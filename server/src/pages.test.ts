import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { initCoffre, lireFichier } from "./coffre.js";

// a 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("un papier en plusieurs photos (carte d'identité recto verso) : un seul papier, un PDF de deux pages", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "0";
  try {
    const dir = mkdtempSync(join(tmpdir(), "lucien-pages-"));
    initCoffre(dir);
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: join(dir, "uploads") });
    const h = db.firstHousehold() ?? db.createHousehold("Famille");
    const avantN = db.listDocuments(h.id).length;
    const form = new FormData();
    form.append("page", new File([PNG], "recto.png", { type: "image/png" }));
    form.append("page", new File([PNG], "verso.png", { type: "image/png" }));
    form.append("nom", "Carte d'identité");
    const r = await api.request("/documents", { method: "POST", body: form });
    assert.equal(r.status, 201, await r.clone().text());
    const docs = db.listDocuments(h.id);
    assert.equal(docs.length, avantN + 1, "one paper");
    const d = docs.find((x) => x.mime === "application/pdf")!;
    assert.match(d.fichier!, /\.pdf$/);
    const pdf = await PDFDocument.load(await lireFichier(join(dir, "uploads", d.fichier!)));
    assert.equal(pdf.getPageCount(), 2);
    const gif = new FormData();
    gif.append("page", new File([PNG], "a.gif", { type: "image/gif" })); gif.append("page", new File([PNG], "b.png", { type: "image/png" }));
    assert.equal((await api.request("/documents", { method: "POST", body: gif })).status, 415);
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});
