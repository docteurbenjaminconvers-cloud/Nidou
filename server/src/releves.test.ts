import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";

test("relevé de la SCI : compte créé à part du budget du foyer, opérations déjà reçues de la banque ignorées", async () => {
  process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = db.createHousehold("Test");
  db.raw.prepare("UPDATE households SET plan = 'famille' WHERE id = ?").run(h.id);
  const csv = "Date;Libellé;Montant\n01/10/2026;VIR CHARLES SCHOENENBERGER;810,00\n05/10/2026;PRLV SYNDIC COPRO;-120,00\n";
  const envoi = async () => { const fd = new FormData(); fd.append("file", new File([csv], "releve.csv", { type: "text/csv" })); fd.append("compte", "Compte SCI Skopelos"); fd.append("destination", "locatif"); return (await api.request("/transactions/import", { method: "POST", body: fd })).json(); };
  const r1 = await envoi();
  assert.equal(r1.ajoutees, 2);
  const compte = db.listBankAccounts(h.id).find((a) => a.nom === "Compte SCI Skopelos")!;
  assert.equal(db.destinationCompte(compte), "locatif");
  assert.equal(db.transactionsFoyer(h.id).length, 0, "nothing in the household budget");
  const r2 = await envoi();
  assert.equal(r2.ajoutees, 0); assert.equal(r2.doublons, 2);
});
