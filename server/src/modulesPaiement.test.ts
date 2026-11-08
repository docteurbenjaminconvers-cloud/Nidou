import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { appliquerAbonnement, appliquerEvenement, changerModules, modulesConserves, remplacerStripe, retirerApresPaiement } from "./abonnement.js";
import { ensureAssistantSchema } from "./assistant.js";
import { ensureVeilleSchema } from "./veille.js";
import { envModule, envPack, lignesModules, planChangement, tousLesPrix } from "./stripeModules.js";

const ENV = Object.fromEntries(tousLesPrix().map((x) => [x.env, `price_${x.env.toLowerCase()}`]));
const AN = 365 * 86400, DEBUT = 1_800_000_000, FIN = DEBUT + AN, MILIEU = DEBUT + AN / 2;
const prix = (env: string, centimes: number) => ({ id: ENV[env], unit_amount: centimes, product: `prod_${env}` });

test("plan : un ajout se paie, un pack déduit les options qu'il remplace, un retrait sans remboursement reste ouvert jusqu'à l'échéance", () => {
  const items = [
    { id: "si_socle", price: { id: "price_duo", unit_amount: 9900, product: "prod_duo" }, quantity: 1, current_period_start: DEBUT, current_period_end: FIN },
    { id: "si_budget", price: prix(envModule("budget_expert", "annuel"), 4900), quantity: 1, current_period_start: DEBUT, current_period_end: FIN },
    { id: "si_veille", price: prix(envModule("veille", "annuel"), 3900), quantity: 2, current_period_start: DEBUT, current_period_end: FIN },
  ];
  // Budget expert → pack Intégral, one close one fewer
  const p = planChangement(items, lignesModules({ formule: "duo", periode: "annuel", modules: ["veille"], pack: "integral", proches: 1 }), { maintenant: MILIEU, essai: false, env: ENV });
  assert.deepEqual(p.payant.items, [{ price: ENV[envPack("integral", "duo", "annuel")], quantity: 1 }]);
  assert.deepEqual(p.payant.credits, [{ item: "si_budget", product: `prod_${envModule("budget_expert", "annuel")}`, montant: 2450 }], "half the year of Budget expert, deducted today");
  assert.deepEqual(p.apresPaiement, ["si_budget"], "removed only once the pack is paid");
  assert.deepEqual(p.gratuit, [{ id: "si_veille", quantity: 1 }], "fewer close ones: at once, no credit");
  assert.deepEqual(p.conserves, []);

  // simple removal: no credit, the module stays open until the end of the year
  const r = planChangement(items, lignesModules({ formule: "duo", periode: "annuel", modules: ["veille"], pack: null, proches: 2 }), { maintenant: MILIEU, essai: false, env: ENV });
  assert.deepEqual(r.payant, { items: [], credits: [] });
  assert.deepEqual(r.gratuit, [{ id: "si_budget", deleted: true }]);
  assert.deepEqual(r.conserves, [{ module: "budget_expert", jusqu_au: new Date(FIN * 1000).toISOString().slice(0, 10) }]);

  // taking it back before the end of the year: already paid, nothing charged now
  const sans = items.filter((i) => i.id !== "si_budget");
  const b = planChangement(sans, lignesModules({ formule: "duo", periode: "annuel", modules: ["veille", "budget_expert"], pack: null, proches: 2 }), { maintenant: MILIEU, essai: false, conserves: ["budget_expert"], env: ENV });
  assert.deepEqual(b.payant.items, []);
  assert.deepEqual(b.gratuit, [{ price: ENV[envModule("budget_expert", "annuel")], quantity: 1 }]);

  // one more close one: charged
  const v = planChangement(items, lignesModules({ formule: "duo", periode: "annuel", modules: ["veille", "budget_expert"], pack: null, proches: 3 }), { maintenant: MILIEU, essai: false, env: ENV });
  assert.deepEqual(v.payant.items, [{ id: "si_veille", quantity: 3 }]);
  // during a free trial nothing was paid: nothing to credit
  assert.deepEqual(planChangement(items, lignesModules({ formule: "duo", periode: "annuel", modules: [], pack: "integral" }), { maintenant: MILIEU, essai: true, env: ENV }).payant.credits, []);
});

