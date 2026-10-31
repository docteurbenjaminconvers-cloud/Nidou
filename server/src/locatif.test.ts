import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_LOCATIF, demoLoyers, quittance, rapportLocatif, relance, revisionIrl } from "./locatif.js";

const today = "2026-10-20";
const r = rapportLocatif(DEMO_LOCATIF, demoLoyers(today), today);

test("locatif : loyers rapprochés de la banque, impayé repéré avec son retard", () => {
  const studio = r.biens.find((b) => b.bien.id === "b1")!;
  assert.ok(studio.encaissements.every((e) => e.statut === "paye"));
  const t2 = r.biens.find((b) => b.bien.id === "b2")!;
  const oct = t2.encaissements.at(-1)!;
  assert.equal(oct.statut, "impaye"); assert.equal(oct.retard_jours, 15);
  assert.equal(t2.impayes, 850);
  assert.ok(r.alertes.some((a) => a.titre.startsWith("Loyer impayé")));
});

test("locatif : révision IRL à la date anniversaire, gel pour les passoires F et G", () => {
  const t2 = r.biens.find((b) => b.bien.id === "b2")!;
  assert.equal(t2.revision!.date, "2026-11-15");
  assert.equal(t2.revision!.indice_nouveau, "2026T3", "T3 2026 is published mid-October, before the 15 November anniversary");
  assert.equal(t2.revision!.nouveau_loyer, Math.round((790 * 148.06) / 145.77 * 100) / 100);
  const studio = r.biens.find((b) => b.bien.id === "b1")!;
  assert.equal(studio.revision!.indice_nouveau, "2027T2", "next September: T2 2027, published in July");
  const gele = revisionIrl(DEMO_LOCATIF.baux[1], { ...DEMO_LOCATIF.biens[1], dpe: "F" }, today)!;
  assert.equal(gele.gel, true); assert.equal(gele.nouveau_loyer, null);
});

test("locatif : rentabilité, micro-foncier ou réel, LMNP", () => {
  const studio = r.biens.find((b) => b.bien.id === "b1")!;
  assert.equal(studio.rentabilite_brute, 6.4);
  assert.equal(r.fiscal.nu!.recettes, 6240);
  assert.equal(r.fiscal.nu!.micro.eligible, true);
  assert.match(r.fiscal.nu!.cases, /4BE/, "micro-foncier is better here");
  assert.match(r.fiscal.meuble!.cases, /5ND/);
  assert.equal(r.fiscal.meuble!.micro.base, (790 + 60) * 12 * 0.5);
});

test("locatif : quittance et relance", () => {
  const t2 = r.biens.find((b) => b.bien.id === "b2")!;
  const q = quittance(DEMO_LOCATIF, t2.bail!, t2.bien, t2.encaissements[0]);
  assert.match(q, /QUITTANCE DE LOYER/); assert.match(q, /Hugo Fabre/); assert.match(q, /850 €/);
  assert.match(relance(DEMO_LOCATIF, t2.bail!, t2.bien, t2.encaissements.at(-1)!), /octobre 2026/);
});
