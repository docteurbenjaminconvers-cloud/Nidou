/**
 * L'offre Lucien : un socle (par nombre de comptes) + des modules à la carte + des packs remisés.
 * Fonction pure, partagée par le serveur (droits, devis) et l'appli (écran Offre, démo).
 *
 *   Socle      Solo 6,90 · Duo 9,90 · Tribu 13,90 €/mois  (papiers, échéances, famille, budget simple, point du dimanche…)
 *   Modules    Budget expert 3,90 · Vie pro Salarié 1,90 · Vie pro Indépendant 19,90 · Patrimoine locatif 4,90 (2 biens, +1,50/bien)
 *              Demander à Lucien 2,90 · Veille d'un proche 3,90 par proche
 *   Packs      Sérénité, Indépendant, Patrimoine : remise sur les modules, prix arrondis en ,90 ; Intégral à prix fixe 29,90 · 32,90 · 36,90
 *   Annuel     10 × le mensuel (2 mois offerts)
 */

export type Periode = "mensuel" | "annuel";
export type Formule = "solo" | "duo" | "tribu";
export type ModuleId = "budget_expert" | "vie_pro_salarie" | "vie_pro_micro" | "vie_pro_independant" | "locatif" | "assistant" | "veille";

export const SOCLE: Record<Formule, { nom: string; comptes: number; mensuel: number; pour: string }> = {
  solo: { nom: "Solo", comptes: 1, mensuel: 6.9, pour: "pour vous seul·e" },
  duo: { nom: "Duo", comptes: 2, mensuel: 9.9, pour: "à deux" },
  tribu: { nom: "Tribu", comptes: 6, mensuel: 13.9, pour: "toute la famille, ados et grands-parents" },
};

export const SOCLE_INCLUT = [
  "Papiers illimités, lus par l'IA, par photo ou par email",
  "Échéances, préavis et rappels, agenda du téléphone",
  "Famille : la page de chacun, la semaine, les dates clés",
  "Budget simple : dépenses, abonnements, économies faciles",
  "Le point du dimanche, les dossiers prêts, le coup dur",
  "Connecteur IA (Claude, ChatGPT…)",
];

export interface ModuleDef {
  id: ModuleId; nom: string; accroche: string; mensuel: number; par?: "bien" | "proche";
  inclut: string[]; pour: string; teinte: "lilac" | "moss" | "yolk" | "peach" | "coral"; route: string | null;
}

/** Biens inclus dans le module locatif, et prix de chaque bien au-delà. */
export const LOCATIF_BIENS_INCLUS = 2;
export const LOCATIF_BIEN_SUPP = 1.5;

