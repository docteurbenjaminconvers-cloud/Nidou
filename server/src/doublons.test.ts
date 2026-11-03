import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { ebSynchroSup, ebTerminerSup, ensureConnexionsSchema, listConnexions, type ConnexionRow } from "./connexions.js";
import { ebSyncHousehold, ensureEbSchema, type EbClient } from "./enablebanking.js";
import { connexionEnDouble, dedoublonnerComptes } from "./doublons.js";

const IBAN_PRO = "FR76 3000 4000 0000 0000 0001 248";
const IBAN_JOINT = "FR7630004000000000000009876";

/** A BNP that answers the same two accounts under whatever session ids it is asked about. */
const bnp = (session: string, uidPrefixe: string) => ({
  createSession: async () => ({ session_id: session, accounts: [
    { uid: `${uidPrefixe}-1`, name: "CONVERS BENJAMIN", product: "Compte professionnel", account_id: { iban: IBAN_PRO } },
    { uid: `${uidPrefixe}-2`, name: "M OU MME CONVERS", product: "Compte joint", account_id: { iban: IBAN_JOINT } },
  ], access: { valid_until: "2099-01-01T00:00:00Z" } }),
  balances: async () => [{ balance_amount: { amount: "3093.12", currency: "EUR" }, balance_type: "CLBD" }],
  transactions: async (uid: string) => [
    { transaction_amount: { amount: "49.00", currency: "EUR" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-05", remittance_information: [`PRLV ABONNEMENT ${uid.endsWith("1") ? "LOGICIEL" : "BOX"}`], entry_reference: `${uid}-r1` },
    { transaction_amount: { amount: "4.50", currency: "EUR" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-06", remittance_information: ["CB CAFE"], entry_reference: `${uid}-r2` },
    { transaction_amount: { amount: "4.50", currency: "EUR" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-10-06", remittance_information: ["CB CAFE"], entry_reference: `${uid}-r3` },
  ],
  deleteSession: async () => { revoquees.push(session); },
}) as unknown as EbClient;
let revoquees: string[] = [];

/** The main link already connected to BNP (session « principal », accounts p-1 and p-2), synced once. */
async function foyerAvecBnp() {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15);
  ensureConnexionsSchema(db); ensureEbSchema(db);
  const c = await bnp("principal", "p").createSession("x");
  db.upsertBankLink({ household_id: h.id, fournisseur: "enablebanking", user_uuid: "principal", external_user_id: "BNP Paribas|FR", derniere_synchro: null, curseur: null, statut: "connecte" });
  db.raw.prepare("UPDATE bank_links SET expire_le = ?, comptes = ? WHERE household_id = ?").run("2099-01-01T00:00:00Z", JSON.stringify(c.accounts.map((a) => ({ uid: a.uid, name: a.name, iban: a.account_id?.iban, usage: null, cash_account_type: null, product: (a as { product?: string }).product, details: null }))), h.id);
  await ebSyncHousehold(db, bnp("principal", "p"), h.id);
  return { db, hid: h.id };
}
const ouvrirSup = (db: Db, hid: string, state: string, cree = new Date().toISOString()) =>
  db.raw.prepare("INSERT INTO bank_connexions (id, household_id, usage, fournisseur, banque, pays, user_uuid, statut, cree_le) VALUES (?, ?, 'perso', 'enablebanking', 'BNP Paribas', 'FR', ?, 'en_attente', ?)").run(`cx-${state}`, hid, `attente:${state}`, cree);

test("situation de Benjamin : la même BNP connectée deux fois, comptes et opérations en double nettoyés", async () => {
  revoquees = [];
  const { db, hid } = await foyerAvecBnp();
  const principaux = db.listBankAccounts(hid);
  assert.equal(principaux.length, 2);
  const pro = principaux.find((a) => a.nom.includes("••1248"))!;
  db.setDestinationCompte(hid, pro.id, "pro");
  const opsAvant = db.listTransactions(hid).length;
  assert.equal(opsAvant, 6);

  // what happened before the fix: a second BNP session imported under « … (BNP Paribas) » names
  ouvrirSup(db, hid, "s.vieux");
  const cx = (await ebTerminerSup(db, bnp("second", "q"), "s.vieux", "code")) as ConnexionRow;
  db.raw.prepare("INSERT INTO bank_accounts (id, household_id, item_id, nom, banque, type, solde, devise, maj_le, infos) VALUES ('eb:q-1', ?, 'second', 'CONVERS BENJAMIN · Compte professionnel ••1248 (BNP Paribas)', 'BNP Paribas', null, 3093.12, 'EUR', ?, ?)").run(hid, new Date().toISOString(), JSON.stringify({ iban: IBAN_PRO }));
  db.raw.prepare("INSERT INTO bank_accounts (id, household_id, item_id, nom, banque, type, solde, devise, maj_le, infos) VALUES ('eb:q-2', ?, 'second', 'M OU MME CONVERS · Compte joint ••9876 (BNP Paribas)', 'BNP Paribas', null, 3093.12, 'EUR', ?, ?)").run(hid, new Date().toISOString(), JSON.stringify({ iban: IBAN_JOINT }));
  db.insertTransactions([
    { household_id: hid, compte: "CONVERS BENJAMIN · Compte professionnel ••1248 (BNP Paribas)", date: "2026-10-05", libelle: "PRLV ABONNEMENT LOGICIEL", marchand: "abonnement logiciel", montant: -49, categorie: "abonnements", empreinte: "eb:q-1:q-1-r1" },
    { household_id: hid, compte: "M OU MME CONVERS · Compte joint ••9876 (BNP Paribas)", date: "2026-10-05", libelle: "PRLV ABONNEMENT BOX", marchand: "abonnement box", montant: -49, categorie: "abonnements", empreinte: "eb:q-2:q-2-r1" },
  ]);
  assert.equal(db.listBankAccounts(hid).length, 4, "the duplicated screen");
  assert.equal(connexionEnDouble(db, cx), true);

  const r = await dedoublonnerComptes(db, bnp("second", "q"), hid);
  assert.deepEqual([r.comptes, r.operations, r.connexions], [2, 2, 1]);
  const restants = db.listBankAccounts(hid);
  assert.deepEqual(restants.map((a) => a.id).sort(), ["eb:p-1", "eb:p-2"], "the first connection's accounts are kept");
  assert.equal(db.destinationParId(hid, "eb:p-1"), "pro", "with the destination already chosen");
  assert.equal(db.listTransactions(hid).length, opsAvant, "the copied operations are gone, the originals all stay");
  assert.equal(db.listTransactions(hid).filter((t) => t.libelle === "CB CAFE").length, 4, "two real coffees the same day on each account are both kept");
  assert.equal(listConnexions(db, hid).length, 0, "the extra connection is closed");
  assert.deepEqual(revoquees, ["second"], "and its access revoked at the bank");
  assert.deepEqual(await dedoublonnerComptes(db, null, hid), { comptes: 0, operations: 0, connexions: 0 }, "nothing more on a second run");
});

test("prévention : une connexion supplémentaire n'importe jamais un compte déjà suivi", async () => {
  const { db, hid } = await foyerAvecBnp();
  ouvrirSup(db, hid, "s.nouveau");
  const cx = (await ebTerminerSup(db, bnp("second", "q"), "s.nouveau", "code")) as ConnexionRow;
  assert.equal(connexionEnDouble(db, cx), true, "the callback sees it brings nothing new and closes it");
  const r = await ebSynchroSup(db, bnp("second", "q"), cx);
  assert.deepEqual([r.comptes, r.ajoutees], [0, 0], "even synced, nothing is added");
  assert.equal(db.listBankAccounts(hid).length, 2);
  assert.equal(db.listTransactions(hid).length, 6);
});

test("une autre banque, ou le compte du conjoint dans la même banque, s'ajoute normalement", async () => {
  const { db, hid } = await foyerAvecBnp();
  ouvrirSup(db, hid, "s.conjoint");
  const conjoint = {
    ...bnp("conjoint", "c"),
    createSession: async () => ({ session_id: "conjoint", accounts: [
      { uid: "c-1", name: "CONVERS CLAIRE", product: "Compte de chèques", account_id: { iban: "FR7630004000000000000005555" } },
      { uid: "c-2", name: "M OU MME CONVERS", product: "Compte joint", account_id: { iban: IBAN_JOINT } }, // the joint account, seen from her login
    ], access: { valid_until: "2099-01-01T00:00:00Z" } }),
  } as unknown as EbClient;
  const cx = (await ebTerminerSup(db, conjoint, "s.conjoint", "code")) as ConnexionRow;
  assert.equal(connexionEnDouble(db, cx), false, "her own account is new");
  const r = await ebSynchroSup(db, conjoint, cx);
  assert.equal(r.comptes, 1, "only her own account is followed, the joint one stays on the first connection");
  const noms = db.listBankAccounts(hid).map((a) => a.nom);
  assert.equal(noms.length, 3);
  assert.equal(noms.filter((n) => n.includes("••9876")).length, 1, "the joint account shows once");
});

test("session principale renouvelée : les 90 jours relus sous de nouveaux identifiants ne se doublent pas", async () => {
  const { db, hid } = await foyerAvecBnp();
  const c = await bnp("renouvelee", "n").createSession("x");
  db.upsertBankLink({ household_id: hid, fournisseur: "enablebanking", user_uuid: "renouvelee", external_user_id: "BNP Paribas|FR", derniere_synchro: null, curseur: null, statut: "connecte" });
  db.raw.prepare("UPDATE bank_links SET comptes = ? WHERE household_id = ?").run(JSON.stringify(c.accounts.map((a) => ({ uid: a.uid, name: a.name, iban: a.account_id?.iban, usage: null, cash_account_type: null, product: (a as { product?: string }).product, details: null }))), hid);
  const r = await ebSyncHousehold(db, bnp("renouvelee", "n"), hid);
  assert.equal(r.ajoutees, 0);
  assert.equal(db.listTransactions(hid).length, 6);
  await dedoublonnerComptes(db, null, hid);
  assert.deepEqual(db.listBankAccounts(hid).map((a) => a.id).sort(), ["eb:n-1", "eb:n-2"], "the old session's lines go, the new ones stay");
});

test("doublons sans numéro de compte enregistré sur la ligne : la connexion en trop part avec ses opérations copiées", async () => {
  revoquees = [];
  const { db, hid } = await foyerAvecBnp();
  ouvrirSup(db, hid, "s.ancien");
  const cx = (await ebTerminerSup(db, bnp("second", "q"), "s.ancien", "code")) as ConnexionRow;
  db.raw.prepare("INSERT INTO bank_accounts (id, household_id, item_id, nom, banque, type, solde, devise, maj_le) VALUES ('eb:q-1', ?, 'second', 'CONVERS BENJAMIN ••1248 (BNP Paribas)', 'BNP Paribas', null, 3093.12, 'EUR', ?)").run(hid, new Date().toISOString());
  db.insertTransactions([{ household_id: hid, compte: "CONVERS BENJAMIN ••1248 (BNP Paribas)", date: "2026-10-05", libelle: "PRLV X", marchand: "x", montant: -49, categorie: "abonnements", empreinte: "eb:q-1:z" }]);
  assert.ok(cx);
  const r = await dedoublonnerComptes(db, bnp("second", "q"), hid);
  assert.equal(r.connexions, 1);
  assert.equal(db.listBankAccounts(hid).length, 2);
  assert.equal(db.listTransactions(hid).length, 6);
  assert.deepEqual(revoquees, ["second"]);
});
