import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { appliquerEvenement, appliquerAbonnement } from "./abonnement.js";

test("abonnement : checkout → famille, résiliation → gratuit, impayé → famille en sursis", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 0);
  assert.equal(db.effectivePlan(h), "gratuit");
  appliquerEvenement(db, { type: "checkout.session.completed", data: { object: { id: "cs_1", customer: "cus_1", subscription: "sub_1", client_reference_id: h.id, metadata: { periode: "annuel" } } } });
  let x = db.getHousehold(h.id)!;
  assert.equal(x.plan, "famille"); assert.equal(x.abonnement_periode, "annuel"); assert.equal(x.stripe_customer_id, "cus_1");
  appliquerEvenement(db, { type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", items: { data: [{ price: { id: "p", recurring: { interval: "year" } }, current_period_end: 1800000000 }] } } } });
  x = db.getHousehold(h.id)!;
  assert.equal(x.abonnement_fin, new Date(1800000000 * 1000).toISOString().slice(0, 10));
  appliquerEvenement(db, { type: "invoice.payment_failed", data: { object: { id: "in_1", customer: "cus_1" } } });
  assert.equal(db.getHousehold(h.id)!.plan, "famille", "past_due keeps access while Stripe retries");
  appliquerEvenement(db, { type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled" } } });
  x = db.getHousehold(h.id)!;
  assert.equal(x.plan, "gratuit"); assert.equal(x.abonnement_statut, "canceled");
  assert.equal(appliquerEvenement(db, { type: "charge.refunded", data: { object: { id: "ch" } } }), "ignoré: charge.refunded");
  appliquerAbonnement(db, x, { statut: "simule", periode: "mensuel" });
  assert.equal(db.getHousehold(h.id)!.plan, "famille");
});

test("formules : capacité de comptes selon gratuit, essai, Solo, Duo, Tribu ; changement de formule par le prix Stripe", async () => {
  const { capaciteComptes, appliquerEvenement: ev, FORMULES } = await import("./abonnement.js");
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15);
  assert.equal(capaciteComptes(db, h), 6, "trial = Tribu");
  db.setTrialEnd(h.id, new Date(0).toISOString());
  assert.equal(capaciteComptes(db, db.getHousehold(h.id)!), 1, "free = 1 person");
  for (const [f, n] of [["solo", 1], ["duo", 2], ["tribu", 6]] as const) {
    appliquerAbonnement(db, db.getHousehold(h.id)!, { statut: "simule", formule: f, periode: "mensuel" });
    assert.equal(capaciteComptes(db, db.getHousehold(h.id)!), n, f);
  }
  assert.equal(FORMULES.tribu.prix.annuel, 139); assert.equal(FORMULES.solo.prix.mensuel, 6.9);
  // a change made in the Stripe portal: the billed price decides the formule, even with stale metadata
  process.env.STRIPE_PRICE_SOLO_ANNUEL = "price_solo_an";
  ev(db, { type: "customer.subscription.updated", data: { object: { id: "sub", customer: "cus_x", status: "active", metadata: { household_id: h.id, formule: "tribu" }, items: { data: [{ price: { id: "price_solo_an", recurring: { interval: "year" } } }] } } } });
  const x = db.getHousehold(h.id)!;
  assert.equal(x.formule, "solo"); assert.equal(x.abonnement_periode, "annuel");
  delete process.env.STRIPE_PRICE_SOLO_ANNUEL;
});
