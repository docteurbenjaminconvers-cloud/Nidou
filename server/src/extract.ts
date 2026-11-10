import { z } from "zod";
import { structured, provider, type ModelInfo } from "./ia.js";
import type { DocCategory, Periodicity } from "./db.js";

export const ExtractionSchema = z.object({
  title: z.string().min(1).max(120),
  category: z.enum([
    "assurance", "energie", "telecom", "logement", "banque", "impots", "abonnement",
    "sante", "identite", "garantie", "education", "vehicule", "autre",
  ]),
  organisme: z.string().nullable(),
  numero_contrat: z.string().nullable(),
  montant: z.number().nullable(),
  periodicite: z.enum(["mensuel", "trimestriel", "annuel", "unique"]).nullable(),
  date_document: z.string().nullable(),
  date_debut: z.string().nullable(),
  date_fin: z.string().nullable(),
  preavis_jours: z.number().int().nullable(),
  resume: z.string().max(400),
  confiance: z.number().min(0).max(1),
  // what Lucien needs later (letters, payments, calls): read once, at upload
  contact: z.object({
    nom: z.string().nullable().optional(), service: z.string().nullable().optional(), adresse: z.string().nullable().optional(),
    email: z.string().nullable().optional(), telephone: z.string().nullable().optional(), site: z.string().nullable().optional(),
  }).nullable().optional(),
  paiement: z.object({ iban: z.string().nullable().optional(), bic: z.string().nullable().optional(), titulaire: z.string().nullable().optional(), date_limite: z.string().nullable().optional() }).nullable().optional(),
  references: z.array(z.object({ libelle: z.string(), valeur: z.string() })).max(12).nullable().optional(),
  dates_cles: z.array(z.object({ libelle: z.string(), date: z.string() })).max(12).nullable().optional(),
  destinataire: z.object({ nom: z.string().nullable().optional(), adresse: z.string().nullable().optional() }).nullable().optional(),
  transcription: z.string().nullable().optional(),
  personnes: z.array(z.object({ prenoms: z.string().nullable().optional(), nom: z.string().nullable().optional(), date_naissance: z.string().nullable().optional() })).max(8).nullable().optional(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractInput {
  texte?: string;
  /** base64 bytes of an image or PDF */
  base64?: string;
  mime?: string;
  nomFichier?: string;
}

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "category", "organisme", "numero_contrat", "montant", "periodicite",
    "date_document", "date_debut", "date_fin", "preavis_jours", "resume", "confiance",
  ],
  properties: {
    title: { type: "string", description: "Titre court et parlant, ex. « Assurance auto Peugeot 308 — MAIF ». Une personne y est nommée par son premier prénom seulement (« Carte nationale d'identité — Achileas Convers », jamais un deuxième ou troisième prénom)." },
    category: { type: "string", enum: ExtractionSchema.shape.category.options },
    organisme: { type: ["string", "null"], description: "Entreprise ou administration émettrice" },
    numero_contrat: { type: ["string", "null"], description: "Le numéro principal du papier : n° de contrat, de police, de client, d'avis fiscal… Pour une pièce d'identité (carte nationale d'identité, passeport, permis, titre de séjour) : le numéro du document, tel qu'imprimé (ex. « KHMF0R359 »), sans espaces." },
    montant: { type: ["number", "null"], description: "Montant TTC en euros, par période de facturation" },
    periodicite: { type: ["string", "null"], enum: [...ExtractionSchema.shape.periodicite.unwrap().options, null] },
    date_document: { type: ["string", "null"], description: "AAAA-MM-JJ" },
    date_debut: { type: ["string", "null"], description: "Début du contrat ou de la période, AAAA-MM-JJ. Pour une pièce d'identité : date de délivrance." },
    date_fin: { type: ["string", "null"], description: "Fin, échéance, expiration ou date de renouvellement, AAAA-MM-JJ. Pour une pièce d'identité : la date de fin de validité imprimée (« Date d'expiration », « Valable jusqu'au »)." },
    preavis_jours: { type: ["integer", "null"], description: "Délai de préavis de résiliation en jours, si mentionné" },
    resume: { type: "string", description: "2 phrases maximum, en français, pour un particulier" },
    confiance: { type: "number", description: "0 à 1 : confiance globale dans l'extraction" },
    contact: {
      type: ["object", "null"], description: "Coordonnées de l'émetteur pour le joindre ou lui écrire (bloc « Pour nous contacter », en-tête, pied de page)",
      properties: {
        nom: { type: ["string", "null"], description: "Nom de l'organisme ou de la société" },
        service: { type: ["string", "null"], description: "Service précis, ex. « Service de gestion comptable d'Uzès »" },
        adresse: { type: ["string", "null"], description: "Adresse postale complète sur plusieurs lignes (rue, BP, code postal, ville, CEDEX)" },
        email: { type: ["string", "null"], description: "Adresse email de contact écrite sur le document (après « Mél », « Courriel », « Email »). Jamais une adresse « no-reply »." },
        telephone: { type: ["string", "null"] },
        site: { type: ["string", "null"], description: "Site web ou espace en ligne indiqué" },
      },
    },
    paiement: {
      type: ["object", "null"], description: "Coordonnées pour payer l'émetteur, si le document en donne",
      properties: {
        iban: { type: ["string", "null"], description: "IBAN du bénéficiaire, sans espaces" },
        bic: { type: ["string", "null"] },
        titulaire: { type: ["string", "null"], description: "Titulaire du compte bénéficiaire" },
        date_limite: { type: ["string", "null"], description: "Date limite de paiement, AAAA-MM-JJ" },
      },
    },
    references: { type: ["array", "null"], description: "Toutes les références utiles pour répondre : n° d'acte, de dossier, de facture, de créance, de client, de contrat, de lettre…", items: { type: "object", properties: { libelle: { type: "string" }, valeur: { type: "string" } }, required: ["libelle", "valeur"] } },
    dates_cles: { type: ["array", "null"], description: "Autres dates importantes du document (émission, échéance, rendez-vous, délai de réponse…), AAAA-MM-JJ", items: { type: "object", properties: { libelle: { type: "string" }, date: { type: "string" } }, required: ["libelle", "date"] } },
    destinataire: { type: ["object", "null"], description: "À qui le document est adressé (nom et adresse du foyer)", properties: { nom: { type: ["string", "null"] }, adresse: { type: ["string", "null"] } } },
    personnes: { type: ["array", "null"], description: "La ou les personnes que le document concerne nommément (titulaire d'une pièce d'identité, élève, assuré, salarié, patient exclu) : tous leurs prénoms dans l'ordre, nom, date de naissance AAAA-MM-JJ si écrite. Vide pour un document adressé au foyer en général.", items: { type: "object", properties: { prenoms: { type: ["string", "null"] }, nom: { type: ["string", "null"] }, date_naissance: { type: ["string", "null"] } } } },
    transcription: { type: ["string", "null"], description: "Pour une photo ou un PDF : le texte intégral du document, fidèlement, ligne par ligne (8 000 caractères au plus). null si le texte t'a été donné." },
  },
} as const;

const SYSTEM = `Tu es le moteur d'extraction de Lucien, un assistant qui gère les papiers d'une famille.
On te donne un document (contrat, facture, courrier, attestation, pièce d'identité, ordonnance…).
Extrais les champs demandés avec rigueur :
- Les dates au format AAAA-MM-JJ. Si seule une date de début et une durée (ex. « 1 an ») sont connues, calcule la date de fin.
- Le montant est le montant TTC par période (mensuel, trimestriel, annuel) ; « unique » pour une facture ou un achat ponctuel.
- Si une information n'est pas présente, renvoie null. N'invente rien.
- Le titre doit permettre de retrouver le document en un coup d'œil : objet + organisme.
- La catégorie « garantie » couvre les achats avec garantie constructeur ou extension.
- La catégorie « sante » est réservée aux documents MÉDICAUX : ordonnance, compte rendu, résultat d'analyse ou d'examen, décompte de soins, certificat médical, carnet de santé ou de vaccination. Lucien ne les conserve pas.
- Un contrat, une carte ou une attestation de mutuelle ou de complémentaire santé, qui ne décrit aucun soin, est de catégorie « assurance ».
- Relève aussi tout ce qui servira ensuite : les coordonnées de l'émetteur (service, adresse postale, email, téléphone), ses coordonnées de paiement (IBAN, BIC), toutes les références (acte, dossier, facture, créance, client, contrat), les dates clés et, pour une photo ou un PDF, la transcription fidèle du texte.
Réponds uniquement via l'outil fourni.`;

export interface ExtractResult extends Extraction { modele: ModelInfo | null }

/** Medical papers are not kept: Lucien is not a certified health-data host (HDS). Decided on 31/10/2026. */
export const estMedical = (ex: { category: string }) => ex.category === "sante";
export const MESSAGE_MEDICAL = "Ce papier ressemble à un document médical (ordonnance, résultat, compte rendu, décompte de soins…). Lucien ne garde pas les documents médicaux : il n'a pas été enregistré. Les contrats et attestations de mutuelle sont acceptés.";

/**
 * Extracts structured fields from a document. Fast model first; when it is not confident, the precise model
 * takes over (10 to 20 % of documents). Falls back to a heuristic extractor when no provider is configured.
 */
export async function extractDocument(input: ExtractInput, opts: { precisOnly?: boolean } = {}): Promise<ExtractResult> {
  if (!provider()) return { ...heuristicExtract(input), modele: null };

  const content: Parameters<typeof structured>[0]["content"] = [];
  if (input.base64 && input.mime) {
    if (input.mime === "application/pdf") content.push({ type: "pdf", base64: input.base64 });
    else if (/^image\/(jpeg|png|gif|webp)$/.test(input.mime)) content.push({ type: "image", mime: input.mime, base64: input.base64 });
  }
  if (input.texte) content.push({ type: "text", text: `Texte du document :\n\n${input.texte.slice(0, 60_000)}` });
  if (input.nomFichier) content.push({ type: "text", text: `Nom du fichier : ${input.nomFichier}` });
  content.push({ type: "text", text: `Date du jour : ${new Date().toISOString().slice(0, 10)}. Extrais les champs.` });

  const tool = { name: "enregistrer_extraction", description: "Enregistre les champs extraits du document.", schema: JSON_SCHEMA as unknown as Record<string, unknown> };
  const seuil = Number(process.env.LUCIEN_SEUIL_CONFIANCE ?? 0.7);

  if (!opts.precisOnly) {
    try {
      const r = await structured({ tier: "rapide", system: SYSTEM, content, tool });
      const ex = ExtractionSchema.safeParse(r.data);
      if (ex.success && ex.data.confiance >= seuil) return { ...ex.data, modele: r.model };
    } catch { /* fall through to the precise model */ }
  }
  const r = await structured({ tier: "precis", system: SYSTEM, content, tool });
  return { ...ExtractionSchema.parse(r.data), modele: r.model };
}

// ---------- Heuristic fallback (no API key) ----------

const CATEGORY_HINTS: [RegExp, DocCategory][] = [
  [/assuran|mutuelle|maif|macif|axa|allianz|matmut|gmf|groupama/i, "assurance"],
  [/edf|engie|totalenergies|électricit|electricit|gaz|eau\b|veolia|suez/i, "energie"],
  [/orange|sfr|bouygues|free\b|mobile|fibre|internet|télécom|telecom/i, "telecom"],
  [/loyer|bail|syndic|copropri|habitation/i, "logement"],
  [/banque|crédit|credit|prêt|pret|relevé|compte/i, "banque"],
  [/impôt|impot|dgfip|taxe|fonci/i, "impots"],
  [/netflix|spotify|disney|canal|abonnement|salle de sport|basic.fit|fitness/i, "abonnement"],
  [/ordonnance|médecin|medecin|pharmacie|analyse|vaccin|hôpital|hopital/i, "sante"],
  [/passeport|carte d'identité|carte nationale|permis de conduire|titre de séjour/i, "identite"],
  [/garantie|facture d'achat|darty|fnac|boulanger|apple|samsung/i, "garantie"],
  [/école|ecole|cantine|crèche|creche|université|universite|scolarit/i, "education"],
  [/contrôle technique|controle technique|carte grise|immatriculation|véhicule|vehicule|voiture/i, "vehicule"],
];

const MONTHS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04", mai: "05", juin: "06", juillet: "07",
  août: "08", aout: "08", septembre: "09", octobre: "10", novembre: "11", décembre: "12", decembre: "12",
};

function parseDates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/g)) {
    out.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(m[0]);
  for (const m of text.matchAll(/\b(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})\b/gi)) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) out.push(`${m[3]}-${mm}-${m[1].padStart(2, "0")}`);
  }
  return [...new Set(out)].sort();
}

