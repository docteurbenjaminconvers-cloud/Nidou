/**
 * One bank account, one line in Lucien. Enable Banking gives an account a new id at every new session, so the same
 * BNP account reached through two sessions (the main link and an extra connection opened by mistake) would show twice,
 * with its operations copied. The account number (IBAN) tells them apart: the main link keeps the account, an extra
 * connection that only brings accounts already known is closed, and copies already imported are removed.
 */
import type { BankAccountRow, Db } from "./db.js";
import type { EbClient } from "./enablebanking.js";
import { linkExtra } from "./enablebanking.js";
import { listConnexions, supprimerConnexion, type ConnexionRow } from "./connexions.js";

export const cleIban = (iban: string | null | undefined) => (iban ? iban.replace(/\s/g, "").toUpperCase() : null);
const ibanDe = (a: BankAccountRow) => { try { return cleIban((JSON.parse(a.infos ?? "{}") as { iban?: string | null }).iban); } catch { return null; } };
const ibansDe = (comptes: string | null) => { try { return (JSON.parse(comptes ?? "[]") as { iban?: string | null }[]).map((c) => cleIban(c.iban)).filter((x): x is string => !!x); } catch { return []; } };

/**
 * Accounts already held by a connection that comes first: the main link, then the extra connections in the order they
 * were made. Returns the IBANs an extra connection must not import again.
 */
export function ibansDejaSuivis(db: Db, hid: string, avant?: ConnexionRow): Set<string> {
  const pris = new Set<string>();
  const lien = db.getBankLink(hid);
  if (lien && lien.statut === "connecte") for (const i of ibansDe(linkExtra(db, hid)?.comptes ?? null)) pris.add(i);
  if (avant) {
    for (const c of listConnexions(db, hid)) {
      if (c.id === avant.id) break;
      if (c.statut === "connecte") for (const i of ibansDe(c.comptes)) pris.add(i);
    }
  }
  return pris;
}

/** An extra connection whose every account is already followed elsewhere (nothing new it brings). */
export function connexionEnDouble(db: Db, c: ConnexionRow): boolean {
  const siens = ibansDe(c.comptes);
  if (!siens.length) return false;
  const pris = ibansDejaSuivis(db, c.household_id, c);
  return siens.every((i) => pris.has(i));
}

/**
 * Removes what is already there twice: for each account number, the line of the main link (else of the oldest
 * connection) is kept with its destination; the other lines and the operations imported under their names go.
 * Extra connections left with nothing of their own are closed (access revoked at the bank).
 */
export async function dedoublonnerComptes(db: Db, client: EbClient | null, hid: string): Promise<{ comptes: number; operations: number; connexions: number }> {
  const lien = db.getBankLink(hid);
  const cx = listConnexions(db, hid);
  const rang = (a: BankAccountRow) => {
    if (lien && a.item_id === lien.user_uuid) return 0;
    const i = cx.findIndex((c) => c.user_uuid === a.item_id);
    return i >= 0 ? 1 + i : 1000; // an old session no longer in use comes last
  };
  const parIban = new Map<string, BankAccountRow[]>();
  for (const a of db.listBankAccounts(hid)) {
    const i = ibanDe(a);
    if (i) parIban.set(i, [...(parIban.get(i) ?? []), a]);
  }
  let comptes = 0, operations = 0, connexions = 0;
  for (const lignes of parIban.values()) {
    if (lignes.length < 2) continue;
    const [garde, ...autres] = [...lignes].sort((x, y) => rang(x) - rang(y) || (x.maj_le ?? "").localeCompare(y.maj_le ?? ""));
    for (const a of autres) {
      if (!garde.destination && a.destination) db.raw.prepare("UPDATE bank_accounts SET destination = ? WHERE id = ?").run(a.destination, garde.id);
      if (a.nom !== garde.nom) operations += Number(db.raw.prepare("DELETE FROM transactions WHERE household_id = ? AND compte = ?").run(hid, a.nom).changes);
      db.raw.prepare("DELETE FROM bank_accounts WHERE id = ?").run(a.id);
      comptes++;
    }
  }
  for (const c of cx) {
    if (c.fournisseur !== "enablebanking" || c.statut !== "connecte" || !connexionEnDouble(db, c)) continue;
    // its accounts are copies of accounts followed elsewhere: their copied operations go with them
    const gardes = new Set(db.listBankAccounts(hid).filter((a) => a.item_id !== c.user_uuid).map((a) => a.nom));
    for (const a of db.listBankAccounts(hid).filter((x) => x.item_id === c.user_uuid && !gardes.has(x.nom))) {
      operations += Number(db.raw.prepare("DELETE FROM transactions WHERE household_id = ? AND compte = ?").run(hid, a.nom).changes);
      comptes++;
    }
    await supprimerConnexion(db, client, hid, c.id); connexions++;
  }
  operations += dedoublonnerOperations(db, hid);
  if (comptes || operations || connexions) console.log(`[banque] doublons retirés : ${comptes} compte(s), ${operations} opération(s), ${connexions} connexion(s)`);
  return { comptes, operations, connexions };
}

/**
 * The same operation imported twice on one account through two bank sessions (ids « eb:<account id>:<ref> » with two
 * different account ids): the copy is removed. Two real identical payments on the same day come from the same session,
 * so they share the account id and are both kept.
 */
export function dedoublonnerOperations(db: Db, hid: string): number {
  const rows = db.raw.prepare("SELECT id, compte, date, libelle, montant, empreinte, importe_le FROM transactions WHERE household_id = ? AND empreinte LIKE 'eb:%' ORDER BY importe_le, id").all(hid) as { id: string; compte: string | null; date: string; libelle: string; montant: number; empreinte: string }[];
  const vus = new Map<string, string[]>(); // operation → sessions (account ids) already seen, with the count per id
  const compte = new Map<string, number>();
  const aSuppr: string[] = [];
  for (const r of rows) {
    const uid = r.empreinte.split(":")[1] ?? "";
    const k = `${r.compte}|${r.date}|${r.montant}|${r.libelle}`;
    const uids = vus.get(k) ?? [];
    // how many times this operation appears under the first account id seen: copies from another id beyond that count go
    const premier = uids[0];
    if (premier === undefined) { vus.set(k, [uid]); compte.set(`${k}|${uid}`, 1); continue; }
    if (uid === premier) { compte.set(`${k}|${uid}`, (compte.get(`${k}|${uid}`) ?? 0) + 1); continue; }
    const n = (compte.get(`${k}|${uid}`) ?? 0) + 1;
    compte.set(`${k}|${uid}`, n);
    if (n <= (compte.get(`${k}|${premier}`) ?? 0)) aSuppr.push(r.id);
  }
  const del = db.raw.prepare("DELETE FROM transactions WHERE id = ?");
  for (const id of aSuppr) del.run(id);
  return aSuppr.length;
}
