/**
 * Dépenses partagées entre les membres d'un foyer (couple, colocation, enfants majeurs) : qui a payé quoi, qui doit
 * combien, et le plus petit nombre de remboursements pour être quittes. Nothing moves money: Lucien keeps the count,
 * the people pay each other back as they like and mark it as settled.
 */
import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { soldes, suggestions, type Depense, type Reglement } from "./partagesCalcul.js";
export * from "./partagesCalcul.js";

export function ensurePartagesSchema(db: Db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS depenses_partagees (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, date TEXT NOT NULL, libelle TEXT NOT NULL, montant REAL NOT NULL,
    paye_par TEXT NOT NULL, participants TEXT NOT NULL, transaction_id TEXT, cree_le TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reglements_partages (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, date TEXT NOT NULL, de TEXT NOT NULL, a TEXT NOT NULL, montant REAL NOT NULL, cree_le TEXT NOT NULL
  );`);
}

export function monterPartages(api: Hono<any>, db: Db, ctx: { household: (c: any) => { id: string } }) {
  ensurePartagesSchema(db);
  const membres = (hid: string) => db.listMembers(hid).map((m) => ({ id: m.id, prenom: m.prenom, role: m.role }));
  const lire = (hid: string) => {
    const depenses = (db.raw.prepare("SELECT * FROM depenses_partagees WHERE household_id = ? ORDER BY date DESC, cree_le DESC").all(hid) as unknown as (Omit<Depense, "participants"> & { participants: string })[])
      .map((d) => ({ id: d.id, date: d.date, libelle: d.libelle, montant: d.montant, paye_par: d.paye_par, participants: JSON.parse(d.participants) as string[], transaction_id: d.transaction_id }));
    const reglements = db.raw.prepare("SELECT id, date, de, a, montant FROM reglements_partages WHERE household_id = ? ORDER BY date DESC, cree_le DESC").all(hid) as unknown as Reglement[];
    const m = membres(hid);
    const s = soldes(depenses, reglements, m);
    return { membres: m, depenses, reglements, soldes: s, suggestions: suggestions(s) };
  };

  api.get("/partages", (c) => c.json(lire(ctx.household(c).id)));

  api.post("/partages/depenses", async (c) => {
    const hid = ctx.household(c).id;
    const b = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), libelle: z.string().trim().min(1).max(120), montant: z.number().positive().max(1_000_000),
      paye_par: z.string(), participants: z.array(z.string()).min(1).max(20), transaction_id: z.string().nullable().optional(),
    }).parse(await c.req.json());
    const ids = new Set(membres(hid).map((m) => m.id));
    if (!ids.has(b.paye_par) || b.participants.some((p) => !ids.has(p))) return c.json({ error: "membre", message: "Choisissez des membres du foyer." }, 400);
    if (b.transaction_id) {
      const t = db.listTransactions(hid).find((x) => x.id === b.transaction_id);
      if (!t) return c.json({ error: "introuvable" }, 404);
    }
    db.raw.prepare("INSERT INTO depenses_partagees (id, household_id, date, libelle, montant, paye_par, participants, transaction_id, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), hid, b.date, b.libelle, Math.round(b.montant * 100) / 100, b.paye_par, JSON.stringify([...new Set(b.participants)]), b.transaction_id ?? null, new Date().toISOString());
    return c.json(lire(hid), 201);
  });

  api.delete("/partages/depenses/:id", (c) => {
    const hid = ctx.household(c).id;
    db.raw.prepare("DELETE FROM depenses_partagees WHERE id = ? AND household_id = ?").run(c.req.param("id"), hid);
    return c.json(lire(hid));
  });

  /** « Marquer comme réglé » : one person paid another back, outside Lucien. */
  api.post("/partages/reglements", async (c) => {
    const hid = ctx.household(c).id;
    const b = z.object({ de: z.string(), a: z.string(), montant: z.number().positive().max(1_000_000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(await c.req.json());
    const ids = new Set(membres(hid).map((m) => m.id));
    if (!ids.has(b.de) || !ids.has(b.a) || b.de === b.a) return c.json({ error: "membre", message: "Choisissez deux membres du foyer." }, 400);
    db.raw.prepare("INSERT INTO reglements_partages (id, household_id, date, de, a, montant, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), hid, b.date ?? new Date().toISOString().slice(0, 10), b.de, b.a, Math.round(b.montant * 100) / 100, new Date().toISOString());
    return c.json(lire(hid), 201);
  });

  api.delete("/partages/reglements/:id", (c) => {
    const hid = ctx.household(c).id;
    db.raw.prepare("DELETE FROM reglements_partages WHERE id = ? AND household_id = ?").run(c.req.param("id"), hid);
    return c.json(lire(hid));
  });
}
