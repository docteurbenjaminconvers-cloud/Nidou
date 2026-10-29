import { entretienVeilles } from "./veille.js";
import type { Db, HouseholdRow } from "./db.js";
import { budgetReport } from "./budget.js";
import { envoyerPush } from "./push.js";
import { envoyerEmail } from "./mail.js";
import { echeancesFamille } from "./famille.js";

export interface Rappel {
  cle: string;            // unique per household: essai:j2 | essai:dernier | essai:termine
  titre: string;
  corps: string;
  route: string;          // deep link inside the app
}

const euro = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;

/**
 * Reverse-trial reminders for one household, computed from today's state:
 *  - two days before the end (day 13 of 15), - on the last day, - once, after the account is back on free.
 * Pure function: the daily job decides what to send, `rappels_envoyes` guarantees each one goes out once.
 */
export function rappelsEssai(db: Db, h: HouseholdRow, now = new Date()): Rappel[] {
  if (h.plan === "famille" || !h.essai_fin) return [];
  const joursRestants = Math.ceil((new Date(h.essai_fin).getTime() - now.getTime()) / 864e5);
  const budget = budgetReport(db.listTransactions(h.id), db.listDocuments(h.id), db.listDecisions(h.id));
  const eco = budget.economies_possibles;
  const perdu = [eco > 0 ? `${euro(eco)} par an d'économies repérées` : null, "la lecture des papiers par l'IA", budget.nb_transactions ? "le suivi des dépenses" : null].filter(Boolean).join(", ");
  const out: Rappel[] = [];
  if (joursRestants === 2) out.push({ cle: "essai:j2", titre: "Votre plan Famille offert se termine dans 2 jours", corps: `Après, votre compte passe en gratuit et met en pause ${perdu}. Vos papiers et vos rappels restent.`, route: "#/settings" });
  if (joursRestants === 1) out.push({ cle: "essai:dernier", titre: "Dernier jour de votre plan Famille offert", corps: eco > 0 ? `${euro(eco)} par an d'économies sont prêtes à être décidées. Gardez le plan Famille pour 9,90 € par mois.` : "Gardez la lecture IA, la banque et les économies pour 9,90 € par mois ou 99 € par an.", route: "#/settings" });
  if (joursRestants <= 0 && joursRestants > -3) out.push({ cle: "essai:termine", titre: eco > 0 ? `${euro(eco)} par an d'économies vous attendent` : "Votre essai est terminé, vos papiers restent", corps: `Compte passé en gratuit : en pause, ${perdu}. Le plan Famille reprend là où vous en étiez.`, route: "#/settings" });
  return out;
}

/**
 * Deadline reminders due today: stored deadlines (from documents) and computed family ones, each once,
 * when today is within `rappel_jours` of the date (first day of the window), plus the day itself.
 */
export function rappelsEcheances(db: Db, h: HouseholdRow, now = new Date()): Rappel[] {
  const today = now.toISOString().slice(0, 10);
  const out: Rappel[] = [];
  const faits = db.familleFaits(h.id);
  const fam = echeancesFamille(h, db.listMembers(h.id), db.listActivites(h.id), now).filter((e) => !faits.has(e.cle)).map((e) => ({ id: `f:${e.cle}`, titre: e.titre, date: e.date, rappel_jours: e.rappel_jours, note: e.note, document_id: null as string | null }));
  const all = [...db.listDeadlines(h.id).map((d) => ({ id: d.id, titre: d.titre, date: d.date, rappel_jours: d.rappel_jours, note: d.note, document_id: d.document_id })), ...fam];
  for (const d of all) {
    const jours = Math.round((new Date(d.date).getTime() - new Date(today).getTime()) / 864e5);
    if (jours < 0 || jours > d.rappel_jours) continue;
    const first = jours === d.rappel_jours || jours === 0;
    if (!first) continue;
    const quand = jours === 0 ? "Aujourd'hui" : jours === 1 ? "Demain" : `Dans ${jours} jours`;
    out.push({ cle: `echeance:${d.id}:${d.date}:${jours === 0 ? "j" : "avant"}`, titre: `${quand} : ${d.titre.replace(/^[^:]+:\s*/, "")}`, corps: d.note ?? "Ouvrez Nidou pour voir le détail.", route: d.document_id ? `#/doc/${d.document_id}` : "#/deadlines" });
  }
  return out;
}

/** Default transport: push to every device of the household; email too for Famille households (free = push only). */
export async function transportParDefaut(db: Db, h: HouseholdRow, r: Rappel) {
  const n = await envoyerPush(db, h.id, { titre: r.titre, corps: r.corps, url: `/${r.route}`, tag: r.cle.split(":")[0] });
  if (db.effectivePlan(h) === "famille") {
    for (const u of db.usersOfHousehold(h.id)) await envoyerEmail({ to: u.email, subject: r.titre, text: `${r.corps}\n\nOuvrir Nidou : ${(process.env.NIDOU_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "")}/${r.route}` });
  }
  if (!n) console.log(`[rappel] ${h.nom} · ${r.cle} · ${r.titre}`);
}

/** Daily pass over every household: trial reminders and deadline reminders, each sent once. */
export async function passeQuotidienne(db: Db, envoyer: (h: HouseholdRow, r: Rappel) => Promise<void> = (h, r) => transportParDefaut(db, h, r)) {
  let n = 0;
  for (const h of db.listHouseholds()) {
    for (const r of [...rappelsEssai(db, h), ...rappelsEcheances(db, h)]) {
      if (db.marquerRappel(h.id, r.cle)) { await envoyer(h, r); n++; }
    }
  }
  return n;
}

export function demarrerRappels(db: Db) {
  const tick = () => {
    try { entretienVeilles(db); } catch (e) { console.error("[veille]", e); }
    return passeQuotidienne(db).catch((e) => console.error("[rappel]", e));
  };
  setTimeout(tick, 5_000);
  const t = setInterval(tick, 6 * 3600_000); // every 6 h; idempotent thanks to rappels_envoyes
  (t as { unref?: () => void }).unref?.();
}