export const MODULES: Record<ModuleId, ModuleDef> = {
  budget_expert: {
    id: "budget_expert", nom: "Budget expert", mensuel: 3.9, teinte: "moss", route: "module/budget",
    accroche: "Les comptes du foyer tenus comme par un expert-comptable.",
    pour: "Ceux qui veulent savoir où va chaque euro, et ce qu'ils possèdent vraiment.",
    inclut: ["Compte de résultat du foyer, mois par mois", "Budget prévisionnel et écarts poste par poste", "Bilan patrimonial : ce que vous possédez, ce que vous devez", "Ratios : endettement, épargne, épargne de précaution", "Clôture du mois et grand livre exportable"],
  },
  vie_pro_salarie: {
    id: "vie_pro_salarie", nom: "Vie pro · Salarié", mensuel: 1.9, teinte: "lilac", route: "module/pro",
    accroche: "Contrat, avenants, bulletins : votre carrière en ordre, jusqu'à la retraite.",
    pour: "Les salariés, du premier CDI à la retraite.",
    inclut: ["Contrat de travail, avenants, attestations", "Bulletins classés et contrôlés chaque mois", "Cumul du net imposable, avant la déclaration", "Bulletins manquants signalés", "Papiers à garder jusqu'à la retraite"],
  },
  vie_pro_micro: {
    id: "vie_pro_micro", nom: "Vie pro · Micro-entrepreneur", mensuel: 9.9, teinte: "lilac", route: "module/pro",
    accroche: "Chiffre d'affaires, cotisations et déclarations URSSAF, sans y penser.",
    pour: "Auto-entrepreneurs, en activité principale ou en complément d'un salaire.",
    inclut: ["Chiffre d'affaires tenu depuis le compte pro", "Cotisations à payer à chaque déclaration, taux de l'année", "Échéances URSSAF mensuelles ou trimestrielles", "Plafonds du régime et seuils de TVA surveillés", "Accès en lecture pour votre comptable ; Salarié inclus"],
  },
  vie_pro_independant: {
    id: "vie_pro_independant", nom: "Vie pro · Indépendant", mensuel: 19.9, teinte: "lilac", route: "module/pro",
    accroche: "Recettes, dépenses et 2035 préparées depuis votre compte pro.",
    pour: "Professions libérales et EI au régime réel (2035) ; inclut Micro-entrepreneur et Salarié.",
    inclut: ["Livre des recettes et des dépenses tenu depuis la banque", "Dépenses classées dans les rubriques de la 2035", "Bénéfice estimé, micro ou réel : le plus favorable", "Échéances : 2035, 2042-C-PRO, CFE, URSSAF", "Tout le module Salarié inclus"],
  },
  locatif: {
    id: "locatif", nom: "Patrimoine locatif", mensuel: 4.9, par: "bien", teinte: "yolk", route: "module/locatif",
    accroche: "Vos biens loués suivis comme par une agence, sans les frais d'agence.",
    pour: "Propriétaires bailleurs, location nue ou meublée.",
    inclut: ["Loyers rapprochés de la banque, impayés repérés", "Quittances et relances en un geste", "Révision IRL calculée à la date anniversaire", "Rentabilité de chaque bien, charges et taxe foncière", "Micro ou réel : le régime le plus favorable, cases à remplir"],
  },
  assistant: {
    id: "assistant", nom: "Demander à Lucien", mensuel: 2.9, teinte: "peach", route: "assistant",
    accroche: "Posez vos questions, Lucien répond avec vos papiers.",
    pour: "Ceux qui préfèrent demander que chercher.",
    inclut: ["Questions en langage courant", "Réponses tirées de vos papiers et de vos comptes", "Lettres et démarches rédigées"],
  },
  veille: {
    id: "veille", nom: "Veille d'un proche", mensuel: 3.9, par: "proche", teinte: "coral", route: "famille",
    accroche: "Un œil bienveillant sur les comptes d'un parent âgé, avec son accord.",
    pour: "Les aidants.",
    inclut: ["Alertes arnaques et dépenses inhabituelles", "Papiers du proche rangés à part", "Accord du proche ou de son représentant"],
  },
};

export interface PackDef { id: string; nom: string; accroche: string; modules: ModuleId[]; remise: number; vedette?: boolean; prix?: Record<Formule, number> }
export const PACKS: PackDef[] = [
  { id: "serenite", nom: "Sérénité", accroche: "Le foyer piloté comme une petite entreprise.", modules: ["budget_expert", "assistant"], remise: 0.25 },
  { id: "independant", nom: "Indépendant", accroche: "Vie perso et vie pro, enfin au même endroit.", modules: ["budget_expert", "vie_pro_independant", "assistant"], remise: 0.25 },
  { id: "patrimoine", nom: "Patrimoine", accroche: "Pour ceux qui louent un ou plusieurs biens.", modules: ["budget_expert", "locatif", "assistant"], remise: 0.3 },
  { id: "integral", nom: "Intégral", accroche: "Tout Lucien, pour tout gérer.", modules: ["budget_expert", "vie_pro_independant", "locatif", "assistant"], remise: 0.3, vedette: true, prix: { solo: 29.9, duo: 32.9, tribu: 36.9 } },
];

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Prix « psychologique » : arrondi à l'euro le plus proche, moins 10 centimes (12,03 → 11,90). */
const en90 = (n: number) => r2(Math.max(0.9, Math.round(n) - 0.1));
const annuel = (mensuel: number) => r2(mensuel * 10);

/** Monthly price of one module for a household (per-property and per-relative surcharges). */
export function prixModule(id: ModuleId, o: { biens?: number; proches?: number } = {}): number {
  const m = MODULES[id];
  if (id === "locatif") return r2(m.mensuel + Math.max(0, (o.biens ?? 0) - LOCATIF_BIENS_INCLUS) * LOCATIF_BIEN_SUPP);
  if (id === "veille") return r2(m.mensuel * Math.max(1, o.proches ?? 1));
  return m.mensuel;
}

/** Modules that contain others: Indépendant ⊃ Micro-entrepreneur ⊃ Salarié. */
export const INCLUT: Partial<Record<ModuleId, ModuleId[]>> = { vie_pro_independant: ["vie_pro_micro", "vie_pro_salarie"], vie_pro_micro: ["vie_pro_salarie"] };
export const couvre = (a: ModuleId, b: ModuleId) => a === b || !!INCLUT[a]?.includes(b);

