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

test("locatif : SCI à l'IS (amortissement, impôt) et meublé de tourisme non classé (15 000 €, 30 %)", () => {
  const sci = r.fiscal.sci[0];
  assert.equal(sci.regime, "is");
  assert.equal(sci.recettes, 890 * 12);
  assert.equal(sci.amortissement, Math.round((214000 * 0.85) / 30 * 100) / 100);
  assert.equal(sci.impot_is, sci.resultat > 0 ? Math.round(sci.resultat * 0.15 * 100) / 100 : 0);
  assert.equal(r.fiscal.nu!.recettes, 6240, "the SCI flat is not declared by the household directly");
  const t = r.fiscal.tourisme[0];
  assert.equal(t.classe, false); assert.equal(t.seuil, 15000); assert.equal(t.abattement, 0.3);
  const palavas = r.biens.find((b) => b.bien.id === "b4")!;
  assert.ok(palavas.recettes_annuelles > 0 && palavas.tourisme_12m.length > 0);
  assert.ok(!r.alertes.some((a) => a.titre.includes("Palavas sans locataire")), "a tourist rental has no lease");
  assert.ok(r.echeances.some((e) => e.titre.includes("liasse 2065")) || r.fiscal.sci[0].echeance < "2026-10-20");
});

test("bail commercial : ILC, périodes triennales, TVA sur le loyer", async () => {
  const { revisionIrl, triennales, loyerDu, encaissements, quittance } = await import("./locatif.js");
  const bien = { id: "b", nom: "Local Skopelos", adresse: "Montpellier", type: "local" as const, meuble: false, prix_achat: 200000, taxe_fonciere: 1200, assurance_pno: 300, charges_non_recuperables: 0, dpe: null };
  const bail = { id: "c", bien_id: "b", locataire: "Charles Tattoo", loyer_hc: 1000, charges: 50, debut: "2021-07-01", irl_trimestre: 1 as const, irl_base: "2025T1", depot_garantie: 3000, jour_paiement: 1, type: "commercial" as const, indice: "ilc" as const, tva: true };
  const r = revisionIrl(bail, bien, "2026-06-30")!;
  assert.equal(r.indice, "ilc");
  assert.equal(r.indice_nouveau, "2026T1", "T1 published late June: in force on 1 July");
  assert.equal(r.nouveau_loyer, Math.round(1000 * 135.26 / 135.87 * 100) / 100, "ILC, not IRL (a slight decrease)");
  assert.equal(r.gel, false);
  const t = triennales(bail, "2026-11-02")!;
  assert.deepEqual(t, { fin_9_ans: "2030-07-01", prochaine: "2027-07-01", conge_avant: "2027-01-01", prolongation: false });
  assert.equal(triennales({ ...bail, type: "habitation" }, "2026-11-02"), null);
  assert.equal(loyerDu(bail), 1260);
  const enc = encaissements(bail, [{ date: "2026-10-01", libelle: "VIR CHARLES TATTOO", montant: 1260, categorie: "revenus", compte: "SCI" }], "2026-10-20", 1);
  assert.equal(enc[0].statut, "paye");
  assert.match(quittance({ bailleur: "SCI Skopelos", biens: [], baux: [] }, bail, bien, enc[0]), /Total TTC : 1\s?260\s€/);
});
