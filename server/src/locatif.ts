/**
 * Module « Patrimoine locatif » : biens, baux, loyers rapprochés de la banque, impayés, quittances et relances,
 * révision IRL, DPE, rentabilité, régime fiscal le plus favorable (micro ou réel), échéances.
 * Fonction pure, partagée appli/serveur. Repères réglementaires et fiscaux à vérifier chaque année.
 */
import type { TxB } from "./budgetExpert.js";
import { limite2035, seuilMicroBnc } from "./viePro.js";

export interface Bien {
  id: string; nom: string; adresse: string; type: "appartement" | "maison" | "studio" | "local" | "parking";
  meuble: boolean; surface?: number | null; prix_achat: number; date_achat?: string | null;
  dpe?: "A" | "B" | "C" | "D" | "E" | "F" | "G" | null; dpe_date?: string | null;
  taxe_fonciere: number; assurance_pno: number; charges_non_recuperables: number; // annual
  credit_mensualite?: number | null; interets_annuels?: number | null; travaux_annee?: number | null;
  structure_id?: string | null;                 // held through a SCI
  tourisme?: "classe" | "non_classe" | null;    // furnished tourist rental (short stays, platforms)
  part_terrain?: number | null;                 // share of the price that is land (not depreciable), SCI at IS
}
export interface Structure { id: string; nom: string; regime: "ir" | "is"; parts_foyer: number } // parts in %
export interface Bail {
  id: string; bien_id: string; locataire: string; loyer_hc: number; charges: number; debut: string; fin?: string | null;
  irl_trimestre: 1 | 2 | 3 | 4; irl_base?: string | null; depot_garantie: number; jour_paiement: number;
}
export interface DonneesLocatif { bailleur: string; adresse_bailleur?: string | null; biens: Bien[]; baux: Bail[]; structures?: Structure[]; encaissements_manuels?: { bail_id: string; mois: string; montant: number; date: string }[] }
export const DONNEES_LOCATIF_VIDES: DonneesLocatif = { bailleur: "", biens: [], baux: [] };

/** Indice de référence des loyers (INSEE, métropole). Mettre à jour à chaque publication trimestrielle. */
export const IRL: Record<string, number> = {
  "2024T2": 145.17, "2024T3": 144.51, "2024T4": 144.64, "2025T1": 145.47, "2025T2": 146.68,
  "2025T3": 145.77, "2025T4": 145.78, "2026T1": 146.60, "2026T2": 148.37, "2026T3": 148.06,
};
export const SOURCE_IRL = "https://www.insee.fr/fr/statistiques/serie/001515333";

