/**
 * What Lucien keeps from a paper for later (« Coordonnées et références » on the paper, the letters, the payments):
 * who sent it and how to reach them, how to pay them, the references to quote, the key dates. Read by the AI at
 * upload, completed by plain reading of the text (emails, phone numbers, IBAN) so nothing written is missed.
 */
import type { Extraction } from "./extract.js";

export interface Details {
  contact: { nom: string | null; service: string | null; adresse: string | null; email: string | null; telephone: string | null; site: string | null };
  paiement: { iban: string | null; bic: string | null; titulaire: string | null; date_limite: string | null } | null;
  references: { libelle: string; valeur: string }[];
  dates_cles: { libelle: string; date: string }[];
}

const SANS_REPONSE = /no-?reply|ne-?pas-?repondre|nepasrepondre|donotreply|mailer-daemon|bounce/i;
const nul = (x: string | null | undefined) => { const t = (x ?? "").trim(); return t ? t : null; };

/** IBAN with a valid checksum (ISO 13616), spaces removed. */
export function ibanValide(x: string): boolean {
  const s = x.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of r) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}

/** Plain reading of a text: emails (no « no-reply »), French phone numbers, IBAN with a valid key. */
export function lireCoordonnees(texte: string | null | undefined): { emails: string[]; telephones: string[]; ibans: string[] } {
  const t = texte ?? "";
  const emails = [...new Set((t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase().replace(/\.$/, "")))].filter((e) => !SANS_REPONSE.test(e));
  const sansIban = t.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, " ");
  const telephones = [...new Set((sansIban.match(/(?<![\dA-Za-z])(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/g) ?? []).map((x) => x.replace(/[\s.-]/g, "").replace(/^\+33/, "0").replace(/(\d{2})(?=\d)/g, "$1 ").trim()))];
  const ibans = [...new Set((t.match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g) ?? []).map((x) => x.replace(/\s+/g, "")).filter(ibanValide))];
  return { emails, telephones, ibans };
}

/** The details to keep, from the AI's reading and the text. Null when there is nothing worth keeping. */
export function detailsDe(ex: Partial<Extraction>, texte: string | null | undefined): Details | null {
  const lu = lireCoordonnees(texte);
  const c = ex.contact ?? {};
  const emailIa = nul(c.email)?.toLowerCase().replace(/\s+/g, "") ?? null;
  const email = emailIa && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(emailIa) && !SANS_REPONSE.test(emailIa) ? emailIa : lu.emails[0] ?? null;
  const ibanIa = nul(ex.paiement?.iban)?.replace(/\s+/g, "").toUpperCase() ?? null;
  const iban = ibanIa && ibanValide(ibanIa) ? ibanIa : lu.ibans[0] ?? null;
  const d: Details = {
    contact: { nom: nul(c.nom) ?? nul(ex.organisme), service: nul(c.service), adresse: nul(c.adresse), email, telephone: nul(c.telephone) ?? lu.telephones[0] ?? null, site: nul(c.site) },
    paiement: iban || nul(ex.paiement?.date_limite) ? { iban, bic: nul(ex.paiement?.bic), titulaire: nul(ex.paiement?.titulaire), date_limite: nul(ex.paiement?.date_limite) } : null,
    references: (ex.references ?? []).filter((r) => nul(r.libelle) && nul(r.valeur)).slice(0, 12),
    dates_cles: (ex.dates_cles ?? []).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)).slice(0, 12),
  };
  const vide = !d.contact.adresse && !d.contact.email && !d.contact.telephone && !d.contact.service && !d.paiement && !d.references.length && !d.dates_cles.length;
  return vide ? null : d;
}

export const lireDetails = (json: string | null | undefined): Details | null => { try { return json ? (JSON.parse(json) as Details) : null; } catch { return null; } };

/**
 * Text and details to store with a new paper. The AI's transcription is kept when no text came with the file (so the
 * letters and the search can use it later), except for identity papers: nothing more than the fields is kept of them.
 */
export function aGarder(ex: Partial<Extraction> & { category: string }, texte: string | null | undefined): { texte: string | null; details: string | null } {
  if (ex.category === "identite") return { texte: texte ?? null, details: null };
  const t = texte ?? (nul(ex.transcription)?.slice(0, 20_000) ?? null);
  const d = detailsDe(ex, t);
  return { texte: t, details: d ? JSON.stringify(d) : null };
}

const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

/**
 * The family member a paper is about (a child's identity card, a payslip, a school certificate), from the names the
 * AI read on it: the same date of birth, or the first given name, or failing that another given name (« Achileas
 * Ulysse »). Only when exactly one member fits; otherwise nobody (the person chooses, and can always change it).
 */
export function membreConcerne(personnes: Extraction["personnes"], membres: { id: string; prenom: string; date_naissance: string | null }[]): string | null {
  const ps = (personnes ?? []).filter((p) => p.prenoms || p.date_naissance);
  if (ps.length !== 1 || !membres.length) return null;
  const p = ps[0];
  const unique = (l: typeof membres) => (l.length === 1 ? l[0].id : null);
  if (p.date_naissance && /^\d{4}-\d{2}-\d{2}$/.test(p.date_naissance)) {
    const r = unique(membres.filter((m) => m.date_naissance === p.date_naissance));
    if (r) return r;
  }
  const prenoms = norm(p.prenoms ?? "").split(" ").filter(Boolean);
  if (!prenoms.length) return null;
  const prenomDe = (m: { prenom: string }) => norm(m.prenom.replace(/^(mamie|mamy|papi|papy|tata|tonton)\s+/i, ""));
  const premier = unique(membres.filter((m) => { const x = prenomDe(m); return !!x && (prenoms.join(" ").startsWith(x + " ") || prenoms.join(" ") === x || prenoms[0] === x); }));
  if (premier) return premier;
  return unique(membres.filter((m) => { const x = prenomDe(m); return !!x && prenoms.includes(x); }));
}

/**
 * The title names the person by the first name the family uses: « Carte d'identité — Ulysse Convers » becomes
 * « … — Achileas Convers » once the paper is Achileas's (Ulysse being his second given name).
 */
export function titreAvecPrenom(titre: string, personnes: Extraction["personnes"], membre: { prenom: string } | null | undefined): string {
  if (!membre) return titre;
  const prenom = membre.prenom.replace(/^(mamie|mamy|papi|papy|tata|tonton)\s+/i, "").trim();
  if (!prenom || norm(titre).split(" ").includes(norm(prenom))) return titre;
  const autres = (personnes ?? []).flatMap((p) => (p.prenoms ?? "").split(/[\s,]+/)).filter((x) => x && norm(x) !== norm(prenom));
  for (const a of autres) {
    const re = new RegExp(`(^|[^\\p{L}])${a.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}])`, "iu");
    if (re.test(titre.normalize("NFC"))) return titre.normalize("NFC").replace(re, `$1${prenom}`);
  }
  return titre;
}
