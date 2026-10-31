/**
 * Routes of the offer (catalogue, quote, modules of the household) and of the paid spaces
 * (Budget expert, Vie pro, Patrimoine locatif): stored data per household, reports computed on the household's
 * own bank operations and papers. A space answers 402 when its module is not part of the household's offer.
 */
import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "./db.js";
import { devis, droits, ESPACES, MODULES, normaliser, PACKS, SOCLE, SOCLE_INCLUT, type Espace, type ModuleId } from "./offre.js";
import { DONNEES_BUDGET_VIDES, grandLivre, rapportBudget, type DonneesBudget } from "./budgetExpert.js";
import { rapportPro, type DonneesPro } from "./viePro.js";
import { rapportLocatif, type DonneesLocatif } from "./locatif.js";
import { paiementDisponible, PaiementIndisponible, simulationPaiement } from "./abonnement.js";

type Ctx = { household: (c: any) => { id: string; nom: string; plan: string; essai_jours_restants: number | null; plan_souscrit: string; essai_fin: string | null }; isOwner: (c: any) => boolean };

const MODULE_IDS = Object.keys(MODULES) as [ModuleId, ...ModuleId[]];
const num = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txt = (n = 200) => z.string().max(n);

export const schemas = {
  budget: z.object({
    previsionnel: z.record(z.string(), num.min(0).max(1e6)),
    patrimoine: z.object({
      actifs: z.array(z.object({ id: txt(40), libelle: txt(), type: z.enum(["compte", "epargne", "placement", "immobilier", "vehicule", "autre"]), valeur: num.min(0).max(1e9) })).max(100),
      passifs: z.array(z.object({ id: txt(40), libelle: txt(), type: z.enum(["credit_immo", "credit_conso", "autre"]), capital_restant: num.min(0).max(1e9), mensualite: num.min(0).max(1e6) })).max(50),
    }),
    comptes_exclus: z.array(txt(80)).max(20).optional(),
  }),
  pro: z.object({
    personnes: z.array(z.object({
      member_id: z.string().max(60).nullable(), prenom: txt(80),
      salarie: z.object({
        employeur: txt(), poste: txt(), type_contrat: z.enum(["CDI", "CDD", "interim", "apprentissage", "autre"]), date_entree: date, convention: txt().nullable().optional(),
        bulletins: z.array(z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/), brut: num.min(0).max(1e6), net_paye: num.min(0).max(1e6), net_imposable: num.min(0).max(1e6) })).max(600),
      }).nullable().optional(),
      independant: z.object({ activite: txt(), regime: z.enum(["bnc_2035", "micro_bnc"]), compte_pro: txt(80), debut_activite: date.nullable().optional(), rubriques: z.record(z.string(), z.string()).optional() }).nullable().optional(),
    })).max(10),
  }),
  locatif: z.object({
    bailleur: txt(), adresse_bailleur: txt().nullable().optional(),
    biens: z.array(z.object({
      id: txt(40), nom: txt(), adresse: txt(300), type: z.enum(["appartement", "maison", "studio", "local", "parking"]), meuble: z.boolean(), surface: num.min(0).max(1e5).nullable().optional(),
      prix_achat: num.min(0).max(1e9), date_achat: date.nullable().optional(), dpe: z.enum(["A", "B", "C", "D", "E", "F", "G"]).nullable().optional(), dpe_date: date.nullable().optional(),
      taxe_fonciere: num.min(0).max(1e6), assurance_pno: num.min(0).max(1e6), charges_non_recuperables: num.min(0).max(1e6),
      credit_mensualite: num.min(0).max(1e6).nullable().optional(), interets_annuels: num.min(0).max(1e7).nullable().optional(), travaux_annee: num.min(0).max(1e7).nullable().optional(),
    })).max(200),
    baux: z.array(z.object({ id: txt(40), bien_id: txt(40), locataire: txt(), loyer_hc: num.min(0).max(1e6), charges: num.min(0).max(1e6), debut: date, fin: date.nullable().optional(), irl_trimestre: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), irl_base: z.string().regex(/^\d{4}T[1-4]$/).nullable().optional(), depot_garantie: num.min(0).max(1e6), jour_paiement: z.number().int().min(1).max(31) })).max(400),
    encaissements_manuels: z.array(z.object({ bail_id: txt(40), mois: z.string().regex(/^\d{4}-\d{2}$/), montant: num.min(0).max(1e6), date })).max(5000).optional(),
  }),
};

