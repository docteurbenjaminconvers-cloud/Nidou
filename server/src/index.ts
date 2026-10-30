import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { demarrerSynchroBanques } from "./banques.js";
import { demarrerRappels } from "./rappels.js";
import { handleMcpRequest } from "./mcp.js";
import { seedDemo } from "./seed.js";
import { demoStatement } from "./seed-statement.js";
import { parseStatement, merchantOf, categorise, fingerprint } from "./transactions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.NIDOU_DATA ?? join(__dirname, "..", "data");
const WEB_DIST = process.env.NIDOU_WEB ?? join(__dirname, "..", "..", "web", "dist");

mkdirSync(DATA_DIR, { recursive: true });
const db = new Db(join(DATA_DIR, "nidou.sqlite"));
if (process.env.NIDOU_SEED === "1" && !db.firstHousehold()) {
  const h = seedDemo(db);
  // Demo account: demo@nidou.fr owns the demo household (log in with that address; the link is printed in the console without BREVO_API_KEY).
  db.joinHousehold(h.id, db.createUser("demo@nidou.fr", "Moi").id, "proprietaire");
  const parsed = parseStatement(demoStatement(), "Compte joint (démo)");
  const cats = await categorise(parsed);
  db.insertTransactions(parsed.map((t, i) => ({ household_id: h.id, compte: t.compte, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i], empreinte: fingerprint(h.id, t) })));
}

const app = new Hono();
app.use("/api/*", cors());
app.route("/api", createApi(db, { uploadDir: join(DATA_DIR, "uploads") }));

// MCP endpoint (streamable HTTP). Claude Desktop / claude.ai: https://<host>/mcp
app.all("/mcp", (c) => handleMcpRequest(db, c.req.raw));
app.all("/mcp/:token", (c) => handleMcpRequest(db, c.req.raw, c.req.param("token")));

// Public waitlist endpoint used by the marketing site (site/).
app.post("/api/waitlist", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return c.json({ error: "email", message: "Adresse email invalide." }, 400);
  const added = db.addToWaitlist(email, body.situation ? String(body.situation).slice(0, 80) : null, body.source ? String(body.source).slice(0, 80) : null);
  return c.json({ ok: true, nouveau: added, position: db.countWaitlist() });
});

// Marketing site (site/) served under /site when present; in production it lives on nidou.fr.
const SITE_DIR = join(__dirname, "..", "..", "site");
if (existsSync(SITE_DIR)) app.use("/site/*", serveStatic({ root: SITE_DIR.replace(process.cwd() + "/", ""), rewriteRequestPath: (p) => p.replace(/^\/site/, "") }));

app.get("/health", (c) => c.json({ ok: true, ia: Boolean(process.env.ANTHROPIC_API_KEY), version: "0.1.0" }));

// Static PWA (after `npm run build --workspace=web`).
if (existsSync(WEB_DIST)) {
  app.use("/*", serveStatic({ root: WEB_DIST.replace(process.cwd() + "/", "") }));
  app.get("*", serveStatic({ path: join(WEB_DIST, "index.html").replace(process.cwd() + "/", "") }));
}

demarrerRappels(db);
demarrerSynchroBanques(db);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Nidou · http://localhost:${PORT}  · API /api · MCP /mcp · IA ${process.env.ANTHROPIC_API_KEY ? "activée" : "désactivée (mode heuristique)"}`);
});
