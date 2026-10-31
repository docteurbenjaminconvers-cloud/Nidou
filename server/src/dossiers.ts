/**
 * « Dossiers prêts » : Lucien rassemble les pièces qu'on vous demande (location, CAF, école, prêt, passeport…),
 * dit ce qui est déjà dans le coffre, ce qui est trop ancien ou expiré, et où obtenir ce qui manque.
 * Fonction pure, sans dépendance au serveur : l'appli (démo comprise) et le serveur (archive .zip, connecteur) s'en servent.
 * Listes indicatives établies d'après service-public.fr : chaque dossier renvoie à sa source.
 */

export interface DocDossier {
  id: string; title: string; category: string; organisme: string | null;
  date_document: string | null; date_fin: string | null; cree_le: string; member_id: string | null;
  fichier?: string | null; resume?: string | null;
}

interface Piece {
  cle: string;
  libelle: string;
  pourquoi?: string;
  match: (d: DocDossier) => boolean;
  /** How many of them are expected (e.g. the last 3 payslips). */
  nombre?: number;
  /** Must be more recent than this many months (date of the paper, or when it was added). */
  moins_de_mois?: number;
  /** Must not be expired (identity papers). */
  en_cours?: boolean;
  obtenir: string;
  optionnelle?: boolean;
}

export interface Kit { cle: string; titre: string; pour: string; icone: string; source: string; pieces: Piece[] }

const t = (d: DocDossier) => `${d.title} ${d.organisme ?? ""} ${d.resume ?? ""}`.toLowerCase();
const re = (r: RegExp) => (d: DocDossier) => r.test(t(d));
const cat = (c: string, r?: RegExp) => (d: DocDossier) => d.category === c && (!r || r.test(t(d)));

