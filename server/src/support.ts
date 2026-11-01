/**
 * « Écrire à l'équipe Lucien » : a message from Réglages, kept in the database (nothing lost if the email service
 * is down) and emailed to the team with the context needed to answer at once (formula, device, screen size).
 * Reply-To is the person, so answering is a plain « Répondre » in the mailbox. Listed in the admin page too.
 */
import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { envoyerEmail } from "./mail.js";
import { adminOk } from "./partenaires.js";

export const SUJETS = { question: "Une question", probleme: "Quelque chose ne marche pas", banque: "Connexion à ma banque", abonnement: "Abonnement, facture, résiliation", idee: "Une idée, une suggestion" } as const;
type Sujet = keyof typeof SUJETS;

export function ensureSupportSchema(db: Db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, user_email TEXT, sujet TEXT NOT NULL, message TEXT NOT NULL, contexte TEXT NOT NULL, traite INTEGER NOT NULL DEFAULT 0, cree_le TEXT NOT NULL)`);
}

export function monterSupport(api: Hono<any>, db: Db, ctx: { household: (c: any) => { id: string; nom: string }; utilisateur: (c: any) => { email: string; prenom: string | null } | null }) {
  ensureSupportSchema(db);

  api.post("/support", async (c) => {
    const h = ctx.household(c);
    const u = ctx.utilisateur(c);
    const b = z.object({
      sujet: z.enum(Object.keys(SUJETS) as [Sujet, ...Sujet[]]), message: z.string().trim().min(5, "Écrivez quelques mots, s'il vous plaît").max(5000),
      infos: z.boolean().default(true), appareil: z.string().max(400).optional(), ecran: z.string().max(40).optional(), langue: z.string().max(5).optional(), page: z.string().max(80).optional(),
    }).parse(await c.req.json());
    const jour = new Date(Date.now() - 864e5).toISOString();
    if ((db.raw.prepare("SELECT COUNT(*) AS n FROM support_messages WHERE household_id = ? AND cree_le > ?").get(h.id, jour) as { n: number }).n >= 10)
      return c.json({ error: "trop", message: "Vous nous avez déjà écrit plusieurs fois aujourd'hui : nous vous répondons au plus vite." }, 429);
    const row = db.getHousehold(h.id);
    const contexte: Record<string, string> = { foyer: h.nom, formule: row?.formule ?? "aucune", abonnement: row?.abonnement_statut ?? (row?.plan === "famille" ? "essai" : "sans abonnement") };
    if (row?.abonnement_periode) contexte.periode = row.abonnement_periode;
    if (b.infos) Object.assign(contexte, { appareil: b.appareil ?? "?", ecran: b.ecran ?? "?", langue: b.langue ?? "fr", page: b.page ?? "?" });
    const id = randomUUID();
    db.raw.prepare("INSERT INTO support_messages (id, household_id, user_email, sujet, message, contexte, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, h.id, u?.email ?? null, b.sujet, b.message, JSON.stringify(contexte), new Date().toISOString());
    const qui = u ? `${u.prenom ? `${u.prenom} ` : ""}<${u.email}>` : "(compte sans email)";
    const envoye = await envoyerEmail({
      to: process.env.LUCIEN_SUPPORT_EMAIL ?? "bonjour@monlucien.fr", replyTo: u?.email,
      subject: `[Lucien] ${SUJETS[b.sujet]} · ${u?.prenom ?? h.nom}`,
      text: `${b.message}\n\n— De : ${qui}\n${Object.entries(contexte).map(([k, v]) => `${k} : ${v}`).join("\n")}\nRéf. ${id.slice(0, 8)}`,
    }).catch(() => false);
    return c.json({ ok: true, envoye, reponse_a: u?.email ?? null }, 201);
  });

  const interdit = (c: any) => (adminOk(c.req.header("authorization")) ? null : c.json({ error: "interdit", message: "Code d'administration incorrect." }, 403));
  api.get("/admin/support", (c) => {
    const r = interdit(c); if (r) return r;
    const l = db.raw.prepare("SELECT * FROM support_messages ORDER BY traite, cree_le DESC LIMIT 300").all() as unknown as { contexte: string; traite: number }[];
    return c.json(l.map((m) => ({ ...m, contexte: JSON.parse(m.contexte), traite: !!m.traite })));
  });
  api.post("/admin/support/:id", async (c) => {
    const r = interdit(c); if (r) return r;
    const b = z.object({ traite: z.boolean() }).parse(await c.req.json());
    db.raw.prepare("UPDATE support_messages SET traite = ? WHERE id = ?").run(b.traite ? 1 : 0, c.req.param("id"));
    return c.json({ ok: true });
  });
}
