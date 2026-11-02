import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { analyserPro } from "./analysePro.js";

const tx = (id: string, date: string, libelle: string, marchand: string, montant: number, categorie = "autre") =>
  ({ id, household_id: "h", compte: "Pro", date, libelle, marchand, montant, categorie, empreinte: id, importe_le: date });

test("compte pro : inventaire des prélèvements, nouveaux, hausses, faux annuaires, doublons, micro-débits, frais", () => {
  const today = "2026-11-02";
  const txs = [
    // a long-standing software subscription
    ...["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"].map((d, i) => tx(`s${i}`, d, "PRLV ADOBE SYSTEMS", "adobe", -71.99, "abonnements")),
    // a new recurring charge that started 6 weeks ago, worded like a directory scam
    tx("a1", "2026-09-20", "PRLV ANNUAIRE PRO FRANCE REFERENCEMENT", "annuaire pro france", -89, "autre"),
    tx("a2", "2026-10-20", "PRLV ANNUAIRE PRO FRANCE REFERENCEMENT", "annuaire pro france", -89, "autre"),
    // a one-off fake register
    tx("k1", "2026-08-11", "PRLV REGISTRE DES ENTREPRISES SERVICE", "registre service", -249, "autre"),
    // charged twice
    tx("d1", "2026-10-14", "CB OVH SAS", "ovh", -54.6), tx("d2", "2026-10-15", "CB OVH SAS", "ovh", -54.6),
    // tiny unknown debit
    tx("m1", "2026-10-28", "CB XQZ*PAYMT 4421", "xqz paymt", -1.49),
    // bank fees
    tx("f1", "2026-08-31", "COMMISSION INTERVENTION", "commission intervention", -8, "frais_bancaires"),
    tx("f2", "2026-09-30", "FRAIS TENUE DE COMPTE", "frais tenue de compte", -25, "frais_bancaires"),
    // income and transfers are left aside
    tx("r1", "2026-10-05", "VIR CLIENT", "client", 2400, "revenus"), tx("v1", "2026-10-06", "VIR VERS PERSO", "perso", -1500, "virements"),
  ];
  const r = analyserPro(txs, {}, today);
  const adobe = r.prelevements.find((p) => p.marchand === "Adobe")!;
  assert.equal(adobe.annuel, 863.88);
  assert.deepEqual(adobe.signaux, []);
  const annuaire = r.prelevements.find((p) => p.marchand === "Annuaire Pro France")!;
  assert.ok(annuaire.signaux.includes("nouveau") && annuaire.signaux.includes("suspect"));
  assert.equal(r.prelevements[0].marchand, "Annuaire Pro France", "flagged first");
  assert.ok(r.alertes.some((a) => a.type === "suspect" && a.marchand === "Registre Service"));
  assert.ok(r.alertes.some((a) => a.type === "doublon" && a.marchand === "Ovh"));
  assert.ok(r.alertes.some((a) => a.type === "micro" && a.montant === 1.49));
  assert.ok(r.alertes.some((a) => a.type === "frais"));
  assert.equal(r.alertes.filter((a) => a.type === "doublon").length, 1, "one alert per pair");
  assert.equal(r.a_verifier, 4); // annuaire + registre + doublon + micro
  const apres = analyserPro(txs, { [annuaire.cle]: "resilier" }, today);
  assert.equal(apres.a_verifier, 3);
});

test("compte pro : seuls les comptes classés Professionnel sont analysés", async () => {
  process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = db.createHousehold("Test");
  db.upsertBankAccount({ id: "a", household_id: h.id, item_id: null, nom: "Perso ••1", banque: "B", type: null, solde: 1, devise: "EUR", maj_le: null });
  db.upsertBankAccount({ id: "b", household_id: h.id, item_id: null, nom: "SASU ••2", banque: "B", type: null, solde: 1, devise: "EUR", maj_le: null });
  db.setDestinationCompte(h.id, "b", "pro");
  db.insertTransactions([
    { household_id: h.id, compte: "Perso ••1", date: "2026-10-01", libelle: "PRLV ANNUAIRE X", marchand: "annuaire x", montant: -50, categorie: "autre", empreinte: "p1" },
    { household_id: h.id, compte: "SASU ••2", date: "2026-10-02", libelle: "PRLV KBIS EXPRESS", marchand: "kbis express", montant: -79, categorie: "autre", empreinte: "p2" },
  ]);
  const r = await (await api.request("/pro/verification")).json();
  assert.deepEqual(r.comptes, ["SASU ••2"]);
  assert.equal(r.alertes.filter((a: { type: string }) => a.type === "suspect").length, 1);
  assert.equal(r.alertes[0].marchand, "Kbis Express");
  const cle = r.alertes[0].cle;
  const r2 = await (await api.request("/pro/verification/decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cle, decision: "ok" }) })).json();
  assert.equal(r2.alertes[0].decision, "ok");
});
