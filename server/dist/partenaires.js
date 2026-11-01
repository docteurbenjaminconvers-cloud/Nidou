import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { envoyerEmail } from "./mail.js";
export function ensurePartenairesSchema(db) {
    db.raw.exec(`CREATE TABLE IF NOT EXISTS cabinets (
    code TEXT PRIMARY KEY, nom TEXT NOT NULL, email TEXT NOT NULL, ville TEXT, statut TEXT NOT NULL DEFAULT 'en_attente', cree_le TEXT NOT NULL
  )`);
    const cols = db.raw.prepare("PRAGMA table_info(households)").all().map((c) => c.name);
    if (!cols.includes("code_partenaire"))
        db.raw.exec("ALTER TABLE households ADD COLUMN code_partenaire TEXT");
}
/** Readable code: 4 letters of the cabinet's name + 4 random characters (no ambiguous ones). */
export function nouveauCode(nom) {
    const base = nom.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
    const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const r = randomBytes(4);
    return `${base}-${[...r].map((b) => alpha[b % alpha.length]).join("")}`;
}
export const cabinet = (db, code) => db.raw.prepare("SELECT * FROM cabinets WHERE code = ?").get(code.trim().toUpperCase());
export const cabinetValide = (db, code) => { const c = code ? cabinet(db, code) : undefined; return c?.statut === "valide" ? c : null; };
export const codePartenaire = (db, householdId) => db.raw.prepare("SELECT code_partenaire FROM households WHERE id = ?").get(householdId)?.code_partenaire ?? null;
/** Days of free trial a household's first paid subscription gets: 30 with a valid partner code, never twice. */
export function joursOfferts(db, h) {
    if (h.stripe_subscription_id || (h.abonnement_statut && h.abonnement_statut !== "simule"))
        return 0;
    return cabinetValide(db, codePartenaire(db, h.id)) ? 30 : 0;
}
export const adminOk = (header) => {
    const t = process.env.LUCIEN_ADMIN_TOKEN;
    if (!t || !header)
        return false;
    const a = Buffer.from(header.replace(/^Bearer\s+/i, "")), b = Buffer.from(t);
    return a.length === b.length && timingSafeEqual(a, b);
};
export function monterPartenaires(api, db, ctx) {
    ensurePartenairesSchema(db);
    /** Public: a cabinet asks to become a partner (validated by Lucien before its code works). */
    api.post("/partenaires", async (c) => {
        const b = z.object({ nom: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), ville: z.string().trim().max(80).optional() }).parse(await c.req.json());
        let code = nouveauCode(b.nom);
        while (cabinet(db, code))
            code = nouveauCode(b.nom);
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
        const h = db.getHousehold(ctx.household(c).id);
        if (b.code === null || b.code === "") {
            db.raw.prepare("UPDATE households SET code_partenaire = NULL WHERE id = ?").run(h.id);
            return c.json({ code: null, cabinet: null });
        }
        const cab = cabinetValide(db, b.code);
        if (!cab)
            return c.json({ error: "code_inconnu", message: "Ce code partenaire n'existe pas ou n'est pas encore actif." }, 400);
        if (h.stripe_subscription_id)
            return c.json({ error: "deja_abonne", message: "Le mois offert s'applique au premier abonnement : le vôtre est déjà en cours." }, 400);
        db.raw.prepare("UPDATE households SET code_partenaire = ? WHERE id = ?").run(cab.code, h.id);
        return c.json({ code: cab.code, cabinet: { nom: cab.nom, ville: cab.ville }, offert: "Premier mois offert à l'abonnement" });
    });
    // ---------- admin (Bearer LUCIEN_ADMIN_TOKEN): the page #/admin of the app ----------
    const interdit = (c) => (adminOk(c.req.header("authorization")) ? null : c.json({ error: "interdit", message: "Code d'administration incorrect." }, 403));
    const listeAdmin = () => db.raw.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM households h WHERE h.code_partenaire = c.code) AS clients,
      (SELECT COUNT(*) FROM households h WHERE h.code_partenaire = c.code AND h.abonnement_statut IN ('active', 'trialing', 'past_due', 'simule')) AS abonnes
    FROM cabinets c ORDER BY CASE c.statut WHEN 'en_attente' THEN 0 WHEN 'valide' THEN 1 ELSE 2 END, c.cree_le DESC`).all();
    const publicUrl = () => (process.env.LUCIEN_PUBLIC_URL ?? "https://monlucien.fr").replace(/\/$/, "");
    const emailCode = (cab) => envoyerEmail({ to: cab.email, subject: `Votre code partenaire Lucien : ${cab.code}`,
        text: `Bonjour,\n\nVotre cabinet ${cab.nom} est maintenant partenaire de Lucien. Votre code : ${cab.code}\n\nDonnez-le à vos clients : en le saisissant dans Lucien (Réglages, « Code de votre comptable »), ils bénéficient du premier mois offert à leur abonnement. Lorsqu'un client indépendant vous ouvre son dossier dans Lucien, vous recevez de sa part un lien de consultation en lecture seule : livre des recettes et des dépenses, rubriques de la 2035, échéances.\n\nPrésentation pour vos clients : ${publicUrl()}/#comptables\n\nPour toute question : bonjour@monlucien.fr\n\nL'équipe Lucien` }).catch(() => false);
    api.get("/admin/partenaires", (c) => interdit(c) ?? c.json(listeAdmin()));
    /** Summary for the admin page: cabinets, households who came through them, and the AI spend of the month. */
    api.get("/admin/resume", (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const l = listeAdmin();
        const foyers = db.raw.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN abonnement_statut IN ('active', 'trialing', 'past_due', 'simule') THEN 1 ELSE 0 END) AS abonnes FROM households").get();
        return c.json({
            cabinets: { en_attente: l.filter((x) => x.statut === "en_attente").length, valides: l.filter((x) => x.statut === "valide").length, refuses: l.filter((x) => x.statut === "refuse").length },
            via_cabinets: { foyers: l.reduce((s, x) => s + x.clients, 0), abonnes: l.reduce((s, x) => s + x.abonnes, 0) },
            foyers: { total: foyers.n, abonnes: foyers.abonnes ?? 0 },
            ia: db.iaDepenseMois(),
        });
    });
    /** A cabinet added by hand (met at a show, by phone…): validated at once. */
    api.post("/admin/partenaires", async (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const b = z.object({ nom: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), ville: z.string().trim().max(80).optional(), envoyer_email: z.boolean().default(true) }).parse(await c.req.json());
        let code = nouveauCode(b.nom);
        while (cabinet(db, code))
            code = nouveauCode(b.nom);
        db.raw.prepare("INSERT INTO cabinets (code, nom, email, ville, statut, cree_le) VALUES (?, ?, ?, ?, 'valide', ?)").run(code, b.nom, b.email.toLowerCase(), b.ville || null, new Date().toISOString());
        const cab = cabinet(db, code);
        const envoye = b.envoyer_email ? await emailCode(cab) : false;
        return c.json({ ...cab, envoye }, 201);
    });
    /** Validate, refuse or put back on hold; validating can email the code to the cabinet. */
    api.post("/admin/partenaires/:code", async (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const b = z.object({ statut: z.enum(["valide", "refuse", "en_attente"]), envoyer_email: z.boolean().default(false) }).parse(await c.req.json());
        const avant = cabinet(db, c.req.param("code"));
        if (!avant)
            return c.json({ error: "introuvable" }, 404);
        db.raw.prepare("UPDATE cabinets SET statut = ? WHERE code = ?").run(b.statut, avant.code);
        const cab = cabinet(db, avant.code);
        const envoye = b.statut === "valide" && b.envoyer_email ? await emailCode(cab) : false;
        return c.json({ ...cab, envoye });
    });
    api.patch("/admin/partenaires/:code", async (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const b = z.object({ nom: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(200).optional(), ville: z.string().trim().max(80).nullable().optional() }).parse(await c.req.json());
        const cab = cabinet(db, c.req.param("code"));
        if (!cab)
            return c.json({ error: "introuvable" }, 404);
        db.raw.prepare("UPDATE cabinets SET nom = ?, email = ?, ville = ? WHERE code = ?").run(b.nom ?? cab.nom, (b.email ?? cab.email).toLowerCase(), b.ville === undefined ? cab.ville : b.ville || null, cab.code);
        return c.json(cabinet(db, cab.code));
    });
    api.post("/admin/partenaires/:code/email", async (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const cab = cabinet(db, c.req.param("code"));
        if (!cab || cab.statut !== "valide")
            return c.json({ error: "statut", message: "Seul un cabinet validé reçoit son code." }, 409);
        return c.json({ envoye: await emailCode(cab) });
    });
    /** CSV for a spreadsheet (separator « ; », opens in Excel). */
    api.get("/admin/partenaires.csv", (c) => {
        const r = interdit(c);
        if (r)
            return r;
        const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
        const lignes = ["Code;Cabinet;Email;Ville;Statut;Inscrit le;Foyers;Abonnés", ...listeAdmin().map((x) => [x.code, x.nom, x.email, x.ville, x.statut, x.cree_le.slice(0, 10), x.clients, x.abonnes].map(q).join(";"))];
        return new Response("\ufeff" + lignes.join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="cabinets-partenaires.csv"', "cache-control": "no-store" } });
    });
}
