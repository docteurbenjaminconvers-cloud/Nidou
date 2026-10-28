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
    title: { type: "string", description: "Titre court et parlant, ex. « Assurance auto Peugeot 308 — MAIF »" },
    category: { type: "string", enum: ExtractionSchema.shape.category.options },
    organisme: { type: ["string", "null"], description: "Entreprise ou administration émettrice" },
    numero_contrat: { type: ["string", "null"] },
    montant: { type: ["number", "null"], description: "Montant TTC en euros, par période de facturation" },
    periodicite: { type: ["string", "null"], enum: [...ExtractionSchema.shape.periodicite.unwrap().options, null] },
    date_document: { type: ["string", "null"], description: "AAAA-MM-JJ" },
    date_debut: { type: ["string", "null"], description: "Début du contrat ou de la période, AAAA-MM-JJ" },
    date_fin: { type: ["string", "null"], description: "Fin, échéance, expiration ou date de renouvellement, AAAA-MM-JJ" },
    preavis_jours: { type: ["integer", "null"], description: "Délai de préavis de résiliation en jours, si mentionné" },
    resume: { type: "string", description: "2 phrases maximum, en français, pour un particulier" },
    confiance: { type: "number", description: "0 à 1 : confiance globale dans l'extraction" },
  },
} as const;

const SYSTEM = `Tu es le moteur d'extraction de Nidou, un assistant qui gère les papiers d'une famille.
On te donne un document (contrat, facture, courrier, attestation, pièce d'identité, ordonnance…).
Extrais les champs demandés avec rigueur :
- Les dates au format AAAA-MM-JJ. Si seule une date de début et une durée (ex. « 1 an ») sont connues, calcule la date de fin.
- Le montant est le montant TTC par période (mensuel, trimestriel, annuel) ; « unique » pour une facture ou un achat ponctuel.
- Si une information n'est pas présente, renvoie null. N'invente rien.
- Le titre doit permettre de retrouver le document en un coup d'œil : objet + organisme.
- La catégorie « garantie » couvre les achats avec garantie constructeur ou extension.
Réponds uniquement via l'outil fourni.`;

export interface ExtractResult extends Extraction { modele: ModelInfo | null }

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
  const seuil = Number(process.env.NIDOU_SEUIL_CONFIANCE ?? 0.7);

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
