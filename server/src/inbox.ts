import { avecCompteur, reel } from "./ia.js";
import { aGarder, membreConcerne, titreAvecPrenom } from "./details.js";
import type { Db, DocumentRow } from "./db.js";
import { estMedical, extractDocument, heuristicExtract } from "./extract.js";
import { budgetIa } from "./iaBudget.js";
import { deadlinesFor } from "./deadlines.js";
import { assemblerPages } from "./pages.js";
import { envoyerEmail } from "./mail.js";

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

const TRANSFERT = /^[ \t>]*(?:-{2,}\s*(?:Message transféré|Forwarded message|Message d'origine|Original Message|Courriel d'origine)\s*-{2,}|Début du message (?:transféré|réexpédié)\s*:|Begin forwarded message\s*:|_{10,}(?=[ \t]*\n[ \t]*(?:De|From)\s*:))[ \t]*$/im;

/**
 * Keeps what the model must read. A forwarded email: the forwarded message itself (what comes before it is the
 * person's own note and signature — Gmail puts the signature above the forwarded part). Otherwise: the text without
 * quoted replies and without the signature.
 */
export function cleanBody(text: string): string {
  let t = text.replace(/\r/g, "");
  const m = TRANSFERT.exec(t);
  if (m) {
    t = t.slice(m.index + m[0].length);
    const lignes = t.split("\n").filter((l) => l.trim());
    // Apple Mail quotes the whole forwarded message: unquote it rather than drop it
    if (lignes.length && lignes.filter((l) => /^\s*>/.test(l)).length > lignes.length * 0.6) t = t.replace(/^[ \t]*>+ ?/gm, "");
    // the forwarded message's own header (De, Date, Objet…) is not the paper: only its sender is kept, at the end
    const l = t.replace(/^\s+/, "").split("\n");
    let n = 0, de: string | null = null;
    while (n < l.length && n < 8 && /^\s*(De|From|Date|Envoyé|Sent|Objet|Subject|Sujet|À|A|To|Cc|Répondre à|Reply-To)\s*:/i.test(l[n])) { de ??= /^\s*(?:De|From)\s*:\s*(.+)$/i.exec(l[n])?.[1]?.trim() ?? null; n++; }
    if (n) t = l.slice(n).join("\n") + (de ? `\n\nEmail reçu de : ${de}` : "");
  }
  return t
    .replace(/^(>.*\n?)+/gm, "")
    .replace(/\n--\s*\n[\s\S]*$/, "")
    .replace(TRANSFERT, "")
    .trim();
}

/** The text of an HTML-only email (many invoices by email have no text part). */
export function texteDuHtml(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&euro;/g, "€").replace(/&deg;/g, "°").replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type InboxOutcome =
  | { statut: "ignore"; raison: "destinataire_inconnu" | "plan_gratuit" | "deja_traite" | "rien_a_lire" }
  | { statut: "ok"; household_id: string; documents: DocumentRow[]; non_gardes: number }; // non_gardes: medical papers, never kept

const LOGO = 25 * 1024; // images lighter than this are logos and signature pictures, not papers

