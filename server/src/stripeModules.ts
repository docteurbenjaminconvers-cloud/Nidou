/**
 * Modules and packs on Stripe. One subscription per household: the socle (Solo/Duo/Tribu) + one line per module,
 * or one line for a pack (the pack's price depends on the formule, because the pack total is rounded with the socle).
 *
 * Prices are created once with scripts/stripe-prix.ts, which prints the environment variables:
 *   STRIPE_PRICE_<MODULE>_<PERIODE>              BUDGET_EXPERT, VIE_PRO_SALARIE, VIE_PRO_INDEPENDANT, LOCATIF, ASSISTANT, VEILLE
 *   STRIPE_PRICE_LOCATIF_BIEN_<PERIODE>          each property beyond the 2 included (quantity)
 *   STRIPE_PRICE_PACK_<PACK>_<FORMULE>_<PERIODE> pack line, socle excluded
 * The socle keeps its own prices (STRIPE_PRICE_<FORMULE>_<PERIODE>, abonnement.ts).
 */
import { devis, LOCATIF_BIENS_INCLUS, MODULES, normaliser, PACKS, SOCLE, type Formule, type ModuleId, type Periode } from "./offre.js";

export interface LigneStripe { cle: string; env: string; quantite: number; libelle: string; mensuel: number }
const P = (p: Periode) => p.toUpperCase();

export const envModule = (m: ModuleId, p: Periode) => `STRIPE_PRICE_${m.toUpperCase()}_${P(p)}`;
export const envBien = (p: Periode) => `STRIPE_PRICE_LOCATIF_BIEN_${P(p)}`;
export const envPack = (pack: string, f: Formule, p: Periode) => `STRIPE_PRICE_PACK_${pack.toUpperCase()}_${f.toUpperCase()}_${P(p)}`;

export interface ChoixModules { formule: Formule; periode: Periode; modules: ModuleId[]; pack: string | null; biens?: number; proches?: number }

/** The module and pack lines a choice needs (socle excluded), each with its env var and quantity. */
export function lignesModules(c: ChoixModules): LigneStripe[] {
  const pack = PACKS.find((p) => p.id === c.pack) ?? null;
  const dansPack = new Set<ModuleId>(pack?.modules ?? []);
  if (dansPack.has("vie_pro_independant")) dansPack.add("vie_pro_salarie");
  const out: LigneStripe[] = [];
  if (pack) {
    const d = devis({ formule: c.formule, periode: "mensuel", modules: [], pack: pack.id, biens: Math.min(c.biens ?? 0, LOCATIF_BIENS_INCLUS) });
    out.push({ cle: `pack:${pack.id}`, env: envPack(pack.id, c.formule, c.periode), quantite: 1, libelle: `Pack ${pack.nom}`, mensuel: Math.round((d.mensuel - SOCLE[c.formule].mensuel) * 100) / 100 });
  }
  for (const m of normaliser(c.modules)) {
    if (dansPack.has(m)) continue;
    out.push({ cle: m, env: envModule(m, c.periode), quantite: m === "veille" ? Math.max(1, c.proches ?? 1) : 1, libelle: MODULES[m].nom, mensuel: MODULES[m].mensuel });
  }
  // Properties beyond the 2 included, whether the property module comes alone or in a pack.
  const locatif = dansPack.has("locatif") || c.modules.includes("locatif");
  const supp = Math.max(0, (c.biens ?? 0) - LOCATIF_BIENS_INCLUS);
  if (locatif && supp > 0) out.push({ cle: "locatif_bien", env: envBien(c.periode), quantite: supp, libelle: "Bien supplémentaire", mensuel: 1.5 });
  return out;
}

/** Every module/pack env var we may bill, for reading a subscription back. */
export function tousLesPrix(): { env: string; cle: string; periode: Periode; formule?: Formule }[] {
  const out: { env: string; cle: string; periode: Periode; formule?: Formule }[] = [];
  for (const p of ["mensuel", "annuel"] as Periode[]) {
    for (const m of Object.keys(MODULES) as ModuleId[]) out.push({ env: envModule(m, p), cle: m, periode: p });
    out.push({ env: envBien(p), cle: "locatif_bien", periode: p });
    for (const pk of PACKS) for (const f of Object.keys(SOCLE) as Formule[]) out.push({ env: envPack(pk.id, f, p), cle: `pack:${pk.id}`, periode: p, formule: f });
  }
  return out;
}

/** Modules a subscription's billed items give access to (price ids → modules, packs expanded). */
export function modulesDepuisItems(items: { price: { id: string }; quantity?: number }[], env: Record<string, string | undefined> = process.env): { modules: ModuleId[]; pack: string | null; biens_supp: number; proches: number } {
  const parId = new Map<string, string>();
  for (const x of tousLesPrix()) { const id = env[x.env]; if (id) parId.set(id, x.cle); }
  // legacy option prices (abonnement.ts) count as the same modules
  for (const [k, cle] of [["STRIPE_PRICE_ASSISTANT_MENSUEL", "assistant"], ["STRIPE_PRICE_ASSISTANT_ANNUEL", "assistant"], ["STRIPE_PRICE_VEILLE_MENSUEL", "veille"], ["STRIPE_PRICE_VEILLE_ANNUEL", "veille"]] as const) if (env[k]) parId.set(env[k]!, cle);
  const mods = new Set<ModuleId>();
  let pack: string | null = null, biens_supp = 0, proches = 0;
  for (const it of items) {
    const cle = parId.get(it.price.id);
    if (!cle) continue;
    if (cle.startsWith("pack:")) { pack = cle.slice(5); for (const m of PACKS.find((p) => p.id === pack)?.modules ?? []) mods.add(m); }
    else if (cle === "locatif_bien") biens_supp += it.quantity ?? 1;
    else { mods.add(cle as ModuleId); if (cle === "veille") proches += it.quantity ?? 1; }
  }
  return { modules: normaliser([...mods]), pack, biens_supp, proches };
}

/** Env vars a choice needs that are not configured (so we never open a checkout with a missing line). */
export const prixManquants = (lignes: LigneStripe[], env: Record<string, string | undefined> = process.env) => lignes.filter((l) => !env[l.env]).map((l) => l.env);

/**
 * Item changes to bring an existing subscription to the wanted module lines, leaving the socle (and anything
 * that is not a module/pack price) untouched.
 */
export function ecartItems(actuels: { id: string; price: { id: string }; quantity?: number }[], voulus: LigneStripe[], env: Record<string, string | undefined> = process.env) {
  const nos = new Set(tousLesPrix().map((x) => env[x.env]).filter(Boolean) as string[]);
  for (const k of ["STRIPE_PRICE_ASSISTANT_MENSUEL", "STRIPE_PRICE_ASSISTANT_ANNUEL", "STRIPE_PRICE_VEILLE_MENSUEL", "STRIPE_PRICE_VEILLE_ANNUEL"]) if (env[k]) nos.add(env[k]!);
  const veut = new Map(voulus.map((l) => [env[l.env]!, l.quantite]));
  const supprimer = actuels.filter((i) => nos.has(i.price.id) && !veut.has(i.price.id)).map((i) => i.id);
  const modifier = actuels.filter((i) => veut.has(i.price.id) && (i.quantity ?? 1) !== veut.get(i.price.id)).map((i) => ({ id: i.id, quantite: veut.get(i.price.id)! }));
  const ajouter = [...veut].filter(([price]) => !actuels.some((i) => i.price.id === price)).map(([price, quantite]) => ({ price, quantite }));
  return { supprimer, modifier, ajouter };
}
