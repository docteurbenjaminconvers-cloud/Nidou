/**
 * « Combien de temps garder ce papier ? » : la durée de conservation de chaque document, d'après les durées
 * publiées par service-public.fr, et la liste de ce qu'on peut jeter (grand ménage). Fonction pure, partagée appli/serveur.
 */
export const SOURCE_CONSERVATION = "https://www.service-public.gouv.fr/particuliers/vosdroits/F19134";
const REGLES = [
    { cle: "bulletin", libelle: "Bulletin de salaire", match: (_d, t) => /bulletin de (salaire|paie)|fiche de paie/.test(t), garde: { type: "retraite" }, detail: "Ils prouvent vos droits à la retraite : gardez-les jusqu'à ce qu'elle soit liquidée." },
    { cle: "livret", libelle: "Livret de famille, acte d'état civil", match: (_d, t) => /livret de famille|acte de (naissance|mariage|décès|deces)|jugement de divorce/.test(t), garde: { type: "vie" }, detail: "À conserver toute la vie." },
    { cle: "diplome", libelle: "Diplôme", match: (_d, t) => /diplôme|diplome|baccalaur/.test(t), garde: { type: "vie" }, detail: "À conserver toute la vie." },
    { cle: "carnet_sante", libelle: "Carnet de santé, examens", match: (d, t) => d.category === "sante" && /carnet|vaccin|radio|analyse|examen|compte rendu|certificat/.test(t), garde: { type: "vie" }, detail: "Votre histoire médicale : à garder toute la vie." },
    { cle: "decompte_sante", libelle: "Remboursements de santé", match: (d) => d.category === "sante" && /décompte|decompte|remboursement|relevé de prestations|releve de prestations/.test(d.title.toLowerCase()), garde: { type: "annees", annees: 2, depuis: "document" }, detail: "2 ans : le délai pour contester un remboursement." },
    { cle: "impot_revenu", libelle: "Avis d'impôt sur le revenu", match: (d, t) => d.category === "impots" && /revenu|avis d'imp[ôo]t|déclaration|declaration/.test(t) && !/fonci|habitation/.test(t), garde: { type: "annees", annees: 3, depuis: "document", fin_annee: true }, detail: "L'administration peut contrôler pendant 3 ans : gardez l'avis et les justificatifs jusqu'à la fin de la 3e année." },
    { cle: "taxe_locale", libelle: "Taxe foncière ou d'habitation", match: (d, t) => d.category === "impots" && /fonci|habitation/.test(t), garde: { type: "annees", annees: 1, depuis: "document", fin_annee: true }, detail: "1 an, jusqu'à la fin de l'année suivante." },
    { cle: "energie", libelle: "Facture d'électricité, de gaz ou d'eau", match: (d) => d.category === "energie" && /facture|échéancier|echeancier|relevé|releve|régularisation|regularisation/.test(d.title.toLowerCase()), garde: { type: "annees", annees: 5, depuis: "document" }, detail: "5 ans : le fournisseur peut réclamer un impayé pendant ce délai." },
    { cle: "energie_contrat", libelle: "Contrat d'énergie", match: (d) => d.category === "energie", garde: { type: "tant_que", quoi: "le contrat court, puis 5 ans" }, detail: "Le contrat sert tant qu'il court ; ses factures se gardent 5 ans." },
    { cle: "telecom_facture", libelle: "Facture de téléphone ou d'internet", match: (d) => d.category === "telecom" && /facture/.test(d.title.toLowerCase()), garde: { type: "annees", annees: 1, depuis: "document" }, detail: "1 an." },
    { cle: "telecom", libelle: "Abonnement téléphone ou internet", match: (d) => d.category === "telecom", garde: { type: "tant_que", quoi: "l'abonnement court, puis 1 an" }, detail: "Le contrat sert tant qu'il court ; ses factures se gardent 1 an." },
    { cle: "rib", libelle: "RIB", match: (_d, t) => /\brib\b|relevé d'identité bancaire|releve d'identite bancaire/.test(t), garde: { type: "tant_que", quoi: "le compte est ouvert" }, detail: "Utile tant que le compte existe." },
    { cle: "releve", libelle: "Relevé de compte", match: (d) => d.category === "banque" && /relevé de compte|releve de compte|relevé bancaire|releve bancaire|relevé n|relevé du/.test(d.title.toLowerCase()), garde: { type: "annees", annees: 5, depuis: "document" }, detail: "5 ans." },
    { cle: "credit", libelle: "Contrat de crédit", match: (d, t) => d.category === "banque" && /crédit|credit|prêt|pret|amortissement/.test(t), garde: { type: "tant_que", quoi: "le crédit court, puis 2 ans" }, detail: "Jusqu'à 2 ans après le dernier remboursement." },
    { cle: "assurance_avis", libelle: "Avis d'échéance d'assurance", match: (d) => d.category === "assurance" && /avis d'échéance|avis d'echeance|quittance|appel de cotisation/.test(d.title.toLowerCase()), garde: { type: "annees", annees: 2, depuis: "document" }, detail: "2 ans." },
    { cle: "assurance", libelle: "Contrat d'assurance", match: (d) => d.category === "assurance", garde: { type: "tant_que", quoi: "le contrat court, puis 2 ans" }, detail: "Pendant toute la durée du contrat, puis 2 ans après sa résiliation." },
    { cle: "bail", libelle: "Bail et quittances de loyer", match: (d, t) => d.category === "logement" && /bail|quittance|loyer|état des lieux|etat des lieux/.test(t), garde: { type: "tant_que", quoi: "la location dure, puis 3 ans" }, detail: "Jusqu'à 3 ans après votre départ du logement." },
    { cle: "propriete", libelle: "Acte de propriété, travaux", match: (d, t) => d.category === "logement" && /acte de vente|propriété|propriete|notaire|travaux|permis de construire/.test(t), garde: { type: "tant_que", quoi: "vous êtes propriétaire, puis 10 ans pour les travaux" }, detail: "Tant que vous êtes propriétaire ; les factures de gros travaux, 10 ans (garantie décennale)." },
    { cle: "vehicule", libelle: "Papiers du véhicule", match: (d) => d.category === "vehicule", garde: { type: "tant_que", quoi: "vous gardez le véhicule" }, detail: "Carte grise, contrôles techniques, factures d'entretien : jusqu'à la revente (l'acheteur les demandera)." },
    { cle: "identite", libelle: "Passeport, carte d'identité", match: (d, t) => d.category === "identite" && /passeport|carte (nationale )?d'identit|\bcni\b|permis|titre de séjour/.test(t), garde: { type: "tant_que", quoi: "il est valide (l'ancien sert pour le renouveler)" }, detail: "Jusqu'à son renouvellement : l'ancien titre facilite la demande." },
    { cle: "garantie", libelle: "Facture d'achat", match: (d) => d.category === "garantie", garde: { type: "tant_que", quoi: "vous avez l'objet" }, detail: "Elle prouve la garantie (2 ans minimum) et la valeur de l'objet en cas de vol ou de sinistre." },
    { cle: "abonnement", libelle: "Abonnement", match: (d) => d.category === "abonnement", garde: { type: "tant_que", quoi: "l'abonnement court, puis 1 an" }, detail: "Le contrat sert tant qu'il court ; ses factures se gardent 1 an." },
    { cle: "scolarite", libelle: "Papiers de scolarité", match: (d) => d.category === "education", garde: { type: "tant_que", quoi: "l'année scolaire en cours" }, detail: "Inscriptions, cantine, assurance scolaire : utiles pour l'année en cours." },
];
const finAnnee = (iso) => `${iso.slice(0, 4)}-12-31`;
const plusAns = (iso, n) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4)}`;
const fr = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export function conservation(d, today = new Date().toISOString().slice(0, 10)) {
    const txt = `${d.title} ${d.organisme ?? ""} ${d.resume ?? ""}`.toLowerCase();
    const r = REGLES.find((x) => x.match(d, txt));
    if (!r)
        return null;
    const g = r.garde;
    if (g.type === "vie")
        return { regle: r.cle, libelle: r.libelle, jusqua: null, garder: "À vie", detail: r.detail, peut_jeter: false };
    if (g.type === "retraite")
        return { regle: r.cle, libelle: r.libelle, jusqua: null, garder: "Jusqu'à la retraite", detail: r.detail, peut_jeter: false };
    if (g.type === "tant_que")
        return { regle: r.cle, libelle: r.libelle, jusqua: null, garder: `Tant que ${g.quoi}`, detail: r.detail, peut_jeter: false };
    const base = g.depuis === "fin" ? d.date_fin : d.date_document ?? d.cree_le.slice(0, 10);
    if (!base)
        return null;
    const jusqua = g.fin_annee ? finAnnee(plusAns(base, g.annees)) : plusAns(base, g.annees);
    // Still running (end date ahead): never offered for the clear-out, whatever the rule says.
    const enCours = Boolean(d.date_fin && d.date_fin >= today);
    if (enCours && jusqua < today)
        return { regle: r.cle, libelle: r.libelle, jusqua: null, garder: "Tant qu'il est en cours", detail: r.detail, peut_jeter: false };
    return { regle: r.cle, libelle: r.libelle, jusqua, garder: jusqua < today ? `Pouvait partir depuis le ${fr(jusqua)}` : `Jusqu'au ${fr(jusqua)}`, detail: r.detail, peut_jeter: jusqua < today };
}
/** Papers whose keeping period is over (oldest first). */
export function grandMenage(docs, today) {
    return docs.map((doc) => ({ doc, etat: conservation(doc, today) }))
        .filter((x) => Boolean(x.etat?.peut_jeter))
        .sort((a, b) => (a.etat.jusqua ?? "").localeCompare(b.etat.jusqua ?? ""));
}
