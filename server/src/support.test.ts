import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { createApi } from "./api.js";

const json = (body: unknown, method = "POST", headers: Record<string, string> = {}) => ({ method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("support : message gardé en base avec son contexte, listé dans l'administration, limité par jour", async () => {
  process.env.LUCIEN_AUTH = "0"; process.env.LUCIEN_ADMIN_TOKEN = "secret-admin";
  const db = new Db(":memory:");
  seedDemo(db);
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  assert.equal((await api.request("/support", json({ sujet: "banque", message: "ok" }))).status, 400, "too short");
  const r = await api.request("/support", json({ sujet: "banque", message: "Ma banque ne se connecte pas", appareil: "iPhone Safari", ecran: "390x844", page: "settings" }));
  assert.equal(r.status, 201);
  assert.equal((await r.json()).ok, true);
  assert.equal((await api.request("/admin/support")).status, 403);
  const auth = { authorization: "Bearer secret-admin" };
  const l = await (await api.request("/admin/support", { headers: auth })).json();
  assert.equal(l.length, 1);
  assert.equal(l[0].sujet, "banque");
  assert.equal(l[0].contexte.appareil, "iPhone Safari");
  assert.equal(l[0].traite, false);
  await api.request(`/admin/support/${l[0].id}`, json({ traite: true }, "POST", auth));
  assert.equal((await (await api.request("/admin/support", { headers: auth })).json())[0].traite, true);
  const sansInfos = await api.request("/support", json({ sujet: "idee", message: "Une idée de fonction", infos: false, appareil: "secret" }));
  assert.equal(sansInfos.status, 201);
  assert.equal(JSON.stringify(db.raw.prepare("SELECT contexte FROM support_messages WHERE sujet = 'idee'").get()).includes("secret"), false, "no device info when unticked");
  for (let i = 0; i < 8; i++) await api.request("/support", json({ sujet: "question", message: "Encore une question" }));
  assert.equal((await api.request("/support", json({ sujet: "question", message: "Encore une question" }))).status, 429);
  delete process.env.LUCIEN_ADMIN_TOKEN;
});
