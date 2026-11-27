import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { demanderLien, consommerLien } from "./auth.js";

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

test("accès offert : un proche marqué « offert » a tout Lucien sans payer, et revient à la normale si on le retire", async () => {
  delete process.env.STRIPE_SECRET_KEY; delete process.env.LUCIEN_PAIEMENT_SIMULE;
  process.env.LUCIEN_AUTH = "1"; process.env.LUCIEN_ADMIN_TOKEN = "secret-admin"; process.env.LUCIEN_ACCES = "restreint";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const auth = { authorization: "Bearer secret-admin" };
  assert.equal((await api.request("/admin/acces", json({ email: "soeur@exemple.fr", prenom: "Anne", envoyer_email: false, offert: true }, "POST", auth))).status, 201);
  const r = await demanderLien(db, "soeur@exemple.fr", { prenom: "Anne" });
  const c = consommerLien(db, new URL(r.lien!).searchParams.get("token")!, 15);
  assert.ok(c.ok);
  const ck = { cookie: `lucien_session=${c.ok ? c.session : ""}` };
  const h = await (await api.request("/household", { headers: ck })).json();
  assert.equal(h.abonnement.statut, "offert");
  assert.equal(h.plan, "famille");
  assert.equal(h.abonnement.formule, "tribu");
  assert.deepEqual([...h.modules].sort(), ["assistant", "budget_expert", "locatif", "vie_pro_independant"]);
  assert.equal((await api.request("/abonnement/checkout", { method: "POST", headers: { ...ck, "content-type": "application/json" }, body: JSON.stringify({ formule: "duo", periode: "mensuel", demarrage_immediat: true }) })).status, 503, "nothing to pay, and no payment without Stripe");
  const l = await (await api.request("/admin/acces", { headers: auth })).json();
  assert.equal(l.liste[0].offert, true);
  // the household was created during this request: its trial is still running after the « offert » is removed
  assert.equal((await api.request("/admin/acces/soeur%40exemple.fr", json({ offert: false }, "PATCH", auth))).status, 200);
  const h2 = await (await api.request("/household", { headers: ck })).json();
  assert.equal(h2.abonnement.statut, null);
  assert.deepEqual(h2.modules, []);
  assert.ok(h2.essai?.actif, "back to the normal trial");
  assert.equal((await api.request("/admin/acces/inconnu%40exemple.fr", json({ offert: true }, "PATCH", auth))).status, 404);
  delete process.env.LUCIEN_ACCES; delete process.env.LUCIEN_ADMIN_TOKEN;
});

test("lien à partager : chacun entre avec son adresse, tant qu'il reste une place et que la date n'est pas passée", async () => {
  process.env.LUCIEN_AUTH = "1"; process.env.LUCIEN_ADMIN_TOKEN = "secret-admin"; process.env.LUCIEN_ACCES = "restreint"; delete process.env.LUCIEN_ACCES_EMAILS;
  const { oublierDemandes } = await import("./auth.js"); oublierDemandes();
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const auth = { authorization: "Bearer secret-admin" };
    assert.equal((await api.request("/admin/acces/liens", json({ nom: "Famille", places: 2, jours: 15 }))).status, 403, "admin only");
    const cree = await (await api.request("/admin/acces/liens", json({ nom: "Famille", places: 2, jours: 15 }, "POST", auth))).json();
    assert.match(cree.url, /\/\?invitation=[a-z0-9]{10}$/);
    assert.deepEqual(await (await api.request(`/auth/invitation/${cree.code}`)).json(), { valable: true });
    assert.deepEqual(await (await api.request("/auth/invitation/nimportequoi")).json(), { valable: false });
    assert.equal((await api.request("/auth/demander", json({ email: "tante@exemple.fr" }))).status, 403, "without the link: closed");
    assert.equal((await api.request("/auth/demander", json({ email: "tante@exemple.fr", invitation: "mauvaiscode" }))).status, 403);
    assert.notEqual((await api.request("/auth/demander", json({ email: "Tante@exemple.fr", invitation: cree.code.toUpperCase() }))).status, 403);
    assert.notEqual((await api.request("/auth/demander", json({ email: "tante@exemple.fr", invitation: cree.code }))).status, 403, "same address: no second place taken");
    assert.notEqual((await api.request("/auth/demander", json({ email: "cousin@exemple.fr", invitation: cree.code }))).status, 403);
    const plein = await api.request("/auth/demander", json({ email: "voisin@exemple.fr", invitation: cree.code }));
    assert.equal(plein.status, 403); assert.match((await plein.json()).message, /plus valable/);
    const liens = (await (await api.request("/admin/acces/liens", { headers: auth })).json()).liens;
    assert.equal(liens[0].utilises, 2); assert.equal(liens[0].valable, false);
    const liste = (await (await api.request("/admin/acces", { headers: auth })).json()).liste;
    assert.deepEqual(liste.map((x: any) => x.email).sort(), ["cousin@exemple.fr", "tante@exemple.fr"]); assert.match(liste[0].note, /Lien « Famille »/);
    assert.notEqual((await api.request("/auth/demander", json({ email: "tante@exemple.fr" }))).status, 403, "once in, the link is no longer needed");
    // a link past its date
    const vieux = await (await api.request("/admin/acces/liens", json({ nom: "Vieux", places: 5, jours: 1 }, "POST", auth))).json();
    db.raw.prepare("UPDATE acces_liens SET expire_le = ? WHERE code = ?").run("2020-01-01T00:00:00.000Z", vieux.code);
    assert.equal((await api.request("/auth/demander", json({ email: "ami@exemple.fr", invitation: vieux.code }))).status, 403);
    assert.equal((await api.request(`/admin/acces/liens/${vieux.code}`, { method: "DELETE", headers: auth })).status, 200);
  } finally { delete process.env.LUCIEN_ACCES; delete process.env.LUCIEN_ADMIN_TOKEN; }
});
