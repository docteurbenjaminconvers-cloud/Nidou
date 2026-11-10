import { useEffect, useRef, useState } from "react";

/**
 * A PDF shown page after page, drawn by the app itself (pdf.js, loaded only when a PDF is opened). An iPhone app
 * installed on the home screen shows a PDF in a frame as a blank page, or only its first page: drawn here, every page
 * of a recto verso or of a letter shows, everywhere.
 */
export function PagesPdf({ blob, titre }: { blob: Blob; titre: string }) {
  const boite = useRef<HTMLDivElement>(null);
  const [etat, setEtat] = useState<"lecture" | "ok" | "erreur">("lecture");
  useEffect(() => {
    let fini = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const el = boite.current;
        if (!el || fini) return;
        el.innerHTML = "";
        const largeur = Math.max(280, el.clientWidth || 360);
        for (let n = 1; n <= Math.min(pdf.numPages, 30); n++) {
          const page = await pdf.getPage(n);
          if (fini) return;
          const base = page.getViewport({ scale: 1 });
          const vue = page.getViewport({ scale: (largeur / base.width) * Math.min(2, devicePixelRatio || 1) });
          const c = document.createElement("canvas");
          c.width = Math.floor(vue.width); c.height = Math.floor(vue.height);
          c.setAttribute("aria-label", `${titre}, page ${n} sur ${pdf.numPages}`);
          c.className = "pdf-page";
          el.appendChild(c);
          await page.render({ canvasContext: c.getContext("2d")!, viewport: vue }).promise;
        }
        if (!fini) setEtat("ok");
      } catch { if (!fini) setEtat("erreur"); }
    })();
    return () => { fini = true; };
  }, [blob, titre]);
  return (
    <>
      {etat === "lecture" && <p className="note">Ouverture…</p>}
      {etat === "erreur" && <p className="note">Ce PDF ne s'affiche pas ici : touchez « Enregistrer » pour l'ouvrir avec une autre appli.</p>}
      <div ref={boite} className="pdf-pages" />
    </>
  );
}
