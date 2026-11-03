import { test } from "node:test";
import assert from "node:assert/strict";
import { libelleLisible, merchantOf } from "./libelles.js";
import { rubriqueDe, cleLibelle } from "./viePro.js";
import { Db } from "./db.js";
import { migrerMarchands } from "./marchands.js";
import { ensureResiliationsSchema } from "./resiliations.js";

// labels in the BNP format (made up here: no real account data)
const SAUR = (ech: string, ref: string) => `PRLV SEPA SAUR ECH/${ech} ID EMETTEUR/FR86ZZZ000000 MDT/S-6-0000000000-000000000-02 REF/SAPR${ref} LIB/FACTURE SAUR`;
const ORANGE = "PRLV SEPA ORANGE -ORANGE ECH/311025 ID EMETTEUR/FR12ZZZ123456 MDT/ABC123 REF/XYZ LIB/FACTURE 10/2025";
const CARTE = (d: string, m: string) => `FACTURE CARTE DU ${d} LEGALSTART.FR/B CARTE 4974XXXXXXXX0000 FRA ${m}EUR`;
const TVA = "PRLV SEPA B2B DGFIP IMPOT ECH/260826 ID EMETTEUR/FR46ZZZ000000 MDT/++123DGFIP REF/220340 LIB/TVA1-082026-3310CA3";
const LEASING = "PRLV SEPA CM-CIC LEASING SOLUTIONS ECH/010926 ID EMETTEUR/FR91ZZZ000000 MDT/KA00-E00-001 REF/020EN0 LIB/KA00 020EN0";
const VIR_PRIVE = "VIR SEPA INST EMIS /MOTIF PRIVE /BEN MR JEAN MARTIN /REFDO 33626CC0FE844F8D992B84B51A0BED92 /REF NOTPROVIDED";
const VIR_SAS = "VIR SEPA INST EMIS /MOTIF APPORT SAS /BEN SAS CENTRE EXEMPLE /REFDO 868C969EA0FC4F0EBEB9944A4B40E5BA /REF NOTPROVIDED";

test("libellés BNP : le nom du créancier, sans les références techniques", () => {
  assert.equal(merchantOf(ORANGE), "orange");
  assert.equal(merchantOf(SAUR("011026", "1")), merchantOf(SAUR("010926", "2")), "same creditor every month");
  assert.equal(merchantOf(CARTE("011026", "16,80")), "legalstart");
  assert.equal(merchantOf("CB CARREFOUR MARKET 11/10 MONTPELLIER"), "carrefour market");
  assert.equal(libelleLisible(ORANGE), "Prélèvement Orange");
  assert.equal(libelleLisible(SAUR("011026", "1")), "Prélèvement Saur");
  assert.equal(libelleLisible(TVA), "Prélèvement DGFIP Impot · TVA");
  assert.equal(libelleLisible(CARTE("011026", "16,80")), "Carte Legalstart.fr");
  assert.equal(libelleLisible(VIR_SAS), "Virement à SAS Centre Exemple · Apport SAS");
  assert.equal(libelleLisible("ECHEANCE PRET 00640 61066114"), "Échéance de prêt");
});

test("Vie pro : un virement ou un remboursement de prêt n'est jamais un achat à amortir", () => {
  const t = (libelle: string, montant: number) => ({ date: "2026-10-01", libelle, montant, categorie: "autre" });
  assert.equal(rubriqueDe(t(VIR_SAS, -5000)), "a_classer");
  assert.equal(rubriqueDe(t(VIR_PRIVE, -2000)), "prelevements");
  assert.equal(rubriqueDe(t("ECHEANCE PRET 00640 61066114", -1200)), "a_classer");
  assert.equal(rubriqueDe(t(TVA, -900)), "tva");
  assert.equal(rubriqueDe(t(LEASING, -60)), "location_materiel");
  assert.equal(rubriqueDe(t(SAUR("011026", "1"), -6)), "energie");
  assert.equal(rubriqueDe(t(CARTE("011026", "16,80"), -16.8)), "actes");
  assert.equal(rubriqueDe(t("FACTURE CARTE DU 020926 MATERIEL MEDICAL PRO CARTE 4974XXXXXXXX0000", -1800)), "immobilisation", "a large card purchase may be equipment");
  // a choice made once applies to every month, whatever the references and the amount
  assert.equal(cleLibelle(CARTE("011026", "16,80")), cleLibelle(CARTE("011126", "19,90")));
  assert.equal(rubriqueDe(t(CARTE("011126", "19,90"), -19.9), { [cleLibelle(CARTE("011026", "16,80"))]: "divers_gestion" }), "divers_gestion");
  assert.equal(rubriqueDe(t("PRLV URSSAF", -10), { "PRLV URSSAF": "a_classer" }), "a_classer", "choices saved with the old key still apply");
});

test("noms recalculés sur les opérations déjà importées, choix déjà faits reportés", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15);
  ensureResiliationsSchema(db);
  const ancien = "orange -orange ech/";
  db.insertTransactions(["2026-08-31", "2026-09-30"].map((date, i) => ({ household_id: h.id, compte: "Pro", date, libelle: ORANGE, marchand: ancien, montant: -56.99, categorie: "telecom", empreinte: `e${i}` })));
  db.setModuleData(h.id, "verif_pro", { decisions: { [`rec:${ancien}`]: "resilier" } });
  db.setDecision(h.id, `fantome:${ancien}`, "resilie");
  db.raw.prepare("INSERT INTO resiliations (household_id, cle, marchand, montant, frequence, demande_le, statut, maj_le) VALUES (?, ?, 'Orange -Orange Ech/', 56.99, 'mensuel', '2026-10-01', 'en_cours', '2026-10-01')").run(h.id, ancien);
  const avant = db.listTransactions(h.id).map((t) => [t.date, t.libelle, t.montant]);
  const r = migrerMarchands(db);
  assert.deepEqual(r, { operations: 2, foyers: 1 });
  const apres = db.listTransactions(h.id);
  assert.ok(apres.every((t) => t.marchand === "orange"));
  assert.deepEqual(apres.map((t) => [t.date, t.libelle, t.montant]), avant, "dates, labels and amounts untouched");
  assert.deepEqual(db.getModuleData<{ decisions: Record<string, string> }>(h.id, "verif_pro")?.decisions, { "rec:orange": "resilier" });
  assert.equal(db.listDecisions(h.id)["fantome:orange"], "resilie");
  assert.equal((db.raw.prepare("SELECT cle, marchand FROM resiliations").get() as { cle: string }).cle, "orange");
  assert.deepEqual(migrerMarchands(db), { operations: 0, foyers: 0 }, "once only");
});
