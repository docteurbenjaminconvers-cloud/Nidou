import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { conservation, grandMenage, type DocConservation } from "./conservation.js";

const today = "2026-11-10";
const d = (o: Partial<DocConservation> & { title: string; category: string }): DocConservation =>
  ({ id: o.title, organisme: null, date_document: null, date_fin: null, cree_le: "2026-01-01T00:00:00Z", resume: null, ...o });

test("conservation : durées par type de papier", () => {
  assert.equal(conservation(d({ title: "Avis d'impôt sur le revenu 2022", category: "impots", date_document: "2022-08-01" }), today)!.jusqua, "2025-12-31");
  assert.equal(conservation(d({ title: "Taxe foncière 2026", category: "impots", date_document: "2026-09-01" }), today)!.jusqua, "2027-12-31");
  assert.equal(conservation(d({ title: "Électricité — facture", category: "energie", date_document: "2020-03-01" }), today)!.peut_jeter, true);
  assert.equal(conservation(d({ title: "Fibre — facture de mars", category: "telecom", date_document: "2025-03-01" }), today)!.peut_jeter, true);
  assert.equal(conservation(d({ title: "Bulletin de salaire — janvier 2001", category: "autre", date_document: "2001-01-31" }), today)!.garder, "Jusqu'à la retraite");
  assert.equal(conservation(d({ title: "Livret de famille", category: "identite" }), today)!.garder, "À vie");
  assert.equal(conservation(d({ title: "Ma recette de crêpes", category: "autre" }), today), null, "no rule, no advice");
});

test("conservation : un contrat en cours n'est jamais proposé au ménage", () => {
  const vieux = "2015-01-01";
  for (const doc of [
    d({ title: "Mutuelle santé famille", category: "assurance", date_document: vieux, resume: "Remboursements des soins, tiers payant" }),
    d({ title: "Contrat électricité", category: "energie", date_document: vieux }),
    d({ title: "Fibre + mobile", category: "telecom", date_document: vieux }),
    d({ title: "Assurance habitation", category: "assurance", date_document: vieux }),
    d({ title: "Lave-linge — facture", category: "garantie", date_document: vieux }),
    d({ title: "Passeport — Léa", category: "identite", date_document: vieux, date_fin: "2020-01-01" }),
  ]) assert.equal(conservation(doc, today)!.peut_jeter, false, doc.title);
});

test("grand ménage : la vieille facture de la famille de démo, puis un vieux relevé", () => {
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const docs = db.listDocuments(h.id);
  assert.deepEqual(grandMenage(docs).map((x) => x.doc.title), ["Facture Orange — mars 2024"]);
  const plus = [...docs, { ...docs[0], id: "x", title: "Relevé de compte — mars 2019", category: "banque" as const, organisme: "Crédit Agricole", resume: null, date_document: "2019-03-31" }];
  assert.deepEqual(grandMenage(plus).map((x) => x.doc.title), ["Relevé de compte — mars 2019", "Facture Orange — mars 2024"]);
});
