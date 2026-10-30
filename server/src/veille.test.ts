import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import * as V from "./veille.js";
import { appliquerAbonnement } from "./abonnement.js";

const json = { "content-type": "application/json" };

test("veille : fermée par défaut tant que l'avocat n'a pas validé", async () => {
  delete process.env.LUCIEN_VEILLE; process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  db.createHousehold("Test");
  const r = await api.request("/veilles", { method: "POST", headers: json, body: JSON.stringify({ member_id: "x", mesure: "aucune" }) });
  assert.equal(r.status, 403);
  assert.equal((await (await api.request("/veilles")).json()).ouverte, false);
});

test("veille : consentement, alertes anti-arnaque, journal infalsifiable, retrait", async () => {
  process.env.LUCIEN_VEILLE = "1"; process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = db.createHousehold("Test");
  const mamie = db.addMember(h.id, "Josette", "parent_a_charge");
  const enfant = db.addMember(h.id, "Léo", "enfant");
  const creer = (b: object) => api.request("/veilles", { method: "POST", headers: json, body: JSON.stringify(b) });

  // only a dependent person; without a measure she must be able to consent herself
  assert.equal((await creer({ member_id: enfant.id, mesure: "aucune", personne_peut_consentir: true })).status, 400);
  const sansAccord = await creer({ member_id: mamie.id, mesure: "aucune", personne_peut_consentir: false });
  assert.equal(sansAccord.status, 400); assert.match((await sansAccord.json()).message, /juge/);
  // a tutelle needs the judgment
  assert.equal((await (await creer({ member_id: mamie.id, mesure: "tutelle", aidant_qualite: "tuteur" })).json()).error, "acte_manquant");

  const r = await creer({ member_id: mamie.id, mesure: "aucune", personne_peut_consentir: true, temoins: [{ nom: "Paul", email: "paul@x.fr" }] });
  assert.equal(r.status, 201);
  const v = await r.json();
  assert.equal(v.statut, "attente_consentement");
  const jeton = v.lien_personne.split("/consentement/")[1];
  // a second watch on the same person is refused
  assert.equal((await creer({ member_id: mamie.id, mesure: "aucune", personne_peut_consentir: true })).status, 400);

  // no bank before consent
  assert.equal((await api.request(`/veille/p/${jeton}/banque`, { method: "POST", headers: json, body: "{}" })).status, 400);
  // the person consents herself
  const c = await api.request(`/veille/p/${jeton}/consentir`, { method: "POST", headers: json, body: JSON.stringify({ nom_signataire: "Josette Martin", en_qualite_de: "personne", accepte: true }) });
  assert.equal((await c.json()).statut, "active");
  // simulated bank: scam patterns are flagged
  const b = await (await api.request(`/veille/p/${jeton}/banque`, { method: "POST", headers: json, body: "{}" })).json();
  assert.equal(b.banque_connectee, true);
  const d = await (await api.request(`/veilles/${v.id}`)).json();
  assert.ok(d.alertes.some((a: { titre: string }) => /Transcash|coupon|recharge/i.test(a.titre + " " + JSON.stringify(a))));
  assert.ok(d.alertes.some((a: { gravite: string }) => a.gravite === "urgente"));
  assert.equal(d.journal.intact, true);
  // one alert per operation: the 2 400 € transfer is flagged once, as a new beneficiary
  assert.equal(d.alertes.filter((a: { titre: string }) => /2\u202f?\s?400/.test(a.titre)).length, 1);
  assert.equal(d.alertes[0].gravite, "urgente");

  // tampering with the log is detected
  db.raw.prepare("UPDATE veille_journal SET acteur = 'Quelqu''un' WHERE action = 'consentement'").run();
  assert.equal(V.verifierJournal(db, v.id).intact, false);
  db.raw.prepare("UPDATE veille_journal SET acteur = 'Josette Martin' WHERE action = 'consentement'").run();
  assert.equal(V.verifierJournal(db, v.id).intact, true);

  // CSV export for a notary
  const csv = await (await api.request(`/veilles/${v.id}/journal?format=csv`)).text();
  assert.match(csv, /consentement/);

  // the person withdraws alone, from her page
  const w = await (await api.request(`/veille/p/${jeton}/retirer`, { method: "POST", headers: json, body: JSON.stringify({ nom: "Josette" }) })).json();
  assert.equal(w.statut, "terminee");
  assert.equal((await (await api.request(`/veilles/${v.id}`)).json()).alertes.length, 0);
});

test("veille : une incluse dans Tribu, les suivantes payantes, rien en gratuit", async () => {
  process.env.LUCIEN_VEILLE = "1";
  const db = new Db(":memory:");
  V.ensureVeilleSchema(db);
  const h = db.createHousehold("Test");
  const a = db.addMember(h.id, "Josette", "parent_a_charge");
  const b = db.addMember(h.id, "Henri", "parent_a_charge");
  const creer = (id: string) => V.creerVeille(db, db.getHousehold(h.id)!, { member_id: id, aidant_user_id: null, aidant_nom: "Ben", mesure: "aucune", personne_peut_consentir: true });
  appliquerAbonnement(db, db.getHousehold(h.id)!, { statut: "simule", formule: "tribu", periode: "mensuel" });
  creer(a.id);
  assert.throws(() => creer(b.id), (e: V.RefusVeille) => e.code === "veille_payante");
  V.setVeillesSupp(db, h.id, 1);
  creer(b.id);
  appliquerAbonnement(db, db.getHousehold(h.id)!, { statut: "simule", formule: "solo", periode: "mensuel" });
  assert.equal(V.capaciteVeilles(db, db.getHousehold(h.id)!), 1); // Solo: only the paid extra
});

test("veille : un consentement expiré suspend la veille", () => {
  process.env.LUCIEN_VEILLE = "1";
  const db = new Db(":memory:");
  V.ensureVeilleSchema(db);
  const h = db.createHousehold("Test");
  const m = db.addMember(h.id, "Josette", "parent_a_charge");
  const v = V.creerVeille(db, h, { member_id: m.id, aidant_user_id: null, aidant_nom: "Ben", mesure: "aucune", personne_peut_consentir: true });
  V.consentir(db, v, { nom_signataire: "Josette", en_qualite_de: "personne", accepte: true });
  db.raw.prepare("UPDATE veilles SET consentement_expire = ? WHERE id = ?").run(new Date(0).toISOString(), v.id);
  assert.equal(V.entretienVeilles(db).suspendues, 1);
  assert.equal(V.veilleParId(db, v.id)!.statut, "suspendue");
});