export function monterEspaces(api: Hono<any>, db: Db, ctx: Ctx) {
  const actifs = (c: any) => {
    const h = ctx.household(c);
    return droits({ plan: h.plan, essai_actif: h.plan_souscrit === "gratuit" && !!h.essai_fin && (h.essai_jours_restants ?? 0) > 0, modules: db.getModules(h.id) as ModuleId[] });
  };

  api.get("/offre", (c) => {
    const h = ctx.household(c);
    return c.json({ socle: SOCLE, socle_inclut: SOCLE_INCLUT, modules: MODULES, packs: PACKS, souscrits: db.getModules(h.id), actifs: [...actifs(c)], paiement: paiementDisponible() });
  });

  api.post("/offre/devis", async (c) => {
    const b = z.object({ formule: z.enum(["solo", "duo", "tribu"]), periode: z.enum(["mensuel", "annuel"]), modules: z.array(z.enum(MODULE_IDS)).max(10), pack: z.string().max(30).nullable().optional(), biens: z.number().int().min(0).max(200).optional(), proches: z.number().int().min(0).max(10).optional() }).parse(await c.req.json());
    return c.json(devis(b));
  });

  /** Choosing modules is a payment: simulated on a test instance only; with Stripe, not wired yet (see README). */
  api.post("/offre/modules", async (c) => {
    if (!ctx.isOwner(c)) return c.json({ error: "proprietaire", message: "Seul le propriétaire du foyer gère l'abonnement." }, 403);
    const b = z.object({ modules: z.array(z.enum(MODULE_IDS)).max(10), pack: z.string().max(30).nullable().optional() }).parse(await c.req.json());
    if (!paiementDisponible() || !simulationPaiement()) return c.json({ error: "paiement_indisponible", message: new PaiementIndisponible().message }, 503);
    const pack = PACKS.find((p) => p.id === b.pack);
    const mods = normaliser([...(pack?.modules ?? []), ...b.modules]);
    db.setModules(ctx.household(c).id, mods);
    return c.json({ souscrits: mods, actifs: [...actifs(c)] });
  });

  const verifier = (c: any, e: Espace) => (actifs(c).has(ESPACES[e] as ModuleId) || (e === "pro" && actifs(c).has("vie_pro_independant")));
  const refus = (c: any, e: Espace) => c.json({ error: "module", module: ESPACES[e], message: `Cet espace fait partie du module ${MODULES[ESPACES[e] as ModuleId].nom}.` }, 402);
  const transactions = (hid: string) => db.listTransactions(hid).map((t) => ({ date: t.date, libelle: t.libelle, montant: t.montant, categorie: t.categorie, compte: t.compte }));

  const donnees = (hid: string, e: Espace, nom: string): unknown => {
    const d = db.getModuleData(hid, e);
    if (d) return d;
    if (e === "budget") return DONNEES_BUDGET_VIDES;
    if (e === "pro") return { personnes: db.listMembers(hid).filter((m) => m.role === "adulte").map((m) => ({ member_id: m.id, prenom: m.prenom, salarie: null, independant: null })) } satisfies DonneesPro;
    return { bailleur: nom.replace(/\s*\(démo\)$/, ""), biens: [], baux: [] } satisfies DonneesLocatif;
  };

  api.get("/espaces/:espace", (c) => {
    const e = c.req.param("espace") as Espace;
    if (!(e in ESPACES)) return c.json({ error: "introuvable" }, 404);
    if (!verifier(c, e)) return refus(c, e);
    const h = ctx.household(c);
    const d = donnees(h.id, e, h.nom);
    const txs = transactions(h.id);
    const rapport = e === "budget" ? rapportBudget(txs, d as DonneesBudget)
      : e === "pro" ? rapportPro(d as DonneesPro, txs, db.listDocuments(h.id).map((x) => ({ id: x.id, title: x.title, category: x.category })))
      : rapportLocatif(d as DonneesLocatif, txs);
    return c.json({ donnees: d, rapport, comptes: [...new Set(txs.map((t) => t.compte).filter(Boolean))] });
  });

  api.put("/espaces/:espace", async (c) => {
    const e = c.req.param("espace") as Espace;
    if (!(e in ESPACES)) return c.json({ error: "introuvable" }, 404);
    if (!verifier(c, e)) return refus(c, e);
    const d = schemas[e].parse(await c.req.json());
    db.setModuleData(ctx.household(c).id, e, d);
    return c.json({ ok: true });
  });

  api.get("/espaces/budget/grand-livre.csv", (c) => {
    if (!verifier(c, "budget")) return refus(c, "budget");
    const h = ctx.household(c);
    const d = donnees(h.id, "budget", h.nom) as DonneesBudget;
    return new Response(grandLivre(transactions(h.id), d), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="grand-livre-lucien.csv"`, "x-content-type-options": "nosniff" } });
  });
}
