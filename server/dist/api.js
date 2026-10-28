import { Hono } from "hono";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractDocument, heuristicExtract } from "./extract.js";
import { deadlinesFor } from "./deadlines.js";
import { chargesReport } from "./charges.js";
import { generateLetter, templateLetter } from "./letters.js";
import { rappelsEssai, rappelsEcheances } from "./rappels.js";
import { envoyerPush, pushOn } from "./push.js";
import { appliquerAbonnement, creerCheckout, portail, resumeAbonnement, traiterWebhook } from "./abonnement.js";
import { AUTH_ON, COOKIE, consommerLien, cookieHeader, demanderLien, emailValide, readCookie } from "./auth.js";
import { familleReport, echeancesFamille } from "./famille.js";
import { boiteAddress, fromBrevo, processInboundEmail } from "./inbox.js";
import { parseStatement, merchantOf, categorise, ruleCategory, fingerprint, TX_CATEGORIES, TX_LABEL } from "./transactions.js";
import { budgetReport } from "./budget.js";
import { demoStatement } from "./seed-statement.js";
import Anthropic from "@anthropic-ai/sdk";
import { bridgeConfig, BridgeClient, syncHousehold, simulatedConnect, simulatedSync, verifyBridgeSignature } from "./bridge.js";
/**
 * Plans. Every household starts with a 15-day reverse trial of the full Famille plan, then falls back to a bare free plan:
 * documents are read locally (no AI call), no statement import, no bank connection, push notifications only.
 * The free AI quota is 0 by default; NIDOU_IA_LECTURES_GRATUIT lets a later experiment reopen a few AI readings per month,
 * still under the global monthly budget NIDOU_IA_PLAFOND_GRATUIT_EUR shared by all free households.
 */
