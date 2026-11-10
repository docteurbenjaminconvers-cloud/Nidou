/**
 * One paper in several photos (an identity card front and back, a three-page letter): the pages are put together
 * into one PDF, which is then read and kept like any PDF.
 */
import { PDFDocument } from "pdf-lib";
const A4 = { l: 595.28, h: 841.89 };
/** The pages, in order, as one PDF: each photo fills an A4 page (margins kept), PDFs keep their own pages. */
export async function assemblerPages(pages) {
    const pdf = await PDFDocument.create();
    for (const p of pages) {
        if (p.mime === "application/pdf") {
            const src = await PDFDocument.load(p.buf, { ignoreEncryption: true });
            for (const pg of await pdf.copyPages(src, src.getPageIndices()))
                pdf.addPage(pg);
            continue;
        }
        const img = p.mime === "image/png" ? await pdf.embedPng(p.buf) : await pdf.embedJpg(p.buf);
        const paysage = img.width > img.height;
        const page = pdf.addPage(paysage ? [A4.h, A4.l] : [A4.l, A4.h]);
        const marge = 24;
        const k = Math.min((page.getWidth() - 2 * marge) / img.width, (page.getHeight() - 2 * marge) / img.height);
        const w = img.width * k, h = img.height * k;
        page.drawImage(img, { x: (page.getWidth() - w) / 2, y: (page.getHeight() - h) / 2, width: w, height: h });
    }
    return Buffer.from(await pdf.save());
}
