import { test } from "node:test";
import assert from "node:assert/strict";
import type { TransactionRow } from "./db.js";
import { prevoirFinDeMois } from "./prevision.js";

let n = 0;
const t = (date: string, marchand: string, montant: number, categorie = "autre"): TransactionRow => ({ id: String(n++), household_id: "h", compte: "Compte joint", date, libelle: marchand, marchand, montant, categorie, empreinte: String(n), importe_le: "" });

function historique(): TransactionRow[] {
  const txs: TransactionRow[] = [];
  for (const m of ["2026-08", "2026-09", "2026-10"]) {
    txs.push(t(`${m}-28`, "atelier verdier", 2850, "revenus"), t(`${m}-05`, "credit immo", -1180, "logement"), t(`${m}-12`, "netflix", -13.49, "abonnements"));
    for (const d of ["03", "10", "17", "24"]) txs.push(t(`${m}-${d}`, "carrefour", -150, "alimentation")); // 600 €/month of groceries
  }
  return txs;
}

test("solde prévu : prélèvements à venir, salaire attendu, dépenses courantes, jour par jour", () => {
  const txs = [...historique(), t("2026-11-05", "credit immo", -1180, "logement")];
  const p = prevoirFinDeMois(1500, txs, "2026-11-08");
  assert.deepEqual(p.prelevements_a_venir.map((x) => x.libelle), ["Netflix"], "the mortgage already went out this month");
  assert.deepEqual(p.revenus_attendus.map((x) => [x.libelle, x.montant, x.jour]), [["Atelier Verdier", 2850, 28]]);
  assert.ok(p.depense_courante_jour > 19 && p.depense_courante_jour < 20.5, `~600 €/month: ${p.depense_courante_jour}`);
  assert.equal(p.jours_restants, 22); assert.equal(p.fin_mois, "2026-11-30");
  assert.ok(Math.abs(p.solde_prevu - (1500 + 2850 - 13.49 - p.depense_courante_jour * 22)) < 0.05);
  assert.equal(p.alerte, null);
});

test("solde prévu : découvert annoncé avec sa date, avant le salaire", () => {
  const p = prevoirFinDeMois(300, historique(), "2026-11-02");
  assert.ok(p.alerte, "goes under zero"); assert.equal(p.alerte!.jour, "2026-11-05", "the day of the mortgage");
  assert.ok(p.solde_prevu > 0, "back above zero after the salary on the 28th");
  assert.equal(p.plus_bas.jour < "2026-11-28", true);
});
