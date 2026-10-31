import { test } from "node:test";
import assert from "node:assert/strict";
import { demoStatement } from "./seed-statement.js";
import { lireReleveDemo } from "./categorie.js";
import { DEMO_BUDGET, grandLivre, posteDe, rapportBudget } from "./budgetExpert.js";

const today = "2026-10-20";
const txs = lireReleveDemo(demoStatement(today));

test("budget expert : compte de résultat mensuel, épargne à part, moyenne sur mois complets", () => {
  const r = rapportBudget(txs, DEMO_BUDGET, today);
  assert.equal(r.mois.at(-1)!.mois, "2026-10");
  assert.equal(r.mois.at(-1)!.complet, false);
  const sept = r.mois.find((m) => m.mois === "2026-09")!;
  assert.equal(sept.produits.travail, 4950, "two salaries");
  assert.equal(sept.produits.aides, 141.5, "CAF is an aid, not work income");
  assert.equal(sept.epargne_versee, 300, "Livret A transfer is savings, not a charge");
  assert.equal(sept.charges.logement, 1180);
  assert.ok(r.moyenne.produits > 5000);
});

test("budget expert : prévisionnel proposé, bilan, ratios et alertes", () => {
  const r = rapportBudget(txs, DEMO_BUDGET, today);
  const alim = r.previsionnel.find((p) => p.poste === "alimentation")!;
  assert.equal(alim.prevu, 520); assert.equal(alim.propose, false);
  const energie = r.previsionnel.find((p) => p.poste === "energie")!;
  assert.equal(energie.propose, true); assert.equal(energie.prevu % 10, 0);
  assert.equal(r.bilan.valeur_nette, 437040 - 168400);
  assert.equal(r.bilan.liquidites, 13040);
  assert.ok(r.ratios.endettement! > 20 && r.ratios.endettement! < 35);
  assert.ok(r.ratios.epargne_precaution_mois! > 3);
});

test("budget expert : grand livre au format comptable", () => {
  const csv = grandLivre(txs.slice(0, 5), DEMO_BUDGET);
  const l = csv.trim().split("\r\n");
  assert.equal(l[0], "Date;Compte;Intitulé du compte;Libellé;Débit;Crédit");
  assert.equal(l.length, 6);
  assert.equal(posteDe({ date: "2026-10-01", libelle: "VIR LIVRET A EPARGNE", montant: -300, categorie: "epargne" }), "epargne");
  assert.ok(grandLivre([{ date: "2026-10-01", libelle: 'A;B "C"', montant: -1, categorie: "autre" }], {}).includes('"A;B ""C"""'));
});
