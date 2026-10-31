import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { createApi } from "./api.js";
import { joursOfferts, nouveauCode } from "./partenaires.js";

const json = (body: unknown, method = "POST", headers: Record<string, string> = {}) => ({ method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("partenaires : inscription du cabinet, validation par Lucien, code saisi par le client, mois offert une seule fois", async () => {
  process.env.LUCIEN_AUTH = "0"; process.env.LUCIEN_ADMIN_TOKEN = "secret-admin";
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  assert.equal((await api.request("/partenaires", json({ nom: "Cabinet Durand & associés", email: "contact@durand.fr", ville: "Montpellier" }))).status, 201);
  assert.equal((await api.request("/admin/partenaires")).status, 403, "admin only");
  const liste = await (await api.request("/admin/partenaires", { headers: { authorization: "Bearer secret-admin" } })).json();
  const code = liste[0].code as string;
  assert.match(code, /^CABI-[A-Z2-9]{4}$/);
  assert.equal((await api.request("/partenaire", json({ code }, "PUT"))).status, 400, "not usable before validation");
  await api.request(`/admin/partenaires/${code}`, json({ statut: "valide" }, "POST", { authorization: "Bearer secret-admin" }));
  const r = await (await api.request("/partenaire", json({ code: code.toLowerCase() }, "PUT"))).json();
  assert.equal(r.cabinet.nom, "Cabinet Durand & associés");
  assert.equal(joursOfferts(db, db.getHousehold(h.id)!), 30);
  db.raw.prepare("UPDATE households SET stripe_subscription_id = 'sub_1', abonnement_statut = 'active' WHERE id = ?").run(h.id);
  assert.equal(joursOfferts(db, db.getHousehold(h.id)!), 0, "first subscription only");
  assert.notEqual(nouveauCode("Été"), nouveauCode("Été"));
  delete process.env.LUCIEN_ADMIN_TOKEN;
});
