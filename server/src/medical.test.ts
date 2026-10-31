import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { processInboundEmail } from "./inbox.js";

test("documents médicaux : refusés à l'envoi et par email, fichier effacé ; la mutuelle reste acceptée", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "0";
  try {
    const dir = mkdtempSync(join(tmpdir(), "lucien-med-"));
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: dir });
    const h = db.firstHousehold() ?? db.createHousehold("Famille");
    const form = new FormData();
    form.append("file", new File(["Ordonnance du Dr Martin : amoxicilline 1 g, 3 fois par jour"], "ordonnance.txt", { type: "text/plain" }));
    const r = await api.request("/documents", { method: "POST", body: form });
    assert.equal(r.status, 422); assert.equal((await r.json()).error, "document_medical");
    assert.equal(readdirSync(dir).filter((f) => f.endsWith("ordonnance.txt")).length, 0, "file removed");
    assert.equal(db.listDocuments(h.id).length, 0);
    const ok = await api.request("/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texte: "Attestation Harmonie Mutuelle, complémentaire santé, contrat MUT-77", nomFichier: "mutuelle.txt" }) });
    assert.equal(ok.status, 201, "mutual insurance certificate accepted");
    assert.equal(db.listDocuments(h.id)[0].category, "assurance");
    const exe = new FormData();
    exe.append("file", new File(["MZ"], "facture.exe", { type: "application/x-msdownload" }));
    assert.equal((await api.request("/documents", { method: "POST", body: exe })).status, 415, "programs refused");
    // forwarded by email
    db.raw.prepare("UPDATE households SET plan = 'famille' WHERE id = ?").run(h.id);
    const code = db.getHousehold(h.id)!.boite_code;
    const res = await processInboundEmail(db, { message_id: "m1", to: [`foyer-${code}@in.monlucien.fr`], from: "labo@x.fr", subject: "Vos résultats", text: "Résultats d'analyse de sang, ordonnance du médecin traitant, à conserver.", attachments: [] }, { plan: () => "famille" });
    assert.equal(res.statut, "ok"); assert.equal(res.statut === "ok" && res.documents.length, 0, "nothing kept");
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});
