/**
 * Avant-première : with LUCIEN_ACCES=restreint, only invited addresses can ask for a login link (people who already
 * have an account, and those invited into a household by its owner, keep their access). The list lives in the
 * database and is managed from the admin page; LUCIEN_ACCES_EMAILS adds addresses from the server settings
 * (Benjamin's own, so he can never lock himself out).
 */
import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "./db.js";
import { emailValide } from "./auth.js";
import { envoyerEmail } from "./mail.js";
import { adminOk } from "./partenaires.js";

export const accesRestreint = () => (process.env.LUCIEN_ACCES ?? "").toLowerCase() === "restreint";
const publicUrl = () => (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function ensureAccesSchema(db: Db) {
  db.raw.exec("CREATE TABLE IF NOT EXISTS acces_invites (email TEXT PRIMARY KEY, prenom TEXT, note TEXT, cree_le TEXT NOT NULL)");
}

/** May this address ask for a login link? */
export function accesAutorise(db: Db, email: string): boolean {
  if (!accesRestreint()) return true;
  const e = email.trim().toLowerCase();
  if ((process.env.LUCIEN_ACCES_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(e)) return true;
  if (db.userByEmail(e)) return true;
  return !!db.raw.prepare("SELECT 1 FROM acces_invites WHERE email = ?").get(e);
}

export const MESSAGE_FERME = () => "Lucien est en avant-première : l'accès se fait pour l'instant sur invitation. Laissez votre adresse sur la liste d'attente pour être prévenu(e) de l'ouverture.";

export function monterAcces(api: Hono<any>, db: Db) {
  ensureAccesSchema(db);
  const interdit = (c: any) => (adminOk(c.req.header("authorization")) ? null : c.json({ error: "interdit", message: "Code d'administration incorrect." }, 403));

  api.get("/admin/acces", (c) => {
    const r = interdit(c); if (r) return r;
    const liste = db.raw.prepare("SELECT a.*, (SELECT COUNT(*) FROM users u WHERE lower(u.email) = a.email) AS inscrit FROM acces_invites a ORDER BY a.cree_le DESC").all() as unknown as { inscrit: number }[];
    return c.json({ restreint: accesRestreint(), liste: liste.map((x) => ({ ...x, inscrit: x.inscrit > 0 })) });
  });

  api.post("/admin/acces", async (c) => {
    const r = interdit(c); if (r) return r;
    const b = z.object({ email: z.string().trim().toLowerCase(), prenom: z.string().trim().max(60).optional(), note: z.string().trim().max(200).optional(), envoyer_email: z.boolean().default(true) }).parse(await c.req.json());
    if (!emailValide(b.email)) return c.json({ error: "email", message: "Adresse email invalide." }, 400);
    db.raw.prepare("INSERT INTO acces_invites (email, prenom, note, cree_le) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET prenom = excluded.prenom, note = excluded.note").run(b.email, b.prenom || null, b.note || null, new Date().toISOString());
    const envoye = b.envoyer_email ? await envoyerEmail({
      to: b.email, subject: "Vous êtes invité(e) à découvrir Lucien en avant-première",
      text: `Bonjour${b.prenom ? ` ${b.prenom}` : ""},\n\nVous faites partie des toutes premières personnes à essayer Lucien, le majordome qui pense à tout pour vous : vos papiers rangés, vos échéances rappelées à temps, votre budget plus léger.\n\nPour commencer, ouvrez ce lien et saisissez cette adresse email : ${publicUrl()}\n\nAstuce : sur votre téléphone, ajoutez Lucien à votre écran d'accueil pour l'ouvrir comme une appli.\n\nVotre avis compte énormément : dans Réglages, « Écrire à l'équipe Lucien », dites-nous ce qui vous plaît et ce qui coince.\n\nBenjamin, pour l'équipe Lucien`,
    }).catch(() => false) : false;
    return c.json({ ok: true, envoye }, 201);
  });

  /** A login link made by the admin, to open on the phone: no email needed (before Brevo, or when an email is lost). */
  api.post("/admin/acces/lien", async (c) => {
    const r = interdit(c); if (r) return r;
    const b = z.object({ email: z.string().trim().toLowerCase() }).parse(await c.req.json());
    if (!emailValide(b.email)) return c.json({ error: "email", message: "Adresse email invalide." }, 400);
    if (!accesAutorise(db, b.email)) return c.json({ error: "sur_invitation", message: "Invitez d'abord cette adresse." }, 403);
    const token = db.createAuthLink(b.email, { ttlMinutes: 30 });
    return c.json({ lien: `${publicUrl()}/api/auth/lien?token=${token}`, valable_minutes: 30 });
  });

  api.delete("/admin/acces/:email", (c) => {
    const r = interdit(c); if (r) return r;
    db.raw.prepare("DELETE FROM acces_invites WHERE email = ?").run(decodeURIComponent(c.req.param("email")).toLowerCase());
    return c.json({ ok: true });
  });
}
