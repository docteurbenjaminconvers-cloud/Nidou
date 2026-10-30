import { createHash, randomUUID } from "node:crypto";
import type { Db, HouseholdRow } from "./db.js";
import { newToken } from "./db.js";
import { FORMULES, type Formule } from "./abonnement.js";

/**
 * Veille bancaire d'un proche (parent âgé, personne aidée) : alertes anti-arnaque en LECTURE SEULE.
 *
 * Garde-fous, tous appliqués par le code :
 *  1. Lecture seule : aucun virement, aucune action sur le compte ; seulement des alertes.
 *  2. Consentement de la personne elle-même, sur son propre lien, horodaté, valable 1 an, retirable seule à tout moment.
 *     Sous tutelle : le tuteur désigné par le juge autorise, jugement joint. Sous curatelle : la personne ET le curateur.
 *     Habilitation familiale ou mandat de protection future : la personne habilitée, acte joint.
 *     Personne qui ne peut plus consentir sans mesure de protection : refus, orientation vers le juge.
 *  3. Transparence : la personne voit qui a accès ; les proches désignés (« témoins ») reçoivent les mêmes alertes.
 *  4. Journal chaîné (empreintes SHA-256) : toute modification ultérieure se détecte ; exportable.
 *  5. Fin automatique : retrait du consentement, décès déclaré, fin de mesure, consentement expiré (suspension).
 *  6. Opérations du proche séparées du budget familial, effacées après la fin (LUCIEN_VEILLE_CONSERVATION_JOURS).
 *
 * La fonction est fermée par défaut (LUCIEN_VEILLE=1 pour l'ouvrir) tant que les conditions n'ont pas été validées par un avocat.
 */

export const veilleOuverte = () => process.env.LUCIEN_VEILLE === "1";
export const CONSENTEMENT_JOURS = 365;
export const PRIX_VEILLE = { mensuel: 3.9, annuel: 39 };
const conservationJours = () => Number(process.env.LUCIEN_VEILLE_CONSERVATION_JOURS ?? 90);

export type Mesure = "aucune" | "curatelle" | "tutelle" | "habilitation_familiale" | "mandat_protection_future";
export type Statut = "attente_consentement" | "active" | "suspendue" | "terminee";
export const MESURE_LABEL: Record<Mesure, string> = {
  aucune: "aucune mesure de protection",
  curatelle: "curatelle",
  tutelle: "tutelle",
  habilitation_familiale: "habilitation familiale",
  mandat_protection_future: "mandat de protection future",
};

export interface VeilleRow {
  id: string;
  household_id: string;
  member_id: string;
  aidant_user_id: string | null;
  aidant_nom: string;
  mesure: Mesure;
  acte_document_id: string | null;      // jugement, acte d'habilitation ou mandat
  aidant_qualite: string | null;        // « tuteur désigné », « curateur », « personne habilitée »…
  temoins: string;                      // JSON [{nom, email}]
  statut: Statut;
  jeton: string;                        // lien personnel de la personne protégée
  consentement_le: string | null;
  consentement_par: string | null;
  consentement_expire: string | null;
  bridge_user_uuid: string | null;
  banque_connectee: number;
  cree_le: string;
  fin_le: string | null;
  motif_fin: string | null;
}