const r2 = (n: number) => Math.round(n * 100) / 100;
const jour = (d: string) => new Date(d + "T12:00:00Z");
const ecart = (a: string, b: string) => Math.round((jour(b).getTime() - jour(a).getTime()) / 864e5);
const moisPrec = (m: string, n = 1) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 - n, 1)).toISOString().slice(0, 7); };
const finMois = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} €`;

export interface Encaissement { mois: string; attendu: number; recu: number; date: string | null; statut: "paye" | "partiel" | "impaye" | "a_venir"; retard_jours: number; libelle: string | null }

/** Rent payments of one lease, month by month, matched on the bank: amount close to the rent, or the tenant's name. */
export function encaissements(b: Bail, txs: TxB[], today: string, n = 6, manuels: DonneesLocatif["encaissements_manuels"] = []): Encaissement[] {
  const cc = r2(b.loyer_hc + b.charges);
  const nom = b.locataire.toUpperCase().split(/\s+/).filter((w) => w.length > 2);
  const pris = new Set<TxB>();
  const out: Encaissement[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = moisPrec(today.slice(0, 7), i);
    if (m < b.debut.slice(0, 7) || (b.fin && m > b.fin.slice(0, 7))) continue;
    const echeance = `${m}-${String(Math.min(28, b.jour_paiement)).padStart(2, "0")}`;
    const du = new Date(jour(`${m}-01`).getTime() - 6 * 864e5).toISOString().slice(0, 10);
    const cands = txs.filter((t) => !pris.has(t) && t.montant > 0 && t.date >= du && t.date <= finMois(m) && (Math.abs(t.montant - cc) <= 2 || nom.some((w) => t.libelle.toUpperCase().includes(w))));
    const man = (manuels ?? []).filter((x) => x.bail_id === b.id && x.mois === m);
    cands.forEach((t) => pris.add(t));
    const recu = r2(cands.reduce((s, t) => s + t.montant, 0) + man.reduce((s, x) => s + x.montant, 0));
    const date = [...cands.map((t) => t.date), ...man.map((x) => x.date)].sort()[0] ?? null;
    const statut: Encaissement["statut"] = recu >= cc - 2 ? "paye" : recu > 0 ? "partiel" : today <= echeance ? "a_venir" : "impaye";
    out.push({ mois: m, attendu: cc, recu, date, statut, retard_jours: statut === "impaye" || statut === "partiel" ? Math.max(0, ecart(echeance, today)) : 0, libelle: cands[0]?.libelle ?? null });
  }
  return out;
}

/** Next IRL revision on the lease anniversary. Rents of F and G homes are frozen (loi Climat et résilience, since 24 August 2022). */
export function revisionIrl(b: Bail, bien: Bien, today: string) {
  const [, md] = [b.debut.slice(0, 4), b.debut.slice(5)];
  let annee = Number(today.slice(0, 4));
  let date = `${annee}-${md}`;
  if (date < today) { annee++; date = `${annee}-${md}`; }
  if (date <= b.debut) return null;
  // The index used is the last one published for the lease's quarter on the revision date (T1 mid-April, T2 mid-July, T3 mid-October, T4 mid-January).
  const t = b.irl_trimestre;
  const publie = (y: number) => (t < 4 ? `${y}-${String(3 * t + 1).padStart(2, "0")}-15` : `${y + 1}-01-15`);
  const anneeIndice = publie(annee) <= date ? annee : annee - 1;
  const nouveau = `${anneeIndice}T${t}`, ancien = b.irl_base ?? `${anneeIndice - 1}T${t}`;
  const gel = bien.dpe === "F" || bien.dpe === "G";
  const iN = IRL[nouveau], iA = IRL[ancien];
  const loyer = iN && iA && !gel ? r2((b.loyer_hc * iN) / iA) : null;
  return { date, dans_jours: ecart(today, date), indice_ancien: ancien, indice_nouveau: nouveau, valeur_ancienne: iA ?? null, valeur_nouvelle: iN ?? null, nouveau_loyer: loyer, hausse: loyer ? r2(loyer - b.loyer_hc) : null, gel };
}

export function alerteDpe(bien: Bien, today: string): { niveau: "info" | "attention" | "bloquant"; texte: string } | null {
  if (!bien.dpe) return { niveau: "info", texte: "DPE non renseigné : il est obligatoire pour louer un logement." };
  if (bien.type === "local" || bien.type === "parking") return null;
  if (bien.dpe === "G") return { niveau: "bloquant", texte: "Classé G : interdit à la location pour un nouveau bail ou un renouvellement depuis le 1er janvier 2025 (logement indécent). Des travaux s'imposent." };
  if (bien.dpe === "F") return { niveau: "attention", texte: "Classé F : loyer gelé, et location interdite à partir du 1er janvier 2028. Prévoyez les travaux." };
  if (bien.dpe === "E") return { niveau: "info", texte: "Classé E : location interdite à partir du 1er janvier 2034." };
  if (bien.dpe_date && bien.dpe_date < "2021-07-01") return { niveau: "attention", texte: "DPE réalisé avant juillet 2021 : il n'est plus valable, faites-le refaire." };
  if (bien.dpe_date) { const fin = `${Number(bien.dpe_date.slice(0, 4)) + 10}${bien.dpe_date.slice(4)}`; if (ecart(today, fin) < 365) return { niveau: "info", texte: `DPE valable jusqu'au ${fin.split("-").reverse().join("/")}.` }; }
  return null;
}

