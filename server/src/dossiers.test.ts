import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { bordereau, etatDossiers, etatKit, KITS, type DocDossier } from "./dossiers.js";
import { zip } from "./zip.js";
import { createApi } from "./api.js";

const today = "2026-11-10";
const doc = (o: Partial<DocDossier> & { title: string; category: string }): DocDossier =>
  ({ id: o.title, organisme: null, date_document: null, date_fin: null, cree_le: "2026-01-01T00:00:00Z", member_id: null, fichier: null, resume: null, ...o });
const kit = (cle: string) => KITS.find((k) => k.cle === cle)!;

test("dossiers : pièce prête, trop ancienne, expirée, manquante", () => {
  const docs = [
    doc({ title: "Passeport — Moi", category: "identite", date_fin: "2026-05-01" }),             // expiré
    doc({ title: "Électricité — facture", category: "energie", date_document: "2026-10-20" }), // récente
    doc({ title: "Électricité — nouvel échéancier", category: "energie", date_document: "2026-11-01" }), // pas un justificatif
    doc({ title: "Bulletin de salaire — octobre", category: "autre", date_document: "2026-10-31" }),
    doc({ title: "Bulletin de salaire — septembre", category: "autre", date_document: "2026-09-30" }),
    doc({ title: "Avis d'impôt sur le revenu 2024", category: "impots", date_document: "2024-08-01" }), // trop ancien
    doc({ title: "Lave-linge — facture", category: "garantie", resume: "Garantie constructeur 2 ans" }), // « garantie » n'est pas un garant
  ];
  const e = etatKit(kit("location"), docs, today);
  const s = Object.fromEntries(e.pieces.map((p) => [p.cle, p.statut]));
  assert.equal(s.identite, "expire");
  assert.equal(s.domicile, "ok");
  assert.deepEqual(e.pieces.find((p) => p.cle === "domicile")!.documents.map((d) => d.id), ["Électricité — facture"]);
  assert.equal(s.bulletins, "ancien", "2 payslips out of 3");
  assert.match(e.pieces.find((p) => p.cle === "bulletins")!.note!, /2 sur 3/);
  assert.equal(s.avis_impot, "ancien");
  assert.equal(s.contrat_travail, "manquant");
  assert.equal(s.garant, "manquant");
  assert.equal(e.requis, 5, "the guarantor is optional");
  assert.equal(e.prets, 1);
  assert.equal(e.complet, false);
});

test("dossiers : la famille de démo, et le bordereau", () => {
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const kits = etatDossiers(db.listDocuments(h.id));
  assert.equal(kits.length, KITS.length);
  const loc = kits.find((k) => k.cle === "location")!;
  assert.equal(loc.pieces.find((p) => p.cle === "bulletins")!.statut, "ok");
  assert.equal(loc.pieces.find((p) => p.cle === "avis_impot")!.statut, "ok");
  const caf = kits.find((k) => k.cle === "caf")!;
  assert.equal(caf.pieces.find((p) => p.cle === "rib")!.statut, "ok");
  assert.equal(caf.pieces.find((p) => p.cle === "livret_famille")!.statut, "ok");
  const b = bordereau(loc, "Famille Martin (démo)", today);
  assert.match(b, /^LOUER UN LOGEMENT — Famille Martin\n/);
  assert.match(b, /\[x\] 3 derniers bulletins de salaire/);
  assert.match(b, /\[ \] Contrat de travail/);
  assert.match(b, /À fournir : /);
  assert.match(b, /service-public\.gouv\.fr/);
});

test("zip : archive lisible (noms UTF-8, contenu restitué)", () => {
  const z = zip([{ nom: "00 - Bordereau.txt", contenu: Buffer.from("Pièces prêtes ✓") }, { nom: "01 - Avis d'impôt.pdf", contenu: Buffer.from("%PDF-1.4 test") }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 2);
  const nomLen = z.readUInt16LE(26), taille = z.readUInt32LE(18);
  assert.equal(z.subarray(30, 30 + nomLen).toString("utf8"), "00 - Bordereau.txt");
  assert.equal(inflateRawSync(z.subarray(30 + nomLen, 30 + nomLen + taille)).toString("utf8"), "Pièces prêtes ✓");
});

test("API : dossiers, .zip avec les originaux, fichier d'un papier réservé au foyer", async () => {
  process.env.LUCIEN_AUTH = "0";
  const dir = "/tmp/lucien-test-uploads";
  mkdirSync(dir, { recursive: true });
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const avis = db.listDocuments(h.id).find((d) => d.title.startsWith("Avis d'impôt"))!;
  writeFileSync(`${dir}/avis-test.pdf`, "%PDF-1.4 avis");
  db.raw.prepare("UPDATE documents SET fichier = ?, mime = ? WHERE id = ?").run("avis-test.pdf", "application/pdf", avis.id);
  const api = createApi(db, { uploadDir: dir });
  const liste = await (await api.request("/dossiers")).json();
  assert.equal(liste.length, KITS.length);
  const r = await api.request("/dossiers/location/zip");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/zip");
  const z = Buffer.from(await r.arrayBuffer());
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 2, "cover sheet + the tax notice");
  assert.ok(z.includes(Buffer.from("Dernier avis d'imp")), "file named after its piece");
  assert.equal((await api.request("/dossiers/inconnu/zip")).status, 404);
  const f = await api.request(`/documents/${avis.id}/fichier`);
  assert.equal(f.status, 200);
  assert.equal(await f.text(), "%PDF-1.4 avis");
  const autre = db.createHousehold("Autre", 0);
  const d2 = db.insertDocument({ household_id: autre.id, member_id: null, title: "Secret", category: "autre", organisme: null, numero_contrat: null, montant: null, periodicite: null, date_document: null, date_debut: null, date_fin: null, preavis_jours: null, resume: null, texte: null, fichier: "avis-test.pdf", mime: "application/pdf", confiance: 1 });
  assert.equal((await api.request(`/documents/${d2.id}/fichier`)).status, 404, "another household's file is never served");
});
