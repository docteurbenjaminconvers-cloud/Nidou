/**
 * Le point du dimanche soir : « La semaine de Lucien », envoyé une fois par semaine (notification, et email pour le plan Famille).
 * Le contenu vient de semaine.ts, la même fonction que l'écran « Votre semaine » de l'appli.
 */
import type { Db, HouseholdRow } from "./db.js";
import { agendaSemaine, conseilsFamille, echeancesFamille } from "./famille.js";
import { budgetReport } from "./budget.js";
import { heureParis, pointSemaine, type PointSemaine, type SemaineEntree } from "./semaine.js";

/** Same inputs as the app screen: open deadlines (papers and family), weekly agenda, budget, papers to check, advice. */
export function entreeSemaine(db: Db, h: HouseholdRow, now = new Date()): SemaineEntree {
  const members = db.listMembers(h.id), activites = db.listActivites(h.id);
  const faits = db.familleFaits(h.id);
  const famille = echeancesFamille(h, members, activites, now).filter((e) => !faits.has(e.cle)).map((e) => ({ id: `f:${e.cle}`, titre: e.titre, date: e.date, fait: 0, note: e.note, document_id: null }));
  const docs = db.listDocuments(h.id);
  const plan = db.effectivePlan(h);
  let economies: SemaineEntree["economies"] = null;
  if (plan === "famille") {
    const b = budgetReport(db.listTransactions(h.id), docs, db.listDecisions(h.id));
    if (b.nb_transactions) {
      const a = b.actions.find((x) => x.decision !== "garde" && x.decision !== "resilie") ?? null;
      economies = { possibles: b.economies_possibles, decidees: b.economies_decidees, geste: a ? { titre: a.titre, effort: a.effort, gain: a.economie_annuelle } : null };
    }
  }
  return {
    foyer: h.nom,
    echeances: [...db.listDeadlines(h.id).map((d) => ({ id: d.id, titre: d.titre, date: d.date, fait: d.fait, note: d.note, document_id: d.document_id })), ...famille],
    creneaux: agendaSemaine(members, activites),
    aVerifier: docs.filter((d) => !d.verifie && (d.confiance ?? 1) < 0.7).length,
    economies,
    conseils: conseilsFamille(h, members, activites, now),
  };
}

export function pointDuFoyer(db: Db, h: HouseholdRow, now = new Date()): PointSemaine {
  return pointSemaine(entreeSemaine(db, h, now), now);
}

/** The Sunday slot: from 17:00 on Sunday, Paris time (with a catch-up until Monday noon if the server was asleep). */
export function creneauDimanche(now: Date): boolean {
  const { date, heure } = heureParis(now);
  const j = new Date(date + "T12:00:00Z").getUTCDay(); // 0 = dimanche
  return (j === 0 && heure >= 17) || (j === 1 && heure < 12);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const court = (iso: string) => { const d = new Date(iso + "T12:00:00Z"); return `${d.getUTCDate()} ${MOIS_COURT[d.getUTCMonth()]}`; };

/** Email version: plain text, and HTML in the « Cocon » colours (inline styles, no image, readable everywhere). */
export function emailSemaine(p: PointSemaine, prenom: string | null, base: string): { subject: string; text: string; html: string } {
  const lien = (route: string | null) => `${base}/#/${route ?? "semaine"}`;
  const bonjour = `Bonsoir${prenom ? ` ${prenom}` : ""},`;
  const text = [
    bonjour, "", p.intro, "",
    ...p.sections.flatMap((s) => [s.titre.toUpperCase(), ...s.items.map((i) => `- ${i.quand && s.cle === "echeances" ? court(i.quand) + " : " : ""}${i.titre}${i.detail ? ` — ${i.detail}` : ""}`), ""]),
    `Tout le détail : ${lien("semaine")}`, "", "Lucien, votre majordome",
    "Pour ne plus recevoir ce point du dimanche : Réglages, « Le point du dimanche ».",
  ].join("\n");
  const C = { papier: "#FBF4F0", encre: "#3B2A3A", corail: "#D95F45", gris: "#8B6F84", ligne: "#F0E3EC", or: "#E9B23A", lilas: "#E8DDF3", vert: "#1F6B4A" };
  const section = (s: PointSemaine["sections"][number]) => `
    <tr><td style="padding:22px 0 6px;font-family:Georgia,serif;font-style:italic;font-size:21px;color:${C.encre}">${esc(s.titre)}</td></tr>
    <tr><td style="background:#ffffff;border-radius:18px;padding:4px 18px">
      ${s.items.map((i, k) => `<div style="padding:12px 0;${k ? `border-top:1px solid ${C.ligne};` : ""}">
        <a href="${esc(lien(i.route))}" style="text-decoration:none;color:${C.encre}">
          ${i.quand && (s.cle === "echeances") ? `<span style="display:inline-block;min-width:54px;font-weight:800;color:${i.urgent ? C.corail : C.gris}">${esc(court(i.quand))}</span>` : ""}
          <b style="font-size:15px">${esc(i.titre)}</b>${i.montant ? ` <span style="color:${C.vert};font-weight:800">· ${esc(Math.round(i.montant).toLocaleString("fr-FR"))} €/an</span>` : ""}
        </a>
        ${i.detail ? `<div style="color:${C.gris};font-size:13.5px;margin-top:3px">${esc(i.detail)}</div>` : ""}
      </div>`).join("")}
    </td></tr>`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:${C.papier}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.papier}"><tr><td align="center" style="padding:28px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${C.encre};font-size:15px;line-height:1.5">
    <tr><td style="padding-bottom:18px"><span style="display:inline-block;width:30px;height:30px;border-radius:50%;background:${C.corail};vertical-align:middle;text-align:center;line-height:30px;color:${C.or};font-size:15px">&#9670;</span>
      <span style="font-family:Georgia,serif;font-style:italic;font-size:22px;font-weight:bold;vertical-align:middle;margin-left:8px">Lucien</span></td></tr>
    <tr><td style="font-family:Georgia,serif;font-style:italic;font-size:30px;line-height:1.15;padding-bottom:10px">${esc(p.titre)}</td></tr>
    <tr><td style="padding-bottom:4px">${esc(bonjour)}</td></tr>
    <tr><td style="color:${C.encre}">${esc(p.intro)}</td></tr>
    ${p.sections.map(section).join("")}
    <tr><td style="padding:26px 0 8px"><a href="${esc(lien("semaine"))}" style="display:inline-block;background:${C.corail};color:#ffffff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:999px">Ouvrir ma semaine</a></td></tr>
    <tr><td style="padding-top:14px;font-family:Georgia,serif;font-style:italic;color:${C.encre}">Lucien, votre majordome</td></tr>
    <tr><td style="padding-top:18px;color:${C.gris};font-size:12px">Vous recevez ce point chaque dimanche soir. Pour l'arrêter : Réglages, « Le point du dimanche ».</td></tr>
  </table></td></tr></table></body></html>`;
  return { subject: `${p.titre} : ${p.notification.corps}`.slice(0, 140), text, html };
}