export interface Temoin { nom: string; email: string | null }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS veilles (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL,
  aidant_user_id TEXT, aidant_nom TEXT NOT NULL, mesure TEXT NOT NULL, acte_document_id TEXT, aidant_qualite TEXT,
  temoins TEXT NOT NULL DEFAULT '[]', statut TEXT NOT NULL, jeton TEXT NOT NULL UNIQUE,
  consentement_le TEXT, consentement_par TEXT, consentement_expire TEXT,
  bridge_user_uuid TEXT, banque_connectee INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL, fin_le TEXT, motif_fin TEXT
);
CREATE TABLE IF NOT EXISTS veille_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT, veille_id TEXT NOT NULL, quand TEXT NOT NULL, acteur TEXT NOT NULL,
  action TEXT NOT NULL, details TEXT, empreinte_prec TEXT NOT NULL, empreinte TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS veille_operations (
  id TEXT PRIMARY KEY, veille_id TEXT NOT NULL, date TEXT NOT NULL, libelle TEXT NOT NULL, montant REAL NOT NULL,
  empreinte TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS veille_alertes (
  id TEXT PRIMARY KEY, veille_id TEXT NOT NULL, operation_id TEXT, type TEXT NOT NULL, gravite TEXT NOT NULL,
  titre TEXT NOT NULL, detail TEXT NOT NULL, quand TEXT NOT NULL, vue INTEGER NOT NULL DEFAULT 0,
  UNIQUE (veille_id, operation_id, type)
);
`;

export function ensureVeilleSchema(db: Db) {
  db.raw.exec(SCHEMA);
  const cols = (db.raw.prepare("PRAGMA table_info(households)").all() as unknown as { name: string }[]).map((c) => c.name);
  if (!cols.includes("veilles_supp")) db.raw.exec("ALTER TABLE households ADD COLUMN veilles_supp INTEGER NOT NULL DEFAULT 0");
}

const now = () => new Date().toISOString();
const get = (db: Db, id: string) => db.raw.prepare("SELECT * FROM veilles WHERE id = ?").get(id) as VeilleRow | undefined;
export const veilleParJeton = (db: Db, jeton: string) => db.raw.prepare("SELECT * FROM veilles WHERE jeton = ?").get(jeton) as VeilleRow | undefined;
export const veilleParId = get;
export const veillesDuFoyer = (db: Db, household_id: string) => db.raw.prepare("SELECT * FROM veilles WHERE household_id = ? ORDER BY cree_le DESC").all(household_id) as unknown as VeilleRow[];
const majVeille = (db: Db, id: string, patch: Partial<VeilleRow>) => {
  const keys = Object.keys(patch) as (keyof VeilleRow)[];
  db.raw.prepare(`UPDATE veilles SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] as never), id);
};

// ---------- journal chaîné ----------
const empreinte = (prec: string, quand: string, acteur: string, action: string, details: string) =>
  createHash("sha256").update([prec, quand, acteur, action, details].join("␟")).digest("hex");

export function journaliser(db: Db, veille_id: string, acteur: string, action: string, details: Record<string, unknown> = {}) {
  const last = db.raw.prepare("SELECT empreinte FROM veille_journal WHERE veille_id = ? ORDER BY id DESC LIMIT 1").get(veille_id) as { empreinte: string } | undefined;
  const prec = last?.empreinte ?? "0".repeat(64);
  const quand = now(), d = JSON.stringify(details);
  db.raw.prepare("INSERT INTO veille_journal (veille_id, quand, acteur, action, details, empreinte_prec, empreinte) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(veille_id, quand, acteur, action, d, prec, empreinte(prec, quand, acteur, action, d));
}

export function journal(db: Db, veille_id: string) {
  return db.raw.prepare("SELECT quand, acteur, action, details, empreinte_prec, empreinte FROM veille_journal WHERE veille_id = ? ORDER BY id").all(veille_id) as unknown as { quand: string; acteur: string; action: string; details: string; empreinte_prec: string; empreinte: string }[];
}

/** Recomputes the chain: any edited, inserted or deleted line breaks it. */
export function verifierJournal(db: Db, veille_id: string): { intact: boolean; lignes: number; rupture: number | null } {
  const lignes = journal(db, veille_id);
  let prec = "0".repeat(64);
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (l.empreinte_prec !== prec || l.empreinte !== empreinte(prec, l.quand, l.acteur, l.action, l.details ?? "")) return { intact: false, lignes: lignes.length, rupture: i + 1 };
    prec = l.empreinte;
  }
  return { intact: true, lignes: lignes.length, rupture: null };
}