// ---------- pièces communes ----------
const IDENTITE: Piece = {
  cle: "identite", libelle: "Pièce d'identité en cours de validité", match: cat("identite", /passeport|carte (nationale )?d'identit|\bcni\b|titre de séjour/), en_cours: true,
  obtenir: "Carte d'identité ou passeport : demande en mairie sur rendez-vous, pré-demande sur ants.gouv.fr.",
};
const DOMICILE_3_MOIS: Piece = {
  cle: "domicile", libelle: "Justificatif de domicile de moins de 3 mois", pourquoi: "Facture d'électricité, de gaz, d'eau, d'internet ou quittance de loyer.",
  match: (d) => (d.category === "energie" || d.category === "telecom" || (d.category === "logement" && /quittance|loyer/.test(t(d)))) && !/échéancier|echeancier|contrat/.test(t(d)), moins_de_mois: 3,
  obtenir: "Téléchargez votre dernière facture dans l'espace client de votre fournisseur d'énergie ou d'internet, puis ajoutez-la à Lucien.",
};
const AVIS_IMPOT: Piece = {
  cle: "avis_impot", libelle: "Dernier avis d'impôt sur le revenu", match: cat("impots", /avis d'imp[ôo]t|imp[ôo]t sur le revenu|avis de situation/), moins_de_mois: 18,
  obtenir: "impots.gouv.fr, espace particulier, rubrique « Documents » : l'avis se télécharge en PDF.",
};
const BULLETINS: Piece = {
  cle: "bulletins", libelle: "3 derniers bulletins de salaire", nombre: 3, match: re(/bulletin de (salaire|paie)|fiche de paie|bulletin de paie/), moins_de_mois: 4,
  obtenir: "Votre employeur ou votre coffre-fort de paie (Digiposte, Cegedim…). Indépendant : bilan ou attestation comptable.",
};
const CONTRAT_TRAVAIL: Piece = {
  cle: "contrat_travail", libelle: "Contrat de travail ou attestation de l'employeur", match: re(/contrat de travail|attestation (de l')?employeur|promesse d'embauche/),
  obtenir: "Demandez une attestation d'emploi au service RH : elle indique le poste, la date d'embauche et la période d'essai.",
};
const RIB: Piece = {
  cle: "rib", libelle: "RIB", match: (d) => /\brib\b|relevé d'identité bancaire|releve d'identite bancaire/.test(t(d)),
  obtenir: "Dans l'appli de votre banque, rubrique « RIB » : un PDF à partager.",
};
const LIVRET_FAMILLE: Piece = {
  cle: "livret_famille", libelle: "Livret de famille ou acte de naissance", match: re(/livret de famille|acte de naissance|extrait d'acte/),
  obtenir: "Acte de naissance gratuit en ligne sur service-public.fr (rubrique « Demande d'acte de naissance »). Photographiez aussi le livret de famille.",
};

export const KITS: Kit[] = [
  {
    cle: "location", titre: "Louer un logement", pour: "Le dossier à remettre au propriétaire ou à l'agence", icone: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z",
    source: "https://www.service-public.fr/particuliers/vosdroits/F1169",
    pieces: [
      IDENTITE, DOMICILE_3_MOIS, BULLETINS, CONTRAT_TRAVAIL, AVIS_IMPOT,
      { cle: "garant", libelle: "Dossier du garant (si vous en avez un)", optionnelle: true, match: re(/\bgarant\b|\bgarante\b|acte de caution|cautionnement|visale/),
        obtenir: "Pas de garant ? La garantie Visale d'Action Logement est gratuite : visale.fr." },
    ],
  },
  {
    cle: "caf", titre: "Demande à la CAF", pour: "Allocations familiales, APL, prime d'activité", icone: "M12 21s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.6-7 10-7 10z",
    source: "https://www.caf.fr/allocataires/caf-de-paris/offre-de-service/demarches-en-ligne",
    pieces: [
      IDENTITE, RIB, AVIS_IMPOT, LIVRET_FAMILLE,
      { cle: "bail", libelle: "Bail ou quittance de loyer (pour l'aide au logement)", match: cat("logement", /bail|quittance|loyer/), moins_de_mois: 12,
        obtenir: "Votre bail signé, ou une quittance demandée au propriétaire. Il remplira aussi une attestation de loyer pour la CAF." },
    ],
  },
  {
    cle: "ecole", titre: "Inscription à l'école et à la cantine", pour: "Mairie, école, centre de loisirs", icone: "M3 9l9-5 9 5-9 5-9-5zM7 11.5V16c0 1.5 2.5 3 5 3s5-1.5 5-3v-4.5",
    source: "https://www.service-public.fr/particuliers/vosdroits/F1865",
    pieces: [
      LIVRET_FAMILLE, DOMICILE_3_MOIS,
      { cle: "vaccins", libelle: "Carnet de santé, pages des vaccinations", match: (d) => d.category === "sante" && /vaccin|carnet de santé|carnet de sante/.test(t(d)),
        obtenir: "Photographiez les pages « vaccinations » du carnet de santé de l'enfant." },
      { cle: "assurance_scolaire", libelle: "Attestation d'assurance scolaire", match: cat("assurance", /scolaire|responsabilité civile|responsabilite civile|habitation/), moins_de_mois: 12,
        obtenir: "Souvent incluse dans l'assurance habitation (responsabilité civile) : demandez l'attestation à votre assureur." },
      { cle: "quotient", libelle: "Attestation de quotient familial CAF (tarif de la cantine)", optionnelle: true, match: re(/quotient familial|attestation de paiement caf|attestation caf/), moins_de_mois: 6,
        obtenir: "caf.fr, « Mon compte », « Attestations » : l'attestation de quotient familial se télécharge en PDF." },
    ],
  },
  {
    cle: "pret", titre: "Demande de prêt immobilier", pour: "Banque ou courtier", icone: "M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6",
    source: "https://www.service-public.fr/particuliers/vosdroits/F1004",
    pieces: [
      IDENTITE, DOMICILE_3_MOIS, LIVRET_FAMILLE, CONTRAT_TRAVAIL, BULLETINS,
      { ...AVIS_IMPOT, cle: "avis_impot_2", libelle: "2 derniers avis d'impôt", nombre: 2, moins_de_mois: 30 },
      { cle: "releves", libelle: "3 derniers relevés de compte", nombre: 3, match: cat("banque", /relevé|releve/), moins_de_mois: 4,
        obtenir: "Dans l'appli de votre banque, rubrique « Relevés » : téléchargez les 3 derniers en PDF." },
      { cle: "credits", libelle: "Tableaux d'amortissement des crédits en cours", optionnelle: true, match: cat("banque", /amortissement|crédit|credit|prêt|pret/),
        obtenir: "Demandez-les à votre banque, ou dans l'espace client du prêteur." },
    ],
  },
  {
    cle: "identite", titre: "Refaire un passeport ou une carte d'identité", pour: "Rendez-vous en mairie", icone: "M4 6h16v12H4zM8 10h3M8 14h6M15 10h1",
    source: "https://www.service-public.fr/particuliers/vosdroits/F1342",
    pieces: [
      { ...DOMICILE_3_MOIS, cle: "domicile_1an", libelle: "Justificatif de domicile de moins d'un an", moins_de_mois: 12 },
      { cle: "ancien_titre", libelle: "Ancien passeport ou ancienne carte d'identité", match: cat("identite", /passeport|carte (nationale )?d'identit|\bcni\b/),
        obtenir: "Si vous ne l'avez plus : déclaration de perte ou de vol, et un acte de naissance." },
      { cle: "timbre", libelle: "Timbre fiscal (passeport seulement)", optionnelle: true, match: re(/timbre fiscal/),
        obtenir: "Timbre électronique sur timbres.impots.gouv.fr (86 € pour un passeport adulte)." },
    ],
  },
  {
    cle: "sinistre", titre: "Déclarer un sinistre à l'assurance", pour: "Dégât des eaux, vol, bris, accident", icone: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
    source: "https://www.service-public.fr/particuliers/vosdroits/F2697",
    pieces: [
      { cle: "contrat_assurance", libelle: "Contrat ou attestation d'assurance concerné", match: cat("assurance"),
        obtenir: "Dans l'espace client de votre assureur, rubrique « Mes contrats »." },
      { cle: "factures_achat", libelle: "Factures des biens abîmés ou volés", match: (d) => d.category === "garantie" || /facture d'achat|ticket de caisse/.test(t(d)),
        obtenir: "Retrouvez-les dans vos emails ou l'espace client du magasin. Photos des biens à défaut." },
      { cle: "depot_plainte", libelle: "Récépissé de dépôt de plainte (en cas de vol)", optionnelle: true, match: re(/plainte|récépissé|recepisse/),
        obtenir: "Pré-plainte en ligne sur pre-plainte-en-ligne.gouv.fr, puis rendez-vous au commissariat ou à la gendarmerie." },
      { cle: "constat", libelle: "Constat amiable (dégât des eaux, accident)", optionnelle: true, match: re(/constat/),
        obtenir: "Formulaire disponible chez votre assureur ; à remplir avec le voisin ou l'autre conducteur." },
    ],
  },
];

export type StatutPiece = "ok" | "ancien" | "expire" | "manquant";
export interface PieceEtat { cle: string; libelle: string; pourquoi: string | null; statut: StatutPiece; documents: { id: string; titre: string; date: string | null; fichier: boolean }[]; attendu: number; obtenir: string; optionnelle: boolean; note: string | null }
export interface EtatKit { cle: string; titre: string; pour: string; icone: string; source: string; pieces: PieceEtat[]; prets: number; requis: number; complet: boolean }

const dateDe = (d: DocDossier) => d.date_document ?? d.cree_le.slice(0, 10);
const moisEntre = (de: string, a: string) => (new Date(a + "T12:00:00Z").getTime() - new Date(de + "T12:00:00Z").getTime()) / (30.44 * 864e5);

export function etatKit(kit: Kit, docs: DocDossier[], today = new Date().toISOString().slice(0, 10)): EtatKit {
  const pieces: PieceEtat[] = kit.pieces.map((p) => {
    const trouves = docs.filter(p.match).sort((a, b) => dateDe(b).localeCompare(dateDe(a)));
    const attendu = p.nombre ?? 1;
    const frais = trouves.filter((d) => !p.moins_de_mois || moisEntre(dateDe(d), today) <= p.moins_de_mois);
    const valides = p.en_cours ? frais.filter((d) => !d.date_fin || d.date_fin >= today) : frais;
    let statut: StatutPiece = "manquant", note: string | null = null;
    if (valides.length >= attendu) statut = "ok";
    else if (p.en_cours && frais.some((d) => d.date_fin && d.date_fin < today)) { statut = "expire"; note = "Le titre que j'ai est expiré : il faut le renouveler."; }
    else if (trouves.length) { statut = "ancien"; note = valides.length ? `J'en ai ${valides.length} sur ${attendu} assez récent${valides.length > 1 ? "s" : ""}.` : `Celui que j'ai date de plus de ${p.moins_de_mois} mois.`; }
    const garder = (statut === "ok" ? valides : trouves).slice(0, attendu);
    return {
      cle: p.cle, libelle: p.libelle, pourquoi: p.pourquoi ?? null, statut, attendu, obtenir: p.obtenir, optionnelle: Boolean(p.optionnelle), note,
      documents: garder.map((d) => ({ id: d.id, titre: d.title, date: d.date_document ?? null, fichier: Boolean(d.fichier) })),
    };
  });
  const requis = pieces.filter((p) => !p.optionnelle);
  const prets = requis.filter((p) => p.statut === "ok").length;
  return { cle: kit.cle, titre: kit.titre, pour: kit.pour, icone: kit.icone, source: kit.source, pieces, prets, requis: requis.length, complet: prets === requis.length };
}

export const etatDossiers = (docs: DocDossier[], today?: string) => KITS.map((k) => etatKit(k, docs, today));

/** The cover sheet that goes into the .zip (and that the app can share as text). */
export function bordereau(e: EtatKit, foyer: string, today = new Date().toISOString().slice(0, 10)): string {
  const fr = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const lignes = e.pieces.map((p) => {
    const mark = p.statut === "ok" ? "[x]" : "[ ]";
    const docs = p.documents.map((d) => `      - ${d.titre}${d.date ? ` (${fr(d.date)})` : ""}`).join("\n");
    const manque = p.statut === "ok" ? "" : `\n      À fournir : ${p.obtenir}`;
    return `  ${mark} ${p.libelle}${p.optionnelle ? " (si besoin)" : ""}${docs ? "\n" + docs : ""}${manque}`;
  });
  return [
    `${e.titre.toUpperCase()} — ${foyer.replace(/\s*\(démo\)$/, "")}`,
    `Dossier préparé par Lucien le ${fr(today)} : ${e.prets} pièce${e.prets > 1 ? "s" : ""} sur ${e.requis} prête${e.prets > 1 ? "s" : ""}.`,
    "",
    ...lignes,
    "",
    `Liste indicative d'après ${e.source}. Vérifiez auprès de l'organisme, qui peut demander d'autres pièces.`,
  ].join("\n");
}
