/**
 * Several banks per household (decided on 01/11/2026): the first personal bank keeps the household's main link
 * (bank_links, unchanged), and every further connection lives here: another personal bank (the partner's bank) or
 * a professional account (Qonto, Shine, the « pro » offer of a high-street bank), opened with Enable Banking's
 * business login. Accounts of a professional connection are typed « pro »: they stay out of the family budget and
 * are offered to Vie pro. Read-only, like every bank access in Lucien.
 */
import { nomCompte, nomsUniques, type InfosCompte } from "./destinations.js";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { budgetIa } from "./iaBudget.js";
import { categorise, fingerprint, merchantOf, parseStatement } from "./transactions.js";
import { cleIban, dedoublonnerOperations, ibansDejaSuivis } from "./doublons.js";
import { type CompteEb, type EbAccount, type EbAspsp, type EbClient, infosEb, mapEbTransactions, newState } from "./enablebanking.js";

export type Usage = "perso" | "pro";
export interface ConnexionRow {
  id: string; household_id: string; usage: Usage; fournisseur: "enablebanking" | "simule"; banque: string; pays: string;
  user_uuid: string;            // Enable Banking session id, or « attente:<state> » until the bank sends the person back
  statut: "en_attente" | "connecte" | "erreur"; expire_le: string | null; comptes: string | null;
  derniere_synchro: string | null; curseur: string | null; cree_le: string;
}

export function ensureConnexionsSchema(db: Db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS bank_connexions (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, usage TEXT NOT NULL, fournisseur TEXT NOT NULL, banque TEXT NOT NULL, pays TEXT NOT NULL,
    user_uuid TEXT NOT NULL, statut TEXT NOT NULL, expire_le TEXT, comptes TEXT, derniere_synchro TEXT, curseur TEXT, cree_le TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bank_connexions_foyer ON bank_connexions(household_id);`);
}

export const listConnexions = (db: Db, hid: string) => {
  ensureConnexionsSchema(db);
  return db.raw.prepare("SELECT * FROM bank_connexions WHERE household_id = ? ORDER BY cree_le").all(hid) as unknown as ConnexionRow[];
};
const parId = (db: Db, id: string) => db.raw.prepare("SELECT * FROM bank_connexions WHERE id = ?").get(id) as unknown as ConnexionRow | undefined;
const maj = (db: Db, c: ConnexionRow) => db.raw.prepare("UPDATE bank_connexions SET user_uuid = ?, statut = ?, expire_le = ?, comptes = ?, derniere_synchro = ?, curseur = ? WHERE id = ?")
  .run(c.user_uuid, c.statut, c.expire_le, c.comptes, c.derniere_synchro, c.curseur, c.id);

/** Starts an extra connection; returns the bank's login URL. The state starts with « s. » so the callback finds it. */
export async function ebConnecterSup(db: Db, client: EbClient, hid: string, aspsp: EbAspsp, usage: Usage): Promise<{ url: string }> {
  ensureConnexionsSchema(db);
  const state = `s.${newState()}`;
  db.raw.prepare("INSERT INTO bank_connexions (id, household_id, usage, fournisseur, banque, pays, user_uuid, statut, cree_le) VALUES (?, ?, ?, 'enablebanking', ?, ?, ?, 'en_attente', ?)")
    .run(randomUUID(), hid, usage, aspsp.name, aspsp.country, `attente:${state}`, new Date().toISOString());
  const { url } = await client.startAuth({ name: aspsp.name, country: aspsp.country }, state, aspsp.maximum_consent_validity, usage === "pro" ? "business" : "personal");
  return { url };
}

/** The bank sent the person back: opens the session and records the accounts. Returns the household. */
export async function ebTerminerSup(db: Db, client: EbClient, state: string, code: string): Promise<ConnexionRow | null> {
  ensureConnexionsSchema(db);
  const c = db.raw.prepare("SELECT * FROM bank_connexions WHERE user_uuid = ?").get(`attente:${state}`) as unknown as ConnexionRow | undefined;
  if (!c) return null;
  const s = await client.createSession(code);
  const comptes = JSON.stringify((s.accounts ?? []).map((a) => infosEb(a as EbAccount)));
  const fait = { ...c, user_uuid: s.session_id, statut: "connecte" as const, expire_le: s.access?.valid_until ?? null, comptes };
  maj(db, fait);
  return fait;
}

const nomSup = (c: Pick<ConnexionRow, "usage" | "banque">, a: InfosCompte) => `${nomCompte(a, c.usage === "pro" ? "Pro · " : "")} (${c.banque})`;

/** Balances and new booked transactions of one extra connection. */
export async function ebSynchroSup(db: Db, client: EbClient, c: ConnexionRow) {
  if (c.statut === "en_attente" || c.user_uuid.startsWith("attente:")) return { comptes: 0, lues: 0, ajoutees: 0 };
  if (c.expire_le && new Date(c.expire_le).getTime() < Date.now()) {
    maj(db, { ...c, statut: "erreur" });
    throw new Error(`L'autorisation de ${c.banque} a expiré : reconnectez cette banque.`);
  }
  const comptes = JSON.parse(c.comptes ?? "[]") as CompteEb[];
  const from = (c.curseur ?? new Date(Date.now() - 90 * 864e5).toISOString()).slice(0, 10);
  const noms = nomsUniques(comptes, (a) => nomSup(c, a));
  const dejaSuivis = ibansDejaSuivis(db, c.household_id, c); // same account already followed through another connection
  let lues = 0, ajoutees = 0, suivis = 0;
  for (const [i, a] of comptes.entries()) {
    const nom = noms[i];
    const iban = cleIban(a.iban);
    if (iban && dejaSuivis.has(iban)) { db.raw.prepare("DELETE FROM bank_accounts WHERE id = ?").run(`eb:${a.uid}`); continue; }
    suivis++;
    const bal = await client.balances(a.uid).catch(() => []);
    const solde = bal.find((b) => ["CLBD", "ITAV", "XPCD", "ITBD"].includes(b.balance_type ?? "")) ?? bal[0];
    db.upsertBankAccount({ id: `eb:${a.uid}`, household_id: c.household_id, item_id: c.user_uuid, nom, banque: c.banque, type: c.usage === "pro" ? "pro" : null, solde: solde ? Number(solde.balance_amount.amount) : null, devise: solde?.balance_amount.currency ?? "EUR", maj_le: new Date().toISOString(), infos: JSON.stringify(a) });
    if (db.destinationParId(c.household_id, `eb:${a.uid}`) === "ignore") continue; // not followed: no operation imported
    const parsed = mapEbTransactions(await client.transactions(a.uid, from), nom);
    lues += parsed.length;
    const cats = await categorise(parsed, budgetIa(db, c.household_id));
    ajoutees += db.insertTransactions(parsed.map((t, i) => ({
      household_id: c.household_id, compte: t.compte, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i],
      empreinte: t.ref ? `eb:${a.uid}:${t.ref}` : fingerprint(c.household_id, t),
    })));
  }
  const now = new Date().toISOString();
  maj(db, { ...c, statut: "connecte", derniere_synchro: now, curseur: new Date(Date.now() - 3 * 864e5).toISOString() });
  ajoutees -= Math.min(ajoutees, dedoublonnerOperations(db, c.household_id));
  return { comptes: suivis, lues, ajoutees };
}

