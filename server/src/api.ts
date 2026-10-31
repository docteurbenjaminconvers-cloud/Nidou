import { Hono } from "hono";
import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Db, DocumentRow, HouseholdRow } from "./db.js";
import { extractDocument, heuristicExtract } from "./extract.js";
import { deadlinesFor } from "./deadlines.js";
import { chargesReport, lignesFamille } from "./charges.js";
import { generateLetter, templateLetter } from "./letters.js";
import { rappelsEssai, rappelsEcheances } from "./rappels.js";
import * as V from "./veille.js";
import { ajouterVeillePayante, basculerAssistant } from "./abonnement.js";
import { AssistantErreur, ensureAssistantSchema, etatAssistant, repondre } from "./assistant.js";
import { bridge, eb, fournisseur, notifierAlertes, synchroniserFoyer, synchroniserVeille } from "./banques.js";
import { banquesFR, BANQUES_DEMO, ebConnectHousehold, ebFinishHousehold, ensureEbSchema, linkExtra, newState } from "./enablebanking.js";
import { envoyerEmail } from "./mail.js";
import { envoyerPush, pushOn } from "./push.js";
import { appliquerAbonnement, capaciteComptes, creerCheckout, FORMULES, portail, resumeAbonnement, traiterWebhook, type Formule } from "./abonnement.js";
import { pointDuFoyer } from "./hebdo.js";
import { bordereau, etatDossiers, etatKit, KITS } from "./dossiers.js";
import { zip } from "./zip.js";
import { agendaIcs } from "./ics.js";

import { AUTH_ON, consommerLien, cookieHeader, demanderLien, emailValide, sessionToken } from "./auth.js";
import { agendaSemaine, familleReport, echeancesFamille, JOURS, coutsParMembre } from "./famille.js";
import { boiteAddress, fromBrevo, processInboundEmail, type InboundEmail } from "./inbox.js";
import { parseStatement, merchantOf, categorise, ruleCategory, fingerprint, TX_CATEGORIES, TX_LABEL, type ParsedTx } from "./transactions.js";
import { budgetReport } from "./budget.js";
import { demoStatement } from "./seed-statement.js";
import Anthropic from "@anthropic-ai/sdk";
import { simulatedConnect, simulatedSync, verifyBridgeSignature } from "./bridge.js";


/**
 * Plans. Every household starts with a 15-day reverse trial of the full Famille plan, then falls back to a bare free plan:
 * documents are read locally (no AI call), no statement import, no bank connection, push notifications only.
 * The free AI quota is 0 by default; LUCIEN_IA_LECTURES_GRATUIT lets a later experiment reopen a few AI readings per month,
 * still under the global monthly budget LUCIEN_IA_PLAFOND_GRATUIT_EUR shared by all free households.
 */
export const FREE_LIMITS = {
  documents: 50,
  comptes: 1,      // people who log in; member cards without a login (children, elderly parent) are unlimited on every plan
  lettersPerMonth: 3,
  iaLecturesParMois: Number(process.env.LUCIEN_IA_LECTURES_GRATUIT ?? 0),
  importReleves: false,
  banque: false,
  notifications: "push" as const,
};
export const TRIAL_DAYS = Number(process.env.LUCIEN_ESSAI_JOURS ?? 15);
const freeCapEur = () => Number(process.env.LUCIEN_IA_PLAFOND_GRATUIT_EUR ?? 2000);

