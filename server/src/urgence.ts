/**
 * « En cas de coup dur » : la marche à suivre quand tout va mal (portefeuille perdu ou volé, dégât des eaux,
 * accident de voiture, hospitalisation), avec les références du foyer tirées du coffre (numéros de contrat,
 * organismes) pour ne rien chercher au mauvais moment. Fonction pure, partagée appli/serveur.
 * Délais et numéros publics : service-public.fr, Code des assurances (art. L113-2).
 */

export interface DocUrgence { id: string; title: string; category: string; organisme: string | null; numero_contrat: string | null; date_fin: string | null; member_id: string | null; resume?: string | null }

export interface Etape { titre: string; detail: string; lien?: string; tel?: string; delai?: string }
export interface Reference { id: string; titre: string; organisme: string | null; numero: string | null }
export interface Scenario { cle: string; titre: string; quand: string; icone: string; etapes: Etape[]; references: Reference[]; source: string }

const txt = (d: DocUrgence) => `${d.title} ${d.organisme ?? ""} ${d.resume ?? ""}`.toLowerCase();
const ref = (d: DocUrgence): Reference => ({ id: d.id, titre: d.title, organisme: d.organisme, numero: d.numero_contrat });
const trouve = (docs: DocUrgence[], f: (d: DocUrgence, t: string) => boolean) => docs.filter((d) => f(d, txt(d))).map(ref);

export const NUMEROS = [
  { tel: "112", libelle: "Urgences (numéro européen)" },
  { tel: "15", libelle: "SAMU, urgence médicale" },
  { tel: "17", libelle: "Police, gendarmerie" },
  { tel: "18", libelle: "Pompiers" },
  { tel: "114", libelle: "Urgences par SMS (sourds, malentendants, ou si parler est dangereux)" },
];