/** Ends one extra connection: access revoked at the bank, its accounts removed; past transactions stay in the history. */
export async function supprimerConnexion(db: Db, client: EbClient | null, hid: string, id: string): Promise<boolean> {
  ensureConnexionsSchema(db);
  const c = parId(db, id);
  if (!c || c.household_id !== hid) return false;
  if (client && c.fournisseur === "enablebanking" && !c.user_uuid.startsWith("attente:")) await client.deleteSession(c.user_uuid).catch((e) => console.error("[banque] session non révoquée :", (e as Error).message));
  db.raw.prepare("DELETE FROM bank_accounts WHERE household_id = ? AND item_id = ?").run(hid, c.user_uuid);
  db.raw.prepare("DELETE FROM bank_connexions WHERE id = ?").run(id);
  return true;
}

/** Revokes every extra connection of a household (account deletion). */
export async function couperConnexions(db: Db, client: EbClient | null, hid: string) {
  for (const c of listConnexions(db, hid)) await supprimerConnexion(db, client, hid, c.id);
}

// ---------- simulated mode (no keys): a fictional professional account so the flow can be tried ----------
const RELEVE_PRO_DEMO = (y: number, m: number) => {
  const mois = (k: number) => { const d = new Date(Date.UTC(y, m - 1 - k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const lignes: string[] = ["date;libelle;montant"];
  for (let k = 0; k < 3; k++) {
    const p = mois(k);
    lignes.push(`${p}-03;VIR HONORAIRES PATIENTS SEMAINE 1;1240,00`, `${p}-10;VIR HONORAIRES PATIENTS SEMAINE 2;1180,00`, `${p}-17;VIR CPAM REMBOURSEMENTS TIERS PAYANT;960,00`,
      `${p}-05;PRLV URSSAF COTISATIONS;-612,00`, `${p}-06;PRLV LOYER CABINET;-450,00`, `${p}-12;CB FOURNITURES MEDICALES;-86,40`, `${p}-20;PRLV ASSURANCE RCP;-48,00`);
  }
  return lignes.join("\n");
};

export function simulerConnexionSup(db: Db, hid: string, usage: Usage, banque = usage === "pro" ? "Banque pro de démonstration" : "Deuxième banque de démonstration") {
  ensureConnexionsSchema(db);
  const id = randomUUID(), session = `sim:${id}`;
  const now = new Date();
  db.raw.prepare("INSERT INTO bank_connexions (id, household_id, usage, fournisseur, banque, pays, user_uuid, statut, derniere_synchro, cree_le) VALUES (?, ?, ?, 'simule', ?, 'FR', ?, 'connecte', ?, ?)")
    .run(id, hid, usage, banque, session, now.toISOString(), now.toISOString());
  const nom = nomSup({ usage, banque }, { name: usage === "pro" ? "Compte professionnel" : "Compte courant", iban: null });
  db.upsertBankAccount({ id: `sim:${id}`, household_id: hid, item_id: session, nom, banque, type: usage === "pro" ? "pro" : null, solde: usage === "pro" ? 6420.5 : 1310.2, devise: "EUR", maj_le: now.toISOString() });
  if (usage === "pro") {
    const parsed = parseStatement(RELEVE_PRO_DEMO(now.getUTCFullYear(), now.getUTCMonth() + 1), nom);
    db.insertTransactions(parsed.map((t) => ({ household_id: hid, compte: nom, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: t.montant > 0 ? "revenus" : "autre", empreinte: fingerprint(hid, t) })));
  }
  return { id, compte: nom };
}
