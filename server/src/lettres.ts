/**
 * Letters Lucien sends for the household (cancellation, refund request): who to write to, gleaned from the papers
 * (email, postal address, customer reference), the letter itself as text and as a PDF laid out like a real letter.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface Coordonnees {
  emails: string[];            // best first
  adresse: string | null;      // postal address of the company, several lines
  reference: string | null;    // customer / contract number
  source: string | null;       // the paper it was read from
}

export interface Lettre {
  expediteur: { nom: string; adresse: string | null };
  destinataire: { nom: string; adresse: string | null };
  date: string;                // « 8 novembre 2026 »
  objet: string;
  reference: string | null;
  corps: string[];             // paragraphs, salutation included
  signature: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SANS_REPONSE = /no-?reply|ne-?pas-?repondre|nepasrepondre|donotreply|mailer-daemon|bounce|notification/i;
const BON_MOT = /resili|desabon|service-?client|serviceclient|clients?@|contact|relation|adherent|gestion|sav|support/i;

/** Papers of this company: organisme or title naming it (« Leocare », « LEOCARE SAS »…). */
export function papiersDe<T extends { organisme: string | null; title: string }>(docs: T[], marchand: string): T[] {
  const m = norm(marchand);
  if (m.length < 3) return [];
  const premier = m.split(" ")[0];
  return docs.filter((d) => {
    const o = norm(d.organisme ?? ""), t = norm(d.title);
    return (o && (o.includes(m) || m.includes(o) || o.split(" ")[0] === premier)) || t.includes(m);
  });
}

