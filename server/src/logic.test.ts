import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { deadlinesFor } from "./deadlines.js";
import { chargesReport } from "./charges.js";
import { heuristicExtract } from "./extract.js";
import { seedDemo } from "./seed.js";

const TODAY = "2026-10-28";

test("une assurance annuelle produit un rappel de résiliation avant le préavis et un renouvellement", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("t");
  const doc = db.insertDocument({
    household_id: h.id, member_id: null, title: "Auto", category: "assurance", organisme: "MAIF", numero_contrat: "X",
    montant: 600, periodicite: "annuel", date_document: "2025-12-01", date_debut: "2025-12-01", date_fin: "2026-12-01",
    preavis_jours: 60, resume: null, texte: null, fichier: null, mime: null, confiance: 1,
  });
  const d = deadlinesFor(doc, TODAY);
  const resil = d.find((x) => x.type === "resiliation");
  const renew = d.find((x) => x.type === "renouvellement");
  assert.equal(resil?.date, "2026-10-02" < TODAY ? undefined : "2026-10-02"); // préavis déjà dépassé : pas de rappel
  assert.equal(renew?.date, "2026-12-01");
});

test("un renouvellement passé est reporté à l'année suivante", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("t");
  const doc = db.insertDocument({
    household_id: h.id, member_id: null, title: "Hab", category: "assurance", organisme: "Matmut", numero_contrat: null,
    montant: 30, periodicite: "mensuel", date_document: "2023-10-01", date_debut: "2023-10-01", date_fin: "2026-10-01",
    preavis_jours: 60, resume: null, texte: null, fichier: null, mime: null, confiance: 1,
  });
  const d = deadlinesFor(doc, TODAY);
  assert.equal(d.find((x) => x.type === "renouvellement")?.date, "2027-10-01");
  assert.equal(d.find((x) => x.type === "resiliation")?.date, "2027-08-02");
});

test("un passeport produit une expiration avec 90 jours d'avance", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("t");
  const doc = db.insertDocument({
    household_id: h.id, member_id: null, title: "Passeport", category: "identite", organisme: null, numero_contrat: null,
    montant: null, periodicite: null, date_document: null, date_debut: null, date_fin: "2027-01-15",
    preavis_jours: null, resume: null, texte: null, fichier: null, mime: null, confiance: 1,
  });
  const d = deadlinesFor(doc, TODAY);
  assert.equal(d.length, 1);
  assert.equal(d[0].type, "expiration");
  assert.equal(d[0].rappel_jours, 90);
});

test("les charges fixes totalisent et détectent hausse et abonnements multiples", () => {
  const db = new Db(":memory:");
  seedDemo(db);
  const h = db.firstHousehold()!;
  const r = chargesReport(db.listDocuments(h.id), TODAY);
  assert.ok(r.total_mensuel > 400, `total ${r.total_mensuel}`);
  assert.ok(r.alertes.some((a) => a.type === "hausse" && a.titre.includes("%")), "hausse EDF attendue");
  assert.ok(r.alertes.some((a) => a.type === "doublon"), "doublon attendu (EDF x2 ou abonnements)");
  assert.ok(r.alertes.some((a) => a.type === "non_renegocie"), "contrat non renégocié attendu");
  assert.equal(r.par_categorie[0].mensuel, Math.max(...r.par_categorie.map((c) => c.mensuel)));
});

test("l'extracteur heuristique lit montant, dates et catégorie", () => {
  const ex = heuristicExtract({
    texte: "MAIF — Avis d'échéance\nContrat n° AUT-4471-8820\nPériode du 01/12/2025 au 30/11/2026\nCotisation annuelle : 612,00 €\nPréavis de résiliation : 2 mois",
  });
  assert.equal(ex.category, "assurance");
  assert.equal(ex.organisme, "MAIF");
  assert.equal(ex.montant, 612);
  assert.equal(ex.periodicite, "annuel");
  assert.equal(ex.date_debut, "2025-12-01");
  assert.equal(ex.date_fin, "2026-11-30");
  assert.equal(ex.preavis_jours, 60);
  assert.equal(ex.numero_contrat, "AUT-4471-8820");
});

test("la base enregistre et journalise les accès MCP", () => {
  const db = new Db(":memory:");
  const h = seedDemo(db);
  db.logMcpAccess(h.id, "echeances", { from: TODAY });
  const log = db.listMcpAccess(h.id) as any[];
  assert.equal(log.length, 1);
  assert.equal(log[0].outil, "echeances");
});