/** A fake Stripe with pending updates: an update that needs a payment applies only if the card goes through. */
function fauxStripe(carte: "ok" | "3ds") {
  let n = 0;
  const sub: any = { id: "sub_1", customer: "cus_1", status: "active", metadata: {}, pending_update: null, items: { data: [
    { id: "si_socle", price: { id: "price_duo", unit_amount: 9900, product: "prod_duo" }, quantity: 1, current_period_start: DEBUT, current_period_end: FIN },
    { id: "si_budget", price: prix(envModule("budget_expert", "annuel"), 4900), quantity: 1, current_period_start: DEBUT, current_period_end: FIN },
  ] } };
  const journal: any[] = [];
  const appliquer = (items: any[]) => {
    for (const x of items) {
      if (x.deleted) sub.items.data = sub.items.data.filter((i: any) => i.id !== x.id);
      else if (x.id) sub.items.data.find((i: any) => i.id === x.id).quantity = x.quantity;
      else sub.items.data.push({ id: `si_${++n}`, price: { id: x.price, unit_amount: 0, product: "prod_x" }, quantity: x.quantity, current_period_start: DEBUT, current_period_end: FIN });
    }
  };
  const client = {
    subscriptions: {
      async retrieve() { return structuredClone(sub); },
      async update(_id: string, p: any) {
        journal.push(structuredClone(p));
        if (p.payment_behavior === "pending_if_incomplete") {
          assert.ok(!p.items.some((x: any) => x.deleted), "Stripe refuses item deletions in a pending update");
          assert.equal(p.proration_behavior, "always_invoice");
          if (carte === "3ds") { sub.pending_update = { subscription_items: p.items, metadata: p.metadata }; return { ...structuredClone(sub), latest_invoice: { hosted_invoice_url: "https://invoice.stripe.com/i/test" } }; }
        }
        if (p.items) appliquer(p.items);
        if (p.metadata) Object.assign(sub.metadata, p.metadata);
        return structuredClone(sub);
      },
    },
    invoices: {
      async createPreview(p: any) {
        const d = p.subscription_details.proration_date;
        return { lines: { data: [
          { amount: 11500, period: { start: d }, parent: { subscription_item_details: { proration: true } } }, // the new pack, half a year
          { amount: 1200, period: { start: d - 9999 }, parent: { invoice_item_details: { proration: true } } }, // left from an earlier change
          { amount: 36800, period: { start: FIN }, parent: { subscription_item_details: { proration: false } } }, // renewal
        ] } };
      },
    },
    payer() { sub.pending_update && (appliquer(sub.pending_update.subscription_items), Object.assign(sub.metadata, sub.pending_update.metadata), sub.pending_update = null); },
    sub, journal,
  };
  return client;
}

function foyer() {
  const db = new Db(":memory:");
  ensureAssistantSchema(db); ensureVeilleSchema(db);
  const h = db.createHousehold("Test", 0);
  appliquerAbonnement(db, h, { customer: "cus_1", subscription: "sub_1", statut: "active", formule: "duo", periode: "annuel", fin: new Date(FIN * 1000).toISOString().slice(0, 10) });
  db.setModules(h.id, ["budget_expert"]);
  return { db, h: db.getHousehold(h.id)! };
}