export function createApi(db: Db, opts: { uploadDir: string }) {
  const api = new Hono();
  V.ensureVeilleSchema(db);
  ensureAssistantSchema(db);
  ensureEbSchema(db);

  const secure = () => (process.env.LUCIEN_PUBLIC_URL ?? "").startsWith("https://");

  // ---------- auth (magic link) ----------
  api.post("/auth/demander", async (c) => {
    const body = z.object({ email: z.string() }).parse(await c.req.json());
    const email = body.email.trim().toLowerCase();
    if (!emailValide(email)) return c.json({ error: "email", message: "Adresse email invalide." }, 400);
    const r = await demanderLien(db, email);
    return c.json({ ok: true, envoye: r.envoye, lien: r.lien });
  });

  api.get("/auth/lien", (c) => {
    const token = c.req.query("token") ?? "";
    const r = consommerLien(db, token, TRIAL_DAYS);
    if (!r.ok) return c.redirect(`/#/connexion?erreur=${r.raison}`);
    c.header("set-cookie", cookieHeader(r.session, secure()));
    return c.redirect("/#/home");
  });

  api.post("/auth/deconnexion", (c) => {
    const t = sessionToken(c.req.header("cookie"));
    if (t) db.deleteSession(t);
    c.header("set-cookie", cookieHeader(null, secure()));
    return c.json({ ok: true });
  });

  /**
   * Household resolution. With accounts on (default), the session cookie gives the user and their household;
   * without a session every route answers 401 `non_connecte`. LUCIEN_AUTH=0 keeps the single-household prototype.
   */
  api.use("*", async (c, next) => {
    if (c.req.path.includes("/auth/") || c.req.path.endsWith("/inbox") || c.req.path.endsWith("/bank/webhook") || c.req.path.endsWith("/bank/callback") || c.req.path.endsWith("/bank/eb/callback") || c.req.path.endsWith("/stripe/webhook") || c.req.path.endsWith("/abonnement/simule") || c.req.path.endsWith("/waitlist") || c.req.path.includes("/veille/p/") || /\/agenda\/[^/]+\.ics$/.test(c.req.path) || c.req.path.endsWith("/veille/callback")) return next();
    let row;
    let user = null as { id: string; email: string; prenom: string | null } | null;
    if (AUTH_ON()) {
      const t = sessionToken(c.req.header("cookie"));
      user = t ? db.userBySession(t) ?? null : null;
      if (!user) return c.json({ error: "non_connecte", message: "Connectez-vous pour ouvrir votre espace." }, 401);
      row = db.householdsOfUser(user.id)[0];
      if (!row) {
        row = db.createHousehold(user.prenom ? `Famille de ${user.prenom}` : "Ma famille", TRIAL_DAYS);
        db.addMember(row.id, user.prenom ?? "Moi", "adulte");
        db.joinHousehold(row.id, user.id, "proprietaire");
      }
    } else {
      row = db.firstHousehold();
      if (!row) {
        row = db.createHousehold("Ma famille", TRIAL_DAYS);
        db.addMember(row.id, "Moi", "adulte");
      }
    }
    // Accounts beyond the formule's capacity are paused (owner first, then by join date); the owner always keeps access.
    if (user) {
      const ordre = db.usersOfHousehold(row.id).sort((a, b) => Number(b.role === "proprietaire") - Number(a.role === "proprietaire") || a.rejoint_le.localeCompare(b.rejoint_le));
      const rang = ordre.findIndex((u) => u.id === user!.id);
      const cap = capaciteComptes(db, row);
      if (rang >= cap && !c.req.path.endsWith("/auth/moi") && !c.req.path.endsWith("/auth/deconnexion")) {
        const proprio = ordre[0];
        return c.json({ error: "compte_en_pause", message: `Le foyer « ${row.nom} » est en formule ${cap === 1 ? "gratuite (1 personne)" : `${cap} personnes`}. ${proprio?.prenom ?? "Le propriétaire"} peut passer à une formule plus grande pour vous rendre l'accès ; vos papiers vous attendent.` }, 402);
      }
    }
    // `plan` is the plan in force today (trial counts as Famille); `plan_souscrit` is what is paid for.
    c.set("household" as never, { ...row, plan_souscrit: row.plan, plan: db.effectivePlan(row), essai_jours_restants: db.trialDaysLeft(row) } as never);
    c.set("user" as never, user as never);
    await next();
  });

  const household = (c: any) => c.get("household") as { id: string; nom: string; plan: "gratuit" | "famille"; plan_souscrit: "gratuit" | "famille"; essai_fin: string | null; essai_jours_restants: number | null };
  const currentUser = (c: any) => c.get("user") as { id: string; email: string; prenom: string | null } | null;
  const isOwner = (c: any) => { const u = currentUser(c); return !u || db.householdsOfUser(u.id).find((h) => h.id === household(c).id)?.role === "proprietaire"; };

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
    if (!emailValide(email)) return c.json({ error: "email", message: "Adresse email invalide." }, 400);
    const cap = capaciteComptes(db, db.getHousehold(h.id)!);
    if (db.usersOfHousehold(h.id).length + db.listInvitations(h.id).length >= cap) {
      const msg = h.plan === "gratuit"
        ? "Le plan gratuit est réservé à une personne. Avec Duo, votre conjoint·e se connecte aussi ; avec Tribu, jusqu'à 6 personnes."
        : cap < FORMULES.tribu.comptes
          ? `Votre formule accepte ${cap} personne${cap > 1 ? "s" : ""} connectée${cap > 1 ? "s" : ""}. Passez à ${cap === 1 ? "Duo ou Tribu" : "Tribu"} pour en inviter plus.`
          : `La formule Tribu accepte jusqu'à ${cap} personnes connectées.`;
      return c.json({ error: "limite_comptes", message: msg, capacite: cap }, 402);
    }
    const u = currentUser(c);
    const r = await demanderLien(db, email, { household_id: h.id, prenom: body.prenom, invite_par: u?.prenom ?? db.listMembers(h.id)[0]?.prenom ?? null });
    return c.json({ ok: true, envoye: r.envoye, lien: r.lien }, 201);
  });

  api.delete("/invitations/:token", (c) => {
    const l = db.getAuthLink(c.req.param("token"));
    if (!l || l.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
    db.deleteAuthLink(l.token);
    return c.json({ ok: true });
  });

  api.delete("/foyer/comptes/:user_id", (c) => {
    const h = household(c), u = currentUser(c);
    if (!isOwner(c)) return c.json({ error: "proprietaire", message: "Seul le propriétaire du foyer peut retirer un compte." }, 403);
    if (u && u.id === c.req.param("user_id")) return c.json({ error: "soi_meme", message: "Vous ne pouvez pas vous retirer vous-même." }, 400);
    db.leaveHousehold(h.id, c.req.param("user_id"));
    return c.json({ ok: true });
  });

  // ---------- abonnement (Stripe) ----------
  api.post("/abonnement/checkout", async (c) => {
    const h = household(c);
    const body = z.object({ formule: z.enum(["solo", "duo", "tribu"]).default("duo"), periode: z.enum(["mensuel", "annuel"]) }).parse(await c.req.json());
    const comptes = db.usersOfHousehold(h.id).length;
    if (comptes > FORMULES[body.formule].comptes) {
      return c.json({ error: "formule_trop_petite", message: `${comptes} personnes se connectent à ce foyer : la formule ${FORMULES[body.formule].nom} en accepte ${FORMULES[body.formule].comptes}. Choisissez une formule plus grande ou retirez un compte.` }, 400);
    }
    const r = await creerCheckout(db, db.getHousehold(h.id)!, body.formule, body.periode, currentUser(c)?.email ?? null);
    return c.json(r);
  });

  api.post("/abonnement/portail", async (c) => {
    const url = await portail(db.getHousehold(household(c).id)!);
    return url ? c.json({ url }) : c.json({ error: "indisponible", message: "Le portail de facturation nécessite Stripe." }, 400);
  });

  /** Simulated checkout (no Stripe key): activates the plan right away. Never exposed when Stripe is configured. */
  api.get("/abonnement/simule", (c) => {
    if (process.env.STRIPE_SECRET_KEY) return c.json({ error: "stripe_actif" }, 400);
    const h = db.getHousehold(c.req.query("h") ?? "");
    const periode = c.req.query("periode") === "annuel" ? "annuel" : "mensuel";
    const formule = (["solo", "duo", "tribu"].includes(c.req.query("formule") ?? "") ? c.req.query("formule") : "duo") as Formule;
    if (!h) return c.json({ error: "introuvable" }, 404);
    appliquerAbonnement(db, h, { statut: "simule", formule, periode, fin: new Date(Date.now() + (periode === "annuel" ? 365 : 30) * 864e5).toISOString().slice(0, 10) });
    return c.redirect("/#/settings?paiement=ok");
  });

  api.post("/stripe/webhook", async (c) => {
    try {
      const r = await traiterWebhook(db, await c.req.text(), c.req.header("stripe-signature") ?? null);
      return c.json({ ok: true, r });
    } catch (e) {
      return c.json({ error: "webhook", message: (e as Error).message }, 400);
    }
  });

  api.post("/mcp/regenerer", (c) => {
    if (!isOwner(c)) return c.json({ error: "proprietaire" }, 403);
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
      boite_email: h.plan === "famille" ? boiteAddress(db.getHousehold(h.id)!.boite_code) : null,
      mcp_token: h.plan === "famille" ? db.getHousehold(h.id)!.mcp_token : null,
      utilisateur: currentUser(c),
      abonnement: resumeAbonnement(db.getHousehold(h.id)!),
      comptes: db.usersOfHousehold(h.id).length,
      capacite_comptes: capaciteComptes(db, db.getHousehold(h.id)!),
      assistant: etatAssistant(db, db.getHousehold(h.id)!),
      veille: { ouverte: V.veilleOuverte(), capacite: V.capaciteVeilles(db, db.getHousehold(h.id)!), en_cours: V.veillesEnCours(db, h.id) },
      boite_recus: db.listInboxMessages(h.id, 10),
      hebdo: db.getHousehold(h.id)!.hebdo !== 0,
    });
  });

  /**
   * Inbound email webhook (forwarding address). Protected by LUCIEN_INBOX_SECRET (query `secret` or header `x-lucien-secret`; the old `x-nidou-secret` is still accepted).
   * Accepts the generic InboundEmail shape, an array of them, or Brevo's inbound-parsing payload ({ items: [...] }).
   */
  api.post("/inbox", async (c) => {
    const secret = process.env.LUCIEN_INBOX_SECRET;
    if (secret && c.req.query("secret") !== secret && c.req.header("x-lucien-secret") !== secret && c.req.header("x-nidou-secret") !== secret) return c.json({ error: "non_autorise" }, 401);
    const body = await c.req.json();
    const generic = z.object({
      message_id: z.string().min(1), to: z.array(z.string()), from: z.string().nullable().default(null), subject: z.string().nullable().default(null),
      text: z.string().nullable().default(null), attachments: z.array(z.object({ nom: z.string(), mime: z.string(), base64: z.string() })).default([]),
    });
    const mails: InboundEmail[] = Array.isArray(body) ? body.map((m) => generic.parse(m)) : body?.items ? await fromBrevo(body) : [generic.parse(body)];
    const resultats = [];
    for (const m of mails) resultats.push(await processInboundEmail(db, m, { plan: (hh) => db.effectivePlan(db.getHousehold(hh.id)!) }));
    return c.json({ resultats: resultats.map((r) => (r.statut === "ok" ? { statut: "ok", documents: r.documents.length } : r)) });
  });

  api.patch("/household", async (c) => {
    const h = household(c);
    const body = z.object({ plan: z.enum(["gratuit", "famille"]).optional(), terminer_essai: z.boolean().optional(), nom: z.string().min(1).max(60).optional(), hebdo: z.boolean().optional() }).parse(await c.req.json());
    if (body.hebdo !== undefined) db.setHebdo(h.id, body.hebdo);
    if (body.plan) db.setPlan(h.id, body.plan);
    if (body.nom) db.renameHousehold(h.id, body.nom);
    if (body.terminer_essai) db.setTrialEnd(h.id, new Date(0).toISOString());
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
    const { prenom, role, ...extra } = body;
    return c.json(db.addMember(h.id, prenom, role, extra as never), 201);
  });

  api.patch("/members/:id", async (c) => {
    const m = db.getMember(c.req.param("id"));
    if (!m || m.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
    db.updateMember(m.id, memberSchema.partial().parse(await c.req.json()) as never);
    return c.json(db.getMember(m.id));
  });

  api.delete("/members/:id", (c) => {
    const m = db.getMember(c.req.param("id"));
    if (!m || m.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
    db.deleteMember(m.id);
    return c.json({ ok: true });
  });

  // ---------- organisation familiale ----------
  api.get("/famille", (c) => {
    const h = household(c);
    return c.json(familleReport(db.getHousehold(h.id)!, db.listMembers(h.id), db.listActivites(h.id), db.familleFaits(h.id)));
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
    if (!a || a.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
    db.updateActivite(a.id, activiteSchema.partial().parse(await c.req.json()) as never);
    return c.json(db.getActivite(a.id));
  });

  api.delete("/activites/:id", (c) => {
    const a = db.getActivite(c.req.param("id"));
    if (!a || a.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
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
    if (!d || d.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
    return c.json({ ...publicDoc(d), texte: d.texte, echeances: db.listDeadlines(d.household_id, { includeDone: true }).filter((x) => x.document_id === d.id) });
  });

  /**
   * Calendar subscription (Google, Apple, Outlook): deadlines and the children's weekly activities, refreshed by the calendar app.
   * The link carries a secret (no session in a calendar app); it can be changed, which cuts the old one.
   */
  const icsPour = (h: HouseholdRow) => {
    const faits = db.familleFaits(h.id);
    const members = db.listMembers(h.id), activites = db.listActivites(h.id);
    const depuis = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const fam = echeancesFamille(h, members, activites).filter((e) => !faits.has(e.cle) && e.date >= depuis).map((e) => ({ id: `f-${e.cle}`, titre: e.titre, date: e.date, rappel_jours: e.rappel_jours, note: e.note }));
    const docs = db.listDeadlines(h.id, { from: depuis }).map((d) => ({ id: d.id, titre: d.titre, date: d.date, rappel_jours: d.rappel_jours, note: d.note }));
    return agendaIcs({ foyer: h.nom, echeances: [...docs, ...fam], creneaux: agendaSemaine(members, activites), lien: `${(process.env.LUCIEN_PUBLIC_URL ?? "").replace(/\/$/, "")}/#/deadlines` });
  };
  api.get("/agenda/:fichier", (c) => {
    const f = c.req.param("fichier");
    if (!f.endsWith(".ics")) return c.json({ error: "introuvable" }, 404);
    const h = db.householdByIcsToken(f.slice(0, -4));
    if (!h) return c.text("Lien d'agenda inconnu ou remplacé : abonnez-vous à nouveau depuis Lucien.", 404);
    return c.body(icsPour(h), 200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="lucien.ics"', "cache-control": "private, max-age=900" });
  });
  const lienAgenda = (c: { req: { url: string } }, tok: string) => {
    const base = (process.env.LUCIEN_PUBLIC_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
    return `${base}/api/agenda/${tok}.ics`;
  };
  api.get("/agenda-lien", (c) => c.json({ url: lienAgenda(c, db.icsToken(household(c).id)) }));
  api.post("/agenda-lien", (c) => c.json({ url: lienAgenda(c, db.icsToken(household(c).id, true)) }));

  /** The original file of a paper (photo or PDF), for the household only. */
  api.get("/documents/:id/fichier", async (c) => {
    const d = db.getDocument(c.req.param("id"));
    if (!d || d.household_id !== household(c).id || !d.fichier) return c.json({ error: "introuvable" }, 404);
    const buf = await readFile(join(opts.uploadDir, basename(d.fichier))).catch(() => null);
    if (!buf) return c.json({ error: "introuvable" }, 404);
    const nom = `${d.title.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim().slice(0, 80) || "document"}${extname(d.fichier)}`;
    return new Response(new Uint8Array(buf), { headers: { "content-type": d.mime ?? "application/octet-stream", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(nom)}`, "cache-control": "private, no-store" } });
  });

  /** « Dossiers prêts » : for each usual request (rental, CAF, school, loan…), what is ready, too old or missing. */
  api.get("/dossiers", (c) => c.json(etatDossiers(db.listDocuments(household(c).id))));

  /** The whole folder in one .zip: a cover sheet (what is there, what is missing and where to get it) and the original files. */
  api.get("/dossiers/:cle/zip", async (c) => {
    const h = household(c);
    const kit = KITS.find((k) => k.cle === c.req.param("cle"));
    if (!kit) return c.json({ error: "introuvable" }, 404);
    const docs = db.listDocuments(h.id);
    const e = etatKit(kit, docs);
    const fichiers = [{ nom: "00 - Bordereau.txt", contenu: Buffer.from(bordereau(e, db.getHousehold(h.id)!.nom), "utf8") }];
    let n = 1;
    for (const p of e.pieces) for (const ref of p.documents) {
      const d = docs.find((x) => x.id === ref.id);
      if (!d?.fichier) continue;
      const buf = await readFile(join(opts.uploadDir, basename(d.fichier))).catch(() => null);
      if (!buf) continue;
      const titre = d.title.replace(/[^\p{L}\p{N} ._'-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 70);
      fichiers.push({ nom: `${String(n++).padStart(2, "0")} - ${p.libelle.replace(/[^\p{L}\p{N} ._'-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40)} - ${titre}${extname(d.fichier)}`, contenu: buf });
    }
    const nom = `Lucien - ${kit.titre}.zip`;
    return new Response(new Uint8Array(zip(fichiers)), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nom)}`, "cache-control": "private, no-store" } });
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

    let texte: string | undefined, base64: string | undefined, mime: string | undefined, nomFichier: string | undefined;
    let fichier: string | null = null;
    const ct = c.req.header("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const f = form.get("file");
      texte = (form.get("texte") as string | null) ?? undefined;
      if (f instanceof File) {
        nomFichier = f.name;
        mime = f.type || "application/octet-stream";
        const buf = Buffer.from(await f.arrayBuffer());
        if (buf.length > 15 * 1024 * 1024) return c.json({ error: "fichier_trop_gros" }, 413);
        base64 = buf.toString("base64");
        await mkdir(opts.uploadDir, { recursive: true });
        fichier = `${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
        await writeFile(join(opts.uploadDir, fichier), buf);
        if (mime.startsWith("text/")) texte = texte ?? buf.toString("utf8");
      }
    } else {
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
    if (ex.modele) db.recordIaLecture(h.id, gratuit, ex.modele.cout_lecture_centimes);
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
    if (!d || d.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
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
    db.updateDocument(d.id, patch as Partial<DocumentRow>);
    const updated = db.getDocument(d.id)!;
    db.replaceDeadlinesForDocument(updated.id, updated.household_id, deadlinesFor(updated));
    return c.json(publicDoc(updated));
  });

  api.delete("/documents/:id", (c) => {
    const d = db.getDocument(c.req.param("id"));
    if (!d || d.household_id !== household(c).id) return c.json({ error: "introuvable" }, 404);
    db.deleteDocument(d.id);
    return c.json({ ok: true });
  });

  // ---------- deadlines ----------
  /** Stored deadlines (from documents) merged with the computed family ones (anniversaries, aides, réinscriptions…). */
  /** « La semaine de Lucien » as the server computes it for the Sunday email (the app computes the same thing locally). */
  api.get("/semaine", (c) => c.json(pointDuFoyer(db, db.getHousehold(household(c).id)!)));

  api.get("/deadlines", (c) => {
    const h = household(c);
    const from = c.req.query("from"), to = c.req.query("to"), done = c.req.query("done") === "1";
    const faits = db.familleFaits(h.id);
    const fam = echeancesFamille(db.getHousehold(h.id)!, db.listMembers(h.id), db.listActivites(h.id))
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
    if (id.startsWith("f:")) db.marquerFamilleFait(household(c).id, id.slice(2), body.fait);
    else db.setDeadlineDone(id, body.fait);
    return c.json({ ok: true });
  });

  // ---------- charges fixes ----------
  api.get("/charges", (c) => {
    const h = household(c);
    const report = chargesReport(db.listDocuments(h.id), undefined, lignesFamille(coutsParMembre(db.listMembers(h.id), db.listActivites(h.id))));
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
    if (!doc || doc.household_id !== h.id) return c.json({ error: "introuvable" }, 404);
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
    let text = "", compte: string | null = null;
    const ct = c.req.header("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const f = form.get("file");
      compte = (form.get("compte") as string | null) || null;
      if (f instanceof File) {
        const buf = Buffer.from(await f.arrayBuffer());
        if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
          if (!process.env.ANTHROPIC_API_KEY) return c.json({ error: "pdf_sans_ia", message: "La lecture des relevés PDF nécessite la clé API Anthropic. Exportez le relevé en CSV depuis votre banque." }, 400);
          text = await pdfStatementToCsv(buf);
        } else text = buf.toString("utf8");
      }
    } else {
      const body = z.object({ texte: z.string().optional(), compte: z.string().optional(), demo: z.boolean().optional() }).parse(await c.req.json());
      text = body.demo ? demoStatement() : body.texte ?? "";
      compte = body.compte ?? (body.demo ? "Compte joint (démo)" : null);
    }
    const parsed = parseStatement(text, compte);
    if (parsed.length === 0) return c.json({ error: "format", message: "Aucune ligne reconnue. Format attendu : une ligne par opération avec date, libellé et montant (CSV de votre banque)." }, 400);
    const cats = h.plan === "gratuit" ? parsed.map((t) => ruleCategory(t.libelle, t.montant) ?? "autre") : await categorise(parsed);
    const added = db.insertTransactions(parsed.map((t: ParsedTx, i: number) => ({
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

  api.get("/bank/status", (c) => {
    const h = household(c);
    const link = db.getBankLink(h.id);
    return c.json({
      fournisseur: link?.fournisseur === "simule" ? "simule" : link?.fournisseur ?? fournisseur(),
      connecte: link?.statut === "connecte",
      expire_le: link ? linkExtra(db, h.id)?.expire_le ?? null : null,
      statut: link?.statut ?? "aucune",
      derniere_synchro: link?.derniere_synchro ?? null,
      comptes: db.listBankAccounts(h.id).map((a) => ({ id: a.id, nom: a.nom, banque: a.banque, solde: a.solde, devise: a.devise, maj_le: a.maj_le })),
    });
  });

  /** Starts the Connect flow: returns the URL where the family picks its bank. */
  api.post("/bank/connect", async (c) => {
    const h = household(c);
    if (h.plan === "gratuit") return c.json({ error: "limite_plan", message: "La connexion bancaire automatique fait partie du plan Famille." }, 402);
    const f = fournisseur();
    if (f === "simule") return c.json(await simulatedConnect(db, h.id));
    if (f === "enablebanking") {
      const body = z.object({ aspsp: z.object({ name: z.string(), country: z.string().length(2), maximum_consent_validity: z.number().optional() }) }).parse(await c.req.json());
      return c.json(await ebConnectHousehold(db, eb()!, h.id, body.aspsp));
    }
    const b = bridge()!;
    const body = z.object({ email: z.string().email() }).parse(await c.req.json().catch(() => ({})));
    let userUuid = db.getBankLink(h.id)?.user_uuid;
    if (!userUuid) {
      const externalId = `lucien-${h.id}`;
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
        if (link.fournisseur === "simule" || fournisseur() === "simule") await simulatedSync(db, link.household_id); else await synchroniserFoyer(db, link.household_id);
      } catch (e) {
        db.upsertBankLink({ ...link, statut: "erreur" });
        console.error("sync après connect :", e);
      }
    }
    return c.redirect(`/#budget${success ? "" : "?bank=abandon"}`);
  });

  api.post("/bank/sync", async (c) => {
    const h = household(c);
    try {
      const link = db.getBankLink(h.id);
      return c.json(!link || link.fournisseur === "simule" || fournisseur() === "simule" ? await simulatedSync(db, h.id) : await synchroniserFoyer(db, h.id));
    } catch (e) {
      return c.json({ error: "synchro", message: e instanceof Error ? e.message : "Synchronisation impossible" }, 502);
    }
  });

  /** Banks the family can pick (Enable Banking needs Lucien to show the list; Bridge shows its own). */
  api.get("/bank/banques", async (c) => {
    const c2 = eb();
    return c.json({ fournisseur: fournisseur(), banques: c2 ? await banquesFR(c2) : BANQUES_DEMO });
  });

  /** Enable Banking sends the person back here, for the household (state "h.") or a protected relative (state "v."). */
  api.get("/bank/eb/callback", async (c) => {
    const state = c.req.query("state") ?? "", code = c.req.query("code"), err = c.req.query("error");
    const client = eb();
    if (state.startsWith("v.")) {
      const v = V.veilleParBridgeUser(db, `attente:${state}`);
      if (!v) return c.redirect("/");
      if (client && code && !err) {
        try {
          const s = await client.createSession(code);
          V.setBanque(db, v, { bridge_user_uuid: `eb:${s.session_id}`, banque_connectee: 1 });
          V.journaliser(db, v.id, "Banque", "connexion_banque", { fournisseur: "enablebanking", banque: s.aspsp?.name ?? null, comptes: (s.accounts ?? []).length, autorisation_jusqu_au: s.access?.valid_until?.slice(0, 10) ?? null });
          await synchroniserVeille(db, V.veilleParId(db, v.id)!).catch((e) => console.error("veille sync :", e));
          return c.redirect(`/#/consentement/${v.jeton}?banque=ok`);
        } catch (e) { console.error("veille session :", e); }
      }
      return c.redirect(`/#/consentement/${v.jeton}?banque=abandon`);
    }
    if (!client || !code || err) return c.redirect("/#budget?bank=abandon");
    try {
      const hid = await ebFinishHousehold(db, client, state, code);
      if (!hid) return c.redirect("/#budget?bank=abandon");
      await synchroniserFoyer(db, hid).catch((e) => console.error("sync après connexion :", e));
      return c.redirect("/#budget");
    } catch (e) {
      console.error("eb callback :", e);
      return c.redirect("/#budget?bank=abandon");
    }
  });

  api.delete("/bank", async (c) => {
    const link = db.getBankLink(household(c).id);
    if (link?.fournisseur === "enablebanking" && !link.user_uuid.startsWith("attente:")) await eb()?.deleteSession(link.user_uuid).catch(() => {});
    db.deleteBankLink(household(c).id);
    return c.json({ ok: true });
  });

  /** Bridge webhook: `item.refreshed` (and friends) → sync that user's household. Signed with BridgeApi-Signature. */

  // ---------- veille bancaire d'un proche (anti-arnaque, lecture seule) ----------
  const fermee = (c: any) => c.json({ error: "fonction_fermee", message: "La veille bancaire d'un proche ouvrira après validation juridique." }, 403);
  const acteurDe = (c: any) => { const u = currentUser(c); return u ? (u.prenom ? `${u.prenom} (${u.email})` : u.email) : "Aidant"; };
  const publicUrl = () => (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const lienPersonne = (v: V.VeilleRow) => `${publicUrl()}/#/consentement/${v.jeton}`;
  const resumeVeille = (v: V.VeilleRow) => {
    const m = db.getMember(v.member_id);
    const al = V.alertes(db, v.id);
    return { id: v.id, member_id: v.member_id, prenom: m?.prenom ?? "?", statut: v.statut, mesure: v.mesure, mesure_label: V.MESURE_LABEL[v.mesure], aidant: v.aidant_nom, aidant_qualite: v.aidant_qualite,
      temoins: JSON.parse(v.temoins), consentement_le: v.consentement_le, consentement_expire: v.consentement_expire, accords: (v.consentement_par ?? "").split(",").filter(Boolean),
      qui_consent: m ? V.quiConsent(v, m.prenom) : null, banque_connectee: Boolean(v.banque_connectee), alertes_non_vues: al.filter((a) => !a.vue).length, alertes_urgentes: al.filter((a) => a.gravite === "urgente" && !a.vue).length,
      lien_personne: v.statut === "terminee" ? null : lienPersonne(v), fin_le: v.fin_le, motif_fin: v.motif_fin };
  };
  /** Alerts reach the aidant's devices and the witnesses by email (paid plans), the same text for everyone. */
  /** Ending a watch also closes the bank consent at the source, not just in Lucien. */
  const fermerBanqueVeille = async (v: V.VeilleRow) => {
    if (v.bridge_user_uuid?.startsWith("eb:")) await eb()?.deleteSession(v.bridge_user_uuid.slice(3)).catch((e) => console.error("fermeture session :", e));
  };
  const notifier = (v: V.VeilleRow, nouvelles: V.Alerte[]) => notifierAlertes(db, v, nouvelles);

  api.get("/veilles", (c) => {
    const h = household(c);
    const row = db.getHousehold(h.id)!;
    return c.json({ ouverte: V.veilleOuverte(), capacite: V.capaciteVeilles(db, row), en_cours: V.veillesEnCours(db, h.id), prix: V.PRIX_VEILLE, veilles: V.veillesDuFoyer(db, h.id).map(resumeVeille) });
  });

  api.post("/veilles", async (c) => {
    if (!V.veilleOuverte()) return fermee(c);
    const h = household(c);
    const body = z.object({
      member_id: z.string(), mesure: z.enum(["aucune", "curatelle", "tutelle", "habilitation_familiale", "mandat_protection_future"]),
      acte_document_id: z.string().nullable().default(null), aidant_qualite: z.string().nullable().default(null),
      temoins: z.array(z.object({ nom: z.string(), email: z.string().email().nullable().default(null) })).max(6).default([]),
      personne_peut_consentir: z.boolean().default(false),
    }).parse(await c.req.json());
    try {
      const v = V.creerVeille(db, db.getHousehold(h.id)!, { ...body, aidant_user_id: currentUser(c)?.id ?? null, aidant_nom: acteurDe(c) });
      return c.json(resumeVeille(v), 201);
    } catch (e) {
      if (e instanceof V.RefusVeille) return c.json({ error: e.code, message: e.message }, e.code === "veille_payante" ? 402 : 400);
      throw e;
    }
  });

  const maVeille = (c: any) => { const v = V.veilleParId(db, c.req.param("id")); return v && v.household_id === household(c).id ? v : null; };

  api.get("/veilles/:id", (c) => {
    const v = maVeille(c);
    if (!v) return c.json({ error: "introuvable" }, 404);
    if (v.statut === "active") V.marquerConsultation(db, v, acteurDe(c));
    return c.json({ ...resumeVeille(v), alertes: v.statut === "active" || v.statut === "suspendue" ? V.alertes(db, v.id) : [], journal: V.verifierJournal(db, v.id) });
  });

  api.post("/veilles/:id/vue", (c) => {
    const v = maVeille(c);
    if (!v) return c.json({ error: "introuvable" }, 404);
    db.raw.prepare("UPDATE veille_alertes SET vue = 1 WHERE veille_id = ?").run(v.id);
    return c.json({ ok: true });
  });

  api.post("/veilles/:id/terminer", async (c) => {
    const v = maVeille(c);
    if (!v) return c.json({ error: "introuvable" }, 404);
    const body = z.object({ motif: z.enum(["deces", "fin_mesure", "demande_aidant"]) }).parse(await c.req.json());
    await fermerBanqueVeille(v);
    return c.json(resumeVeille(V.terminer(db, v, acteurDe(c), body.motif)));
  });

  /** Tamper-evident log, as JSON (with the chain check) or CSV for a lawyer or a notary. */
  api.get("/veilles/:id/journal", (c) => {
    const v = maVeille(c);
    if (!v) return c.json({ error: "introuvable" }, 404);
    const lignes = V.journal(db, v.id);
    if (c.req.query("format") === "csv") {
      const esc = (x: string) => `"${String(x ?? "").replace(/"/g, '""')}"`;
      const csv = ["quand;acteur;action;details;empreinte_precedente;empreinte", ...lignes.map((l) => [l.quand, l.acteur, l.action, l.details, l.empreinte_prec, l.empreinte].map(esc).join(";"))].join("\n");
      return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="journal-veille-${v.id.slice(0, 8)}.csv"` } });
    }
    return c.json({ verification: V.verifierJournal(db, v.id), lignes });
  });

  // ---------- assistant « Demander à Lucien » (option payante) ----------
  api.get("/assistant", (c) => c.json(etatAssistant(db, db.getHousehold(household(c).id)!)));
  api.post("/assistant", async (c) => {
    const h = db.getHousehold(household(c).id)!;
    const body = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1).max(40) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "requete", message: "Question illisible." }, 400);
    try {
      const u = currentUser(c);
      return c.json(await repondre(db, h, body.data.messages, { nom: u?.prenom ?? null }));
    } catch (e) {
      if (e instanceof AssistantErreur) return c.json({ error: e.code, message: e.message, etat: etatAssistant(db, h) }, e.code === "acces" ? 402 : e.code === "quota" ? 429 : e.code === "requete" ? 400 : 503);
      throw e;
    }
  });
  api.post("/abonnement/assistant", async (c) => {
    if (!isOwner(c)) return c.json({ error: "proprietaire", message: "Seul le propriétaire du foyer gère l'abonnement." }, 403);
    const h = db.getHousehold(household(c).id)!;
    const body = z.object({ actif: z.boolean() }).parse(await c.req.json().catch(() => ({ actif: true })));
    if (body.actif && db.effectivePlan(h) !== "famille") return c.json({ error: "plan", message: "L'assistant s'ajoute à une formule Solo, Duo ou Tribu." }, 402);
    try { return c.json({ ...(await basculerAssistant(db, h, body.actif)), etat: etatAssistant(db, db.getHousehold(h.id)!) }); }
    catch (e) { return c.json({ error: "paiement", message: (e as Error).message }, 400); }
  });

  api.post("/abonnement/veille", async (c) => {
    const h = household(c);
    const body = z.object({ periode: z.enum(["mensuel", "annuel"]).default("mensuel") }).parse(await c.req.json().catch(() => ({})));
    try { return c.json(await ajouterVeillePayante(db, db.getHousehold(h.id)!, body.periode)); }
    catch (e) { return c.json({ error: "paiement", message: (e as Error).message }, 400); }
  });

  // --- page personnelle de la personne protégée (sans compte : son lien suffit) ---
  const parJeton = (c: any) => V.veilleParJeton(db, c.req.param("jeton"));

  api.get("/veille/p/:jeton", (c) => {
    const v = parJeton(c);
    if (!v) return c.json({ error: "introuvable", message: "Ce lien n'est plus valable." }, 404);
    return c.json(V.vuePersonne(db, v));
  });

  api.post("/veille/p/:jeton/consentir", async (c) => {
    if (!V.veilleOuverte()) return fermee(c);
    const v = parJeton(c);
    if (!v) return c.json({ error: "introuvable" }, 404);
    const body = z.object({ nom_signataire: z.string(), en_qualite_de: z.enum(["personne", "representant"]), accepte: z.boolean() }).parse(await c.req.json());
    try { V.consentir(db, v, body); return c.json(V.vuePersonne(db, V.veilleParId(db, v.id)!)); }
    catch (e) { if (e instanceof V.RefusVeille) return c.json({ error: e.code, message: e.message }, 400); throw e; }
  });

  api.post("/veille/p/:jeton/retirer", async (c) => {
    const v = parJeton(c);
    if (!v) return c.json({ error: "introuvable" }, 404);
    const body = z.object({ nom: z.string().default("La personne protégée") }).parse(await c.req.json().catch(() => ({})));
    await fermerBanqueVeille(v);
    V.terminer(db, v, body.nom.trim() || "La personne protégée", "retrait_consentement");
    const m = db.getMember(v.member_id)!;
    await envoyerPush(db, v.household_id, { titre: `${m.prenom} a retiré son accord`, corps: "La veille bancaire est arrêtée. Les opérations seront effacées.", url: `/#/veille/${v.id}`, tag: `veille-${v.id}` });
    return c.json(V.vuePersonne(db, V.veilleParId(db, v.id)!));
  });

  /** The person connects her own bank herself (her code never goes through the aidant). */
  api.post("/veille/p/:jeton/banque", async (c) => {
    if (!V.veilleOuverte()) return fermee(c);
    const v = parJeton(c);
    if (!v) return c.json({ error: "introuvable" }, 404);
    if (v.statut !== "active") return c.json({ error: "consentement", message: "La banque se connecte une fois l'accord donné." }, 400);
    const f = fournisseur();
    if (f === "simule") {
      V.setBanque(db, v, { banque_connectee: 1 });
      const r = V.ajouterOperations(db, V.veilleParId(db, v.id)!, V.operationsSimulees());
      V.journaliser(db, v.id, "Banque", "connexion_banque", { fournisseur: "simulé", operations: r.ajoutees });
      await notifier(v, r.nouvelles);
      return c.json({ url: null, ...V.vuePersonne(db, V.veilleParId(db, v.id)!) });
    }
    if (f === "enablebanking") {
      const body = z.object({ aspsp: z.object({ name: z.string(), country: z.string().length(2), maximum_consent_validity: z.number().optional() }) }).parse(await c.req.json());
      const state = `v.${newState()}`;
      V.setBanque(db, v, { bridge_user_uuid: `attente:${state}` });
      const { url } = await eb()!.startAuth({ name: body.aspsp.name, country: body.aspsp.country }, state, body.aspsp.maximum_consent_validity);
      return c.json({ url });
    }
    const b = bridge()!;
    const body = z.object({ email: z.string().email().nullable().default(null) }).parse(await c.req.json().catch(() => ({})));
    let uuid = v.bridge_user_uuid;
    if (!uuid) { uuid = (await b.client.createUser(`lucien-veille-${v.id}`)).uuid; V.setBanque(db, v, { bridge_user_uuid: uuid }); }
    const { access_token } = await b.client.userToken(uuid);
    const session = await b.client.connectSession(access_token, body.email ?? `veille+${v.id.slice(0, 8)}@monlucien.fr`, v.id, "/api/veille/callback");
    return c.json({ url: session.url });
  });

  const syncVeille = (v: V.VeilleRow) => synchroniserVeille(db, v);

  api.get("/veille/p/:jeton/banques", async (c) => {
    if (!parJeton(c)) return c.json({ error: "introuvable" }, 404);
    const c2 = eb();
    return c.json({ fournisseur: fournisseur(), banques: c2 ? await banquesFR(c2) : BANQUES_DEMO });
  });

  api.get("/veille/callback", async (c) => {
    const v = V.veilleParBridgeUser(db, c.req.query("user_uuid") ?? "");
    if (!v) return c.redirect("/");
    if (c.req.query("success") === "true") {
      V.setBanque(db, v, { banque_connectee: 1 });
      V.journaliser(db, v.id, "Banque", "connexion_banque", { fournisseur: "bridge" });
      await syncVeille(V.veilleParId(db, v.id)!).catch((e) => console.error("veille sync :", e));
    }
    return c.redirect(`/#/consentement/${v.jeton}?banque=${c.req.query("success") === "true" ? "ok" : "abandon"}`);
  });

  api.post("/bank/webhook", async (c) => {
    const raw = await c.req.text();
    const b = bridge();
    const secrets = [b?.cfg.webhookSecret ?? "", process.env.BRIDGE_WEBHOOK_SECRET_PREVIOUS ?? ""];
    if (b && !verifyBridgeSignature(raw, c.req.header("BridgeApi-Signature"), secrets)) return c.json({ error: "signature" }, 401);
    let evt: any = {};
    try { evt = JSON.parse(raw); } catch { return c.json({ error: "json" }, 400); }
    const type = String(evt.type ?? "");
    const userUuid = evt.content?.user_uuid;
    if (["item.refreshed", "item.created", "item.account.updated", "item.account.created"].includes(type) && userUuid) {
      const link = db.getBankLinkByUser(String(userUuid));
      if (link && b) {
        // Respond fast, sync in the background (Bridge retries slow endpoints).
        synchroniserFoyer(db, link.household_id).catch((e) => console.error("webhook sync :", e));
      }
      const veille = V.veilleParBridgeUser(db, String(userUuid));
      if (veille && b) syncVeille(veille).catch((e) => console.error("webhook veille :", e));
    }
    return c.json({ ok: true });
  });

  /** IA spend this month (free vs paid) and the free cap: what an admin dashboard will show. */
  // Reminders already sent to this household (trial reminders) and the ones due today, for the app's feed and for debugging.
  api.get("/rappels", (c) => {
    const h = household(c);
    const row = db.getHousehold(h.id)!;
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
    const n = await envoyerPush(db, h.id, { titre: "Lucien est prêt", corps: "Vous recevrez ici vos rappels d'échéances et vos économies.", url: "/#/notifs", tag: "test" });
    return c.json({ ok: true, envoyes: n, actif: pushOn() });
  });

  api.get("/ia/depense", (c) => c.json({ ...db.iaDepenseMois(), plafond_gratuit_eur: freeCapEur(), fournisseur: process.env.LUCIEN_IA_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.MISTRAL_API_KEY ? "mistral" : "aucun") }));

  // ---------- MCP access log ----------
  api.get("/mcp/log", (c) => c.json(db.listMcpAccess(household(c).id)));

  return api;
}

export function publicDoc(d: DocumentRow) {
  const { texte, ...rest } = d;
  return rest;
}

/** Reads a PDF bank statement with Claude and returns it as CSV lines (date;libellé;montant). */
async function pdfStatementToCsv(buf: Buffer): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: process.env.LUCIEN_MODEL ?? "claude-sonnet-5-5",
    max_tokens: 8000,
    system: "Tu convertis un relevé bancaire en CSV. Une ligne par opération : date au format JJ/MM/AAAA;libellé complet;montant signé (négatif pour un débit, virgule décimale). Première ligne : Date;Libellé;Montant. Aucun autre texte.",
    messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }, { type: "text", text: "Convertis ce relevé." }] }],
  });
  const t = res.content.find((b) => b.type === "text");
  return t && t.type === "text" ? t.text : "";
}