// ---------- capacité (facturation) ----------
export function capaciteVeilles(db: Db, h: HouseholdRow): number {
  const plan = db.effectivePlan(h);
  if (plan === "gratuit") return 0;
  const supp = (db.raw.prepare("SELECT veilles_supp FROM households WHERE id = ?").get(h.id) as { veilles_supp: number } | undefined)?.veilles_supp ?? 0;
  const formule = h.plan === "famille" ? ((h.formule as Formule) ?? "duo") : "tribu"; // trial = Tribu
  return (formule === "tribu" ? 1 : 0) + supp;
}
export const veillesEnCours = (db: Db, household_id: string) => veillesDuFoyer(db, household_id).filter((v) => v.statut !== "terminee").length;
export function setVeillesSupp(db: Db, household_id: string, n: number) { db.raw.prepare("UPDATE households SET veilles_supp = ? WHERE id = ?").run(Math.max(0, n), household_id); }

// ---------- création ----------
export class RefusVeille extends Error { constructor(public code: string, message: string) { super(message); } }

export function creerVeille(db: Db, h: HouseholdRow, input: {
  member_id: string; aidant_user_id: string | null; aidant_nom: string; mesure: Mesure; acte_document_id?: string | null; aidant_qualite?: string | null;
  temoins?: Temoin[]; personne_peut_consentir: boolean;
}): VeilleRow {
  const m = db.getMember(input.member_id);
  if (!m || m.household_id !== h.id) throw new RefusVeille("membre", "Personne introuvable dans ce foyer.");
  if (m.role !== "parent_a_charge" && m.role !== "autre_a_charge") throw new RefusVeille("membre", "La veille bancaire concerne un parent ou une personne aidée.");
  if (veillesDuFoyer(db, h.id).some((v) => v.member_id === m.id && v.statut !== "terminee")) throw new RefusVeille("doublon", `Une veille existe déjà pour ${m.prenom}.`);
  if (input.mesure === "aucune" && !input.personne_peut_consentir) {
    throw new RefusVeille("consentement_impossible", `Sans mesure de protection, ${m.prenom} doit pouvoir donner son accord elle-même. Si ce n'est plus possible, une mesure doit être demandée au juge des contentieux de la protection (tribunal judiciaire) : tutelle, curatelle ou habilitation familiale. Lucien ne peut pas l'activer à sa place.`);
  }
  if (input.mesure !== "aucune") {
    const doc = input.acte_document_id ? db.getDocument(input.acte_document_id) : undefined;
    if (!doc || doc.household_id !== h.id) throw new RefusVeille("acte_manquant", `Joignez le ${input.mesure === "mandat_protection_future" ? "mandat de protection future" : input.mesure === "habilitation_familiale" ? "jugement d'habilitation familiale" : `jugement de ${MESURE_LABEL[input.mesure]}`} (ajoutez-le dans Papiers, puis choisissez-le ici).`);
    if (!input.aidant_qualite?.trim()) throw new RefusVeille("qualite", "Précisez votre qualité dans la mesure (tuteur, curateur, personne habilitée, mandataire).");
  }
  if (veillesEnCours(db, h.id) >= capaciteVeilles(db, h)) {
    throw new RefusVeille("veille_payante", db.effectivePlan(h) === "gratuit"
      ? "La veille bancaire d'un proche demande une formule payante."
      : `La veille d'un proche coûte ${PRIX_VEILLE.mensuel.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € par mois (${PRIX_VEILLE.annuel} € par an) ; la formule Tribu en comprend une.`);
  }
  const v: VeilleRow = {
    id: randomUUID(), household_id: h.id, member_id: m.id, aidant_user_id: input.aidant_user_id, aidant_nom: input.aidant_nom,
    mesure: input.mesure, acte_document_id: input.acte_document_id ?? null, aidant_qualite: input.aidant_qualite ?? null,
    temoins: JSON.stringify((input.temoins ?? []).filter((t) => t.nom.trim())), statut: "attente_consentement", jeton: newToken(),
    consentement_le: null, consentement_par: null, consentement_expire: null, bridge_user_uuid: null, banque_connectee: 0, cree_le: now(), fin_le: null, motif_fin: null,
  };
  db.raw.prepare(`INSERT INTO veilles (id, household_id, member_id, aidant_user_id, aidant_nom, mesure, acte_document_id, aidant_qualite, temoins, statut, jeton, cree_le)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(v.id, v.household_id, v.member_id, v.aidant_user_id, v.aidant_nom, v.mesure, v.acte_document_id, v.aidant_qualite, v.temoins, v.statut, v.jeton, v.cree_le);
  journaliser(db, v.id, v.aidant_nom, "demande", { personne: m.prenom, mesure: v.mesure, qualite: v.aidant_qualite, acte: v.acte_document_id, temoins: JSON.parse(v.temoins) });
  return v;
}

/** Who must agree, in plain words, for the person's own page. */
export function quiConsent(v: VeilleRow, prenom: string): { personne: boolean; representant: boolean; texte: string } {
  switch (v.mesure) {
    case "aucune": return { personne: true, representant: false, texte: `${prenom} donne son accord elle-même.` };
    case "curatelle": return { personne: true, representant: true, texte: `${prenom} donne son accord, avec son curateur ou sa curatrice (${v.aidant_nom}).` };
    case "tutelle": return { personne: false, representant: true, texte: `Le tuteur désigné par le juge (${v.aidant_nom}) autorise la veille ; ${prenom} en est informée.` };
    default: return { personne: false, representant: true, texte: `${v.aidant_nom}, ${MESURE_LABEL[v.mesure]}, autorise la veille dans les limites de l'acte ; ${prenom} en est informée.` };
  }
}

