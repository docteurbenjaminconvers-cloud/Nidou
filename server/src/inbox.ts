import type { Db, DocumentRow } from "./db.js";
import { estMedical, extractDocument, heuristicExtract } from "./extract.js";
import { budgetIa } from "./iaBudget.js";
import { deadlinesFor } from "./deadlines.js";

/**
 * Forwarding address: each household owns `foyer-<code>@<LUCIEN_INBOX_DOMAIN>`. Any email forwarded there (by hand or by a
 * Gmail/Outlook rule) is read like a photo in the app: attachments (PDF, images) first, otherwise the body.
 * No OAuth, no access to the mailbox itself. The mail provider (Brevo inbound parsing, OVH, Postmark…) posts the parsed
 * message to POST /api/inbox?secret=LUCIEN_INBOX_SECRET in the generic shape below; a Brevo adapter is included.
 */
export interface InboundEmail {
  message_id: string;
  to: string[];
  from: string | null;
  subject: string | null;
  text: string | null;
  attachments: { nom: string; mime: string; base64: string }[];
}

export const INBOX_DOMAIN = () => process.env.LUCIEN_INBOX_DOMAIN ?? "in.monlucien.fr";
export const boiteAddress = (code: string | null) => (code ? `foyer-${code}@${INBOX_DOMAIN()}` : null);

const MAX_ATTACHMENTS = 5;
const MAX_BYTES = 15 * 1024 * 1024;
const READABLE = /^(application\/pdf|image\/(jpeg|png|gif|webp))$/;

export function codeFromAddress(addr: string): string | null {
  const m = addr.toLowerCase().match(/(?:foyer|nid)-([a-z0-9]{6})@/);
  return m ? m[1] : null;
}

/** Strips quoted replies and signatures so the model reads the forwarded content, not the chit-chat around it. */
export function cleanBody(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/^(>.*\n?)+/gm, "")
    .replace(/\n--\s*\n[\s\S]*$/, "")
    .replace(/^-{5,}\s*(Message transféré|Forwarded message|Message d'origine|Original Message).*$/gim, "")
    .trim();
}

export type InboxOutcome =
  | { statut: "ignore"; raison: "destinataire_inconnu" | "plan_gratuit" | "deja_traite" | "rien_a_lire" }
  | { statut: "ok"; household_id: string; documents: DocumentRow[] };

export async function processInboundEmail(db: Db, mail: InboundEmail, opts: { plan: (h: { id: string }) => "gratuit" | "famille" }): Promise<InboxOutcome> {
  const code = mail.to.map(codeFromAddress).find(Boolean);
  const h = code ? db.householdByBoiteCode(code) : undefined;
  if (!h) return { statut: "ignore", raison: "destinataire_inconnu" };
  if (opts.plan(h) === "gratuit") { db.recordInboxMessage(h.id, mail.message_id, mail.from, mail.subject, 0); return { statut: "ignore", raison: "plan_gratuit" }; }

  const files = mail.attachments.filter((a) => READABLE.test(a.mime) && Buffer.byteLength(a.base64, "base64") <= MAX_BYTES).slice(0, MAX_ATTACHMENTS);
  const body = cleanBody(mail.text ?? "");
  const inputs: { base64?: string; mime?: string; nomFichier?: string; texte?: string }[] = files.length
    ? files.map((a) => ({ base64: a.base64, mime: a.mime, nomFichier: a.nom, texte: body.length > 40 ? body : undefined }))
    : body.length > 40 ? [{ texte: body, nomFichier: mail.subject ?? undefined }] : [];
  if (inputs.length === 0) { db.recordInboxMessage(h.id, mail.message_id, mail.from, mail.subject, 0); return { statut: "ignore", raison: "rien_a_lire" }; }
  if (!db.recordInboxMessage(h.id, mail.message_id, mail.from, mail.subject, inputs.length)) return { statut: "ignore", raison: "deja_traite" };

  const docs: DocumentRow[] = [];
  for (const input of inputs) {
    const budget = budgetIa(db, h.id);
    const ex = budget.ok() ? await extractDocument(input) : { ...heuristicExtract(input), modele: null };
    if (ex.modele) db.recordIaLecture(h.id, false, ex.modele.cout_lecture_centimes);
    if (estMedical(ex)) continue; // medical papers are never kept
    const doc = db.insertDocument({
      household_id: h.id, member_id: null, title: ex.title, category: ex.category, organisme: ex.organisme, numero_contrat: ex.numero_contrat,
      montant: ex.montant, periodicite: ex.periodicite, date_document: ex.date_document, date_debut: ex.date_debut, date_fin: ex.date_fin,
      preavis_jours: ex.preavis_jours, resume: ex.resume, texte: input.texte ?? null, fichier: null, mime: input.mime ?? "text/plain",
      confiance: ex.confiance, source: "email",
    });
    db.replaceDeadlinesForDocument(doc.id, h.id, deadlinesFor(doc));
    docs.push(doc);
  }
  return { statut: "ok", household_id: h.id, documents: docs };
}

/** Brevo "inbound parsing" webhook → generic shape. Attachments are fetched with the account's API key. */
export async function fromBrevo(payload: { items?: BrevoItem[] }): Promise<InboundEmail[]> {
  const out: InboundEmail[] = [];
  for (const it of payload.items ?? []) {
    const attachments: InboundEmail["attachments"] = [];
    for (const a of it.Attachments ?? []) {
      if (!READABLE.test(a.ContentType) || !process.env.BREVO_API_KEY) continue;
      const r = await fetch(`https://api.brevo.com/v3/inbound/attachments/${a.DownloadToken}`, { headers: { "api-key": process.env.BREVO_API_KEY } });
      if (r.ok) attachments.push({ nom: a.Name, mime: a.ContentType, base64: Buffer.from(await r.arrayBuffer()).toString("base64") });
    }
    out.push({ message_id: it.MessageId ?? it.Uuid, to: (it.To ?? []).map((t) => t.Address), from: it.From?.Address ?? null, subject: it.Subject ?? null, text: it.RawTextBody ?? null, attachments });
  }
  return out;
}

interface BrevoItem {
  Uuid: string; MessageId?: string; From?: { Address: string }; To?: { Address: string }[]; Subject?: string; RawTextBody?: string;
  Attachments?: { Name: string; ContentType: string; DownloadToken: string }[];
}
