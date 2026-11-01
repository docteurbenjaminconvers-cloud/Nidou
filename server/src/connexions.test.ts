import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { ebSynchroSup, ebTerminerSup, ensureConnexionsSchema, listConnexions, simulerConnexionSup, supprimerConnexion, type ConnexionRow } from "./connexions.js";
import type { EbClient } from "./enablebanking.js";

test("compte pro : tenu à part du budget du foyer, retiré proprement à la déconnexion", async () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15);
  db.insertTransactions([{ household_id: h.id, compte: "Compte joint", date: "2026-10-02", libelle: "CARREFOUR", marchand: "carrefour", montant: -50, categorie: "alimentation", empreinte: "a" }]);
  const { id, compte } = simulerConnexionSup(db, h.id, "pro", "Qonto");
  assert.ok(compte.startsWith("Pro · "));
  assert.ok(db.comptesPro(h.id).has(compte), "a professional account is set aside without being declared anywhere");
  assert.ok(db.listTransactions(h.id).some((t) => t.compte === compte), "the professional statement is there for Vie pro");
  assert.ok(db.transactionsFoyer(h.id).every((t) => t.compte !== compte), "…and out of the family budget");
  assert.equal(listConnexions(db, h.id).length, 1);
  assert.equal(await supprimerConnexion(db, null, "autre-foyer", id), false, "another household cannot disconnect it");
  assert.equal(await supprimerConnexion(db, null, h.id, id), true);
  assert.equal(listConnexions(db, h.id).length, 0);
  assert.ok(db.listBankAccounts(h.id).every((a) => a.nom !== compte), "the account is gone");
  assert.ok(db.listTransactions(h.id).some((t) => t.compte === compte), "past operations stay in the history");
});

test("banque supplémentaire Enable Banking : session ouverte, comptes lus, connexion professionnelle", async () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15);
  ensureConnexionsSchema(db);
  db.raw.prepare("INSERT INTO bank_connexions (id, household_id, usage, fournisseur, banque, pays, user_uuid, statut, cree_le) VALUES ('c1', ?, 'pro', 'enablebanking', 'Qonto', 'FR', 'attente:s.abc', 'en_attente', ?)").run(h.id, new Date().toISOString());
  const client = {
    createSession: async () => ({ session_id: "sess-1", accounts: [{ uid: "acc-1", name: "Compte principal", account_id: { iban: "FR7612345678901234567890123" } }], access: { valid_until: "2099-01-01T00:00:00Z" } }),
    balances: async () => [{ balance_amount: { amount: "4200.00", currency: "EUR" }, balance_type: "CLBD" }],
    transactions: async () => [{ transaction_amount: { amount: "1500.00", currency: "EUR" }, credit_debit_indicator: "CRDT", status: "BOOK", booking_date: "2026-10-03", remittance_information: ["VIR HONORAIRES"], entry_reference: "r1" }],
  } as unknown as EbClient;
  const cx = await ebTerminerSup(db, client, "s.abc", "code");
  assert.equal(cx?.statut, "connecte"); assert.equal(cx?.user_uuid, "sess-1");
  const r = await ebSynchroSup(db, client, cx as ConnexionRow);
  assert.deepEqual([r.comptes, r.ajoutees], [1, 1]);
  const compte = db.listBankAccounts(h.id)[0];
  assert.equal(compte.type, "pro"); assert.equal(compte.nom, "Pro · Compte principal (Qonto)"); assert.equal(compte.solde, 4200);
  assert.equal(db.soldeFoyer(h.id), null, "the professional balance is not the household's");
});