/** The person's (or representative's) agreement, given on the personal link. */
export function consentir(db: Db, v: VeilleRow, input: { nom_signataire: string; en_qualite_de: "personne" | "representant"; accepte: boolean }) {
  if (v.statut === "terminee") throw new RefusVeille("terminee", "Cette veille est terminée.");
  if (!input.accepte || input.nom_signataire.trim().length < 2) throw new RefusVeille("signature", "Écrivez votre nom et cochez la case pour donner votre accord.");
  const m = db.getMember(v.member_id)!;
  const qui = quiConsent(v, m.prenom);
  if (input.en_qualite_de === "personne" && !qui.personne) throw new RefusVeille("qualite", "Sous cette mesure, c'est le représentant désigné qui autorise.");
  const deja = (v.consentement_par ?? "").split(",").filter(Boolean);
  const parts = Array.from(new Set([...deja, input.en_qualite_de]));
  const complet = (!qui.personne || parts.includes("personne")) && (!qui.representant || parts.includes("representant"));
  const expire = new Date(Date.now() + CONSENTEMENT_JOURS * 864e5).toISOString();
  majVeille(db, v.id, { consentement_par: parts.join(","), ...(complet ? { statut: "active" as Statut, consentement_le: now(), consentement_expire: expire } : {}) });
  journaliser(db, v.id, input.nom_signataire.trim(), "consentement", { en_qualite_de: input.en_qualite_de, complet, valable_jusqu_au: complet ? expire.slice(0, 10) : null });
  return get(db, v.id)!;
}

export function terminer(db: Db, v: VeilleRow, acteur: string, motif: "retrait_consentement" | "deces" | "fin_mesure" | "demande_aidant") {
  if (v.statut === "terminee") return v;
  majVeille(db, v.id, { statut: "terminee", fin_le: now(), motif_fin: motif, banque_connectee: 0 });
  journaliser(db, v.id, acteur, "fin", { motif, effacement_operations_le: new Date(Date.now() + conservationJours() * 864e5).toISOString().slice(0, 10) });
  return get(db, v.id)!;
}