export async function processInboundEmail(db: Db, mail: InboundEmail, opts: { plan: (h: { id: string }) => "gratuit" | "famille" }): Promise<InboxOutcome> {
  const code = mail.to.map(codeFromAddress).find(Boolean);
  const h = code ? db.householdByBoiteCode(code) : undefined;
  if (!h) return { statut: "ignore", raison: "destinataire_inconnu" };
  if (opts.plan(h) === "gratuit") { db.recordInboxMessage(h.id, mail.message_id, mail.from, mail.subject, 0); return { statut: "ignore", raison: "plan_gratuit" }; }

  const poids = (a: { base64: string }) => Buffer.byteLength(a.base64, "base64");
  const files = mail.attachments.filter((a) => READABLE.test(a.mime) && poids(a) <= MAX_BYTES && (a.mime === "application/pdf" || poids(a) >= LOGO)).slice(0, MAX_ATTACHMENTS);
  const body = cleanBody(mail.text ?? "");
  const texte = body.length > 40 ? body : undefined;
  let inputs: { base64?: string; mime?: string; nomFichier?: string; texte?: string }[] = files.length
    ? files.map((a) => ({ base64: a.base64, mime: a.mime, nomFichier: a.nom, texte }))
    : texte ? [{ texte, nomFichier: mail.subject ?? undefined }] : [];
  // several photos in one email: the pages of one paper (a letter front and back), put together like in the app
  if (files.length > 1 && files.every((a) => /^image\/(jpeg|png)$/.test(a.mime))) {
    try {
      const pdf = await assemblerPages(files.map((a) => ({ mime: a.mime, buf: Buffer.from(a.base64, "base64") })));
      inputs = [{ base64: pdf.toString("base64"), mime: "application/pdf", nomFichier: files[0].nom.replace(/\.[a-z0-9]+$/i, "") + ".pdf", texte }];
    } catch { /* unreadable image: each photo stays its own paper */ }
  }
  if (inputs.length === 0) { db.recordInboxMessage(h.id, mail.message_id, mail.from, mail.subject, 0); return { statut: "ignore", raison: "rien_a_lire" }; }
  if (!db.recordInboxMessage(h.id, mail.message_id, mail.from, mail.subject, inputs.length)) return { statut: "ignore", raison: "deja_traite" };

  const docs: DocumentRow[] = [];
  for (const input of inputs) {
    const doc = await rangerPapier(db, h.id, input, "email");
    if (doc) docs.push(doc);
  }
  return { statut: "ok", household_id: h.id, documents: docs, non_gardes: inputs.length - docs.length };
}

/** Brevo "inbound parsing" webhook → generic shape. Attachments are fetched with the account's API key. */
export async function fromBrevo(payload: { items?: BrevoItem[] }): Promise<InboundEmail[]> {
  const out: InboundEmail[] = [];
  for (const it of payload.items ?? []) {
    const attachments: InboundEmail["attachments"] = [];
    for (const a of it.Attachments ?? []) {
      if (!READABLE.test(a.ContentType) || !process.env.BREVO_API_KEY || attachments.length >= MAX_ATTACHMENTS + 3) continue;
      const r = await fetch(`https://api.brevo.com/v3/inbound/attachments/${a.DownloadToken}`, { headers: { "api-key": process.env.BREVO_API_KEY } });
      if (r.ok) attachments.push({ nom: a.Name, mime: a.ContentType, base64: Buffer.from(await r.arrayBuffer()).toString("base64") });
    }
    const uuid = Array.isArray(it.Uuid) ? it.Uuid[0] : it.Uuid;
    const text = it.RawTextBody?.trim() ? it.RawTextBody : it.RawHtmlBody ? texteDuHtml(it.RawHtmlBody) : null;
    out.push({ message_id: it.MessageId ?? uuid ?? `brevo-${Date.now()}`, to: [...(it.To ?? []), ...(it.Cc ?? [])].map((t) => t.Address), from: it.From?.Address ?? null, subject: it.Subject ?? null, text, attachments });
  }
  return out;
}

interface BrevoItem {
  Uuid?: string | string[]; MessageId?: string; From?: { Address: string }; To?: { Address: string }[]; Cc?: { Address: string }[]; Subject?: string; RawTextBody?: string; RawHtmlBody?: string;
  Attachments?: { Name: string; ContentType: string; DownloadToken: string }[];
}

/**
 * Reads one paper (a file or a text) and puts it away like a photo taken in the app: fields, details, the member it
 * is about, its deadlines. Null for a medical paper (never kept). `source`: where it came from (email, assistant).
 */