function parseAmount(text: string): number | null {
  const m = text.match(/(\d{1,3}(?:[  .]\d{3})*(?:[,.]\d{1,2})?)\s*(?:€|eur|euros)/i);
  if (!m) return null;
  return parseFloat(m[1].replace(/[  ]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
}

export function heuristicExtract(input: ExtractInput): Extraction {
  const text = `${input.nomFichier ?? ""}\n${input.texte ?? ""}`;
  const category = CATEGORY_HINTS.find(([re]) => re.test(text))?.[1] ?? "autre";
  const dates = parseDates(text);
  const periodicite: Periodicity | null = /\/\s*mois|mensuel|par mois/i.test(text)
    ? "mensuel"
    : /trimestr/i.test(text)
      ? "trimestriel"
      : /\/\s*an\b|annuel|par an/i.test(text)
        ? "annuel"
        : /facture|reçu|recu|ticket/i.test(text)
          ? "unique"
          : null;
  const ORGS = ["MAIF", "MACIF", "AXA", "Allianz", "Matmut", "GMF", "Groupama", "EDF", "Engie", "TotalEnergies", "Orange", "SFR", "Bouygues", "Free", "Netflix", "Spotify", "Canal+", "Darty", "Fnac", "Boulanger", "Apple", "DGFIP", "CAF", "CPAM", "Basic-Fit"];
  const orgMatch = text.match(new RegExp(`\\b(${ORGS.map((o) => o.replace("+", "\\+")).join("|")})\\b`, "i"));
  const organisme = orgMatch ? ORGS.find((o) => o.toLowerCase() === orgMatch[1].toLowerCase()) ?? orgMatch[1] : null;
  const firstLine = (input.texte ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 3) ?? input.nomFichier ?? "Document";
  const preavis = text.match(/pr[ée]avis\D{0,20}(\d{1,3})\s*(jours|mois)/i);
  return {
    title: firstLine.slice(0, 90),
    category,
    organisme,
    numero_contrat: text.match(/(?:n[°o]\s*(?:de\s*)?(?:contrat|client|police|adhérent|adherent)?\s*:?\s*)([A-Z0-9-]{6,})/i)?.[1] ?? null,
    montant: parseAmount(text),
    periodicite,
    date_document: dates[0] ?? null,
    date_debut: dates.length > 1 ? dates[0] : null,
    date_fin: dates.length > 1 ? dates[dates.length - 1] : null,
    preavis_jours: preavis ? parseInt(preavis[1], 10) * (preavis[2].startsWith("mois") ? 30 : 1) : null,
    resume: "Extraction locale sans IA : vérifiez les champs. Ajoutez une clé API Anthropic pour l'extraction complète.",
    confiance: 0.3,
  };
}