/** Daily: suspends expired consents and erases the operations of ended watches past the retention period. */
export function entretienVeilles(db: Db): { suspendues: number; effacees: number } {
  let suspendues = 0, effacees = 0;
  for (const v of db.raw.prepare("SELECT * FROM veilles WHERE statut = 'active' AND consentement_expire < ?").all(now()) as unknown as VeilleRow[]) {
    majVeille(db, v.id, { statut: "suspendue" });
    journaliser(db, v.id, "Lucien", "suspension", { motif: "consentement expiré, à renouveler" });
    suspendues++;
  }
  const limite = new Date(Date.now() - conservationJours() * 864e5).toISOString();
  for (const v of db.raw.prepare("SELECT * FROM veilles WHERE statut = 'terminee' AND fin_le < ?").all(limite) as unknown as VeilleRow[]) {
    const n = Number(db.raw.prepare("DELETE FROM veille_operations WHERE veille_id = ?").run(v.id).changes);
    db.raw.prepare("DELETE FROM veille_alertes WHERE veille_id = ?").run(v.id);
    if (n) { journaliser(db, v.id, "Lucien", "effacement", { operations: n }); effacees += n; }
  }
  return { suspendues, effacees };
}

// ---------- opérations et alertes anti-arnaque ----------
export interface OperationVeille { date: string; libelle: string; montant: number }

export function ajouterOperations(db: Db, v: VeilleRow, ops: OperationVeille[]): { ajoutees: number; nouvelles: Alerte[] } {
  if (v.statut !== "active") return { ajoutees: 0, nouvelles: [] };
  let n = 0;
  const ins = db.raw.prepare("INSERT OR IGNORE INTO veille_operations (id, veille_id, date, libelle, montant, empreinte) VALUES (?, ?, ?, ?, ?, ?)");
  for (const o of ops) {
    const fp = createHash("sha1").update(`${v.id}|${o.date}|${o.libelle}|${o.montant}`).digest("hex");
    n += Number(ins.run(randomUUID(), v.id, o.date, o.libelle, o.montant, fp).changes);
  }
  return { ajoutees: n, nouvelles: analyser(db, v) };
}

const MOTS_ARNAQUE: [RegExp, string][] = [
  [/\b(pcs|transcash|neosurf|paysafe(card)?|toneo|carte ?cadeau|gift ?card|itunes|google ?play|steam)\b/i, "carte prépayée ou carte cadeau"],
  [/\b(binance|coinbase|kraken|crypto|bitcoin|btc|usdt|bitpanda|paymium)\b/i, "plateforme de cryptomonnaie"],
  [/\b(western ?union|moneygram|ria ?money|worldremit|azimo)\b/i, "transfert d'argent international"],
];

export type Alerte = { operation_id: string | null; type: string; gravite: "urgente" | "attention"; titre: string; detail: string };

