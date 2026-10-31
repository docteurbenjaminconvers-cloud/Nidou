import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { appliquerEvenement } from "./abonnement.js";
import { ensureAssistantSchema } from "./assistant.js";
import { ensureVeilleSchema } from "./veille.js";
import { ecartItems, envModule, envPack, lignesModules, modulesDepuisItems, prixManquants, tousLesPrix } from "./stripeModules.js";

const ENV = Object.fromEntries(tousLesPrix().map((x) => [x.env, `price_${x.env.toLowerCase()}`]));

test("stripe modules : lignes d'un choix (pack + modules hors pack + biens en plus)", () => {
  const l = lignesModules({ formule: "duo", periode: "annuel", modules: ["veille", "vie_pro_salarie"], pack: "integral", biens: 4, proches: 2 });
  assert.deepEqual(l.map((x) => [x.cle, x.quantite]), [["pack:integral", 1], ["veille", 2], ["locatif_bien", 2]], "Salarié is inside Indépendant, never billed twice");
  assert.equal(l[0].env, envPack("integral", "duo", "annuel"));
  assert.equal(l[0].mensuel, 32.9 - 9.9, "pack line = pack total minus the socle");
  assert.deepEqual(prixManquants(l, ENV), []);
  assert.equal(prixManquants(l, {}).length, 3, "never a checkout with a missing price");
  const seul = lignesModules({ formule: "solo", periode: "mensuel", modules: ["locatif", "budget_expert"], pack: null, biens: 1 });
  assert.deepEqual(seul.map((x) => x.env), [envModule("locatif", "mensuel"), envModule("budget_expert", "mensuel")]);
});

test("stripe modules : lecture d'un abonnement et écart à appliquer", () => {
  const items = [{ id: "si_socle", price: { id: "price_socle" } }, { id: "si_pack", price: { id: ENV[envPack("patrimoine", "solo", "mensuel")] } }, { id: "si_v", price: { id: ENV[envModule("veille", "mensuel")] }, quantity: 2 }];
  const lu = modulesDepuisItems(items, ENV);
  assert.deepEqual(lu.modules.sort(), ["assistant", "budget_expert", "locatif", "veille"]);
  assert.equal(lu.pack, "patrimoine"); assert.equal(lu.proches, 2);
  const e = ecartItems(items, lignesModules({ formule: "solo", periode: "mensuel", modules: ["veille"], pack: "integral", proches: 1 }), ENV);
  assert.deepEqual(e.supprimer, ["si_pack"], "the socle line is never touched");
  assert.deepEqual(e.modifier, [{ id: "si_v", quantite: 1 }]);
  assert.deepEqual(e.ajouter, [{ price: ENV[envPack("integral", "solo", "mensuel")], quantite: 1 }]);
});

test("stripe modules : le webhook ouvre les modules facturés et les ferme à la résiliation", () => {
  const db = new Db(":memory:");
  ensureAssistantSchema(db); ensureVeilleSchema(db);
  const h = db.createHousehold("Test", 0);
  Object.assign(process.env, ENV);
  try {
    appliquerEvenement(db, { type: "checkout.session.completed", data: { object: { id: "cs", customer: "cus", subscription: "sub", client_reference_id: h.id, metadata: { periode: "mensuel", formule: "solo", modules: JSON.stringify({ modules: [], pack: "independant" }) } } } });
    assert.deepEqual(db.getModules(h.id).sort(), ["assistant", "budget_expert", "vie_pro_independant"]);
    appliquerEvenement(db, { type: "customer.subscription.updated", data: { object: { id: "sub", customer: "cus", status: "active", items: { data: [{ price: { id: "price_socle" } }, { price: { id: ENV[envModule("locatif", "mensuel")] } }] } } } });
    assert.deepEqual(db.getModules(h.id), ["locatif"], "what is billed decides");
    appliquerEvenement(db, { type: "customer.subscription.deleted", data: { object: { id: "sub", customer: "cus", status: "canceled" } } });
    assert.deepEqual(db.getModules(h.id), []);
  } finally { for (const k of Object.keys(ENV)) delete process.env[k]; }
});