/** Email, postal address and customer reference found in the papers of a company. */
export function coordonnees(docs: { organisme: string | null; title: string; texte: string | null; numero_contrat: string | null }[], marchand: string): Coordonnees {
  const siens = papiersDe(docs, marchand);
  const emails = new Map<string, number>();
  let adresse: string | null = null, reference: string | null = null, source: string | null = null;
  const domaine = norm(marchand).split(" ")[0];
  for (const d of siens) {
    const t = d.texte ?? "";
    for (const e of t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
      const x = e.toLowerCase().replace(/\.$/, "");
      if (SANS_REPONSE.test(x)) continue;
      const score = (BON_MOT.test(x) ? 2 : 0) + (x.split("@")[1].replace(/[^a-z0-9]/g, "").includes(domaine.replace(/ /g, "")) ? 1 : 0);
      emails.set(x, Math.max(emails.get(x) ?? -1, score));
      source ??= d.title;
    }
    if (!reference) reference = d.numero_contrat || (t.match(/(?:n[°o]\s*(?:de\s*)?(?:client|contrat|adh[ée]rent|abonn[ée]|police|dossier)|r[ée]f[ée]rence\s*client|identifiant\s*client)\s*[:.]?\s*([A-Z0-9][A-Z0-9\- ]{3,24}[A-Z0-9])/i)?.[1] ?? null);
    if (!adresse) {
      // « Service résiliation / Leocare / 12 rue X / 75008 Paris »: a street line followed by a postcode and a city
      const lignes = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (let i = 1; i < lignes.length; i++) {
        const cp = lignes[i].match(/^(?:CS\s*\d+\s*)?(\d{5})\s+([A-ZÀ-Ü][A-Za-zÀ-ü' -]{1,40}?)(?:\s+CEDEX(?:\s*\d+)?)?$/i);
        const rue = lignes[i - 1];
        if (cp && /\d/.test(rue) && /(rue|avenue|av\.|bd|boulevard|place|all[ée]e|quai|chemin|route|cs|bp|impasse|cours)\b/i.test(rue)) {
          const nom = i >= 2 && norm(lignes[i - 2]).includes(norm(marchand).split(" ")[0]) ? `${lignes[i - 2]}\n` : "";
          adresse = `${nom}${rue}\n${lignes[i]}`; source ??= d.title; break;
        }
      }
    }
  }
  return { emails: [...emails].sort((a, b) => b[1] - a[1]).map(([e]) => e).slice(0, 4), adresse, reference: reference?.trim() ?? null, source };
}

const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} €`;
export const dateLongue = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function lettreResiliationStructuree(o: { marchand: string; montant: number; expediteur: { nom: string; adresse: string | null }; destinataire?: string | null; reference?: string | null; aujourdhui?: string }): Lettre {
  return {
    expediteur: o.expediteur,
    destinataire: { nom: o.marchand, adresse: o.destinataire ?? "Service client" },
    date: dateLongue(o.aujourdhui ?? new Date().toISOString().slice(0, 10)),
    objet: "Résiliation de mon abonnement",
    reference: o.reference ?? null,
    corps: [
      "Madame, Monsieur,",
      `Je vous informe de ma décision de résilier mon abonnement, pour lequel vous prélevez ${eur(o.montant)} sur mon compte.`,
      "Je vous remercie de prendre en compte cette résiliation à la date la plus proche permise par les conditions de mon contrat, de cesser tout prélèvement à compter de cette date, et de m'adresser une confirmation écrite indiquant la date effective de fin.",
      "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
    ],
    signature: o.expediteur.nom,
  };
}

/** The same letter as plain text (copy, email body). */
export function texteLettre(l: Lettre): string {
  return [
    l.expediteur.nom, l.expediteur.adresse ?? "[votre adresse]", "",
    l.destinataire.nom, l.destinataire.adresse ?? "", "",
    `Le ${l.date}`, "",
    `Objet : ${l.objet}`, ...(l.reference ? [`Référence client : ${l.reference}`] : []), "",
    l.corps.join("\n\n"), "", l.signature,
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const propre = (s: string) => s.replace(/[   ]/g, " ").split("").map((c) => (c.charCodeAt(0) <= 0xff || WINANSI_EXTRA.includes(c) ? c : "?")).join("");

/** A French business letter on A4: sender top left, addressee in the window position, date, subject, body, signature. */
export async function pdfLettre(l: Lettre): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(propre(`${l.objet} — ${l.destinataire.nom}`)); pdf.setAuthor(propre(l.expediteur.nom)); pdf.setCreator("Lucien — monlucien.fr"); pdf.setProducer("Lucien");
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 62, encre = rgb(0.13, 0.12, 0.14), gris = rgb(0.42, 0.4, 0.44);
  let page = pdf.addPage([W, H]);
  const lignes = (t: string, font: PDFFont, size: number, w: number) => {
    const out: string[] = [];
    for (const para of propre(t).split("\n")) {
      let x = "";
      for (const mot of para.split(" ")) { const e = x ? `${x} ${mot}` : mot; if (font.widthOfTextAtSize(e, size) > w && x) { out.push(x); x = mot; } else x = e; }
      out.push(x);
    }
    return out;
  };
  const bloc = (t: string, x: number, y: number, o: { font?: PDFFont; size?: number; w?: number; color?: ReturnType<typeof rgb>; interligne?: number } = {}) => {
    const font = o.font ?? f, size = o.size ?? 11, h = size * (o.interligne ?? 1.45);
    for (const li of lignes(t, font, size, o.w ?? W - x - M)) {
      if (y < M + 40) { page = pdf.addPage([W, H]); y = H - M; }
      page.drawText(li, { x, y: y - size, size, font, color: o.color ?? encre }); y -= h;
    }
    return y;
  };
  // sender (top left)
  let y = H - 56;
  y = bloc(l.expediteur.nom, M, y, { font: fb });
  bloc(l.expediteur.adresse ?? "", M, y, { color: gris, size: 10.5 });
  // addressee, where a window envelope shows it (about 11 cm from the left, 5 cm from the top)
  const xd = 312;
  let yd = bloc(l.destinataire.nom, xd, H - 150, { font: fb });
  yd = bloc(l.destinataire.adresse ?? "", xd, yd);
  y = Math.min(yd, H - 230) - 18;
  y = bloc(`Le ${l.date}`, xd, y) - 22;
  y = bloc(`Objet : ${l.objet}`, M, y, { font: fb });
  if (l.reference) y = bloc(`Référence client : ${l.reference}`, M, y);
  y -= 18;
  for (const p of l.corps) y = bloc(p, M, y, { w: W - 2 * M }) - 9;
  y -= 18;
  bloc(l.signature, xd, y, { font: fb });
  // discreet footer
  page.drawText(propre("Lettre préparée avec Lucien · monlucien.fr"), { x: M, y: 30, size: 7.5, font: f, color: rgb(0.7, 0.68, 0.72) });
  return pdf.save();
}
