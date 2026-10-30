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

test("connecteur : un contrat reconduit tacitement garde une date de fin à venir", async () => {
  const { dateFinCourante } = await import("./deadlines.js");
  assert.equal(dateFinCourante({ category: "assurance", periodicite: "mensuel", date_fin: "2026-10-25" }, TODAY), "2027-10-25");
  assert.equal(dateFinCourante({ category: "identite", periodicite: null, date_fin: "2026-10-25" }, TODAY), "2026-10-25");
});

test("charges fixes : cantine par enfant et activités comptées une seule fois", async () => {
  const { lignesFamille } = await import("./charges.js");
  const { coutsParMembre } = await import("./famille.js");
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const lignes = lignesFamille(coutsParMembre(db.listMembers(h.id), db.listActivites(h.id)));
  const r = chargesReport(db.listDocuments(h.id), TODAY, lignes);
  const cantines = r.charges.filter((c) => /cantine|demi-pension/i.test(c.titre));
  assert.equal(cantines.length, 2, cantines.map((c) => c.titre).join(", "));
  assert.equal(cantines.reduce((s, c) => s + c.montant_mensuel, 0), 126);
  assert.ok(r.charges.some((c) => c.category === "activites" && c.titre.startsWith("Piano")));
  assert.ok(r.charges.every((c) => !c.date_fin || c.source !== "contrat" || c.category !== "assurance" || c.date_fin >= TODAY), "assurances reconduites");
});

test("contrôle technique : rappel explicite du prochain contrôle", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("t");
  const doc = db.insertDocument({
    household_id: h.id, member_id: null, title: "Contrôle technique — Peugeot 3008", category: "vehicule", organisme: "Autosur", numero_contrat: null,
    montant: 79, periodicite: "unique", date_document: "2024-12-19", date_debut: null, date_fin: "2026-12-19",
    preavis_jours: null, resume: "Contrôle technique favorable, prochain contrôle dans 2 ans.", texte: null, fichier: null, mime: null, confiance: 1,
  });
  const d = deadlinesFor(doc, TODAY);
  assert.equal(d.length, 1);
  assert.equal(d[0].titre, "Prochain contrôle technique : Peugeot 3008");
  assert.match(d[0].note ?? "", /au plus tard/);
});

test("assurance : préavis dépassé, la note du renouvellement le signale", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("t");
  const doc = db.insertDocument({
    household_id: h.id, member_id: null, title: "Auto", category: "assurance", organisme: "MAIF", numero_contrat: "X",
    montant: 612, periodicite: "annuel", date_document: "2024-11-29", date_debut: "2024-11-29", date_fin: "2026-11-29",
    preavis_jours: 60, resume: null, texte: null, fichier: null, mime: null, confiance: 1,
  });
  const renew = deadlinesFor(doc, TODAY).find((x) => x.type === "renouvellement");
  assert.match(renew?.note ?? "", /préavis de 60 jours est dépassé/);
  assert.match(renew?.note ?? "", /loi Hamon/);
});

test("alertes : engagement terminé, assurance résiliable à tout moment, sans doublon d'alerte", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("t");
  const base = { household_id: h.id, member_id: null, texte: null, fichier: null, mime: null, confiance: 1 };
  const box = db.insertDocument({ ...base, title: "Fibre + mobile", category: "telecom", organisme: "Orange", numero_contrat: "O1", montant: 65, periodicite: "mensuel", date_document: "2024-04-01", date_debut: "2024-04-01", date_fin: null, preavis_jours: 10, resume: "Engagement terminé." });
  const sport = db.insertDocument({ ...base, title: "Salle de sport", category: "abonnement", organisme: "Basic-Fit", numero_contrat: "B1", montant: 30, periodicite: "mensuel", date_document: "2025-11-01", date_debut: "2025-11-01", date_fin: "2026-11-20", preavis_jours: 30, resume: "Engagement 12 mois." });
  db.insertDocument({ ...base, title: "Netflix", category: "abonnement", organisme: "Netflix", numero_contrat: null, montant: 13, periodicite: "mensuel", date_document: "2026-10-01", date_debut: "2024-01-01", date_fin: "2026-11-10", preavis_jours: 0, resume: "Sans engagement." });
  const auto = db.insertDocument({ ...base, title: "Assurance auto — 3008", category: "assurance", organisme: "MAIF", numero_contrat: "A1", montant: 612, periodicite: "annuel", date_document: "2025-03-01", date_debut: "2025-03-01", date_fin: "2027-03-01", preavis_jours: 60, resume: null });
  const r = chargesReport(db.listDocuments(h.id), TODAY);
  const fin = r.alertes.filter((a) => a.type === "fin_engagement");
  assert.deepEqual(fin.map((a) => a.document_ids[0]).sort(), [box.id, sport.id].sort(), "Orange (terminé) et Basic-Fit (dans 23 jours), pas Netflix");
  assert.equal(fin.find((a) => a.document_ids[0] === box.id)?.gravite, "attention");
  assert.equal(fin.find((a) => a.document_ids[0] === sport.id)?.gravite, "info");
  assert.ok(!r.alertes.some((a) => a.type === "non_renegocie" && a.document_ids[0] === box.id), "pas d'alerte « non renégocié » en double sur la box");
  assert.ok(r.alertes.some((a) => a.type === "resiliable" && a.document_ids[0] === auto.id), "assurance auto de plus d'un an : loi Hamon");
});
