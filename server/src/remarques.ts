/**
 * « Lucien a remarqué » : what Lucien notices by itself, from what it knows of the household (members, papers,
 * deadlines, bank, situations) — computed by rules, free and instant, no AI. A short list, the most useful first;
 * each remark can be set aside and comes back only when the situation changes (its key carries the period).
 */
import type { DeadlineRow, DocumentRow, MemberRow } from "./db.js";
import type { BudgetReport } from "./budget.js";
import type { Prevision } from "./prevision.js";

export type Niveau = "alerte" | "conseil" | "info";
export interface Remarque { cle: string; niveau: Niveau; titre: string; detail: string; action: { libelle: string; route: string } | null }
export interface EtapeSituation { situation: string; titre: string; date: string; fait: boolean; situation_id: string }
export interface Contexte {
  aujourdhui: string;
  membres: MemberRow[];
  documents: DocumentRow[];
  echeances: DeadlineRow[];
  budget: BudgetReport | null;
  prevision: Prevision | null;
  etapes: EtapeSituation[];
  pro_a_verifier: number;
  aSituation: boolean;
}

const jours = (a: string, b: string) => Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 864e5);
const ajout = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const dateFr = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
const euros = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
/** The next date (this year or next) a person reaches `ans` years old, or null. */
function anniversaire(m: MemberRow, ans: number): string | null {
  if (!m.date_naissance || !/^\d{4}-\d{2}-\d{2}/.test(m.date_naissance)) return null;
  const [y, mo, d] = m.date_naissance.slice(0, 10).split("-").map(Number);
  return `${y + ans}-${String(mo).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
}

export function remarquer(c: Contexte): Remarque[] {
  const out: Remarque[] = [];
  const t = c.aujourdhui;

  // --- money first: the end of the month and what hides in the accounts
  if (c.prevision && c.prevision.solde_prevu < 0 && c.prevision.jours_restants > 0) {
    out.push({ cle: `decouvert:${t.slice(0, 7)}`, niveau: "alerte", titre: `Le compte risque de passer à ${euros(c.prevision.solde_prevu)} d'ici la fin du mois`,
      detail: `Avec les prélèvements prévus et vos dépenses habituelles. Décaler une dépense, virer depuis l'épargne ou prévenir la banque évite les frais de découvert.`, action: { libelle: "Voir la fin de mois", route: "budget" } });
  }
  const actions = (c.budget?.actions ?? []).filter((a) => !a.decision && a.economie_annuelle > 0);
  const meilleure = [...actions].sort((a, b) => b.economie_annuelle - a.economie_annuelle)[0];
  if (meilleure && meilleure.economie_annuelle >= 60) {
    out.push({ cle: `economie:${meilleure.cle}`, niveau: "conseil", titre: `${euros(meilleure.economie_annuelle)} par an à gagner : ${meilleure.titre.charAt(0).toLowerCase()}${meilleure.titre.slice(1)}`,
      detail: meilleure.detail, action: { libelle: "Décider", route: "budget" } });
  }
  if (c.pro_a_verifier > 0) {
    out.push({ cle: `pro:${t.slice(0, 7)}:${c.pro_a_verifier}`, niveau: "alerte", titre: `${c.pro_a_verifier} dépense${c.pro_a_verifier > 1 ? "s" : ""} à vérifier sur le compte pro`,
      detail: "Abonnements nouveaux ou en hausse, libellés qui ressemblent à de fausses offres d'annuaire, doublons : un coup d'œil suffit.", action: { libelle: "Vérifier", route: "verif-pro" } });
  }

  // --- papers: identity documents to renew, contracts to cancel in time, guarantees about to end
  for (const d of c.documents) {
    if (!d.date_fin) continue;
    const reste = jours(d.date_fin, t);
    if (d.category === "identite" && reste >= -30 && reste <= 180) {
      out.push({ cle: `identite:${d.id}:${d.date_fin}`, niveau: reste <= 60 ? "alerte" : "conseil", titre: reste < 0 ? `${d.title} est expiré depuis le ${dateFr(d.date_fin)}` : `${d.title} expire le ${dateFr(d.date_fin)}`,
        detail: "Les rendez-vous en mairie prennent souvent plusieurs semaines : prenez-le maintenant, avec la pré-demande en ligne sur ants.gouv.fr. Pensez-y avant un voyage.", action: { libelle: "Voir le papier", route: `doc/${d.id}` } });
    }
    if (d.preavis_jours && d.periodicite !== "unique" && ["assurance", "telecom", "abonnement"].includes(d.category)) {
      const limite = ajout(d.date_fin, -d.preavis_jours);
      const avant = jours(limite, t);
      if (avant >= 0 && avant <= 45) {
        out.push({ cle: `preavis:${d.id}:${limite}`, niveau: "conseil", titre: `${d.title} : dernier jour pour changer le ${dateFr(limite)}`,
          detail: `Après cette date, le contrat est reconduit pour une nouvelle période. C'est le bon moment pour demander un devis concurrent${d.montant ? ` (vous payez ${euros(d.montant)} ${d.periodicite === "mensuel" ? "par mois" : d.periodicite === "annuel" ? "par an" : "par trimestre"})` : ""}.${d.category === "assurance" ? " Bon à savoir : après un an de contrat, une assurance auto, moto ou habitation se résilie aussi à tout moment (loi Hamon), le nouvel assureur s'occupe des démarches." : ""}`,
          action: { libelle: "Voir le contrat", route: `doc/${d.id}` } });
      }
    }
    if (d.category === "garantie" && reste >= 0 && reste <= 30) {
      out.push({ cle: `garantie:${d.id}:${d.date_fin}`, niveau: "info", titre: `La garantie de « ${d.title} » se termine le ${dateFr(d.date_fin)}`,
        detail: "Si l'appareil a un défaut, même léger, faites-le constater avant cette date.", action: { libelle: "Voir le papier", route: `doc/${d.id}` } });
    }
  }

  // --- people: milestones that come with a step to take
  for (const m of c.membres) {
    const seize = anniversaire(m, 16);
    if (seize && jours(t, seize) >= -30 && jours(t, seize) <= 90) {
      out.push({ cle: `recensement:${m.id}`, niveau: "alerte", titre: `${m.prenom} doit se faire recenser`,
        detail: "Le recensement citoyen est obligatoire dans les 3 mois qui suivent les 16 ans, en ligne ou en mairie. L'attestation est demandée pour le bac, le permis et les concours.", action: null });
    }
    const dixhuit = anniversaire(m, 18);
    if (dixhuit && jours(dixhuit, t) >= 0 && jours(dixhuit, t) <= 60) {
      out.push({ cle: `majorite:${m.id}`, niveau: "conseil", titre: `${m.prenom} aura 18 ans le ${dateFr(dixhuit)}`,
        detail: "Ce qui change : sa propre carte Vitale et son compte Ameli, l'inscription sur les listes électorales (automatique si recensé), un compte bancaire à son nom, et le choix fiscal entre rattachement au foyer ou déclaration séparée.", action: null });
    }
    if (m.date_naissance) {
      const [, mo, d] = m.date_naissance.slice(0, 10).split("-").map(Number);
      let anniv = `${t.slice(0, 4)}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (anniv < t) anniv = `${Number(t.slice(0, 4)) + 1}${anniv.slice(4)}`;
      const dans = jours(anniv, t);
      if (dans >= 0 && dans <= 10) {
        out.push({ cle: `anniv:${m.id}:${anniv}`, niveau: "info", titre: /^moi$/i.test(m.prenom.trim()) ? (dans === 0 ? "C'est votre anniversaire aujourd'hui" : `Votre anniversaire ${dans === 1 ? "demain" : `dans ${dans} jours`}`) : dans === 0 ? `C'est l'anniversaire de ${m.prenom} aujourd'hui` : `Anniversaire de ${m.prenom} ${dans === 1 ? "demain" : `dans ${dans} jours`}`,
          detail: "Un cadeau à prévoir, une réservation à faire ?", action: null });
      }
    }
  }

  // --- life situations: the next step, and the late ones
  const enRetard = c.etapes.filter((e) => !e.fait && e.date < t);
  if (enRetard.length) {
    const e = enRetard[0];
    out.push({ cle: `situation_retard:${e.situation_id}:${enRetard.length}`, niveau: "alerte", titre: `${enRetard.length > 1 ? `${enRetard.length} démarches en retard` : "Une démarche en retard"} : ${e.situation}`,
      detail: `${e.titre}, prévue le ${dateFr(e.date)}.`, action: { libelle: "Ouvrir", route: `situation/${e.situation_id}` } });
  }
  const prochaine = c.etapes.filter((e) => !e.fait && e.date >= t && jours(e.date, t) <= 7).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (prochaine) {
    out.push({ cle: `situation_semaine:${prochaine.situation_id}:${prochaine.date}`, niveau: "info", titre: `Cette semaine pour « ${prochaine.situation} » : ${prochaine.titre.charAt(0).toLowerCase()}${prochaine.titre.slice(1)}`,
      detail: `À faire d'ici le ${dateFr(prochaine.date)}.`, action: { libelle: "Ouvrir", route: `situation/${prochaine.situation_id}` } });
  }

  // --- what Lucien does not know yet and would make it more useful
  const ids = c.documents.filter((d) => d.category === "identite");
  const adultes = c.membres.filter((m) => m.role === "adulte");
  if (adultes.length && !ids.length && c.documents.length >= 3) {
    out.push({ cle: "manque:identite", niveau: "info", titre: "Ajoutez vos cartes d'identité et passeports",
      detail: "Lucien vous préviendra six mois avant leur expiration, et vous les aurez sous la main en cas de perte ou de vol.", action: { libelle: "Ajouter", route: "add" } });
  }
  if (!c.membres.some((m) => m.date_naissance) && c.membres.length >= 2) {
    out.push({ cle: "manque:naissances", niveau: "info", titre: "Indiquez les dates de naissance du foyer",
      detail: "Lucien pourra alors penser aux étapes de chacun : recensement à 16 ans, majorité, bourses, Parcoursup, retraite.", action: { libelle: "Famille", route: "famille" } });
  }

  const rang: Record<Niveau, number> = { alerte: 0, conseil: 1, info: 2 };
  return out.sort((a, b) => rang[a.niveau] - rang[b.niveau]);
}
