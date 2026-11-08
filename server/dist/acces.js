import { z } from "zod";
import { emailValide } from "./auth.js";
import { envoyerEmail } from "./mail.js";
import { adminOk } from "./partenaires.js";
import { appliquerAbonnement } from "./abonnement.js";
import { PACKS, normaliser } from "./offre.js";
export const accesRestreint = () => (process.env.LUCIEN_ACCES ?? "").toLowerCase() === "restreint";
const publicUrl = () => (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
export function ensureAccesSchema(db) {
    db.raw.exec("CREATE TABLE IF NOT EXISTS acces_invites (email TEXT PRIMARY KEY, prenom TEXT, note TEXT, cree_le TEXT NOT NULL)");
    const cols = db.raw.prepare("PRAGMA table_info(acces_invites)").all().map((c) => c.name);
    if (!cols.includes("offert"))
        db.raw.exec("ALTER TABLE acces_invites ADD COLUMN offert INTEGER NOT NULL DEFAULT 0");
}
/**
 * Accès offert (avant-première) : a household with at least one member whose invitation is marked « offert » gets the
 * whole of Lucien (Tribu, every module of the Intégral pack) without card or Stripe. Nothing is charged, ever; a real
 * Stripe subscription, when there is one, always takes precedence. Removing the mark brings the household back to its
 * normal state (trial if days remain, otherwise the free plan).
 */
export const STATUT_OFFERT = "offert";
const PAYANT = ["active", "trialing", "past_due"];
export function offertPourFoyer(db, householdId) {
    ensureAccesSchema(db);
    return !!db.raw.prepare("SELECT 1 FROM household_users hu JOIN users u ON u.id = hu.user_id JOIN acces_invites a ON a.email = lower(u.email) WHERE hu.household_id = ? AND a.offert = 1 LIMIT 1").get(householdId);
}
export function synchroniserOffert(db, row) {
    const voulu = offertPourFoyer(db, row.id);
    if (voulu && row.abonnement_statut !== STATUT_OFFERT && !PAYANT.includes(row.abonnement_statut ?? "")) {
        appliquerAbonnement(db, row, { statut: STATUT_OFFERT, formule: "tribu", periode: null, fin: null });
        db.setModules(row.id, normaliser(PACKS.find((p) => p.id === "integral").modules));
    }
    else if (!voulu && row.abonnement_statut === STATUT_OFFERT) {
        db.setAbonnement(row.id, { stripe_customer_id: row.stripe_customer_id, stripe_subscription_id: row.stripe_subscription_id, abonnement_statut: null, abonnement_periode: null, formule: null, abonnement_fin: null, plan: "gratuit" });
        db.setModules(row.id, []);
    }
    else
        return row;
    return db.getHousehold(row.id);
}
/** May this address ask for a login link? */
export function accesAutorise(db, email) {
    if (!accesRestreint())
        return true;
    const e = email.trim().toLowerCase();
    if ((process.env.LUCIEN_ACCES_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).includes(e))
        return true;
    if (db.userByEmail(e))
        return true;
    return !!db.raw.prepare("SELECT 1 FROM acces_invites WHERE email = ?").get(e);
}
export const MESSAGE_FERME = () => "Lucien est en avant-première : l'accès se fait pour l'instant sur invitation. Laissez votre adresse sur la liste d'attente pour être prévenu(e) de l'ouverture.";
export function monterAcces(api, db) {
    ensureAccesSchema(db);
    const interdit = (c) => (adminOk(c.req.header("authorization")) ? null : c.json({ error: "interdit", message: "Code d'administration incorrect." }, 403));
    api.get("/admin/acces", (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const liste = db.raw.prepare("SELECT a.*, (SELECT COUNT(*) FROM users u WHERE lower(u.email) = a.email) AS inscrit FROM acces_invites a ORDER BY a.cree_le DESC").all();
        return c.json({ restreint: accesRestreint(), liste: liste.map((x) => ({ ...x, inscrit: x.inscrit > 0, offert: x.offert === 1 })) });
    });
    api.post("/admin/acces", async (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const b = z.object({ email: z.string().trim().toLowerCase(), prenom: z.string().trim().max(60).optional(), note: z.string().trim().max(200).optional(), envoyer_email: z.boolean().default(true), offert: z.boolean().optional() }).parse(await c.req.json());
        if (!emailValide(b.email))
            return c.json({ error: "email", message: "Adresse email invalide." }, 400);
        db.raw.prepare("INSERT INTO acces_invites (email, prenom, note, cree_le) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET prenom = excluded.prenom, note = excluded.note").run(b.email, b.prenom || null, b.note || null, new Date().toISOString());
        if (b.offert !== undefined) {
            db.raw.prepare("UPDATE acces_invites SET offert = ? WHERE email = ?").run(b.offert ? 1 : 0, b.email);
            const u = db.userByEmail(b.email);
            if (u)
                for (const h of db.householdsOfUser(u.id))
                    synchroniserOffert(db, h);
        }
        const envoye = b.envoyer_email ? await envoyerEmail({
            to: b.email, subject: "Vous êtes invité(e) à découvrir Lucien en avant-première",
            text: `Bonjour${b.prenom ? ` ${b.prenom}` : ""},\n\nVous faites partie des toutes premières personnes à essayer Lucien, le majordome qui pense à tout pour vous : vos papiers rangés, vos échéances rappelées à temps, votre budget plus léger.\n\nPour commencer, ouvrez ce lien et saisissez cette adresse email : ${publicUrl()}\n\nAstuce : sur votre téléphone, ajoutez Lucien à votre écran d'accueil pour l'ouvrir comme une appli.\n\nVotre avis compte énormément : dans Réglages, « Écrire à l'équipe Lucien », dites-nous ce qui vous plaît et ce qui coince.\n\nBenjamin, pour l'équipe Lucien`,
        }).catch(() => false) : false;
        return c.json({ ok: true, envoye }, 201);
    });
    /** A login link made by the admin, to open on the phone: no email needed (before Brevo, or when an email is lost). */
    api.post("/admin/acces/lien", async (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const b = z.object({ email: z.string().trim().toLowerCase() }).parse(await c.req.json());
        if (!emailValide(b.email))
            return c.json({ error: "email", message: "Adresse email invalide." }, 400);
        if (!accesAutorise(db, b.email))
            return c.json({ error: "sur_invitation", message: "Invitez d'abord cette adresse." }, 403);
        const token = db.createAuthLink(b.email, { ttlMinutes: 30 });
        return c.json({ lien: `${publicUrl()}/api/auth/lien?token=${token}`, valable_minutes: 30 });
    });
    /** Turns the « accès offert » on or off for an invitation; the household follows at once. */
    api.patch("/admin/acces/:email", async (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const email = decodeURIComponent(c.req.param("email")).toLowerCase();
        const b = z.object({ offert: z.boolean() }).parse(await c.req.json());
        const res = db.raw.prepare("UPDATE acces_invites SET offert = ? WHERE email = ?").run(b.offert ? 1 : 0, email);
        if (!res.changes)
            return c.json({ error: "introuvable", message: "Cette adresse n'est pas dans la liste." }, 404);
        const u = db.userByEmail(email);
        if (u)
            for (const h of db.householdsOfUser(u.id))
                synchroniserOffert(db, h);
        return c.json({ ok: true, offert: b.offert });
    });
    api.delete("/admin/acces/:email", (c) => {
        const r = interdit(c);
        if (r)
            return r;
        db.raw.prepare("DELETE FROM acces_invites WHERE email = ?").run(decodeURIComponent(c.req.param("email")).toLowerCase());
        return c.json({ ok: true });
    });
}