export function detecterAlertes(ops: (OperationVeille & { id: string })[]): Alerte[] {
  const out: Alerte[] = [];
  const debits = ops.filter((o) => o.montant < 0);
  const montants = debits.map((o) => -o.montant).sort((a, b) => a - b);
  const mediane = montants.length ? montants[Math.floor(montants.length / 2)] : 0;
  const benefsConnus = new Set<string>();
  const parDate = [...ops].sort((a, b) => a.date.localeCompare(b.date));
  for (const o of parDate) {
    const lib = o.libelle;
    const montant = -o.montant;
    for (const [re, quoi] of MOTS_ARNAQUE) {
      if (o.montant < 0 && re.test(lib)) out.push({ operation_id: o.id, type: "mot_cle", gravite: "urgente", titre: `${montant.toLocaleString("fr-FR")} € vers ${quoi}`, detail: `« ${lib} » le ${o.date}. C'est le moyen de paiement le plus utilisé par les escrocs (faux conseiller bancaire, faux petit-fils, faux support technique). Appelez votre proche avant toute chose.` });
    }
    const vir = lib.match(/\b(vir(ement)?|sepa)\b.*?(?:vers|a|à|pour|benef(iciaire)?)?\s*([A-Z][A-Z .'-]{3,})$/i);
    if (o.montant < 0 && /\bvir/i.test(lib)) {
      const benef = (vir?.[4] ?? lib).trim().toUpperCase();
      if (!benefsConnus.has(benef) && montant >= 150) out.push({ operation_id: o.id, type: "nouveau_beneficiaire", gravite: montant >= 1000 ? "urgente" : "attention", titre: `Virement de ${montant.toLocaleString("fr-FR")} € à un nouveau bénéficiaire`, detail: `« ${lib} » le ${o.date}. Premier virement vers ce destinataire.` });
      benefsConnus.add(benef);
    }
    if (o.montant < 0 && montant >= Math.max(500, mediane * 5)) out.push({ operation_id: o.id, type: "montant_inhabituel", gravite: montant >= 2000 ? "urgente" : "attention", titre: `Dépense inhabituelle de ${montant.toLocaleString("fr-FR")} €`, detail: `« ${lib} » le ${o.date}, bien au-dessus des dépenses habituelles (${mediane.toLocaleString("fr-FR")} € en médiane).` });
    if (o.montant < 0 && /\b(retrait|dab|distributeur)\b/i.test(lib)) {
      const memeSemaine = debits.filter((d) => /\b(retrait|dab|distributeur)\b/i.test(d.libelle) && Math.abs(new Date(d.date).getTime() - new Date(o.date).getTime()) <= 7 * 864e5);
      if (memeSemaine.length >= 3 && memeSemaine[memeSemaine.length - 1].id === o.id) out.push({ operation_id: o.id, type: "retraits", gravite: "attention", titre: `${memeSemaine.length} retraits d'espèces en une semaine`, detail: `${memeSemaine.reduce((s, d) => s - d.montant, 0).toLocaleString("fr-FR")} € retirés. Des retraits répétés peuvent signaler une pression (démarchage à domicile, « ami » insistant).` });
    }
  }
  // New recurring direct debits (door-to-door or phone selling).
  const prel = debits.filter((o) => /\b(prlv|prelevement|prélèvement)\b/i.test(o.libelle));
  const premieres = new Map<string, OperationVeille & { id: string }>();
  for (const p of prel) { const k = p.libelle.replace(/\d+/g, "").trim().toUpperCase(); if (!premieres.has(k)) premieres.set(k, p); }
  const recentes = [...premieres.values()].filter((p) => Date.now() - new Date(p.date).getTime() < 45 * 864e5);
  if (recentes.length >= 2) out.push({ operation_id: recentes[recentes.length - 1].id, type: "nouveaux_prelevements", gravite: "attention", titre: `${recentes.length} nouveaux prélèvements ce mois-ci`, detail: `${recentes.map((r) => r.libelle).join(", ")}. Vérifiez qu'ils ont été souscrits en connaissance de cause (démarchage téléphonique, abonnements cachés).` });
  // One alert per operation: the most specific one (scam keyword, then new beneficiary, then amount).
  const vues = new Set<string>();
  return out.filter((a) => !a.operation_id || a.type === "retraits" || a.type === "nouveaux_prelevements" || (!vues.has(a.operation_id) && (vues.add(a.operation_id), true)));
}

function analyser(db: Db, v: VeilleRow): Alerte[] {
  const nouvelles: Alerte[] = [];
  const ops = db.raw.prepare("SELECT id, date, libelle, montant FROM veille_operations WHERE veille_id = ?").all(v.id) as unknown as (OperationVeille & { id: string })[];
  const ins = db.raw.prepare("INSERT OR IGNORE INTO veille_alertes (id, veille_id, operation_id, type, gravite, titre, detail, quand) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const a of detecterAlertes(ops)) {
    const r = ins.run(randomUUID(), v.id, a.operation_id, a.type, a.gravite, a.titre, a.detail, now());
    if (Number(r.changes)) { journaliser(db, v.id, "Lucien", "alerte", { type: a.type, gravite: a.gravite, titre: a.titre }); nouvelles.push(a); }
  }
  return nouvelles;
}

export function alertes(db: Db, veille_id: string) {
  return db.raw.prepare("SELECT id, type, gravite, titre, detail, quand, vue FROM veille_alertes WHERE veille_id = ? ORDER BY vue, (gravite = 'urgente') DESC, quand DESC").all(veille_id) as unknown as { id: string; type: string; gravite: string; titre: string; detail: string; quand: string; vue: number }[];
}

/** Fictional statement of an elderly person's account, with two scam patterns, for the demo and the simulated bank. */
export function operationsSimulees(): OperationVeille[] {
  const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  return [
    { date: d(58), libelle: "VIR PENSION CARSAT", montant: 1420 }, { date: d(55), libelle: "PRLV EDF", montant: -62 },
    { date: d(52), libelle: "CB INTERMARCHE UZES", montant: -48.3 }, { date: d(45), libelle: "CB PHARMACIE DU MARCHE", montant: -18.9 },
    { date: d(40), libelle: "CB BOULANGERIE", montant: -7.2 }, { date: d(30), libelle: "VIR PENSION CARSAT", montant: 1420 },
    { date: d(28), libelle: "PRLV EDF", montant: -62 }, { date: d(25), libelle: "CB INTERMARCHE UZES", montant: -52.1 },
    { date: d(14), libelle: "PRLV ASSUR OBSEQUES DIRECT", montant: -39.9 }, { date: d(12), libelle: "PRLV TELESURVEILLANCE PLUS", montant: -29.9 },
    { date: d(6), libelle: "RETRAIT DAB UZES", montant: -200 }, { date: d(5), libelle: "RETRAIT DAB UZES", montant: -200 },
    { date: d(3), libelle: "RETRAIT DAB NIMES", montant: -300 }, { date: d(2), libelle: "CB TRANSCASH RECHARGE", montant: -500 },
    { date: d(1), libelle: "VIR SEPA VERS M DUBOIS ALEXANDRE", montant: -2400 },
  ];
}

/** Public view for the protected person's own page: who sees what, and the way out. */
export function vuePersonne(db: Db, v: VeilleRow) {
  const m = db.getMember(v.member_id)!;
  const h = db.getHousehold(v.household_id)!;
  const qui = quiConsent(v, m.prenom);
  const parts = (v.consentement_par ?? "").split(",").filter(Boolean);
  return {
    prenom: m.prenom, nid: h.nom, aidant: v.aidant_nom, aidant_qualite: v.aidant_qualite, mesure: v.mesure, mesure_label: MESURE_LABEL[v.mesure],
    statut: v.statut, qui_consent: qui, accords_donnes: parts, consentement_le: v.consentement_le, consentement_expire: v.consentement_expire,
    temoins: JSON.parse(v.temoins) as Temoin[], banque_connectee: Boolean(v.banque_connectee),
    acces: [{ nom: v.aidant_nom, role: v.aidant_qualite ?? "aidant" }, ...(JSON.parse(v.temoins) as Temoin[]).map((t) => ({ nom: t.nom, role: "témoin, reçoit les mêmes alertes" }))],
    engagements: [
      "Lucien ne voit vos opérations qu'en lecture : personne ne peut faire de virement ni rien modifier sur votre compte.",
      "Vous n'avez jamais à donner votre code bancaire à quelqu'un d'autre ; vous vous connectez vous-même à votre banque.",
      "Vous voyez ici qui reçoit les alertes. Chaque consultation est notée dans un journal que l'on ne peut pas modifier.",
      `Votre accord vaut un an. Vous pouvez le retirer à tout moment, seul·e, depuis cette page.`,
    ],
    derniers_acces: journal(db, v.id).filter((l) => l.action === "consultation").slice(-5).map((l) => ({ quand: l.quand, qui: l.acteur })),
  };
}

export function marquerConsultation(db: Db, v: VeilleRow, acteur: string) { journaliser(db, v.id, acteur, "consultation", {}); }
export function setBanque(db: Db, v: VeilleRow, patch: { bridge_user_uuid?: string | null; banque_connectee?: number }) { majVeille(db, v.id, patch as Partial<VeilleRow>); }
export const veilleParBridgeUser = (db: Db, uuid: string) => db.raw.prepare("SELECT * FROM veilles WHERE bridge_user_uuid = ?").get(uuid) as VeilleRow | undefined;
export { FORMULES };
