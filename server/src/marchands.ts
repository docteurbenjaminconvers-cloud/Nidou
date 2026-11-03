/**
 * Recomputes the merchant name of operations already imported when the way Lucien reads bank labels improves
 * (03/11/2026: SEPA fields « ECH/… ID EMETTEUR/… » cut off, names repeated by the bank merged). Only the derived
 * `marchand` field changes: amounts, dates and the bank's own labels stay as they are. The choices already made on a
 * subscription (« à résilier », « je l'utilise », a set-aside remark, a followed cancellation) follow the new name.
 * Runs once per version, at start-up.
 */
import type { Db } from "./db.js";
import { merchantOf } from "./transactions.js";
import { ensureResiliationsSchema, nomMarchand } from "./resiliations.js";

const VERSION = "marchands-2026-11-03";

/** « fantome:orange -orange ech/ » → « fantome:orange », keeping the « #2 » of a second contract. */
export function renommerCle(cle: string, noms: Map<string, string>): string {
  return cle.split(":").map((seg) => {
    const [base, ...suite] = seg.split("#");
    const n = noms.get(base);
    return n ? [n, ...suite].join("#") : seg;
  }).join(":");
}

export function migrerMarchands(db: Db, force = false): { operations: number; foyers: number } {
  db.raw.exec("CREATE TABLE IF NOT EXISTS migrations (nom TEXT PRIMARY KEY, faite_le TEXT NOT NULL)");
  if (!force && db.raw.prepare("SELECT 1 FROM migrations WHERE nom = ?").get(VERSION)) return { operations: 0, foyers: 0 };
  ensureResiliationsSchema(db);
  const rows = db.raw.prepare("SELECT id, household_id, libelle, marchand FROM transactions").all() as { id: string; household_id: string; libelle: string; marchand: string }[];
  // per household: old name → new name (the most frequent one when one old name gave several)
  const votes = new Map<string, Map<string, Map<string, number>>>();
  const maj = db.raw.prepare("UPDATE transactions SET marchand = ? WHERE id = ?");
  let operations = 0;
  db.raw.exec("BEGIN");
  try {
    for (const r of rows) {
      const n = merchantOf(r.libelle);
      if (n === r.marchand) continue;
      maj.run(n, r.id); operations++;
      const h = votes.get(r.household_id) ?? new Map(); votes.set(r.household_id, h);
      const v = h.get(r.marchand) ?? new Map(); h.set(r.marchand, v);
      v.set(n, (v.get(n) ?? 0) + 1);
    }
    for (const [hid, h] of votes) {
      const noms = new Map([...h].map(([ancien, v]) => [ancien, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
      // decisions on the budget's actions
      for (const d of db.raw.prepare("SELECT cle FROM budget_decisions WHERE household_id = ?").all(hid) as { cle: string }[]) {
        const n = renommerCle(d.cle, noms);
        if (n !== d.cle) { db.raw.prepare("DELETE FROM budget_decisions WHERE household_id = ? AND cle = ?").run(hid, n); db.raw.prepare("UPDATE budget_decisions SET cle = ? WHERE household_id = ? AND cle = ?").run(n, hid, d.cle); }
      }
      // followed cancellations
      for (const s of db.raw.prepare("SELECT cle FROM resiliations WHERE household_id = ?").all(hid) as { cle: string }[]) {
        const n = renommerCle(s.cle, noms);
        if (n !== s.cle) { db.raw.prepare("DELETE FROM resiliations WHERE household_id = ? AND cle = ?").run(hid, n); db.raw.prepare("UPDATE resiliations SET cle = ?, marchand = ? WHERE household_id = ? AND cle = ?").run(n, nomMarchand(n.split("#")[0]), hid, s.cle); }
      }
      // checks on the professional accounts, and remarks set aside
      const pro = db.getModuleData<{ decisions?: Record<string, "ok" | "resilier"> }>(hid, "verif_pro");
      if (pro?.decisions) db.setModuleData(hid, "verif_pro", { ...pro, decisions: Object.fromEntries(Object.entries(pro.decisions).map(([k, v]) => [renommerCle(k, noms), v])) });
      const rem = db.getModuleData<{ masquees?: string[] }>(hid, "remarques");
      if (rem?.masquees) db.setModuleData(hid, "remarques", { ...rem, masquees: rem.masquees.map((k) => renommerCle(k, noms)) });
    }
    db.raw.prepare("INSERT OR REPLACE INTO migrations (nom, faite_le) VALUES (?, ?)").run(VERSION, new Date().toISOString());
    db.raw.exec("COMMIT");
  } catch (e) { db.raw.exec("ROLLBACK"); throw e; }
  if (operations) console.log(`[marchands] noms recalculés : ${operations} opération(s), ${votes.size} foyer(s)`);
  return { operations, foyers: votes.size };
}
