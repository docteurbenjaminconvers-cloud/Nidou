import { test } from "node:test";
import assert from "node:assert/strict";
import { demoStatement } from "./seed-statement.js";
import { lireReleveDemo } from "./categorie.js";
import { demoComptePro, demoPro, limite2035, livreCsv, rapportPro, rubriqueDe, seuilMicroBnc } from "./viePro.js";

const today = "2026-10-20";
const txs = [...lireReleveDemo(demoStatement(today)), ...demoComptePro(today)];
const r = rapportPro(demoPro({ moi: "m1", camille: "m2" }, today), txs, [{ id: "d1", title: "Bulletin de salaire — mois dernier" }, { id: "d2", title: "Contrat de travail CDI — Atelier Verdier" }, { id: "d3", title: "Facture EDF" }], today);

test("vie pro salarié : cumul du net imposable, bulletin manquant, prime repérée, salaire vu en banque", () => {
  const moi = r.personnes[0].salarie!;
  assert.deepEqual(moi.manquants, ["2026-07"]);
  assert.ok(moi.anomalies.some((a) => a.mois === "2026-06"), "June bonus flagged");
  assert.equal(moi.cumul_net_imposable, Math.round((2960 * 7 + 900 * 1.03 + 2960) * 100) / 100);
  assert.ok(moi.verses.length >= 3, "salary transfers matched on the bank account");
  assert.equal(moi.anciennete_ans, 9);
  assert.deepEqual(r.papiers.map((p) => p.type), ["bulletin", "contrat"]);
});

test("vie pro indépendant : rubriques 2035, matériel à amortir, prélèvements non déductibles, micro ou réel", () => {
  const c = r.personnes[1].independant!;
  const rub = Object.fromEntries(c.par_rubrique.map((x) => [x.rubrique, x.montant]));
  assert.equal(rub.loyers, 880 * 10);
  assert.equal(rub.sociales_obligatoires, 415 * 10, "CARPIMKO: personal pension contributions");
  assert.equal(rub.urssaf, 640 * 10, "URSSAF mixes contributions and CSG-CRDS: kept apart, to split");
  assert.match(c.micro.conseil, /CSG déductible/);
  assert.equal(c.immobilisations.length, 1, "massage table over 500 € is amortised, not expensed");
  assert.equal(c.prelevements, 2800 * 9, "transfers to the joint account are not expenses");
  assert.equal(c.benefice, Math.round((c.recettes - c.depenses) * 100) / 100);
  assert.ok(c.recettes < seuilMicroBnc(2026));
  assert.match(c.micro.conseil, /réel|micro/);
  assert.equal(rubriqueDe({ date: "", libelle: "PRLV CARMF", montant: -10, categorie: "autre" }), "sociales_obligatoires");
  assert.equal(rubriqueDe({ date: "", libelle: "PRLV URSSAF", montant: -10, categorie: "autre" }, { "PRLV URSSAF": "a_classer" }), "a_classer", "manual choice wins");
  assert.ok(livreCsv(c).startsWith("Date;Libellé;Rubrique 2035;Recette;Dépense"));
});

test("vie pro : repères fiscaux", () => {
  assert.equal(seuilMicroBnc(2025), 77700);
  assert.equal(seuilMicroBnc(2026), 83600);
  assert.equal(limite2035(2026), "2026-05-20", "1 May 2026 is a Friday: 2nd working day is Tue 5 May, + 15 days");
});
