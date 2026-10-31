import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { etatRetractation, marquerDebutAbonnement, remboursementProrata, seRetracter } from "./retractation.js";
import { creerCheckout, ConsentementRequis } from "./abonnement.js";

const J = 86400;
const DEBUT = Date.parse("2026-11-01T00:00:00Z") / 1000, FIN = DEBUT + 365 * J;

function fauxStripe() {
  const appels = { cancel: [] as string[], refunds: [] as { params: Record<string, unknown>; opts: Record<string, unknown> }[] };
  let statut = "active";
  const client = {
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", status: statut, latest_invoice: "in_1", items: { data: [{ current_period_start: DEBUT, current_period_end: FIN }] } }),
      cancel: async (id: string) => { appels.cancel.push(id); statut = "canceled"; return {}; },
    },
    invoices: { retrieve: async () => ({ id: "in_1", amount_paid: 9900, payments: { data: [{ payment: { payment_intent: "pi_1" } }] } }) },
    refunds: { create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => { appels.refunds.push({ params, opts }); return {}; } },
  } as unknown as Stripe;
  return { client, appels };
}

test("rétractation : remboursement de ce qui a été payé moins les jours utilisés", () => {
  assert.equal(remboursementProrata(9900, DEBUT, FIN, DEBUT + 5 * J), 9764, "99 € par an, 5e jour : 97,64 €");
  assert.equal(remboursementProrata(0, DEBUT, FIN, DEBUT), 0, "free partner month: nothing paid, nothing refunded");
});

test("rétractation : 14 jours après un nouvel abonnement, une seule fois ; arrêt immédiat et remboursement", async () => {
  const db = new Db(":memory:"); createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = db.createHousehold("Famille");
  db.raw.prepare("UPDATE households SET stripe_subscription_id = 'sub_1', abonnement_statut = 'active', plan = 'famille' WHERE id = ?").run(h.id);
  marquerDebutAbonnement(db, h.id, new Date(DEBUT * 1000));
  assert.deepEqual(etatRetractation(db, h.id, new Date((DEBUT + 5 * J) * 1000)), { possible: true, jusquau: "2026-11-15" });
  assert.equal(etatRetractation(db, h.id, new Date((DEBUT + 15 * J) * 1000)).possible, false, "after 14 days");
  const { client, appels } = fauxStripe();
  const r = await seRetracter(db, h.id, { client, maintenant: new Date((DEBUT + 5 * J) * 1000) });
  assert.equal(r.rembourse_centimes, 9764);
  assert.deepEqual(appels.cancel, ["sub_1"]);
  assert.equal(appels.refunds[0].params.payment_intent, "pi_1"); assert.equal(appels.refunds[0].params.amount, 9764);
  assert.equal(appels.refunds[0].opts.idempotencyKey, "lucien-retractation-sub_1");
  assert.equal(db.getHousehold(h.id)!.plan, "gratuit", "back to read-only, nothing erased");
  assert.ok(db.getHousehold(h.id), "household kept");
  await assert.rejects(seRetracter(db, h.id, { client, maintenant: new Date((DEBUT + 6 * J) * 1000) }), /déjà été faite|passé/);
  assert.equal(appels.refunds.length, 1, "only once");
});

test("rétractation : un nouvel abonnement exige la demande de démarrage immédiat", async () => {
  const db = new Db(":memory:"); createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = db.createHousehold("Famille");
  await assert.rejects(creerCheckout(db, h, "duo", "mensuel", null), (e) => e instanceof ConsentementRequis);
});
