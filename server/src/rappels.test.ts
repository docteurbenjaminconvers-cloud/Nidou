import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { rappelsEssai, passeQuotidienne } from "./rappels.js";

test("rappels d'essai : J-2, dernier jour, lendemain, chacun une seule fois", async () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15);
  const fin = new Date(h.essai_fin!).getTime();
  const at = (joursAvantFin: number) => new Date(fin - joursAvantFin * 864e5 + 3600_000); // one hour into the day
  assert.equal(rappelsEssai(db, h, at(10)).length, 0);
  assert.deepEqual(rappelsEssai(db, h, at(2)).map((r) => r.cle), ["essai:j2"]);
  assert.deepEqual(rappelsEssai(db, h, at(1)).map((r) => r.cle), ["essai:dernier"]);
  assert.deepEqual(rappelsEssai(db, h, at(-1)).map((r) => r.cle), ["essai:termine"]);
  assert.equal(rappelsEssai(db, h, at(-10)).length, 0, "no nagging weeks later");
  db.setPlan(h.id, "famille");
  assert.equal(rappelsEssai(db, db.getHousehold(h.id)!, at(1)).length, 0, "paying households get no trial reminder");
});

test("passe quotidienne idempotente", async () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 1);
  db.setTrialEnd(h.id, new Date(Date.now() + 12 * 3600_000).toISOString()); // ends later today → last day
  const sent: string[] = [];
  assert.equal(await passeQuotidienne(db, async (_h, r) => { sent.push(r.cle); }), 1);
  assert.equal(await passeQuotidienne(db, async (_h, r) => { sent.push(r.cle); }), 0);
  assert.deepEqual(sent, ["essai:dernier"]);
  assert.deepEqual(db.listRappels(h.id).map((r) => r.cle), ["essai:dernier"]);
});

test("rappels d'échéances : au début de la fenêtre et le jour même, une seule fois", async () => {
  const { rappelsEcheances } = await import("./rappels.js");
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 0);
  const today = new Date("2026-10-28T09:00:00Z");
  const iso = (n: number) => new Date(today.getTime() + n * 864e5).toISOString().slice(0, 10);
  db.insertDeadline({ household_id: h.id, document_id: null, titre: "Résiliation : Assurance auto", type: "resiliation", date: iso(7), rappel_jours: 7, note: null });
  db.insertDeadline({ household_id: h.id, document_id: null, titre: "Paiement : Taxe foncière", type: "echeance", date: iso(3), rappel_jours: 7, note: null });
  db.insertDeadline({ household_id: h.id, document_id: null, titre: "Contrôle technique", type: "expiration", date: iso(0), rappel_jours: 14, note: null });
  const r = rappelsEcheances(db, h, today);
  assert.deepEqual(r.map((x) => x.titre).sort(), ["Aujourd'hui : Contrôle technique", "Dans 7 jours : Assurance auto"]);
  assert.ok(r.every((x) => x.cle.startsWith("echeance:")));
});

test("alertes d'économie : poussées une par passe, jamais deux fois, jamais les « info »", async () => {
  const { rappelsAlertes } = await import("./rappels.js");
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15);
  const base = { household_id: h.id, member_id: null, texte: null, fichier: null, mime: null, confiance: 1 };
  const jour = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  db.insertDocument({ ...base, title: "Électricité", category: "energie", organisme: "EDF", numero_contrat: "E1", montant: 96, periodicite: "mensuel", date_document: jour(-300), date_debut: jour(-300), date_fin: null, preavis_jours: null, resume: null });
  db.insertDocument({ ...base, title: "Électricité — échéancier", category: "energie", organisme: "EDF", numero_contrat: "E1", montant: 117, periodicite: "mensuel", date_document: jour(-10), date_debut: jour(-10), date_fin: null, preavis_jours: null, resume: null });
  db.insertDocument({ ...base, title: "Box", category: "telecom", organisme: "Orange", numero_contrat: "O1", montant: 65, periodicite: "mensuel", date_document: jour(-200), date_debut: jour(-200), date_fin: null, preavis_jours: 10, resume: "Engagement terminé." });
  const sent: string[] = [];
  const envoyer = async (_h: unknown, r: { cle: string }) => { sent.push(r.cle); };
  await passeQuotidienne(db, envoyer);
  await passeQuotidienne(db, envoyer);
  await passeQuotidienne(db, envoyer);
  assert.deepEqual(sent.filter((c) => c.startsWith("alerte:")).map((c) => c.split(":")[1]), ["hausse", "fin_engagement"], "la hausse d'abord, puis l'engagement, puis plus rien");
  assert.equal(rappelsAlertes(db, db.getHousehold(h.id)!).length, 0);
});