/** Never bill a module already contained in another one chosen. */
export function normaliser(modules: ModuleId[]): ModuleId[] {
  const s = new Set(modules.filter((m) => m in MODULES));
  for (const m of [...s]) for (const x of INCLUT[m] ?? []) s.delete(x);
  return [...s];
}

export interface Ligne { libelle: string; mensuel: number; detail?: string }
export interface Devis {
  formule: Formule; periode: Periode; pack: string | null; modules: ModuleId[];
  lignes: Ligne[]; mensuel: number; total: number;   // total = price of the chosen period
  alaCarte: number;                                    // same thing without pack, per month
  economie: number;                                    // per period, thanks to the pack
  conseil: { pack: string; mensuel: number; gain: number } | null; // a pack that would cost less
}

export interface Choix { formule: Formule; periode: Periode; modules: ModuleId[]; pack?: string | null; biens?: number; proches?: number }

export function devis(c: Choix): Devis {
  const pack = PACKS.find((p) => p.id === c.pack) ?? null;
  const mods = normaliser([...(pack?.modules ?? []), ...c.modules]);
  const socle = SOCLE[c.formule].mensuel;
  const opts = { biens: c.biens, proches: c.proches };
  const lignes: Ligne[] = [{ libelle: `Lucien ${SOCLE[c.formule].nom}`, mensuel: socle, detail: `${SOCLE[c.formule].comptes} compte${SOCLE[c.formule].comptes > 1 ? "s" : ""}` }];
  let alaCarte = socle;
  let mensuel = socle;
  const dansPack = new Set(pack?.modules ?? []);
  // Pack: its modules at a discount, rounded to ,90 together with the socle.
  if (pack) {
    const brut = pack.modules.reduce((s, m) => s + prixModule(m, opts), 0);
    alaCarte += brut;
    const total = pack.prix?.[c.formule] ?? en90(socle + brut * (1 - pack.remise)); // a fixed price wins (Intégral: « le prix d'un abonnement internet »)
    lignes.push({ libelle: `Pack ${pack.nom}`, mensuel: r2(total - socle), detail: pack.modules.map((m) => MODULES[m].nom).join(" + ") });
    mensuel = total;
  }
  for (const m of mods) {
    if ([...dansPack].some((p) => couvre(p, m))) continue;
    const p = prixModule(m, opts);
    alaCarte += p; mensuel += p;
    const d = m === "locatif" && (c.biens ?? 0) > LOCATIF_BIENS_INCLUS ? `${c.biens} biens` : m === "veille" && (c.proches ?? 1) > 1 ? `${c.proches} proches` : undefined;
    lignes.push({ libelle: MODULES[m].nom, mensuel: p, detail: d });
  }
  mensuel = r2(mensuel); alaCarte = r2(alaCarte);
  const total = c.periode === "annuel" ? annuel(mensuel) : mensuel;
  const economie = r2((alaCarte - mensuel) * (c.periode === "annuel" ? 10 : 1));
  // Would a pack cover the same modules for less?
  let conseil: Devis["conseil"] = null;
  if (!pack) {
    for (const p of PACKS) {
      const ok = mods.every((m) => p.modules.some((x) => couvre(x, m)) || m === "veille");
      if (!ok) continue;
      const d = devis({ ...c, pack: p.id, modules: mods.filter((m) => m === "veille") });
      if (d.mensuel < mensuel - 0.01 && (!conseil || d.mensuel < conseil.mensuel)) conseil = { pack: p.id, mensuel: d.mensuel, gain: r2(mensuel - d.mensuel) };
    }
  }
  return { formule: c.formule, periode: c.periode, pack: pack?.id ?? null, modules: mods, lignes, mensuel, total, alaCarte, economie, conseil };
}

/** What a household may use. During the trial, everything (to discover the modules). */
export function droits(h: { plan: string; essai_actif: boolean; modules: ModuleId[] }): Set<ModuleId> {
  if (h.essai_actif) return new Set(Object.keys(MODULES) as ModuleId[]);
  if (h.plan !== "famille") return new Set();
  const s = new Set(normaliser(h.modules));
  for (const m of [...s]) for (const x of INCLUT[m] ?? []) s.add(x);
  return s;
}

/** Module data keys stored per household, and the module that unlocks each. */
export const ESPACES = { budget: "budget_expert", pro: "vie_pro_salarie", locatif: "locatif" } as const;
export type Espace = keyof typeof ESPACES;
