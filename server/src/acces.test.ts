import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";

const json = (body: unknown, method = "POST", headers: Record<string, string> = {}) => ({ method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("avant-première : seules les adresses invitées demandent un lien de connexion", async () => {
  process.env.LUCIEN_AUTH = "1"; process.env.LUCIEN_ADMIN_TOKEN = "secret-admin"; process.env.LUCIEN_ACCES = "restreint"; process.env.LUCIEN_ACCES_EMAILS = "benjamin@exemple.fr";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const auth = { authorization: "Bearer secret-admin" };
  assert.equal((await api.request("/auth/demander", json({ email: "inconnue@exemple.fr" }))).status, 403);
  assert.notEqual((await api.request("/auth/demander", json({ email: "Benjamin@exemple.fr" }))).status, 403, "server list");
  assert.equal((await api.request("/admin/acces", json({ email: "soeur@exemple.fr", prenom: "Anne" }))).status, 403, "admin only");
  assert.equal((await api.request("/admin/acces", json({ email: "Soeur@Exemple.fr", prenom: "Anne" }, "POST", auth))).status, 201);
  assert.notEqual((await api.request("/auth/demander", json({ email: "soeur@exemple.fr" }))).status, 403, "invited");
  const l = await (await api.request("/admin/acces", { headers: auth })).json();
  assert.equal(l.restreint, true);
  assert.equal(l.liste[0].email, "soeur@exemple.fr");
  assert.equal((await api.request("/admin/acces/lien", json({ email: "inconnue@exemple.fr" }, "POST", auth))).status, 403);
  const lien = await (await api.request("/admin/acces/lien", json({ email: "benjamin@exemple.fr" }, "POST", auth))).json();
  assert.match(lien.lien, /\/api\/auth\/lien\?token=/);
  await api.request("/admin/acces/soeur%40exemple.fr", { method: "DELETE", headers: auth });
  assert.equal((await api.request("/auth/demander", json({ email: "soeur@exemple.fr" }))).status, 403, "removed");
  delete process.env.LUCIEN_ACCES; delete process.env.LUCIEN_ACCES_EMAILS; delete process.env.LUCIEN_ADMIN_TOKEN;
  assert.notEqual((await api.request("/auth/demander", json({ email: "inconnue2@exemple.fr" }))).status, 403, "open when not restricted");
});
