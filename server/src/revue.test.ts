// Regression tests for the review of 31/10/2026: file serving, clear-out safety, calendar feed, ISO weeks, download names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { createApi, dispositionFichier } from "./api.js";
import { conservation } from "./conservation.js";
import { agendaIcs } from "./ics.js";
import { semaineIso } from "./semaine.js";

const dir = "/tmp/lucien-test-uploads";
const doc = (db: Db, household_id: string, o: { title: string; fichier: string; mime: string }) => db.insertDocument({ household_id, member_id: null, title: o.title, category: "autre", organisme: null, numero_contrat: null, montant: null, periodicite: null, date_document: null, date_debut: null, date_fin: null, preavis_jours: null, resume: null, texte: null, fichier: o.fichier, mime: o.mime, confiance: 1 });

test("revue : un fichier HTML ou SVG déposé n'est jamais affiché sur l'origine de l'appli", async () => {
  process.env.LUCIEN_AUTH = "0";
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/piege.html`, "<script>alert(1)</script>");
  writeFileSync(`${dir}/avis.pdf`, "%PDF-1.4");
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const api = createApi(db, { uploadDir: dir });
  const piege = await api.request(`/documents/${doc(db, h.id, { title: "Piège", fichier: "piege.html", mime: "text/html" }).id}/fichier`);
  assert.equal(piege.headers.get("content-type"), "application/octet-stream");
  assert.match(piege.headers.get("content-disposition")!, /^attachment;/);
  assert.equal(piege.headers.get("x-content-type-options"), "nosniff");
  assert.match(piege.headers.get("content-security-policy")!, /sandbox/);
  const pdf = await api.request(`/documents/${doc(db, h.id, { title: "Avis", fichier: "avis.pdf", mime: "application/pdf" }).id}/fichier`);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition")!, /^inline;/);
});

test("revue : un crédit ou une assurance en cours ne part jamais au grand ménage", () => {
  const base = { organisme: null, cree_le: "2022-01-01T00:00:00Z", resume: null };
  const pret = conservation({ ...base, id: "p", title: "Tableau d'amortissement – échéancier de remboursement prêt immobilier", category: "banque", date_document: "2022-01-01", date_fin: "2042-01-01" }, "2026-11-10")!;
  assert.equal(pret.peut_jeter, false);
  const emprunteur = conservation({ ...base, id: "e", title: "Contrat assurance emprunteur – remboursement", category: "assurance", date_document: "2020-01-01", date_fin: null }, "2026-11-10")!;
  assert.equal(emprunteur.peut_jeter, false);
  const soins = conservation({ ...base, id: "s", title: "Décompte de remboursement de soins", category: "sante", date_document: "2020-01-01", date_fin: null }, "2026-11-10")!;
  assert.equal(soins.peut_jeter, true, "a real health statement can go after 2 years");
  const facture = conservation({ ...base, id: "f", title: "Électricité — facture", category: "energie", date_document: "2015-01-01", date_fin: "2030-01-01" }, "2026-11-10")!;
  assert.equal(facture.peut_jeter, false, "end date ahead: still running");
});

test("revue : agenda — heures mal formées refusées, retour chariot neutralisé", async () => {
  const ics = agendaIcs({ foyer: "F", echeances: [{ id: "1", titre: "Résilier\rATTACH:http://evil\x07", date: "2026-12-01", rappel_jours: 0 }], creneaux: [
    { jour: 2, heure_debut: "9h30", heure_fin: null, titre: "Mal saisi", membre: null, lieu: null, activite_id: "x", type: "sport" },
    { jour: 2, heure_debut: "09:30", heure_fin: "25:99", titre: "Fin bizarre", membre: null, lieu: null, activite_id: "y", type: "sport" },
  ] }, new Date("2026-11-02T10:00:00Z"));
  assert.doesNotMatch(ics, /Mal saisi/);
  assert.match(ics, /DTSTART;TZID=Europe\/Paris:20261103T093000\r\nDTEND;TZID=Europe\/Paris:20261103T103000/);
  assert.match(ics, /SUMMARY:Résilier\\nATTACH:http:\/\/evil\r\n/);
  assert.equal(ics.split("\r\n").filter((l) => l.startsWith("ATTACH")).length, 0);
  assert.doesNotMatch(ics, /\x07/);
  process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:"); seedDemo(db);
  const api = createApi(db, { uploadDir: dir });
  const r = await api.request("/activites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ titre: "Piscine", jour: 3, heure_debut: "9h30" }) });
  assert.ok(r.status === 400 || r.status === 422, `invalid time rejected at entry (got ${r.status})`);
  const ok = await api.request("/activites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ titre: "Piscine", jour: 3, heure_debut: "09:30" }) });
  assert.ok(ok.status < 300, `valid time accepted (got ${ok.status})`);
});

test("revue : semaines ISO justes, y compris les années qui commencent un vendredi", () => {
  assert.equal(semaineIso("2027-01-04"), "2027-W01");
  assert.equal(semaineIso("2027-01-03"), "2026-W53");
  assert.equal(semaineIso("2021-01-04"), "2021-W01");
  assert.equal(semaineIso("2026-11-09"), "2026-W46");
  assert.equal(semaineIso("2026-12-31"), "2026-W53");
  assert.equal(semaineIso("2025-12-29"), "2026-W01");
});

test("revue : nom de téléchargement conforme (repli ASCII, apostrophe encodée)", () => {
  const h = dispositionFichier("attachment", "Lucien - Refaire un passeport ou une carte d'identité.zip");
  assert.match(h, /^attachment; filename="Lucien - Refaire un passeport ou une carte d_identite\.zip"|^attachment; filename="Lucien - Refaire un passeport ou une carte d'identite\.zip"/);
  assert.match(h, /filename\*=UTF-8''Lucien%20-%20Refaire%20un%20passeport%20ou%20une%20carte%20d%27identit%C3%A9\.zip$/);
});
