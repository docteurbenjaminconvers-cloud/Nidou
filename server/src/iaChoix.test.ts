import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { iaPourPapier, semblePieceIdentite } from "./iaChoix.js";

test("ce que l'IA peut lire : pièces d'identité écartées par défaut, foyer « sans IA »", () => {
  assert.equal(semblePieceIdentite({ nomFichier: "Passeport_Lea.pdf" }), true);
  assert.equal(semblePieceIdentite({ nomFichier: "scan.pdf", texte: "CARTE NATIONALE D'IDENTITÉ République française" }), true);
  assert.equal(semblePieceIdentite({ nomFichier: "permis-de-conduire.jpg" }), true);
  assert.equal(semblePieceIdentite({ categorie: "identite", nomFichier: "IMG_0042.jpg" }), true);
  assert.equal(semblePieceIdentite({ nomFichier: "facture-edf.pdf", texte: "Votre facture d'électricité" }), false);
  assert.deepEqual(iaPourPapier({}, { nomFichier: "facture.pdf" }), { ia: true, raison: null });
  assert.deepEqual(iaPourPapier({ ia_papiers: 1, ia_identite: 0 }, { nomFichier: "cni.jpg" }), { ia: false, raison: "identite" });
  assert.deepEqual(iaPourPapier({ ia_identite: 1 }, { nomFichier: "cni.jpg" }), { ia: true, raison: null });
  assert.deepEqual(iaPourPapier({ ia_papiers: 0, ia_identite: 1 }, { nomFichier: "facture.pdf" }), { ia: false, raison: "foyer" });
});

test("ajout d'une pièce d'identité : rangée sans IA, et le réglage du foyer s'enregistre", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "0";
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: mkdtempSync(join(tmpdir(), "lucien-ia-")) });
    const h = db.firstHousehold() ?? db.createHousehold("Famille");
    const post = (chemin: string, corps: object) => api.request(chemin, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) });
    const d = await (await post("/documents", { texte: "Photo de ma carte", nomFichier: "IMG_1.txt", categorie: "identite" })).json() as any;
    assert.equal(d.category, "identite"); assert.match(d.resume, /sans passer par l'IA/);
    const foyer = async () => (await (await api.request("/household")).json()) as any;
    assert.equal((await foyer()).ia_papiers, true); assert.equal((await foyer()).ia_identite, false);
    assert.deepEqual(await (await post("/household/ia", { papiers: false })).json(), { ia_papiers: false, ia_identite: false });
    const f = await (await post("/documents", { texte: "Facture EDF électricité 80 €", nomFichier: "edf.txt" })).json() as any;
    assert.match(f.resume, /sans IA, comme vous l'avez choisi/);
    assert.deepEqual(await (await post("/household/ia", { papiers: true, identite: true })).json(), { ia_papiers: true, ia_identite: true });
    assert.equal(db.getHousehold(h.id)!.ia_identite, 1);
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});
