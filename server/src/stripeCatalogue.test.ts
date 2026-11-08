import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { catalogue, lookupKey, preparerStripe, type StripeMini } from "./stripeCatalogue.js";
import { tousLesPrix, lignesModules } from "./stripeModules.js";

/** A fake Stripe keeping prices and webhooks in memory, with lookup_key transfer like the real one. */
function fauxStripe() {
  const prix: { id: string; lookup_key: string | null; unit_amount: number; recurring: { interval: string }; active: boolean }[] = [];
  const webhooks: { id: string; url: string; status: string; secret: string }[] = [];
  let n = 0;
  const client: StripeMini = {
    prices: {
      async list(p) { return { data: prix.filter((x) => x.active && x.lookup_key && p.lookup_keys.includes(x.lookup_key)) }; },
      async create(p: any) {
        if (p.transfer_lookup_key) for (const x of prix) if (x.lookup_key === p.lookup_key) x.lookup_key = null;
        const x = { id: `price_${++n}`, lookup_key: p.lookup_key, unit_amount: p.unit_amount, recurring: p.recurring, active: true };
        prix.push(x); return { id: x.id };
      },
    },
    webhookEndpoints: {
      async list() { return { data: webhooks }; },
      async create(p: any) { const w = { id: `we_${++n}`, url: p.url, status: "enabled", secret: `whsec_${n}` }; webhooks.push(w); return w; },
    },
  };
  const portails: { id: string; metadata: Record<string, string> }[] = [];
  client.billingPortal = { configurations: { async list() { return { data: portails }; }, async create(p: any) { const c = { id: `bpc_${++n}`, metadata: p.metadata }; portails.push(c); return c; } } };
  return { client, prix, webhooks, portails };
}

test("Stripe : la grille de Lucien est créée une fois, avec le webhook, et suit un changement de prix", async () => {
  const db = new Db(":memory:");
  const f = fauxStripe();
  const env: Record<string, string | undefined> = { STRIPE_SECRET_KEY: "sk_test_x", LUCIEN_PUBLIC_URL: "https://nidou.onrender.com" };
  const r1 = await preparerStripe(db, f.client, env);
  assert.equal(r1.crees, catalogue().length);
  assert.equal(r1.webhook, "cree");
  assert.equal(f.webhooks[0].url, "https://nidou.onrender.com/api/stripe/webhook");
  assert.equal(env.STRIPE_WEBHOOK_SECRET, f.webhooks[0].secret, "the signing secret, given once by Stripe, is kept");
  // every price the billing code may read exists
  for (const x of tousLesPrix()) assert.ok(env[x.env], x.env);
  for (const k of ["STRIPE_PRICE_SOLO_MENSUEL", "STRIPE_PRICE_TRIBU_ANNUEL", "STRIPE_PRICE_VEILLE_MENSUEL", "STRIPE_PRICE_ASSISTANT_ANNUEL"]) assert.ok(env[k], k);
  const solo = f.prix.find((p) => p.lookup_key === lookupKey("STRIPE_PRICE_SOLO_MENSUEL"))!;
  assert.equal(solo.unit_amount, 690);
  assert.equal(f.prix.find((p) => p.lookup_key === lookupKey("STRIPE_PRICE_DUO_ANNUEL"))!.unit_amount, 9900);
  // the Intégral pack line of a Solo checkout matches its catalogue price: 29,90 € in all
  const ligne = lignesModules({ formule: "solo", periode: "mensuel", modules: [], pack: "integral" })[0];
  assert.equal(f.prix.find((p) => p.lookup_key === lookupKey(ligne.env))!.unit_amount, Math.round(ligne.mensuel * 100));
  assert.equal(Math.round(ligne.mensuel * 100) + 690, 2990);

  // a second start creates nothing; the stored secret is reused
  const env2: Record<string, string | undefined> = { STRIPE_SECRET_KEY: "sk_test_x", LUCIEN_PUBLIC_URL: "https://nidou.onrender.com" };
  const r2 = await preparerStripe(db, f.client, env2);
  assert.deepEqual([r2.crees, r2.webhook], [0, "existant"]);
  assert.equal(env2.STRIPE_WEBHOOK_SECRET, f.webhooks[0].secret);
  assert.equal(env2.STRIPE_PRICE_SOLO_MENSUEL, solo.id);
  assert.equal(f.portails.length, 1, "one customer portal configuration, reused");
  assert.equal(env2.LUCIEN_STRIPE_PORTAIL, f.portails[0].id);

  // a price changed by hand in Stripe (or a new grid): a new price takes the lookup key, the old one stays for running subscriptions
  solo.unit_amount = 590;
  const env3: Record<string, string | undefined> = { STRIPE_SECRET_KEY: "sk_test_x", LUCIEN_PUBLIC_URL: "https://nidou.onrender.com" };
  const r3 = await preparerStripe(db, f.client, env3);
  assert.equal(r3.crees, 1);
  assert.notEqual(env3.STRIPE_PRICE_SOLO_MENSUEL, solo.id);
  assert.equal(solo.lookup_key, null);

  // a price set by hand in the server settings wins
  const env4: Record<string, string | undefined> = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_DUO_MENSUEL: "price_manuel" };
  const r4 = await preparerStripe(db, f.client, env4);
  assert.equal(env4.STRIPE_PRICE_DUO_MENSUEL, "price_manuel");
  assert.equal(r4.webhook, "ignore", "no public https address: no webhook");
});