export const FREE_LIMITS = {
    documents: 50,
    members: 2,
    lettersPerMonth: 3,
    iaLecturesParMois: Number(process.env.NIDOU_IA_LECTURES_GRATUIT ?? 0),
    importReleves: false,
    banque: false,
    notifications: "push",
};
export const TRIAL_DAYS = Number(process.env.NIDOU_ESSAI_JOURS ?? 15);
const freeCapEur = () => Number(process.env.NIDOU_IA_PLAFOND_GRATUIT_EUR ?? 2000);
export function createApi(db, opts) {
    const api = new Hono();
    const secure = () => (process.env.NIDOU_PUBLIC_URL ?? "").startsWith("https://");
    // ---------- auth (magic link) ----------
    api.post("/auth/demander", async (c) => {
        const body = z.object({ email: z.string() }).parse(await c.req.json());
        const email = body.email.trim().toLowerCase();
        if (!emailValide(email))
            return c.json({ error: "email", message: "Adresse email invalide." }, 400);
        const r = await demanderLien(db, email);
        return c.json({ ok: true, envoye: r.envoye, lien: r.lien });
    });
    api.get("/auth/lien", (c) => {
        const token = c.req.query("token") ?? "";
        const r = consommerLien(db, token, TRIAL_DAYS);
        if (!r.ok)
            return c.redirect(`/#/connexion?erreur=${r.raison}`);
        c.header("set-cookie", cookieHeader(r.session, secure()));
        return c.redirect("/#/home");
    });
    api.post("/auth/deconnexion", (c) => {
        const t = readCookie(c.req.header("cookie"), COOKIE);
        if (t)
            db.deleteSession(t);
        c.header("set-cookie", cookieHeader(null, secure()));
        return c.json({ ok: true });
    });
    /**
     * Household resolution. With accounts on (default), the session cookie gives the user and their household;
     * without a session every route answers 401 `non_connecte`. NIDOU_AUTH=0 keeps the single-household prototype.
     */
    api.use("*", async (c, next) => {
        if (c.req.path.includes("/auth/") || c.req.path.endsWith("/inbox") || c.req.path.endsWith("/bank/webhook") || c.req.path.endsWith("/bank/callback") || c.req.path.endsWith("/stripe/webhook") || c.req.path.endsWith("/abonnement/simule") || c.req.path.endsWith("/waitlist"))
            return next();
        let row;
        let user = null;
        if (AUTH_ON()) {
            const t = readCookie(c.req.header("cookie"), COOKIE);
            user = t ? db.userBySession(t) ?? null : null;
            if (!user)
                return c.json({ error: "non_connecte", message: "Connectez-vous pour ouvrir votre nid." }, 401);
            row = db.householdsOfUser(user.id)[0];
            if (!row) {
                row = db.createHousehold(user.prenom ? `Famille de ${user.prenom}` : "Ma famille", TRIAL_DAYS);
                db.addMember(row.id, user.prenom ?? "Moi", "adulte");
                db.joinHousehold(row.id, user.id, "proprietaire");
            }
        }
        else {
            row = db.firstHousehold();
            if (!row) {
                row = db.createHousehold("Ma famille", TRIAL_DAYS);
                db.addMember(row.id, "Moi", "adulte");
            }
        }
        // `plan` is the plan in force today (trial counts as Famille); `plan_souscrit` is what is paid for.
        c.set("household", { ...row, plan_souscrit: row.plan, plan: db.effectivePlan(row), essai_jours_restants: db.trialDaysLeft(row) });
        c.set("user", user);
        await next();
    });
    const household = (c) => c.get("household");
    const currentUser = (c) => c.get("user");
    const isOwner = (c) => { const u = currentUser(c); return !u || db.householdsOfUser(u.id).find((h) => h.id === household(c).id)?.role === "proprietaire"; };
    // ---------- foyer partagé (comptes) ----------
    api.get("/auth/moi", (c) => {
        const u = currentUser(c);
        return c.json({ user: u, auth: AUTH_ON(), foyers: u ? db.householdsOfUser(u.id).map((h) => ({ id: h.id, nom: h.nom, role: h.role })) : [] });
    });
    api.get("/foyer/comptes", (c) => {
        const h = household(c);
        return c.json({ comptes: db.usersOfHousehold(h.id).map((u) => ({ id: u.id, email: u.email, prenom: u.prenom, role: u.role, rejoint_le: u.rejoint_le })), invitations: db.listInvitations(h.id).map((i) => ({ token: i.token, email: i.email, prenom: i.prenom, expire_le: i.expire_le })) });
    });
    api.post("/invitations", async (c) => {
        const h = household(c);
        const body = z.object({ email: z.string(), prenom: z.string().nullable().default(null) }).parse(await c.req.json());
        const email = body.email.trim().toLowerCase();
        if (!emailValide(email))
            return c.json({ error: "email", message: "Adresse email invalide." }, 400);
        if (h.plan === "gratuit" && db.usersOfHousehold(h.id).length + db.listInvitations(h.id).length >= FREE_LIMITS.members) {
            return c.json({ error: "limite_plan", message: `Le plan gratuit est limité à ${FREE_LIMITS.members} comptes.` }, 402);
        }
        const u = currentUser(c);
        const r = await demanderLien(db, email, { household_id: h.id, prenom: body.prenom, invite_par: u?.prenom ?? db.listMembers(h.id)[0]?.prenom ?? null });
        return c.json({ ok: true, envoye: r.envoye, lien: r.lien }, 201);
    });
    api.delete("/invitations/:token", (c) => {
        const l = db.getAuthLink(c.req.param("token"));
        if (!l || l.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        db.deleteAuthLink(l.token);
        return c.json({ ok: true });
    });
    api.delete("/foyer/comptes/:user_id", (c) => {
        const h = household(c), u = currentUser(c);
        if (!isOwner(c))
            return c.json({ error: "proprietaire", message: "Seul le propriétaire du nid peut retirer un compte." }, 403);
        if (u && u.id === c.req.param("user_id"))
            return c.json({ error: "soi_meme", message: "Vous ne pouvez pas vous retirer vous-même." }, 400);
        db.leaveHousehold(h.id, c.req.param("user_id"));
        return c.json({ ok: true });
    });
    // ---------- abonnement (Stripe) ----------
    api.post("/abonnement/checkout", async (c) => {
        const h = household(c);
        const body = z.object({ periode: z.enum(["mensuel", "annuel"]) }).parse(await c.req.json());
        const r = await creerCheckout(db, db.getHousehold(h.id), body.periode, currentUser(c)?.email ?? null);
        return c.json(r);
    });
    api.post("/abonnement/portail", async (c) => {
        const url = await portail(db.getHousehold(household(c).id));
        return url ? c.json({ url }) : c.json({ error: "indisponible", message: "Le portail de facturation nécessite Stripe." }, 400);
    });
    /** Simulated checkout (no Stripe key): activates the plan right away. Never exposed when Stripe is configured. */
    api.get("/abonnement/simule", (c) => {
        if (process.env.STRIPE_SECRET_KEY)
            return c.json({ error: "stripe_actif" }, 400);
        const h = db.getHousehold(c.req.query("h") ?? "");
        const periode = c.req.query("periode") === "annuel" ? "annuel" : "mensuel";
        if (!h)
            return c.json({ error: "introuvable" }, 404);
        appliquerAbonnement(db, h, { statut: "simule", periode, fin: new Date(Date.now() + (periode === "annuel" ? 365 : 30) * 864e5).toISOString().slice(0, 10) });
        return c.redirect("/#/settings?paiement=ok");
    });
    api.post("/stripe/webhook", async (c) => {
        try {
            const r = await traiterWebhook(db, await c.req.text(), c.req.header("stripe-signature") ?? null);
            return c.json({ ok: true, r });
        }
        catch (e) {
            return c.json({ error: "webhook", message: e.message }, 400);
        }
    });
    api.post("/mcp/regenerer", (c) => {
        if (!isOwner(c))
            return c.json({ error: "proprietaire" }, 403);
        return c.json({ token: db.regenerateMcpToken(household(c).id) });
    });
    // ---------- household ----------
    api.get("/household", (c) => {
        const h = household(c);
        return c.json({
            ...h,
            membres: db.listMembers(h.id),
            documents: db.countDocuments(h.id),
            limites: h.plan === "gratuit" ? FREE_LIMITS : null,
            essai: h.plan_souscrit === "gratuit" && h.essai_fin ? { fin: h.essai_fin, jours_restants: h.essai_jours_restants, actif: (h.essai_jours_restants ?? 0) > 0 } : null,
            ia_lectures_utilisees: db.iaLecturesMois(h.id),
            ia_lectures_restantes: h.plan === "gratuit" ? Math.max(0, FREE_LIMITS.iaLecturesParMois - db.iaLecturesMois(h.id)) : null,
            ia_gratuit_en_pause: h.plan === "gratuit" && db.iaDepenseMois().gratuit_eur >= freeCapEur(),
            notifications: h.plan === "gratuit" ? "push" : "push+email",
            boite_email: h.plan === "famille" ? boiteAddress(db.getHousehold(h.id).boite_code) : null,
            mcp_token: h.plan === "famille" ? db.getHousehold(h.id).mcp_token : null,
            utilisateur: currentUser(c),
            abonnement: resumeAbonnement(db.getHousehold(h.id)),
            comptes: db.usersOfHousehold(h.id).length,
            boite_recus: db.listInboxMessages(h.id, 10),
        });
    });
    /**
     * Inbound email webhook (forwarding address). Protected by NIDOU_INBOX_SECRET (query `secret` or header `x-nidou-secret`).
     * Accepts the generic InboundEmail shape, an array of them, or Brevo's inbound-parsing payload ({ items: [...] }).
     */
    api.post("/inbox", async (c) => {
        const secret = process.env.NIDOU_INBOX_SECRET;
        if (secret && c.req.query("secret") !== secret && c.req.header("x-nidou-secret") !== secret)
            return c.json({ error: "non_autorise" }, 401);
        const body = await c.req.json();
        const generic = z.object({
            message_id: z.string().min(1), to: z.array(z.string()), from: z.string().nullable().default(null), subject: z.string().nullable().default(null),
            text: z.string().nullable().default(null), attachments: z.array(z.object({ nom: z.string(), mime: z.string(), base64: z.string() })).default([]),
        });
        const mails = Array.isArray(body) ? body.map((m) => generic.parse(m)) : body?.items ? await fromBrevo(body) : [generic.parse(body)];
        const resultats = [];
        for (const m of mails)
            resultats.push(await processInboundEmail(db, m, { plan: (hh) => db.effectivePlan(db.getHousehold(hh.id)) }));
        return c.json({ resultats: resultats.map((r) => (r.statut === "ok" ? { statut: "ok", documents: r.documents.length } : r)) });
    });
    api.patch("/household", async (c) => {
        const h = household(c);
        const body = z.object({ plan: z.enum(["gratuit", "famille"]).optional(), terminer_essai: z.boolean().optional(), nom: z.string().min(1).max(60).optional() }).parse(await c.req.json());
        if (body.plan)
            db.setPlan(h.id, body.plan);
        if (body.nom)
            db.renameHousehold(h.id, body.nom);
        if (body.terminer_essai)
            db.setTrialEnd(h.id, new Date(0).toISOString());
        return c.json({ ok: true });
    });
    const memberSchema = z.object({
        prenom: z.string().min(1), role: z.enum(["adulte", "enfant", "parent_a_charge", "autre_a_charge"]).default("adulte"),
        date_naissance: z.string().nullable().optional(), etablissement: z.string().nullable().optional(), classe: z.string().nullable().optional(),
        cantine_jours: z.string().nullable().optional(), cantine_cout_mois: z.number().nullable().optional(), notes: z.string().nullable().optional(),
    });
    api.post("/members", async (c) => {
        const h = household(c);
        const body = memberSchema.parse(await c.req.json());
        if (h.plan === "gratuit" && db.listMembers(h.id).length >= FREE_LIMITS.members) {
            return c.json({ error: "limite_plan", message: `Le plan gratuit est limité à ${FREE_LIMITS.members} membres.` }, 402);
        }
        const { prenom, role, ...extra } = body;
        return c.json(db.addMember(h.id, prenom, role, extra), 201);
    });
    api.patch("/members/:id", async (c) => {
        const m = db.getMember(c.req.param("id"));
        if (!m || m.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        db.updateMember(m.id, memberSchema.partial().parse(await c.req.json()));
        return c.json(db.getMember(m.id));
    });
    api.delete("/members/:id", (c) => {
        const m = db.getMember(c.req.param("id"));
        if (!m || m.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        db.deleteMember(m.id);
        return c.json({ ok: true });
    });
    // ---------- organisation familiale ----------
    api.get("/famille", (c) => {
        const h = household(c);
        return c.json(familleReport(db.getHousehold(h.id), db.listMembers(h.id), db.listActivites(h.id), db.familleFaits(h.id)));
    });
    api.patch("/famille", async (c) => {
        const h = household(c);
        const body = z.object({ situation: z.enum(["seul", "couple"]).nullable() }).parse(await c.req.json());
        db.setSituation(h.id, body.situation);
        return c.json({ ok: true });
    });
    const activiteSchema = z.object({
        member_id: z.string().nullable().default(null), titre: z.string().min(1), type: z.string().default("autre"),
        jour: z.number().int().min(1).max(7).nullable().default(null), heure_debut: z.string().nullable().default(null), heure_fin: z.string().nullable().default(null),
        lieu: z.string().nullable().default(null), cout_mois: z.number().nullable().default(null), date_debut: z.string().nullable().default(null), date_fin: z.string().nullable().default(null), note: z.string().nullable().default(null),
    });
    api.post("/activites", async (c) => {
        const h = household(c);
        const body = activiteSchema.parse(await c.req.json());
        return c.json(db.insertActivite({ household_id: h.id, ...body }), 201);
    });
    api.patch("/activites/:id", async (c) => {
        const a = db.getActivite(c.req.param("id"));
        if (!a || a.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        db.updateActivite(a.id, activiteSchema.partial().parse(await c.req.json()));
        return c.json(db.getActivite(a.id));
    });
    api.delete("/activites/:id", (c) => {
        const a = db.getActivite(c.req.param("id"));
        if (!a || a.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        db.deleteActivite(a.id);
        return c.json({ ok: true });
    });
    // ---------- documents ----------
    api.get("/documents", (c) => {
        const h = household(c);
        return c.json(db.listDocuments(h.id, { category: c.req.query("category"), q: c.req.query("q") }).map(publicDoc));
    });
    api.get("/documents/:id", (c) => {
        const d = db.getDocument(c.req.param("id"));
        if (!d || d.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        return c.json({ ...publicDoc(d), texte: d.texte, echeances: db.listDeadlines(d.household_id, { includeDone: true }).filter((x) => x.document_id === d.id) });
    });
    /**
     * Upload: multipart (file + optional texte) or JSON { texte, nomFichier }.
     * Runs extraction, stores the document, derives deadlines.
     */
    api.post("/documents", async (c) => {
        const h = household(c);
        if (h.plan === "gratuit" && db.countDocuments(h.id) >= FREE_LIMITS.documents) {
            return c.json({ error: "limite_plan", message: `Le plan gratuit est limité à ${FREE_LIMITS.documents} documents.` }, 402);
        }
        let texte, base64, mime, nomFichier;
        let fichier = null;
        const ct = c.req.header("content-type") ?? "";
        if (ct.includes("multipart/form-data")) {
            const form = await c.req.formData();
            const f = form.get("file");
            texte = form.get("texte") ?? undefined;
            if (f instanceof File) {
                nomFichier = f.name;
                mime = f.type || "application/octet-stream";
                const buf = Buffer.from(await f.arrayBuffer());
                if (buf.length > 15 * 1024 * 1024)
                    return c.json({ error: "fichier_trop_gros" }, 413);
                base64 = buf.toString("base64");
                await mkdir(opts.uploadDir, { recursive: true });
                fichier = `${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
                await writeFile(join(opts.uploadDir, fichier), buf);
                if (mime.startsWith("text/"))
                    texte = texte ?? buf.toString("utf8");
            }
        }
        else {
            const body = z.object({ texte: z.string().min(1), nomFichier: z.string().optional() }).parse(await c.req.json());
            texte = body.texte;
            nomFichier = body.nomFichier;
        }
        // Free plan: local reading only (no AI call), unless a free quota is configured and the global free budget is not exhausted.
        const gratuit = h.plan === "gratuit";
        const quotaOk = !gratuit || db.iaLecturesMois(h.id) < FREE_LIMITS.iaLecturesParMois;
        const capOk = !gratuit || db.iaDepenseMois().gratuit_eur < freeCapEur();
        const iaAutorisee = quotaOk && capOk;
        const ex = iaAutorisee ? await extractDocument({ texte, base64, mime, nomFichier }) : { ...heuristicExtract({ texte, nomFichier }), modele: null };
        if (ex.modele)
            db.recordIaLecture(h.id, gratuit, ex.modele.cout_lecture_centimes);
        if (!iaAutorisee) {
            ex.resume = FREE_LIMITS.iaLecturesParMois === 0
                ? "Plan gratuit : document lu localement, sans IA. Vérifiez et complétez les champs. Le plan Famille lit chaque document avec l'IA."
                : !capOk
                    ? "Les lectures par l'IA du plan gratuit sont en pause jusqu'au mois prochain : vérifiez les champs lus localement. Le plan Famille n'a pas cette limite."
                    : "Quota mensuel de lectures IA du plan gratuit atteint : vérifiez les champs lus localement. Le plan Famille lit chaque document avec l'IA.";
        }
        const doc = db.insertDocument({
            household_id: h.id,
            member_id: null,
            title: ex.title,
            category: ex.category,
            organisme: ex.organisme,
            numero_contrat: ex.numero_contrat,
            montant: ex.montant,
            periodicite: ex.periodicite,
            date_document: ex.date_document,
            date_debut: ex.date_debut,
            date_fin: ex.date_fin,
            preavis_jours: ex.preavis_jours,
            resume: ex.resume,
            texte: texte ?? null,
            fichier,
            mime: mime ?? (texte ? "text/plain" : null),
            confiance: ex.confiance,
        });
        db.replaceDeadlinesForDocument(doc.id, h.id, deadlinesFor(doc));
        return c.json({ ...publicDoc(doc), echeances: db.listDeadlines(h.id).filter((x) => x.document_id === doc.id) }, 201);
    });
    api.patch("/documents/:id", async (c) => {
        const d = db.getDocument(c.req.param("id"));
        if (!d || d.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        const patch = z
            .object({
            title: z.string().min(1).optional(),
            category: z.string().optional(),
            organisme: z.string().nullable().optional(),
            numero_contrat: z.string().nullable().optional(),
            montant: z.number().nullable().optional(),
            periodicite: z.enum(["mensuel", "trimestriel", "annuel", "unique"]).nullable().optional(),
            date_document: z.string().nullable().optional(),
            date_debut: z.string().nullable().optional(),
            date_fin: z.string().nullable().optional(),
            preavis_jours: z.number().int().nullable().optional(),
            member_id: z.string().nullable().optional(),
            verifie: z.number().int().min(0).max(1).optional(),
        })
            .parse(await c.req.json());
        db.updateDocument(d.id, patch);
        const updated = db.getDocument(d.id);
        db.replaceDeadlinesForDocument(updated.id, updated.household_id, deadlinesFor(updated));
        return c.json(publicDoc(updated));
    });
    api.delete("/documents/:id", (c) => {
        const d = db.getDocument(c.req.param("id"));
        if (!d || d.household_id !== household(c).id)
            return c.json({ error: "introuvable" }, 404);
        db.deleteDocument(d.id);
        return c.json({ ok: true });
    });
    // ---------- deadlines ----------
    /** Stored deadlines (from documents) merged with the computed family ones (anniversaries, aides, réinscriptions…). */
    api.get("/deadlines", (c) => {
        const h = household(c);
        const from = c.req.query("from"), to = c.req.query("to"), done = c.req.query("done") === "1";
        const faits = db.familleFaits(h.id);
        const fam = echeancesFamille(db.getHousehold(h.id), db.listMembers(h.id), db.listActivites(h.id))
            .map((e) => ({ id: `f:${e.cle}`, household_id: h.id, document_id: null, titre: e.titre, type: e.type, date: e.date, rappel_jours: e.rappel_jours, fait: faits.has(e.cle) ? 1 : 0, note: e.note, member_id: e.member_id }))
            .filter((e) => (done || !e.fait) && (!from || e.date >= from) && (!to || e.date <= to));
        const all = [...db.listDeadlines(h.id, { from, to, includeDone: done }), ...fam].sort((a, b) => a.date.localeCompare(b.date));
        return c.json(all);
    });
    api.post("/deadlines", async (c) => {
        const h = household(c);
        const body = z
            .object({ titre: z.string().min(1), date: z.string(), type: z.string().default("echeance"), rappel_jours: z.number().int().default(7), note: z.string().nullable().default(null), document_id: z.string().nullable().default(null) })
            .parse(await c.req.json());
        return c.json(db.insertDeadline({ household_id: h.id, ...body }), 201);
    });
    api.patch("/deadlines/:id", async (c) => {
        const body = z.object({ fait: z.boolean() }).parse(await c.req.json());
        const id = c.req.param("id");
        if (id.startsWith("f:"))
            db.marquerFamilleFait(household(c).id, id.slice(2), body.fait);
        else
            db.setDeadlineDone(id, body.fait);
        return c.json({ ok: true });
    });
    // ---------- charges fixes ----------
    api.get("/charges", (c) => {
        const h = household(c);
        const report = chargesReport(db.listDocuments(h.id));
        if (h.plan === "gratuit") {
            // Free plan: totals and the first alert only; full detail is a paid feature.
            return c.json({ ...report, alertes: report.alertes.slice(0, 1), apercu: true, alertes_total: report.alertes.length });
        }
        return c.json({ ...report, apercu: false, alertes_total: report.alertes.length });
    });
    // ---------- courriers ----------
    api.post("/letters", async (c) => {
        const h = household(c);
        const body = z
            .object({ document_id: z.string(), kind: z.enum(["resiliation", "reclamation", "remboursement"]), nom: z.string().min(1), adresse: z.string().optional(), motif: z.string().optional() })
            .parse(await c.req.json());
        const doc = db.getDocument(body.document_id);
        if (!doc || doc.household_id !== h.id)
            return c.json({ error: "introuvable" }, 404);
        const texte = h.plan === "gratuit"
            ? templateLetter({ kind: body.kind, doc, expediteur: { nom: body.nom, adresse: body.adresse }, motif: body.motif })
            : await generateLetter({ kind: body.kind, doc, expediteur: { nom: body.nom, adresse: body.adresse }, motif: body.motif });
        return c.json({ texte });
    });
    // ---------- dépenses (relevés bancaires) ----------
    api.get("/budget", (c) => {
        const h = household(c);
        const txs = db.listTransactions(h.id);
        const report = budgetReport(txs, db.listDocuments(h.id), db.listDecisions(h.id));
        if (h.plan === "gratuit") {
            // Free plan: the headline numbers and the two best actions.
            return c.json({ ...report, actions: report.actions.slice(0, 2), actions_total: report.actions.length, apercu: true });
        }
        return c.json({ ...report, actions_total: report.actions.length, apercu: false });
    });
    api.get("/transactions", (c) => {
        const h = household(c);
        return c.json(db.listTransactions(h.id, { from: c.req.query("from"), to: c.req.query("to") }).slice(0, 500));
    });
    api.patch("/transactions/:id", async (c) => {
        const body = z.object({ categorie: z.enum(TX_CATEGORIES) }).parse(await c.req.json());
        db.updateTransactionCategory(c.req.param("id"), body.categorie);
        return c.json({ ok: true });
    });
    /** Import a statement: multipart file (CSV, TXT, PDF) or JSON { texte, compte } ; { demo: true } loads the sample. */
    api.post("/transactions/import", async (c) => {
        const h = household(c);
        if (h.plan === "gratuit" && !FREE_LIMITS.importReleves) {
            return c.json({ error: "limite_plan", message: "L'import de relevés et l'analyse des dépenses font partie du plan Famille. Vos opérations déjà importées restent consultables." }, 402);
        }
        let text = "", compte = null;
        const ct = c.req.header("content-type") ?? "";
        if (ct.includes("multipart/form-data")) {
            const form = await c.req.formData();
            const f = form.get("file");
            compte = form.get("compte") || null;
            if (f instanceof File) {
                const buf = Buffer.from(await f.arrayBuffer());
                if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
                    if (!process.env.ANTHROPIC_API_KEY)
                        return c.json({ error: "pdf_sans_ia", message: "La lecture des relevés PDF nécessite la clé API Anthropic. Exportez le relevé en CSV depuis votre banque." }, 400);
                    text = await pdfStatementToCsv(buf);
                }
                else
                    text = buf.toString("utf8");
            }
        }
        else {
            const body = z.object({ texte: z.string().optional(), compte: z.string().optional(), demo: z.boolean().optional() }).parse(await c.req.json());
            text = body.demo ? demoStatement() : body.texte ?? "";
            compte = body.compte ?? (body.demo ? "Compte joint (démo)" : null);
        }
        const parsed = parseStatement(text, compte);
        if (parsed.length === 0)
            return c.json({ error: "format", message: "Aucune ligne reconnue. Format attendu : une ligne par opération avec date, libellé et montant (CSV de votre banque)." }, 400);
        const cats = h.plan === "gratuit" ? parsed.map((t) => ruleCategory(t.libelle, t.montant) ?? "autre") : await categorise(parsed);
        const added = db.insertTransactions(parsed.map((t, i) => ({
            household_id: h.id, compte: t.compte, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i], empreinte: fingerprint(h.id, t),
        })));
        return c.json({ lues: parsed.length, ajoutees: added, doublons: parsed.length - added, de: parsed.map((t) => t.date).sort()[0], a: parsed.map((t) => t.date).sort().at(-1) }, 201);
    });
    api.post("/budget/decision", async (c) => {
        const h = household(c);
        const body = z.object({ cle: z.string(), decision: z.enum(["garde", "resilie", "a_faire"]) }).parse(await c.req.json());
        db.setDecision(h.id, body.cle, body.decision);
        return c.json({ ok: true });
    });
    api.get("/budget/categories", (c) => c.json(TX_CATEGORIES.map((k) => ({ cle: k, libelle: TX_LABEL[k] }))));
    // ---------- connexion bancaire (Bridge) ----------
    const bridge = () => { const cfg = bridgeConfig(); return cfg ? { cfg, client: new BridgeClient(cfg) } : null; };
    api.get("/bank/status", (c) => {
        const h = household(c);
        const link = db.getBankLink(h.id);
        return c.json({
            fournisseur: bridge() ? "bridge" : "simule",
            connecte: link?.statut === "connecte",
            statut: link?.statut ?? "aucune",
            derniere_synchro: link?.derniere_synchro ?? null,
            comptes: db.listBankAccounts(h.id).map((a) => ({ id: a.id, nom: a.nom, banque: a.banque, solde: a.solde, devise: a.devise, maj_le: a.maj_le })),
        });
    });
    /** Starts the Connect flow: returns the URL where the family picks its bank. */
    api.post("/bank/connect", async (c) => {
        const h = household(c);
        if (h.plan === "gratuit")
            return c.json({ error: "limite_plan", message: "La connexion bancaire automatique fait partie du plan Famille." }, 402);
        const b = bridge();
        if (!b)
            return c.json(await simulatedConnect(db, h.id));
        const body = z.object({ email: z.string().email() }).parse(await c.req.json().catch(() => ({})));
        let userUuid = db.getBankLink(h.id)?.user_uuid;
        if (!userUuid) {
            const externalId = `nidou-${h.id}`;
            const user = await b.client.createUser(externalId);
            userUuid = user.uuid;
            db.upsertBankLink({ household_id: h.id, fournisseur: "bridge", user_uuid: userUuid, external_user_id: externalId, derniere_synchro: null, curseur: null, statut: "en_attente" });
        }
        const { access_token } = await b.client.userToken(userUuid);
        const session = await b.client.connectSession(access_token, body.email, h.id);
        return c.json({ url: session.url });
    });
    /** Bridge redirects here at the end of Connect; we sync and send the family back into the app. */
    api.get("/bank/callback", async (c) => {
        const userUuid = c.req.query("user_uuid");
        const success = c.req.query("success") === "true";
        const link = userUuid ? db.getBankLinkByUser(userUuid) : undefined;
        if (link && success) {
            try {
                const b = bridge();
                if (b)
                    await syncHousehold(db, b.client, link.household_id);
                else
                    await simulatedSync(db, link.household_id);
            }
            catch (e) {
                db.upsertBankLink({ ...link, statut: "erreur" });
                console.error("sync après connect :", e);
            }
        }
        return c.redirect(`/#budget${success ? "" : "?bank=abandon"}`);
    });
    api.post("/bank/sync", async (c) => {
        const h = household(c);
        const b = bridge();
        try {
            return c.json(b ? await syncHousehold(db, b.client, h.id) : await simulatedSync(db, h.id));
        }
        catch (e) {
            return c.json({ error: "synchro", message: e instanceof Error ? e.message : "Synchronisation impossible" }, 502);
        }
    });
    api.delete("/bank", (c) => {
        db.deleteBankLink(household(c).id);
        return c.json({ ok: true });
    });
    /** Bridge webhook: `item.refreshed` (and friends) → sync that user's household. Signed with BridgeApi-Signature. */
    api.post("/bank/webhook", async (c) => {
        const raw = await c.req.text();
        const b = bridge();
        const secrets = [b?.cfg.webhookSecret ?? "", process.env.BRIDGE_WEBHOOK_SECRET_PREVIOUS ?? ""];
        if (b && !verifyBridgeSignature(raw, c.req.header("BridgeApi-Signature"), secrets))
            return c.json({ error: "signature" }, 401);
        let evt = {};
        try {
            evt = JSON.parse(raw);
        }
        catch {
            return c.json({ error: "json" }, 400);
        }
        const type = String(evt.type ?? "");
        const userUuid = evt.content?.user_uuid;
        if (["item.refreshed", "item.created", "item.account.updated", "item.account.created"].includes(type) && userUuid) {
            const link = db.getBankLinkByUser(String(userUuid));
            if (link && b) {
                // Respond fast, sync in the background (Bridge retries slow endpoints).
                syncHousehold(db, b.client, link.household_id).catch((e) => console.error("webhook sync :", e));
            }
        }
        return c.json({ ok: true });
    });
    /** IA spend this month (free vs paid) and the free cap: what an admin dashboard will show. */
    // Reminders already sent to this household (trial reminders) and the ones due today, for the app's feed and for debugging.
    api.get("/rappels", (c) => {
        const h = household(c);
        const row = db.getHousehold(h.id);
        return c.json({ envoyes: db.listRappels(h.id), dus: [...rappelsEssai(db, row), ...rappelsEcheances(db, row)] });
    });
    // ---------- push (Web Push / VAPID) ----------
    api.get("/push/cle", (c) => c.json({ actif: pushOn(), cle: process.env.VAPID_PUBLIC_KEY ?? null, appareils: db.listPushSubscriptions(household(c).id).length }));
    api.post("/push/abonner", async (c) => {
        const h = household(c);
        const body = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }), appareil: z.string().nullable().default(null) }).parse(await c.req.json());
        db.savePushSubscription({ household_id: h.id, user_id: currentUser(c)?.id ?? null, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, appareil: body.appareil });
        return c.json({ ok: true, appareils: db.listPushSubscriptions(h.id).length }, 201);
    });
    api.delete("/push/abonner", async (c) => {
        const body = z.object({ endpoint: z.string() }).parse(await c.req.json());
        db.deletePushSubscription(body.endpoint);
        return c.json({ ok: true });
    });
    /** Sends a test notification to this household's devices. */
    api.post("/push/test", async (c) => {
        const h = household(c);
        const n = await envoyerPush(db, h.id, { titre: "Nidou est prêt", corps: "Vous recevrez ici vos rappels d'échéances et vos économies.", url: "/#/notifs", tag: "test" });
        return c.json({ ok: true, envoyes: n, actif: pushOn() });
    });
    api.get("/ia/depense", (c) => c.json({ ...db.iaDepenseMois(), plafond_gratuit_eur: freeCapEur(), fournisseur: process.env.NIDOU_IA_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.MISTRAL_API_KEY ? "mistral" : "aucun") }));
    // ---------- MCP access log ----------
    api.get("/mcp/log", (c) => c.json(db.listMcpAccess(household(c).id)));
    return api;
}
export function publicDoc(d) {
    const { texte, ...rest } = d;
    return rest;
}
/** Reads a PDF bank statement with Claude and returns it as CSV lines (date;libellé;montant). */
async function pdfStatementToCsv(buf) {
    const client = new Anthropic();
    const res = await client.messages.create({
        model: process.env.NIDOU_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 8000,
        system: "Tu convertis un relevé bancaire en CSV. Une ligne par opération : date au format JJ/MM/AAAA;libellé complet;montant signé (négatif pour un débit, virgule décimale). Première ligne : Date;Libellé;Montant. Aucun autre texte.",
        messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }, { type: "text", text: "Convertis ce relevé." }] }],
    });
    const t = res.content.find((b) => b.type === "text");
    return t && t.type === "text" ? t.text : "";
}
