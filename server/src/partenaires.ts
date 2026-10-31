/**
 * Cabinets partenaires : an accountant (or approved management association) registers, Lucien validates it, it
 * receives a code. A household that enters this code gets its first month free when it subscribes (Stripe trial
 * of 30 days on the first subscription only). The cabinet also gets read-only links from its clients (espaces.ts).
 */
import type { Hono } from "hono";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.js";

export interface Cabinet { code: string; nom: string; email: string; ville: string | null; statut: "en_attente" | "valide" | "refuse"; cree_le: string }

export function ensurePartenairesSchema(db: Db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS cabinets (
    code TEXT PRIMARY KEY, nom TEXT NOT NULL, email TEXT NOT NULL, ville TEXT, statut TEXT NOT NULL DEFAULT 'en_attente', cree_le TEXT NOT NULL
  )`);
  const cols = (db.raw.prepare("PRAGMA table_info(households)").all() as unknown as { name: string }[]).map((c) => c.name);
  if (!cols.includes("code_partenaire")) db.raw.exec("ALTER TABLE households ADD COLUMN code_partenaire TEXT");
}

/** Readable code: 4 letters of the cabinet's name + 4 random characters (no ambiguous ones). */
export function nouveauCode(nom: string): string {
  const base = nom.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = randomBytes(4);
  return `${base}-${[...r].map((b) => alpha[b % alpha.length]).join("")}`;
}

export const cabinet = (db: Db, code: string) => db.raw.prepare("SELECT * FROM cabinets WHERE code = ?").get(code.trim().toUpperCase()) as Cabinet | undefined;
export const cabinetValide = (db: Db, code: string | null | undefined) => { const c = code ? cabinet(db, code) : undefined; return c?.statut === "valide" ? c : null; };
export const codePartenaire = (db: Db, householdId: string) => (db.raw.prepare("SELECT code_partenaire FROM households WHERE id = ?").get(householdId) as { code_partenaire: string | null } | undefined)?.code_partenaire ?? null;

/** Days of free trial a household's first paid subscription gets: 30 with a valid partner code, never twice. */
export function joursOfferts(db: Db, h: { id: string; stripe_subscription_id?: string | null; abonnement_statut?: string | null }): number {
  if (h.stripe_subscription_id || (h.abonnement_statut && h.abonnement_statut !== "simule")) return 0;
  return cabinetValide(db, codePartenaire(db, h.id)) ? 30 : 0;
}

const adminOk = (header: string | undefined) => {
  const t = process.env.LUCIEN_ADMIN_TOKEN;
  if (!t || !header) return false;
  const a = Buffer.from(header.replace(/^Bearer\s+/i, "")), b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function monterPartenaires(api: Hono<any>, db: Db, ctx: { household: (c: any) => { id: string } }) {
  ensurePartenairesSchema(db);

  /** Public: a cabinet asks to become a partner (validated by Lucien before its code works). */
  api.post("/partenaires", async (c) => {
    const b = z.object({ nom: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), ville: z.string().trim().max(80).optional() }).parse(await c.req.json());
    let code = nouveauCode(b.nom);
    while (cabinet(db, code)) code = nouveauCode(b.nom);
    db.raw.prepare("INSERT INTO cabinets (code, nom, email, ville, cree_le) VALUES (?, ?, ?, ?, ?)").run(code, b.nom, b.email.toLowerCase(), b.ville ?? null, new Date().toISOString());
    return c.json({ ok: true, message: "Merci : nous vérifions votre cabinet et vous envoyons votre code partenaire par email." }, 201);
  });

  /** The household's partner code (from its accountant). */
  api.get("/partenaire", (c) => {
    const code = codePartenaire(db, ctx.household(c).id);
    const cab = cabinetValide(db, code);
    return c.json({ code, cabinet: cab ? { nom: cab.nom, ville: cab.ville } : null, offert: cab ? "Premier mois offert à l'abonnement" : null });
  });
  api.put("/partenaire", async (c) => {
    const b = z.object({ code: z.string().trim().max(20).nullable() }).parse(await c.req.json());
    const h = db.getHousehold(ctx.household(c).id)!;
    if (b.code === null || b.code === "") { db.raw.prepare("UPDATE households SET code_partenaire = NULL WHERE id = ?").run(h.id); return c.json({ code: null, cabinet: null }); }
    const cab = cabinetValide(db, b.code);
    if (!cab) return c.json({ error: "code_inconnu", message: "Ce code partenaire n'existe pas ou n'est pas encore actif." }, 400);
    if (h.stripe_subscription_id) return c.json({ error: "deja_abonne", message: "Le mois offert s'applique au premier abonnement : le vôtre est déjà en cours." }, 400);
    db.raw.prepare("UPDATE households SET code_partenaire = ? WHERE id = ?").run(cab.code, h.id);
    return c.json({ code: cab.code, cabinet: { nom: cab.nom, ville: cab.ville }, offert: "Premier mois offert à l'abonnement" });
  });

  // ---------- admin (Bearer LUCIEN_ADMIN_TOKEN) ----------
  api.get("/admin/partenaires", (c) => {
    if (!adminOk(c.req.header("authorization"))) return c.json({ error: "interdit" }, 403);
    const rows = db.raw.prepare("SELECT c.*, (SELECT COUNT(*) FROM households h WHERE h.code_partenaire = c.code) AS clients FROM cabinets c ORDER BY cree_le DESC").all();
    return c.json(rows);
  });
  api.post("/admin/partenaires/:code", async (c) => {
    if (!adminOk(c.req.header("authorization"))) return c.json({ error: "interdit" }, 403);
    const b = z.object({ statut: z.enum(["valide", "refuse", "en_attente"]) }).parse(await c.req.json());
    db.raw.prepare("UPDATE cabinets SET statut = ? WHERE code = ?").run(b.statut, c.req.param("code").toUpperCase());
    return c.json(cabinet(db, c.req.param("code")) ?? { error: "introuvable" });
  });
}