export function scenarios(docs: DocUrgence[]): Scenario[] {
  const assurHab = trouve(docs, (d, t) => d.category === "assurance" && /habitation|multirisque|logement|\bmrh\b/.test(t));
  const assurAuto = trouve(docs, (d, t) => d.category === "assurance" && /\bauto\b|automobile|véhicule|vehicule|voiture/.test(t));
  const mutuelle = trouve(docs, (d, t) => d.category === "assurance" && /mutuelle|complémentaire santé|complementaire sante|prévoyance|prevoyance/.test(t));
  const identite = trouve(docs, (d, t) => d.category === "identite" && /passeport|carte (nationale )?d'identit|\bcni\b|permis|titre de séjour/.test(t));
  const banque = trouve(docs, (d, t) => d.category === "banque" || /\brib\b/.test(t));
  const vehicule = trouve(docs, (d) => d.category === "vehicule");
  const factures = trouve(docs, (d) => d.category === "garantie");

  return [
    {
      cle: "portefeuille", titre: "Portefeuille ou sac perdu, volé", quand: "Cartes, papiers, clés : dans l'ordre, sans rien oublier.", icone: "M3 7h18v12H3zM16 13h2M3 10h18",
      source: "https://www.service-public.gouv.fr/particuliers/recherche?keyword=perte%20vol%20papiers",
      etapes: [
        { titre: "Faire opposition aux cartes bancaires", detail: "Tout de suite, même la nuit : le numéro de votre banque (au dos de la carte, dans son appli), ou le serveur interbancaire d'opposition.", tel: "0892705705", delai: "Immédiatement" },
        { titre: "En cas de vol : porter plainte", detail: "Pré-plainte en ligne, puis rendez-vous au commissariat ou à la gendarmerie. Le récépissé sert pour la banque, l'assurance et les nouveaux papiers.", lien: "https://www.pre-plainte-en-ligne.gouv.fr" },
        { titre: "Carte d'identité, passeport", detail: "La perte se déclare au moment de refaire le titre (pré-demande en ligne, puis rendez-vous en mairie). En cas de vol, la plainte suffit.", lien: "https://ants.gouv.fr" },
        { titre: "Permis de conduire", detail: "Déclaration de perte et demande de nouveau permis en ligne.", lien: "https://ants.gouv.fr" },
        { titre: "Carte Vitale", detail: "Signalez la perte ou le vol dans votre compte ameli : une nouvelle carte est commandée.", lien: "https://www.ameli.fr" },
        { titre: "Clés et téléphone", detail: "Faites suspendre la ligne par votre opérateur. Si les clés et une adresse étaient ensemble, prévenez votre assureur habitation : changer les serrures est parfois couvert." },
      ],
      references: [...identite, ...banque, ...assurHab],
    },
    {
      cle: "degat_eaux", titre: "Dégât des eaux, incendie, cambriolage", quand: "Chez vous, quelque chose s'est mal passé.", icone: "M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z",
      source: "https://www.service-public.gouv.fr/particuliers/vosdroits/F3077",
      etapes: [
        { titre: "Mettre en sécurité", detail: "Coupez l'eau (ou le gaz, l'électricité). Danger, feu, blessé : appelez les secours.", tel: "112" },
        { titre: "Cambriolage : porter plainte", detail: "Avant de ranger. Listez ce qui manque ; le récépissé est exigé par l'assureur.", lien: "https://www.pre-plainte-en-ligne.gouv.fr" },
        { titre: "Déclarer à l'assureur habitation", detail: "Par téléphone, appli ou courrier recommandé, avec le numéro de contrat. Dégât des eaux : remplissez un constat amiable avec le voisin concerné.", delai: "5 jours ouvrés (vol : 2 jours ouvrés)" },
        { titre: "Photographier et garder les preuves", detail: "Photos des dégâts, objets abîmés gardés jusqu'au passage de l'expert, factures d'achat des biens." },
      ],
      references: [...assurHab, ...factures],
    },
    {
      cle: "accident", titre: "Accident de voiture", quand: "Sur la route, avec ou sans autre véhicule.", icone: "M5 16h14l-1.5-5a2 2 0 00-2-1.5h-7a2 2 0 00-2 1.5zM7 19v-3M17 19v-3",
      source: "https://www.service-public.gouv.fr/particuliers/recherche?keyword=constat%20amiable%20accident",
      etapes: [
        { titre: "Se protéger, alerter", detail: "Gilet, triangle, warnings. Blessé : appelez les secours.", tel: "112" },
        { titre: "Remplir le constat amiable", detail: "Avec l'autre conducteur, sur papier ou dans l'appli e-constat auto. Un seul exemplaire signé par les deux, rien d'ajouté après coup." },
        { titre: "Envoyer le constat à l'assureur", detail: "Avec le numéro de contrat, des photos et les coordonnées des témoins.", delai: "5 jours ouvrés" },
      ],
      references: [...assurAuto, ...vehicule],
    },
    {
      cle: "hopital", titre: "Hospitalisation, urgence médicale", quand: "Pour vous ou un proche : ce qu'on vous demandera à l'accueil.", icone: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z",
      source: "https://www.service-public.gouv.fr/particuliers/recherche?keyword=hospitalisation%20frais",
      etapes: [
        { titre: "Urgence vitale : le 15", detail: "Le SAMU oriente vers le bon service. Pour un avis médical le soir ou le week-end, le 116 117.", tel: "15" },
        { titre: "À l'accueil de l'hôpital", detail: "Pièce d'identité, carte Vitale (ou attestation de droits), carte de mutuelle : avec elles, pas d'avance des frais couverts." },
        { titre: "Prévenir la mutuelle", detail: "Pour la prise en charge (chambre particulière, forfait journalier) et l'éventuelle assistance (aide à domicile, garde d'enfants)." },
        { titre: "Arrêt de travail", detail: "Envoyez-le à la CPAM et à l'employeur.", delai: "48 heures" },
      ],
      references: [...mutuelle, ...identite],
    },
  ];
}
