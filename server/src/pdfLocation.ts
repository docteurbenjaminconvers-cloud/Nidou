/**
 * PDF of a lease or an inventory, with the signatures and a proof page (who signed, when, from where, and the
 * SHA-256 fingerprint of the signed text). Built with pdf-lib and the standard Helvetica fonts.
 */
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ContenuDocument } from "./documentsLocation.js";

export interface SignaturePdf { role: "bailleur" | "locataire"; nom: string; signe_le: string | null; ip?: string | null; image?: string | null }

// Helvetica (WinAnsi) cannot draw every character: narrow spaces and a few signs are replaced.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const propre = (s: string) => s.replace(/m²/g, "m2").replace(/[\u202f\u00a0\u2009]/g, " ").replace(/≤/g, "<=").replace(/≥/g, ">=")
  .split("").map((c) => (c.charCodeAt(0) <= 0xff || WINANSI_EXTRA.includes(c) ? c : "?")).join("");

/** Fingerprint of what is signed: the text itself, so the same text always gives the same fingerprint. */
export const empreinte = (c: ContenuDocument) => createHash("sha256").update(JSON.stringify({ titre: c.titre, sous_titre: c.sous_titre, sections: c.sections })).digest("hex");

const C = { encre: rgb(0.23, 0.165, 0.227), gris: rgb(0.545, 0.435, 0.518), corail: rgb(0.851, 0.373, 0.271), ligne: rgb(0.94, 0.89, 0.925) };

export async function pdfDocument(c: ContenuDocument, signatures: SignaturePdf[] = [], preuve?: { id: string; empreinte: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(propre(c.titre)); pdf.setAuthor("Lucien"); pdf.setCreator("Lucien — monlucien.fr"); pdf.setProducer("Lucien");
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, larg = W - 2 * M;
  let page: PDFPage = pdf.addPage([W, H]); let y = H - M;
  const nouvellePage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const lignes = (t: string, font: PDFFont, size: number, w = larg) => {
    const out: string[] = [];
    for (const para of propre(t).split("\n")) {
      let l = "";
      for (const mot of para.split(" ")) {
        const essai = l ? `${l} ${mot}` : mot;
        if (font.widthOfTextAtSize(essai, size) > w && l) { out.push(l); l = mot; } else l = essai;
      }
      out.push(l);
    }
    return out;
  };
  const ecrire = (t: string, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; apres?: number; gauche?: number } = {}) => {
    const font = o.font ?? f, size = o.size ?? 10.5, h = size * 1.42, x = M + (o.gauche ?? 0);
    for (const l of lignes(t, font, size, larg - (o.gauche ?? 0))) {
      if (y - h < M + 20) nouvellePage();
      page.drawText(l, { x, y: y - size, size, font, color: o.color ?? C.encre });
      y -= h;
    }
    y -= o.apres ?? 0;
  };

  // header
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: C.corail });
  ecrire(c.titre, { font: fb, size: 19, apres: 2 });
  ecrire(c.sous_titre, { size: 9.5, color: C.gris, apres: 14 });
  for (const s of c.sections) {
    if (y < M + 90) nouvellePage();
    ecrire(s.titre, { font: fb, size: 12, apres: 3 });
    for (const p of s.paragraphes) ecrire(p, { apres: 4 });
    y -= 8;
  }

  // signatures
  if (signatures.length) {
    if (y < M + 150) nouvellePage();
    const largeurCase = (larg - 16 * (signatures.length - 1)) / signatures.length;
    const haut = y;
    for (const [i, s] of signatures.entries()) {
      const x = M + i * (largeurCase + 16);
      page.drawRectangle({ x, y: haut - 120, width: largeurCase, height: 120, borderColor: C.ligne, borderWidth: 1 });
      page.drawText(propre(s.role === "bailleur" ? "Le bailleur" : "Le locataire"), { x: x + 8, y: haut - 16, size: 9, font: fb, color: C.gris });
      page.drawText(propre(s.nom).slice(0, 48), { x: x + 8, y: haut - 30, size: 10, font: fb, color: C.encre });
      if (s.signe_le) {
        page.drawText(propre(`Signé le ${new Date(s.signe_le).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`), { x: x + 8, y: haut - 112, size: 8, font: f, color: C.gris });
        const m = s.image?.match(/^data:image\/png;base64,(.+)$/);
        if (m) {
          const img = await pdf.embedPng(Buffer.from(m[1], "base64"));
          const r = Math.min((largeurCase - 16) / img.width, 68 / img.height);
          page.drawImage(img, { x: x + 8, y: haut - 104, width: img.width * r, height: img.height * r });
        }
      } else page.drawText("En attente de signature", { x: x + 8, y: haut - 70, size: 9, font: f, color: C.gris });
    }
    y = haut - 136;
  }

  // proof page
  if (preuve && signatures.some((s) => s.signe_le)) {
    nouvellePage();
    ecrire("Dossier de preuve de la signature électronique", { font: fb, size: 15, apres: 8 });
    ecrire(`Document : ${c.titre} — ${c.sous_titre}`, { apres: 2 });
    ecrire(`Référence : ${preuve.id}`, { apres: 2 });
    ecrire(`Empreinte SHA-256 du texte signé : ${preuve.empreinte}`, { size: 9, apres: 10 });
    for (const s of signatures) ecrire(`${s.role === "bailleur" ? "Bailleur" : "Locataire"} : ${s.nom} — ${s.signe_le ? `signé le ${new Date(s.signe_le).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (heure de Paris), depuis l'adresse IP ${s.ip ?? "inconnue"}` : "pas encore signé"}.`, { apres: 4 });
    y -= 6;
    ecrire("Chaque signataire a lu le document dans Lucien, coché « J'ai lu et j'accepte ce document », puis tracé sa signature. Le locataire a signé depuis un lien personnel envoyé à son adresse email. Lucien a enregistré la date, l'heure et l'adresse IP de chaque signature, et l'empreinte du texte signé : toute modification du texte changerait cette empreinte.", { size: 9.5, color: C.gris, apres: 4 });
    ecrire("Signature électronique simple au sens de l'article 1367 du Code civil et du règlement (UE) n° 910/2014 (eIDAS).", { size: 9.5, color: C.gris });
  }

  // page numbers
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: W - M - 30, y: 28, size: 8, font: f, color: C.gris }));
  return pdf.save();
}
