import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { createApi } from "./api.js";

const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("espaces : ouverts pendant l'essai, fermés (402) après, données validées et rapports calculés", async () => {
  process.env.LUCIEN_AUTH = "0"; delete process.env.STRIPE_SECRET_KEY; delete process.env.LUCIEN_PAIEMENT_SIMULE;
  const db = new Db(":memory:");
  const h = seedDemo(db, { espaces: true });
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const loc = await (await api.request("/espaces/locatif")).json();
  assert.equal(loc.rapport.biens.length, 2, "trial: everything is open");
  const pro = await (await api.request("/espaces/pro")).json();
  assert.ok(pro.rapport.personnes[1].independant.recettes > 0);
  const bud = await (await api.request("/espaces/budget")).json();
  assert.ok(bud.rapport.bilan.valeur_nette > 0);
  const budget = await (await api.request("/budget")).json();
  assert.ok(!JSON.stringify(budget).includes("CARPIMKO"), "the practice's account stays out of the family budget");
  assert.equal((await api.request("/espaces/locatif", json({ bailleur: "x", biens: [{ id: "1" }], baux: [] }, "PUT"))).status, 400, "invalid data refused");
  assert.equal((await api.request("/espaces/locatif", json({ bailleur: "Moi", biens: [], baux: [] }, "PUT"))).status, 200);
  // after the trial, on the free plan: closed
  db.setTrialEnd(h.id, new Date(0).toISOString()); db.setPlan(h.id, "gratuit");
  const r = await api.request("/espaces/locatif");
  assert.equal(r.status, 402); assert.equal((await r.json()).module, "locatif");
});

test("offre : souscrire un module est un paiement — impossible sans paiement en ligne, simulé seulement en test", async () => {
  process.env.LUCIEN_AUTH = "0"; delete process.env.STRIPE_SECRET_KEY; delete process.env.LUCIEN_PAIEMENT_SIMULE;
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  assert.equal((await api.request("/offre/modules", json({ modules: ["locatif"] }))).status, 503);
  assert.deepEqual(db.getModules(h.id), []);
  process.env.LUCIEN_PAIEMENT_SIMULE = "1";
  const ok = await (await api.request("/offre/modules", json({ modules: [], pack: "patrimoine" }))).json();
  assert.deepEqual(ok.souscrits.sort(), ["assistant", "budget_expert", "locatif"]);
  delete process.env.LUCIEN_PAIEMENT_SIMULE;
  const d = await (await api.request("/offre/devis", json({ formule: "duo", periode: "annuel", modules: [], pack: "integral" }))).json();
  assert.equal(d.total, 319);
});
