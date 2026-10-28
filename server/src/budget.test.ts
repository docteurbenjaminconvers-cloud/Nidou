import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { parseStatement, merchantOf, ruleCategory, categorise, fingerprint } from "./transactions.js";
import { budgetReport, findRecurrences } from "./budget.js";
import { demoStatement } from "./seed-statement.js";
import { seedDemo } from "./seed.js";

const TODAY = "2026-10-28";

test("le parseur lit les formats CSV français courants", () => {
  const a = parseStatement("Date;Libellé;Montant\n12/10/2026;CB CARREFOUR MARKET;-54,30\n13/10/2026;VIR SALAIRE;2 850,00");
  assert.equal(a.length, 2);
  assert.equal(a[0].date, "2026-10-12");
  assert.equal(a[0].montant, -54.3);
  assert.equal(a[1].montant, 2850);
  const b = parseStatement("Date,Libelle,Debit,Credit\n2026-10-12,PRLV EDF,96.00,\n2026-10-13,REMB CPAM,,42.10");
  assert.deepEqual(b.map((t) => t.montant), [-96, 42.1]);
  const c = parseStatement("12/10/2026 CB LIDL UZES -31,20\n14/10/2026 PRLV ORANGE -64,99");
  assert.equal(c.length, 2);
  assert.equal(c[1].libelle, "PRLV ORANGE");
});

test("les marchands sont normalisés et catégorisés par règles", async () => {
  assert.equal(merchantOf("CB CARREFOUR MARKET 11/10 MONTPELLIER"), "carrefour market");
  assert.equal(merchantOf("PRLV SEPA EDF CLIENTS PARTICULIERS"), "edf clients particuliers");
  assert.equal(ruleCategory("CB NETFLIX.COM", -13.49), "abonnements");
  assert.equal(ruleCategory("COTISATION CARTE VISA PREMIER", -11), "frais_bancaires");
  assert.equal(ruleCategory("VIR SALAIRE SOCIETE DUPONT", 2850), "revenus");
  const cats = await categorise([{ libelle: "CB LIDL 2210 UZES", montant: -31 }, { libelle: "TRUC INCONNU", montant: -5 }]);
  assert.deepEqual(cats, ["alimentation", "autre"]);
});

async function loadDemo() {
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const parsed = parseStatement(demoStatement(TODAY));
  const cats = await categorise(parsed);
  db.insertTransactions(parsed.map((t, i) => ({ household_id: h.id, compte: "BNP", date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i], empreinte: fingerprint(h.id, t) })));
  return { db, h };
}

test("l'import ignore les doublons", async () => {
  const { db, h } = await loadDemo();
  const n1 = db.listTransactions(h.id).length;
  const parsed = parseStatement(demoStatement(TODAY));
  const added = db.insertTransactions(parsed.map((t) => ({ household_id: h.id, compte: "BNP", date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: "autre", empreinte: fingerprint(h.id, t) })));
  assert.equal(added, 0);
  assert.equal(db.listTransactions(h.id).length, n1);
});

test("les récurrences mensuelles sont détectées avec leur jour de prélèvement", async () => {
  const { db, h } = await loadDemo();
  const recs = findRecurrences(db.listTransactions(h.id));
  const netflix = recs.find((r) => r.marchand.includes("netflix"));
  assert.ok(netflix, "netflix attendu");
  assert.equal(netflix!.frequence, "mensuel");
  assert.equal(netflix!.jour_du_mois, 10);
  assert.ok(!recs.some((r) => r.marchand.includes("carrefour")), "les courses ne sont pas une récurrence");
});

test("le rapport produit des actions classées : fantômes, hausse EDF, frais, streaming", async () => {
  const { db, h } = await loadDemo();
  const r = budgetReport(db.listTransactions(h.id), db.listDocuments(h.id), {}, TODAY);
  assert.equal(r.periode.mois, 4);
  assert.ok(r.revenus_moyenne_mensuelle > 4500, `revenus ${r.revenus_moyenne_mensuelle}`);
  assert.ok(r.reste_a_vivre_moyen > 0);
  const types = new Set(r.actions.map((a) => a.type));
  assert.ok(types.has("fantome"), "abonnement fantôme attendu (Keepcool, iCloud, Prime…)");
  assert.ok(r.actions.some((a) => a.type === "hausse" && a.marchand?.includes("edf")), "hausse EDF attendue");
  assert.ok(types.has("frais"), "frais bancaires attendus");
  assert.ok(types.has("doublon"), "streaming en doublon attendu");
  assert.ok(r.economies_possibles > 300, `économies ${r.economies_possibles}`);
  assert.equal(r.actions[0].priorite, 1);
  // decisions
  const key = r.actions[0].cle;
  const r2 = budgetReport(db.listTransactions(h.id), db.listDocuments(h.id), { [key]: "resilie" }, TODAY);
  assert.equal(r2.economies_decidees, r.actions[0].economie_annuelle);
});

test("les contrats Nidou sont rapprochés des prélèvements", async () => {
  const { db, h } = await loadDemo();
  const r = budgetReport(db.listTransactions(h.id), db.listDocuments(h.id), {}, TODAY);
  const orange = r.recurrences.find((x) => x.marchand.includes("orange"));
  assert.ok(orange?.contrat_id, "Orange doit être rapproché du contrat Fibre + mobile");
  assert.ok(!r.actions.some((a) => a.type === "sans_contrat" && a.marchand?.includes("orange")));
});
