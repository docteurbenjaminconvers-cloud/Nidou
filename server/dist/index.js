import "./env-compat.js";
import { chiffrerExistants, etatCoffre, initCoffre } from "./coffre.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Db } from "./db.js";
import { migrerMarchands } from "./marchands.js";
import { preparerStripe } from "./stripeCatalogue.js";
import { stripeOn } from "./abonnement.js";
import { AUTH_ON } from "./auth.js";
import { createApi } from "./api.js";
import { securiser } from "./securite.js";
import { demarrerSynchroBanques, fournisseur } from "./banques.js";
import { demarrerRappels } from "./rappels.js";
import { handleMcpRequest } from "./mcp.js";
import { seedDemo } from "./seed.js";
import { demoStatement } from "./seed-statement.js";
import { parseStatement, merchantOf, categorise, fingerprint } from "./transactions.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.LUCIEN_DATA ?? join(__dirname, "..", "data");
const WEB_DIST = process.env.LUCIEN_WEB ?? join(__dirname, "..", "..", "web", "dist");
mkdirSync(DATA_DIR, { recursive: true });
// Ancien nom de la base (Nidou) : repris tel quel au premier démarrage sous Lucien.
for (const ext of ["", "-wal", "-shm"]) {
    const ancien = join(DATA_DIR, "nidou.sqlite" + ext), nouveau = join(DATA_DIR, "lucien.sqlite" + ext);
    if (existsSync(ancien) && !existsSync(join(DATA_DIR, "lucien.sqlite")))
        renameSync(ancien, nouveau);
}
const db = new Db(join(DATA_DIR, "lucien.sqlite"));
if (process.env.LUCIEN_SEED === "1" && !db.firstHousehold()) {
    const h = seedDemo(db, { espaces: true });
    // Demo account: demo@monlucien.fr owns the demo household (log in with that address; the link is printed in the console without BREVO_API_KEY).
    db.joinHousehold(h.id, db.createUser("demo@monlucien.fr", "Moi").id, "proprietaire");
    const parsed = parseStatement(demoStatement(), "Compte joint (démo)");
    const cats = await categorise(parsed);
    db.insertTransactions(parsed.map((t, i) => ({ household_id: h.id, compte: t.compte, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i], empreinte: fingerprint(h.id, t) })));
}
// merchant names of operations already imported, recomputed once when the reading of bank labels improves
try {
    migrerMarchands(db);
}
catch (e) {
    console.error("[marchands]", e.message);
}
// Stripe: prices of the grid and webhook created if missing, so that the secret key is the only setting (stripeCatalogue.ts)
if (stripeOn())
    preparerStripe(db)
        .then((r) => console.log(`[stripe] ${process.env.STRIPE_SECRET_KEY.includes("_live_") ? "mode réel" : "mode test"} · prix : ${r.existants} déjà là, ${r.crees} créés · webhook : ${r.webhook}`))
        .catch((e) => console.error("[stripe] préparation impossible :", e.message));
const app = new Hono();
securiser(app);
/**
 * Display diagnostics: when a screen stays empty on someone's device, the app sends what it sees (sizes, styles,
 * error messages; never the page's text or any personal data) so the problem can be fixed without guessing.
 */
app.post("/api/diagnostic", async (c) => {
    const brut = (await c.req.text().catch(() => "")).slice(0, 4000);
    console.warn("[diagnostic]", brut.replace(/[\r\n]+/g, " "));
    return c.json({ ok: true });
});
initCoffre(DATA_DIR);
{
    const e = etatCoffre();
    console.log(`[coffre] fichiers chiffrés sur le disque : ${e.chiffrement ? "oui" : "non"} · clé : ${e.cle === "serveur" ? "réglage du serveur" : "fichier du disque (ajoutez LUCIEN_CLE_COFFRE)"}`);
    // the files written before encryption existed are encrypted in place only when asked (LUCIEN_COFFRE_MIGRER=1)
    if (process.env.LUCIEN_COFFRE_MIGRER === "1")
        chiffrerExistants(join(DATA_DIR, "uploads")).then((r) => console.log(`[coffre] anciens fichiers chiffrés : ${r.chiffres} (déjà chiffrés : ${r.deja})`)).catch((err) => console.error("[coffre] chiffrement des anciens fichiers interrompu :", err.message));
}
app.route("/api", createApi(db, { uploadDir: join(DATA_DIR, "uploads") }));
// MCP endpoint (streamable HTTP). Claude Desktop / claude.ai: https://<host>/mcp
app.all("/mcp", (c) => handleMcpRequest(db, c.req.raw));
app.all("/mcp/:token", (c) => handleMcpRequest(db, c.req.raw, c.req.param("token")));
// Public waitlist endpoint used by the marketing site (site/).
app.post("/api/waitlist", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
        return c.json({ error: "email", message: "Adresse email invalide." }, 400);
    const added = db.addToWaitlist(email, body.situation ? String(body.situation).slice(0, 80) : null, body.source ? String(body.source).slice(0, 80) : null);
    return c.json({ ok: true, nouveau: added, position: db.countWaitlist() });
});
// Marketing site (site/) served under /site when present; in production it lives on monlucien.fr.
const SITE_DIR = join(__dirname, "..", "..", "site");
if (existsSync(SITE_DIR))
    app.use("/site/*", serveStatic({ root: SITE_DIR.replace(process.cwd() + "/", ""), rewriteRequestPath: (p) => p.replace(/^\/site/, "") }));
/** What is switched on (never a secret): lets the setup be checked from outside. */
const etat = () => ({ connexion: AUTH_ON() ? "obligatoire" : "AUCUNE (prototype)", ia: Boolean(process.env.ANTHROPIC_API_KEY || process.env.MISTRAL_API_KEY), banque: fournisseur(), email: Boolean(process.env.BREVO_API_KEY), paiement: Boolean(process.env.STRIPE_SECRET_KEY), acces: process.env.LUCIEN_ACCES === "restreint" ? "sur invitation" : "ouvert" });
app.get("/health", (c) => c.json({ ok: true, ...etat(), version: "0.1.0" }));
// Static PWA (after `npm run build --workspace=web`).
if (existsSync(WEB_DIST)) {
    app.use("/*", serveStatic({ root: WEB_DIST.replace(process.cwd() + "/", "") }));
    app.get("*", serveStatic({ path: join(WEB_DIST, "index.html").replace(process.cwd() + "/", "") }));
}
demarrerRappels(db, { uploadDir: join(DATA_DIR, "uploads") });
demarrerSynchroBanques(db);
serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Lucien · http://localhost:${PORT}  · API /api · MCP /mcp · ${JSON.stringify(etat())}`);
});