export interface RapportBien {
  bien: Bien; bail: Bail | null; loyer_cc: number;
  encaissements: Encaissement[]; impayes: number; revision: ReturnType<typeof revisionIrl>; dpe: ReturnType<typeof alerteDpe>;
  rentabilite_brute: number | null; rentabilite_nette: number | null; cash_flow_mensuel: number;
  charges_annuelles: number;
  recettes_annuelles: number;                         // rents (lease) or platform payouts (tourism), over 12 months
  tourisme_12m: { mois: string; montant: number }[];  // tourism only
}
export interface RapportLocatif {
  biens: RapportBien[];
  totaux: { loyers_annuels: number; encaisse_12m: number; impayes: number; cash_flow_mensuel: number; valeur: number };
  fiscal: {
    nu: { recettes: number; charges_deductibles: number; micro: { eligible: boolean; base: number }; reel: { resultat: number }; conseil: string; cases: string } | null;
    meuble: { recettes: number; seuil: number; micro: { eligible: boolean; base: number }; conseil: string; cases: string } | null;
    tourisme: { classe: boolean; recettes: number; seuil: number; abattement: number; micro: { eligible: boolean; base: number }; conseil: string }[];
    sci: { id: string; nom: string; regime: "ir" | "is"; parts_foyer: number; recettes: number; charges: number; interets: number; amortissement: number; resultat: number; quote_part: number | null; impot_is: number | null; conseil: string; echeance: string }[];
  };
  echeances: { date: string; titre: string; detail: string; bien_id: string | null }[];
  alertes: { niveau: "info" | "attention" | "bloquant"; titre: string; detail: string; bien_id: string | null }[];
}

