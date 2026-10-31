/**
 * La boucle des abonnements : Lucien repère l'abonnement en banque, prépare la résiliation (marche à suivre et lettre),
 * puis vérifie sur les relevés suivants que le prélèvement a bien disparu. Une économie n'est « prouvée » qu'à ce moment-là.
 * If a debit comes back after the notice, Lucien says so and prepares the refund request.
 */
import type { Db, TransactionRow } from "./db.js";

export type Frequence = "mensuel" | "hebdomadaire" | "annuel" | "irregulier";
export type StatutResiliation = "en_cours" | "confirmee" | "encore_prelevee";

export interface SuiviRow {
  household_id: string; cle: string; marchand: string; montant: number; frequence: Frequence;
  demande_le: string; statut: StatutResiliation; dernier_preleve: string | null; maj_le: string;
}

export interface Suivi extends SuiviRow {
  economie_annuelle: number;
  verification_le: string;            // date after which the absence of debit proves the cancellation
  apres_demande: { date: string; montant: number }[]; // debits seen after the request
  message: string;
}

export function ensureResiliationsSchema(db: Db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS resiliations (
    household_id TEXT NOT NULL, cle TEXT NOT NULL, marchand TEXT NOT NULL, montant REAL NOT NULL, frequence TEXT NOT NULL,
    demande_le TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'en_cours', dernier_preleve TEXT, maj_le TEXT NOT NULL,
    PRIMARY KEY (household_id, cle)
  )`);
}

const JOUR = 86400_000;
const plus = (iso: string, jours: number) => new Date(Date.parse(iso) + jours * JOUR).toISOString().slice(0, 10);
const periodeJours = (f: Frequence) => (f === "hebdomadaire" ? 7 : f === "annuel" ? 366 : 31);
export const economieAnnuelle = (montant: number, f: Frequence) => Math.round((f === "hebdomadaire" ? montant * 52 : f === "annuel" ? montant : montant * 12) * 100) / 100;
const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} €`;
const dateFr = (iso: string) => iso.split("-").reverse().join("/");
/** Display name of a merchant key from the bank labels (« basic fit » → « Basic Fit »). */
export const nomMarchand = (m: string) => m.replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/**
 * Pure verdict for one cancellation, from the household's transactions:
 * - one last debit within a period after the request is normal (notice, current month already started);
 * - a debit later than that means the service still charges → « encore prélevée »;
 * - no debit for a full period plus a week after the request → « confirmée », the saving is proven.
 */
export function verifier(s: Pick<SuiviRow, "cle" | "marchand" | "montant" | "frequence" | "demande_le">, txs: Pick<TransactionRow, "date" | "marchand" | "montant">[], aujourdhui: string): { statut: StatutResiliation; verification_le: string; apres_demande: { date: string; montant: number }[]; dernier_preleve: string | null } {
  const p = periodeJours(s.frequence);
  const toleres_jusquau = plus(s.demande_le, p);
  const verification_le = plus(s.demande_le, p + 7);
  const apres = txs.filter((t) => t.marchand === s.cle && t.montant < 0 && t.date > s.demande_le).map((t) => ({ date: t.date, montant: -t.montant })).sort((a, b) => a.date.localeCompare(b.date));
  const dernier = apres.at(-1)?.date ?? null;
  if (apres.some((t) => t.date > toleres_jusquau)) return { statut: "encore_prelevee", verification_le, apres_demande: apres, dernier_preleve: dernier };
  if (aujourdhui >= verification_le) return { statut: "confirmee", verification_le, apres_demande: apres, dernier_preleve: dernier };
  return { statut: "en_cours", verification_le, apres_demande: apres, dernier_preleve: dernier };
}

function message(s: Pick<SuiviRow, "marchand" | "statut">, v: { verification_le: string; apres_demande: { date: string; montant: number }[] }, eco: number): string {
  if (s.statut === "confirmee") return `Plus aucun prélèvement de ${s.marchand} : ${eur(eco)} par an économisés, c'est prouvé.`;
  if (s.statut === "encore_prelevee") {
    const t = v.apres_demande.at(-1)!;
    return `${s.marchand} a encore prélevé ${eur(t.montant)} le ${dateFr(t.date)}, après votre résiliation. Demandez le remboursement : la lettre est prête.`;
  }
  return `Résiliation en cours. Lucien vérifie vos relevés jusqu'au ${dateFr(v.verification_le)}.`;
}

/** Records « j'ai résilié » (idempotent: asking again keeps the first date). */
export function demarrerSuivi(db: Db, householdId: string, r: { cle: string; marchand: string; montant: number; frequence: Frequence }, quand = new Date().toISOString().slice(0, 10)) {
  ensureResiliationsSchema(db);
  db.raw.prepare(`INSERT INTO resiliations (household_id, cle, marchand, montant, frequence, demande_le, statut, maj_le) VALUES (?, ?, ?, ?, ?, ?, 'en_cours', ?)
    ON CONFLICT(household_id, cle) DO NOTHING`).run(householdId, r.cle, r.marchand, r.montant, r.frequence, quand, new Date().toISOString());
  db.setDecision(householdId, `resiliation:${r.cle}`, "en_cours");
}

export function annulerSuivi(db: Db, householdId: string, cle: string) {
  ensureResiliationsSchema(db);
  db.raw.prepare("DELETE FROM resiliations WHERE household_id = ? AND cle = ?").run(householdId, cle);
}

/** All cancellations of a household, re-checked against the transactions; returns those whose status just changed. */
export function suivis(db: Db, householdId: string, txs: Pick<TransactionRow, "date" | "marchand" | "montant">[], aujourdhui = new Date().toISOString().slice(0, 10)): { liste: Suivi[]; changes: Suivi[] } {
  ensureResiliationsSchema(db);
  const rows = db.raw.prepare("SELECT * FROM resiliations WHERE household_id = ? ORDER BY demande_le DESC").all(householdId) as unknown as SuiviRow[];
  const liste: Suivi[] = [], changes: Suivi[] = [];
  for (const r of rows) {
    const v = verifier(r, txs, aujourdhui);
    const eco = economieAnnuelle(r.montant, r.frequence);
    const s: Suivi = { ...r, statut: v.statut, dernier_preleve: v.dernier_preleve, economie_annuelle: eco, verification_le: v.verification_le, apres_demande: v.apres_demande, message: "" };
    s.message = message(s, v, eco);
    if (v.statut !== r.statut || v.dernier_preleve !== r.dernier_preleve) {
      db.raw.prepare("UPDATE resiliations SET statut = ?, dernier_preleve = ?, maj_le = ? WHERE household_id = ? AND cle = ?").run(v.statut, v.dernier_preleve, new Date().toISOString(), householdId, r.cle);
      if (v.statut !== r.statut) changes.push(s);
    }
    liste.push(s);
  }
  return { liste, changes };
}

/** Steps to cancel, whatever the service: the law makes online cancellation simple for contracts taken online. */
export function marcheASuivre(marchand: string, frequence: Frequence): string[] {
  return [
    `Connectez-vous à votre espace client ${marchand} : un bouton « Résilier » ou « Résilier mon contrat » doit y être visible et facile d'accès si le contrat a été souscrit en ligne (obligation légale depuis juin 2023).`,
    "Sinon, envoyez la lettre ci-dessous, par email au service client ou par courrier recommandé, et gardez une copie.",
    frequence === "annuel" ? "Pour un abonnement annuel, vérifiez la date d'échéance : la résiliation peut ne prendre effet qu'à cette date." : "Un dernier prélèvement peut encore passer pour la période commencée : c'est normal.",
    "Revenez ici et touchez « C'est fait, j'ai résilié » : Lucien vérifiera sur vos prochains relevés que le prélèvement a bien disparu.",
  ];
}

/** Cancellation letter for a service found in the bank, without a contract in Lucien. */
export function lettreResiliation(o: { marchand: string; montant: number; expediteur: string; adresse?: string | null; aujourdhui?: string }): string {
  const d = new Date(`${o.aujourdhui ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `${o.expediteur}\n${o.adresse ?? "[votre adresse]"}\n\n${o.marchand}\nService client\n\nLe ${d}\n\nObjet : Résiliation de mon abonnement\nRéférence client : [votre numéro de client]\n\nMadame, Monsieur,\n\nJe vous informe de ma décision de résilier mon abonnement, pour lequel vous prélevez ${eur(o.montant)} sur mon compte.\n\nJe vous remercie de prendre en compte cette résiliation à la date la plus proche permise par les conditions de mon contrat, de cesser tout prélèvement à compter de cette date, et de m'adresser une confirmation écrite indiquant la date effective de fin.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n${o.expediteur}`;
}

/** Refund request when a debit comes back after the cancellation. */
export function lettreRemboursement(o: { marchand: string; demande_le: string; prelevements: { date: string; montant: number }[]; expediteur: string; adresse?: string | null; aujourdhui?: string }): string {
  const d = new Date(`${o.aujourdhui ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const total = o.prelevements.reduce((s, p) => s + p.montant, 0);
  const lignes = o.prelevements.map((p) => `- ${dateFr(p.date)} : ${eur(p.montant)}`).join("\n");
  return `${o.expediteur}\n${o.adresse ?? "[votre adresse]"}\n\n${o.marchand}\nService client\n\nLe ${d}\n\nObjet : Prélèvements après résiliation — demande de remboursement\nRéférence client : [votre numéro de client]\n\nMadame, Monsieur,\n\nJ'ai résilié mon abonnement le ${dateFr(o.demande_le)}. Vous avez pourtant continué à prélever mon compte :\n${lignes}\n\nJe vous demande de cesser immédiatement tout prélèvement et de me rembourser ${eur(Math.round(total * 100) / 100)} sous 30 jours. À défaut, je saisirai le médiateur de la consommation dont vous relevez et je demanderai à ma banque de rejeter vos prochains prélèvements.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n${o.expediteur}`;
}
