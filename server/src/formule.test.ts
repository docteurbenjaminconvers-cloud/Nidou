import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { appliquerAbonnement, changementPrevu, changerFormule, changerModules, creerCheckout, remplacerStripe } from "./abonnement.js";
import { ensureAssistantSchema } from "./assistant.js";
import { ensureVeilleSchema } from "./veille.js";
import { envModule, envPack, tousLesPrix } from "./stripeModules.js";

const SOCLES = Object.fromEntries(["solo", "duo", "tribu"].flatMap((f) => ["mensuel", "annuel"].map((p) => [`STRIPE_PRICE_${f.toUpperCase()}_${p.toUpperCase()}`, `price_${f}_${p}`])));
const ENV = { ...Object.fromEntries(tousLesPrix().map((x) => [x.env, `price_${x.env.toLowerCase()}`])), ...SOCLES, STRIPE_SECRET_KEY: "sk_test_x" };
const DEBUT = 1_800_000_000, FIN = DEBUT + 365 * 86400;

function faux() {
  const journal: any[] = [];
  const sub: any = { id: "sub_1", customer: "cus_1", status: "active", schedule: null, cancel_at_period_end: false, pending_update: null, metadata: {}, items: { data: [
    { id: "si_socle", price: { id: "price_duo_annuel" }, quantity: 1, current_period_start: DEBUT, current_period_end: FIN },
    { id: "si_pack", price: { id: ENV[envPack("integral", "duo", "annuel")] }, quantity: 1, current_period_start: DEBUT, current_period_end: FIN },
  ] } };
  const scheds: any = {};
  return {
    sub, journal, scheds,
    subscriptions: {
      async retrieve() { return structuredClone(sub); },
      async update(_: string, p: any) { journal.push(["update", p]); for (const x of p.items ?? []) { const it = sub.items.data.find((i: any) => i.id === x.id); if (it && x.price) it.price = { id: x.price }; } return structuredClone(sub); },
    },
    invoices: { async createPreview(p: any) { const d = p.subscription_details.proration_date; return { lines: { data: [
      { amount: -4950, period: { start: d }, parent: { subscription_item_details: { proration: true } } },
      { amount: 6950, period: { start: d }, parent: { subscription_item_details: { proration: true } } },
    ] } }; } },
    subscriptionSchedules: {
      async create(p: any) { journal.push(["schedule.create", p]); scheds.s1 = { id: "sched_1", phases: [{ start_date: DEBUT, end_date: FIN }] }; sub.schedule = "sched_1"; return scheds.s1; },
      async retrieve() { return scheds.s1; },
      async update(_: string, p: any) { journal.push(["schedule.update", p]); return scheds.s1; },
      async release() { journal.push(["schedule.release"]); sub.schedule = null; return {}; },
    },
  };
}

function foyer() {
  const db = new Db(":memory:"); ensureAssistantSchema(db); ensureVeilleSchema(db);
  const h = db.createHousehold("Test", 0);
  appliquerAbonnement(db, h, { customer: "cus_1", subscription: "sub_1", statut: "active", formule: "duo", periode: "annuel", fin: new Date(FIN * 1000).toISOString().slice(0, 10) });
  return { db, h: db.getHousehold(h.id)! };
}
const avec = async (f: (x: ReturnType<typeof faux>) => Promise<void>) => {
  Object.assign(process.env, ENV); const x = faux(); remplacerStripe(x);
  try { await f(x); } finally { remplacerStripe(null); for (const k of Object.keys(ENV)) delete process.env[k]; }
};

test("formule : Duo → Tribu se paie tout de suite (différence au prorata), socle et pack changent de prix", () => avec(async (x) => {
  const { db, h } = foyer();
  const a = await changerFormule(db, h, { formule: "tribu", periode: "annuel" });
  assert.equal(a.apercu!.mode, "maintenant");
  assert.equal(a.apercu!.aujourdhui, 20, "credit of Duo + Intégral left, debit of Tribu + Intégral");
  assert.equal(x.journal.length, 0);
  await changerFormule(db, h, { formule: "tribu", periode: "annuel" }, { confirmer: true, prorationDate: a.apercu!.proration_date });
  const [, p] = x.journal.find((j) => j[0] === "update");
  assert.equal(p.payment_behavior, "pending_if_incomplete"); assert.equal(p.proration_behavior, "always_invoice");
  assert.deepEqual(p.items, [{ id: "si_socle", price: "price_tribu_annuel" }, { id: "si_pack", price: ENV[envPack("integral", "tribu", "annuel")] }]);
  assert.equal(db.getHousehold(h.id)!.formule, "tribu");
}));

test("formule : Duo → Solo, ou annuel → mensuel, à l'échéance sans remboursement ; les options attendent", () => avec(async (x) => {
  const { db, h } = foyer();
  const a = await changerFormule(db, h, { formule: "solo", periode: "annuel" });
  assert.equal(a.apercu!.mode, "echeance"); assert.equal(a.apercu!.aujourdhui, 0);
  const r = await changerFormule(db, h, { formule: "solo", periode: "mensuel" }, { confirmer: true });
  assert.ok(!x.journal.some((j) => j[0] === "update"), "nothing changes on the running period");
  const [, u] = x.journal.find((j) => j[0] === "schedule.update");
  assert.equal(u.phases[0].end_date, FIN);
  assert.deepEqual(u.phases[1].items, [{ price: "price_solo_mensuel", quantity: 1 }, { price: ENV[envPack("integral", "solo", "mensuel")], quantity: 1 }]);
  assert.equal(u.end_behavior, "release");
  assert.deepEqual(changementPrevu(db, h.id), r.prevu);
  await assert.rejects(changerModules(db, db.getHousehold(h.id)!, { formule: "duo", periode: "annuel", modules: [], pack: null }, null, false, { confirmer: true }), /est prévu le/);
}));

test("formule : jamais un second abonnement par-dessus celui en cours", () => avec(async () => {
  const { db, h } = foyer();
  await assert.rejects(creerCheckout(db, h, "tribu", "annuel", null, undefined, true), /déjà un abonnement/);
  void envModule;
}));
