import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { securiser } from "./securite.js";
import { oublierDemandes } from "./auth.js";

const appli = () => {
  const app = new Hono();
  securiser(app);
  app.post("/api/waitlist", (c) => c.json({ ok: true }));
  app.post("/api/members", async (c) => c.json({ taille: (await c.req.text()).length }));
  app.post("/api/documents", async (c) => c.json({ taille: (await c.req.arrayBuffer()).byteLength }));
  app.get("/api/documents/1/fichier", (c) => { c.header("content-security-policy", "sandbox"); return c.text("pdf"); });
  app.get("/", (c) => c.html("<p>appli</p>"));
  app.get("/site/", (c) => c.html("<p>site</p>"));
  return app;
};

test("sécurité : en-têtes partout, la politique du lecteur de documents est gardée", async () => {
  const app = appli();
  const r = await app.request("/");
  assert.match(r.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.match(r.headers.get("content-security-policy")!, /script-src 'self';/, "no inline script in the app");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match((await app.request("/site/")).headers.get("content-security-policy")!, /script-src 'self' 'unsafe-inline'/);
  assert.equal((await app.request("/api/documents/1/fichier")).headers.get("content-security-policy"), "sandbox");
});

test("sécurité : tailles limitées avant lecture (1 Mo, 15 Mo pour les papiers)", async () => {
  const app = appli();
  const gros = "x".repeat(2 * 1024 * 1024);
  assert.equal((await app.request("/api/members", { method: "POST", body: gros, headers: { "content-type": "text/plain" } })).status, 413);
  assert.equal((await app.request("/api/documents", { method: "POST", body: gros, headers: { "content-type": "application/octet-stream" } })).status, 200, "a 2 MB paper is fine");
  const enorme = new Uint8Array(16 * 1024 * 1024);
  assert.equal((await app.request("/api/documents", { method: "POST", body: enorme, headers: { "content-type": "application/octet-stream" } })).status, 413);
});

test("sécurité : formulaires publics ouverts aux sites de Lucien seulement, 5 envois par réseau", async () => {
  oublierDemandes();
  const app = appli();
  const envoi = (origin: string, ip = "9.9.9.9") => app.request("/api/waitlist", { method: "POST", headers: { origin, "x-forwarded-for": ip, "content-type": "application/json" }, body: "{}" });
  assert.equal((await envoi("https://monlucien.fr")).headers.get("access-control-allow-origin"), "https://monlucien.fr");
  assert.equal((await envoi("https://pirate.example")).headers.get("access-control-allow-origin"), null);
  for (let i = 0; i < 3; i++) await envoi("https://monlucien.fr");
  assert.equal((await envoi("https://monlucien.fr")).status, 429, "6th sign-up from the same network");
  assert.equal((await envoi("https://monlucien.fr", "8.8.8.8")).status, 200);
  oublierDemandes();
});