export async function rangerPapier(db: Db, householdId: string, input: { base64?: string; mime?: string; nomFichier?: string; texte?: string }, source: string): Promise<DocumentRow | null> {
  const budget = budgetIa(db, householdId);
  const [ex, cout] = await avecCompteur(async () => {
    const ex = budget.ok() ? await extractDocument(input) : { ...heuristicExtract(input), modele: null };
    return [ex, ex.modele ? reel(ex.modele.cout_lecture_centimes) : 0] as const;
  });
  if (ex.modele) db.recordIaLecture(householdId, false, cout);
  if (estMedical(ex)) return null; // medical papers are never kept
  const garde = aGarder(ex, input.texte);
  const membres = db.listMembers(householdId);
  const pourQui = membreConcerne(ex.personnes, membres);
  const doc = db.insertDocument({
    household_id: householdId, member_id: pourQui, title: titreAvecPrenom(ex.title, ex.personnes, membres.find((m) => m.id === pourQui)), category: ex.category, organisme: ex.organisme, numero_contrat: ex.numero_contrat,
    montant: ex.montant, periodicite: ex.periodicite, date_document: ex.date_document, date_debut: ex.date_debut, date_fin: ex.date_fin,
    preavis_jours: ex.preavis_jours, resume: ex.resume, texte: garde.texte, details: garde.details, fichier: null, mime: input.mime ?? "text/plain",
    confiance: ex.confiance, source,
  });
  db.replaceDeadlinesForDocument(doc.id, householdId, deadlinesFor(doc));
  return doc;
}

/**
 * Tells the person what became of the email they sent — only when it comes from a member of the household (never an
 * answer to a company whose invoice was forwarded by a rule). Nothing for a message already handled.
 */
/** True when an answer was due. */
export async function accuserReception(db: Db, mail: InboundEmail, r: InboxOutcome): Promise<boolean> {
  if (r.statut === "ignore" && (r.raison === "deja_traite" || r.raison === "destinataire_inconnu")) return false;
  const code = mail.to.map(codeFromAddress).find(Boolean);
  const h = code ? db.householdByBoiteCode(code) : undefined;
  const de = (mail.from ?? "").trim().toLowerCase();
  if (!h || !de || !db.usersOfHousehold(h.id).some((u) => u.email.toLowerCase() === de)) return false;
  const base = (process.env.LUCIEN_PUBLIC_URL ?? "").replace(/\/$/, "");
  const sujet = (mail.subject ?? "votre email").replace(/^((fwd?|tr|re)\s*:\s*)+/i, "").slice(0, 80);
  let lignes: string[];
  if (r.statut === "ok" && r.documents.length) {
    lignes = [
      r.documents.length === 1 ? "C'est rangé :" : `C'est rangé, ${r.documents.length} papiers :`,
      ...r.documents.map((d) => `• ${d.title}${base ? `\n  ${base}/#doc/${d.id}` : ""}`),
      "Ouvrez-le pour vérifier ce que j'ai lu : dates, montant, échéances.",
      ...(r.non_gardes ? ["Une pièce jointe ressemblait à un document médical : je ne les conserve pas."] : []),
    ];
  } else if (r.statut === "ok") {
    lignes = ["Je n'ai rien rangé : ce document ressemble à un document médical, et je ne les conserve pas."];
  } else if (r.raison === "plan_gratuit") {
    lignes = ["Je n'ai pas rangé cet email : le dépôt par email fait partie de la formule complète.", ...(base ? [`${base}/#settings`] : [])];
  } else {
    lignes = ["Je n'ai rien trouvé à lire dans cet email.", "Joignez le papier en PDF ou en photo (JPEG, PNG), ou transférez l'email qui contient son texte."];
  }
  await envoyerEmail({ to: de, subject: `Lucien — ${sujet}`, text: ["Bonjour,", ...lignes, "Lucien"].join("\n\n") });
  return true; // an answer was due (whether the mail service took it is in its own log)
}