test("options en cours d'abonnement : montant annoncé, carte débitée, pack ouvert seulement une fois payé", async () => {
  Object.assign(process.env, ENV, { STRIPE_SECRET_KEY: "sk_test_x" });
  const f = fauxStripe("ok"); remplacerStripe(f);
  try {
    const { db, h } = foyer();
    const choix = { formule: "duo" as const, periode: "annuel" as const, modules: [], pack: "integral" };
    const a = await changerModules(db, h, choix, null);
    assert.ok(a.apercu, "an existing subscription first gets an estimate");
    assert.equal(f.journal.length, 0, "nothing changed on Stripe");
    assert.deepEqual(db.getModules(h.id), ["budget_expert"], "nothing opened yet");
    const credit = Math.round(4900 * (FIN - a.apercu!.proration_date) / AN) / 100;
    assert.equal(a.apercu!.credit, credit);
    assert.equal(a.apercu!.aujourdhui, Math.round((11500 - credit * 100)) / 100, "only this change's prorations, minus Budget expert");
    assert.equal(a.apercu!.prochain.montant, 329, "Duo + Intégral, per year");

    const r = await changerModules(db, h, choix, null, false, { confirmer: true, prorationDate: a.apercu!.proration_date });
    assert.equal(r.attente, false);
    const paye = f.journal.find((p) => p.payment_behavior);
    assert.equal(paye.proration_date, a.apercu!.proration_date, "same amounts as announced");
    assert.equal(paye.add_invoice_items[0].price_data.unit_amount, -Math.round(credit * 100));
    assert.ok(!f.sub.items.data.some((i: any) => i.id === "si_budget"), "Budget expert line removed once the pack is paid");
    assert.equal(f.sub.metadata.lucien_retirer, "");
    assert.deepEqual([...db.getModules(h.id)].sort(), ["assistant", "budget_expert", "locatif", "vie_pro_independant"]);
  } finally { remplacerStripe(null); for (const k of [...Object.keys(ENV), "STRIPE_SECRET_KEY"]) delete process.env[k]; }
});

test("options : validation bancaire demandée → rien n'est ouvert avant le paiement, puis le webhook termine", async () => {
  Object.assign(process.env, ENV, { STRIPE_SECRET_KEY: "sk_test_x" });
  const f = fauxStripe("3ds"); remplacerStripe(f);
  try {
    const { db, h } = foyer();
    const r = await changerModules(db, h, { formule: "duo", periode: "annuel", modules: [], pack: "integral" }, null, false, { confirmer: true });
    assert.equal(r.attente, true);
    assert.equal(r.url, "https://invoice.stripe.com/i/test", "the customer confirms on Stripe's invoice page");
    assert.deepEqual(db.getModules(h.id), ["budget_expert"], "the pack is not open before the payment");
    f.payer();
    // Stripe then sends customer.subscription.updated with the new items
    appliquerEvenement(db, { type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: f.sub.metadata, items: { data: f.sub.items.data } } } });
    assert.ok(db.getModules(h.id).includes("locatif"));
    await retirerApresPaiement("sub_1");
    assert.ok(!f.sub.items.data.some((i: any) => i.id === "si_budget"));
  } finally { remplacerStripe(null); for (const k of [...Object.keys(ENV), "STRIPE_SECRET_KEY"]) delete process.env[k]; }
});

test("options : un retrait garde le module ouvert jusqu'à l'échéance, sans remboursement", async () => {
  Object.assign(process.env, ENV, { STRIPE_SECRET_KEY: "sk_test_x" });
  const f = fauxStripe("ok"); remplacerStripe(f);
  try {
    const { db, h } = foyer();
    await changerModules(db, h, { formule: "duo", periode: "annuel", modules: [], pack: null }, null, false, { confirmer: true });
    const sansPaiement = f.journal.every((p) => p.proration_behavior === "none");
    assert.ok(sansPaiement, "no credit, no charge");
    assert.ok(!f.sub.items.data.some((i: any) => i.id === "si_budget"), "not renewed");
    assert.deepEqual(db.getModules(h.id), ["budget_expert"], "still open: already paid");
    assert.deepEqual(modulesConserves(db, h.id).map((x) => x.module), ["budget_expert"]);
    // the webhook that follows keeps it open too
    appliquerEvenement(db, { type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", items: { data: f.sub.items.data } } } });
    assert.deepEqual(db.getModules(h.id), ["budget_expert"]);
    // after the end of the period it closes
    assert.deepEqual(modulesConserves(db, h.id, new Date(FIN * 1000 + 86400000).toISOString().slice(0, 10)), []);
  } finally { remplacerStripe(null); for (const k of [...Object.keys(ENV), "STRIPE_SECRET_KEY"]) delete process.env[k]; }
});