export function rapportLocatif(d: DonneesLocatif, txs: TxB[], today = new Date().toISOString().slice(0, 10)): RapportLocatif {
  const PLATEFORMES = /airbnb|booking|abritel|homelidays|gites de france|vrbo|leboncoin vacances/i;
  const debut12 = moisPrec(today.slice(0, 7), 11);
  const nbTourisme = d.biens.filter((x) => x.meuble && x.tourisme).length;
  const biens: RapportBien[] = d.biens.map((bien) => {
    const bail = d.baux.find((b) => b.bien_id === bien.id && (!b.fin || b.fin >= today)) ?? null;
    const mot = bien.nom.toUpperCase().split(/\s+/).pop() ?? "";
    const tour = bien.meuble && bien.tourisme ? txs.filter((t) => t.montant > 0 && PLATEFORMES.test(t.libelle) && t.date.slice(0, 7) >= debut12 && (nbTourisme === 1 || t.libelle.toUpperCase().includes(mot))) : [];
    const tourisme_12m = bien.tourisme ? [...new Set(tour.map((t) => t.date.slice(0, 7)))].sort().map((m) => ({ mois: m, montant: r2(tour.filter((t) => t.date.startsWith(m)).reduce((a, t) => a + t.montant, 0)) })) : [];
    const enc = bail ? encaissements(bail, txs, today, 6, d.encaissements_manuels) : [];
    const charges_annuelles = r2(bien.taxe_fonciere + bien.assurance_pno + bien.charges_non_recuperables);
    const loyerAnnuel = bien.tourisme ? r2(tour.reduce((a, t) => a + t.montant, 0)) : bail ? bail.loyer_hc * 12 : 0;
    return {
      bien, bail, loyer_cc: bail ? r2(bail.loyer_hc + bail.charges) : 0, encaissements: enc,
      impayes: r2(enc.filter((e) => e.statut === "impaye" || e.statut === "partiel").reduce((s, e) => s + e.attendu - e.recu, 0)),
      revision: bail ? revisionIrl(bail, bien, today) : null, dpe: alerteDpe(bien, today),
      rentabilite_brute: bien.prix_achat > 0 && loyerAnnuel > 0 ? Math.round((loyerAnnuel / bien.prix_achat) * 1000) / 10 : null,
      rentabilite_nette: bien.prix_achat > 0 && loyerAnnuel > 0 ? Math.round(((loyerAnnuel - charges_annuelles - (bien.interets_annuels ?? 0)) / bien.prix_achat) * 1000) / 10 : null,
      cash_flow_mensuel: r2(loyerAnnuel / 12 - (bien.credit_mensualite ?? 0) - charges_annuelles / 12),
      charges_annuelles, recettes_annuelles: loyerAnnuel, tourisme_12m,
    };
  });

  // Fiscal: unfurnished (revenus fonciers) and furnished (LMNP, BIC) are declared separately.
  // Properties held through a SCI are declared by the SCI (below), tourist rentals have their own ceilings.
  const directs = biens.filter((b) => !b.bien.structure_id);
  const nus = directs.filter((b) => !b.bien.meuble && b.bail), meubles = directs.filter((b) => b.bien.meuble && !b.bien.tourisme && b.bail);
  let nu: RapportLocatif["fiscal"]["nu"] = null;
  if (nus.length) {
    const recettes = r2(nus.reduce((s, b) => s + b.bail!.loyer_hc * 12, 0));
    const charges_deductibles = r2(nus.reduce((s, b) => s + b.charges_annuelles + (b.bien.interets_annuels ?? 0) + (b.bien.travaux_annee ?? 0) + 20, 0)); // + 20 € de frais de gestion par local
    const eligible = recettes <= 15000;
    const base = r2(recettes * 0.7), resultat = r2(recettes - charges_deductibles);
    const conseil = !eligible ? "Plus de 15 000 € de loyers nus par an : le régime réel (déclaration 2044) s'applique."
      : resultat < base ? `Au réel, vos charges dépassent l'abattement de 30 % : vous déclareriez ${eur(Math.round(base - resultat))} de moins. L'option pour le réel engage 3 ans.`
      : `Le micro-foncier (abattement de 30 %) est plus favorable : ${eur(Math.round(resultat - base))} de moins à déclarer qu'au réel.`;
    nu = { recettes, charges_deductibles, micro: { eligible, base }, reel: { resultat }, conseil, cases: eligible && resultat >= base ? "Déclaration 2042, case 4BE (loyers bruts)." : "Déclaration 2044, résultat reporté sur la 2042 (cases 4BA, ou 4BB/4BC en cas de déficit)." };
  }
  let meuble: RapportLocatif["fiscal"]["meuble"] = null;
  if (meubles.length) {
    const annee = Number(today.slice(0, 4));
    const recettes = r2(meubles.reduce((s, b) => s + (b.bail!.loyer_hc + b.bail!.charges) * 12, 0));
    const seuil = seuilMicroBnc(annee); // même plafond que les prestations de services pour la location meublée de longue durée
    const eligible = recettes <= seuil;
    const base = r2(Math.max(recettes * 0.5, Math.min(recettes, 305)));
    meuble = { recettes, seuil, micro: { eligible, base }, conseil: eligible ? "Location meublée de longue durée (LMNP) : en micro-BIC, 50 % des recettes sont imposés. Le réel permet d'amortir le bien et le mobilier, souvent plus favorable avec un crédit : il demande une comptabilité (liasse 2031)." : "Recettes au-dessus du plafond du micro-BIC : le régime réel s'applique.", cases: "Déclaration 2042-C-PRO, case 5ND (micro-BIC, location meublée non professionnelle)." };
  }

  const anneeF = Number(today.slice(0, 4));
  const tourisme: RapportLocatif["fiscal"]["tourisme"] = [];
  for (const classe of [true, false]) {
    const tb = directs.filter((b) => b.bien.tourisme === (classe ? "classe" : "non_classe"));
    if (!tb.length) continue;
    const recettes = r2(tb.reduce((a, b) => a + b.recettes_annuelles, 0));
    const seuil = classe ? seuilMicroBnc(anneeF) : 15000, abattement = classe ? 0.5 : 0.3;
    const eligible = recettes <= seuil;
    tourisme.push({ classe, recettes, seuil, abattement, micro: { eligible, base: r2(Math.max(recettes * (1 - abattement), Math.min(recettes, 305))) },
      conseil: eligible ? `Meublé de tourisme ${classe ? "classé" : "non classé"} : en micro-BIC, ${Math.round((1 - abattement) * 100)} % des recettes sont imposés (abattement de ${Math.round(abattement * 100)} %, plafond ${seuil.toLocaleString("fr-FR")} €).${classe ? "" : " Le classement du meublé (étoiles) ou le régime réel sont souvent plus favorables."}` : `Recettes au-dessus du plafond de ${seuil.toLocaleString("fr-FR")} € : le régime réel s'applique.` });
  }
  const sci: RapportLocatif["fiscal"]["sci"] = (d.structures ?? []).map((st) => {
    const sb = biens.filter((b) => b.bien.structure_id === st.id);
    const recettes = r2(sb.reduce((a, b) => a + b.recettes_annuelles, 0));
    const charges = r2(sb.reduce((a, b) => a + b.charges_annuelles + (b.bien.travaux_annee ?? 0), 0));
    const interets = r2(sb.reduce((a, b) => a + (b.bien.interets_annuels ?? 0), 0));
    const amortissement = st.regime === "is" ? r2(sb.reduce((a, b) => a + (b.bien.prix_achat * (1 - (b.bien.part_terrain ?? 0.15))) / 30, 0)) : 0;
    const resultat = r2(recettes - charges - interets - amortissement);
    const impot = st.regime === "is" ? (resultat > 0 ? r2(Math.min(resultat, 42500) * 0.15 + Math.max(0, resultat - 42500) * 0.25) : 0) : null;
    const quote = st.regime === "ir" ? r2((resultat * st.parts_foyer) / 100) : null;
    return { id: st.id, nom: st.nom, regime: st.regime, parts_foyer: st.parts_foyer, recettes, charges, interets, amortissement, resultat, quote_part: quote, impot_is: impot,
      conseil: st.regime === "ir"
        ? `SCI à l'impôt sur le revenu : elle dépose la 2072-S, chaque associé reporte sa quote-part (${st.parts_foyer} % pour le foyer) sur sa 2044, lignes 111 à 114. Le micro-foncier n'est possible que si vous louez aussi un bien en direct.`
        : "SCI à l'impôt sur les sociétés : résultat estimé après amortissement du bâti (sur 30 ans, terrain exclu), impôt à 15 % jusqu'à 42 500 € de bénéfice puis 25 % (taux réduit sous conditions de détention). Liasse 2065 ; votre comptable découpe l'amortissement par composants.",
      echeance: limite2035(anneeF + 1) };
  });

  const echeances: RapportLocatif["echeances"] = [];
  const alertes: RapportLocatif["alertes"] = [];
  const annee = Number(today.slice(0, 4));
  for (const b of biens) {
    if (b.revision && !b.revision.gel && b.revision.dans_jours <= 60) echeances.push({ date: b.revision.date, titre: `Révision du loyer : ${b.bien.nom}`, detail: b.revision.nouveau_loyer ? `IRL ${b.revision.indice_nouveau} : ${eur(b.bail!.loyer_hc)} → ${eur(b.revision.nouveau_loyer)} hors charges.` : `En attente de la publication de l'IRL ${b.revision.indice_nouveau}.`, bien_id: b.bien.id });
    if (b.bail) { const reg = `${annee}-${b.bail.debut.slice(5)}`; if (reg >= today && ecart(today, reg) <= 60) echeances.push({ date: reg, titre: `Régularisation des charges : ${b.bien.nom}`, detail: "Comparez les provisions encaissées aux charges récupérables réelles, justificatifs à l'appui.", bien_id: b.bien.id }); }
    const imp = b.encaissements.filter((e) => e.statut === "impaye" || e.statut === "partiel");
    if (imp.length) alertes.push({ niveau: "attention", titre: `Loyer ${imp.length > 1 ? "impayés" : "impayé"} : ${b.bien.nom}`, detail: `${b.bail!.locataire} : ${eur(b.impayes)} en retard (${imp.map((e) => nomMois(e.mois)).join(", ")}).`, bien_id: b.bien.id });
    if (b.dpe && b.dpe.niveau !== "info") alertes.push({ niveau: b.dpe.niveau, titre: `DPE : ${b.bien.nom}`, detail: b.dpe.texte, bien_id: b.bien.id });
    if (!b.bail && !b.bien.tourisme) alertes.push({ niveau: "info", titre: `${b.bien.nom} sans locataire`, detail: "Ajoutez le bail pour suivre les loyers.", bien_id: b.bien.id });
  }
  const tf = `${today.slice(0, 4)}-10-15`;
  if (d.biens.length && tf >= today) echeances.push({ date: tf, titre: "Taxe foncière", detail: `${eur(r2(d.biens.reduce((s, b) => s + b.taxe_fonciere, 0)))} au total, date indicative : elle figure sur l'avis.`, bien_id: null });
  for (const x of sci) if (x.echeance >= today) echeances.push({ date: x.echeance, titre: `${x.nom} : ${x.regime === "ir" ? "déclaration 2072-S" : "liasse 2065"}`, detail: "En ligne, date limite indicative (fixée chaque année, vers le 20 mai).", bien_id: null });
  echeances.sort((a, b) => a.date.localeCompare(b.date));

  const enc12 = biens.reduce((s, b) => s + b.encaissements.reduce((x, e) => x + e.recu, 0), 0);
  return {
    biens,
    totaux: { loyers_annuels: r2(biens.reduce((s, b) => s + (b.bail ? b.bail.loyer_hc * 12 : 0), 0)), encaisse_12m: r2(enc12), impayes: r2(biens.reduce((s, b) => s + b.impayes, 0)), cash_flow_mensuel: r2(biens.reduce((s, b) => s + b.cash_flow_mensuel, 0)), valeur: r2(d.biens.reduce((s, b) => s + b.prix_achat, 0)) },
    fiscal: { nu, meuble, tourisme, sci }, echeances, alertes,
  };
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const nomMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Quittance de loyer (gratuite, à remettre à la demande du locataire : loi du 6 juillet 1989, art. 21). */
export function quittance(d: DonneesLocatif, bail: Bail, bien: Bien, e: Encaissement): string {
  return [
    `QUITTANCE DE LOYER — ${nomMois(e.mois).toUpperCase()}`, "",
    `Bailleur : ${d.bailleur}${d.adresse_bailleur ? `, ${d.adresse_bailleur}` : ""}`,
    `Locataire : ${bail.locataire}`,
    `Logement : ${bien.nom}, ${bien.adresse}`, "",
    `Je soussigné(e) ${d.bailleur}, bailleur du logement désigné ci-dessus, déclare avoir reçu de ${bail.locataire} la somme de ${eur(e.recu)} au titre du loyer et des charges de ${nomMois(e.mois)}, et lui en donne quittance, sous réserve de tous mes droits.`, "",
    `Détail :`, `  Loyer hors charges : ${eur(bail.loyer_hc)}`, `  Provision pour charges : ${eur(bail.charges)}`, `  Total : ${eur(r2(bail.loyer_hc + bail.charges))}`, "",
    `Paiement reçu le ${e.date ? e.date.split("-").reverse().join("/") : "—"}.`, "",
    `Fait le ${new Date().toLocaleDateString("fr-FR")}`, d.bailleur,
  ].join("\n");
}

/** Courteous reminder for a late rent (first step, before any formal notice). */
export function relance(d: DonneesLocatif, bail: Bail, bien: Bien, e: Encaissement): string {
  return [
    `Objet : loyer de ${nomMois(e.mois)} — ${bien.nom}`, "",
    `Bonjour ${bail.locataire},`, "",
    `Sauf erreur de ma part, je n'ai pas reçu le loyer de ${nomMois(e.mois)}, d'un montant de ${eur(e.attendu - e.recu)}, attendu le ${String(Math.min(28, bail.jour_paiement)).padStart(2, "0")}/${e.mois.slice(5, 7)}.`,
    `Il s'agit peut-être d'un simple oubli : pourriez-vous procéder au règlement dans les meilleurs délais, ou me tenir informé(e) si vous rencontrez une difficulté ? Nous trouverons une solution ensemble.`, "",
    `Bien cordialement,`, d.bailleur,
  ].join("\n");
}

// ---------- démo ----------

export const DEMO_LOCATIF: DonneesLocatif = {
  bailleur: "Famille Martin",
  adresse_bailleur: "12 rue des Écoles, 34000 Montpellier",
  biens: [
    { id: "b1", nom: "Studio Écusson", adresse: "4 rue de l'Aiguillerie, 34000 Montpellier", type: "studio", meuble: false, surface: 22, prix_achat: 98000, date_achat: "2018-06-12", dpe: "D", dpe_date: "2022-03-08", taxe_fonciere: 620, assurance_pno: 95, charges_non_recuperables: 380, credit_mensualite: 0, interets_annuels: 0, travaux_annee: 0 },
    { id: "b2", nom: "T2 meublé Antigone", adresse: "18 place du Nombre d'Or, 34000 Montpellier", type: "appartement", meuble: true, surface: 41, prix_achat: 165000, date_achat: "2021-10-04", dpe: "C", dpe_date: "2021-09-20", taxe_fonciere: 840, assurance_pno: 120, charges_non_recuperables: 520, credit_mensualite: 760, interets_annuels: 2100, travaux_annee: 0 },
    { id: "b3", nom: "T3 Boutonnet", adresse: "9 rue du Faubourg Boutonnet, 34090 Montpellier", type: "appartement", meuble: false, surface: 64, prix_achat: 214000, date_achat: "2019-11-20", dpe: "D", dpe_date: "2023-05-11", taxe_fonciere: 1180, assurance_pno: 160, charges_non_recuperables: 640, credit_mensualite: 980, interets_annuels: 2650, travaux_annee: 0, structure_id: "s1", part_terrain: 0.15 },
    { id: "b4", nom: "Studio Palavas", adresse: "3 rue de la Méditerranée, 34250 Palavas-les-Flots", type: "studio", meuble: true, surface: 24, prix_achat: 132000, date_achat: "2023-04-07", dpe: "C", dpe_date: "2023-03-15", taxe_fonciere: 540, assurance_pno: 110, charges_non_recuperables: 420, credit_mensualite: 640, interets_annuels: 1900, travaux_annee: 0, tourisme: "non_classe" },
  ],
  structures: [{ id: "s1", nom: "SCI Les Oliviers", regime: "is", parts_foyer: 100 }],
  baux: [
    { id: "l3", bien_id: "b3", locataire: "Nadia Benali", loyer_hc: 890, charges: 70, debut: "2022-03-01", irl_trimestre: 4, depot_garantie: 890, jour_paiement: 5 },
    { id: "l1", bien_id: "b1", locataire: "Inès Morel", loyer_hc: 520, charges: 35, debut: "2023-09-01", irl_trimestre: 2, depot_garantie: 520, jour_paiement: 3 },
    { id: "l2", bien_id: "b2", locataire: "Hugo Fabre", loyer_hc: 790, charges: 60, debut: "2024-11-15", irl_trimestre: 3, depot_garantie: 1580, jour_paiement: 5 },
  ],
};

/** Rent transfers of the demo tenants: Inès always on time, Hugo forgot this month. */
export function demoLoyers(today: string): TxB[] {
  const out: TxB[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = moisPrec(today.slice(0, 7), i);
    const add = (j: number, libelle: string, montant: number) => { const date = `${m}-${String(j).padStart(2, "0")}`; if (date <= today) out.push({ date, libelle, montant, categorie: "revenus", compte: "Compte joint" }); };
    add(2, "VIR MME MOREL INES LOYER", 555);
    add(5, "VIR BENALI NADIA LOYER T3", 960);
    const ete = [5, 6, 7, 8, 9].includes(Number(m.slice(5, 7)));
    add(12, "VIR AIRBNB PAYMENTS LUXEMBOURG", ete ? 1480 : 360);
    if (ete) add(26, "VIR AIRBNB PAYMENTS LUXEMBOURG", 920);
    if (i !== 0) add(4, "VIR FABRE HUGO", 850);
  }
  return out;
}
