import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { consommerLien, demanderLien, oublierDemandes } from "./auth.js";
import { remboursementProrata, resilierEtRembourser, supprimerFoyer } from "./suppression.js";

const J = 86400;

test("suppression : remboursement au prorata des jours non utilisés", () => {
  assert.equal(remboursementProrata(9900, 0, 365 * J, 0), 9900, "whole year left");
  assert.equal(remboursementProrata(9900, 0, 360 * J, 90 * J), 7425, "3/4 of the period left");
  assert.equal(remboursementProrata(690, 0, 30 * J, 30 * J), 0, "period over");
  assert.equal(remboursementProrata(0, 0, 30 * J, 0), 0, "free month (partner trial): nothing to refund");
});

/** A Stripe stand-in that records what Lucien asks. */
function fauxStripe(statut = "active") {
  const appels: { cancel: string[]; refunds: { params: Record<string, unknown>; opts: Record<string, unknown> }[] } = { cancel: [], refunds: [] };
  const client = {
    subscriptions: {
      retrieve: async (id: string) => ({ id, status: statut, latest_invoice: "in_1", items: { data: [{ current_period_start: 0, current_period_end: 360 * J }] } }),
      cancel: async (id: string) => { appels.cancel.push(id); return { id, status: "canceled" }; },
    },
    invoices: { retrieve: async () => ({ id: "in_1", amount_paid: 32900, payments: { data: [{ payment: { payment_intent: "pi_1" } }] } }) },
    refunds: { create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => { appels.refunds.push({ params, opts }); return { id: "re_1" }; } },
  } as unknown as Stripe;
  return { client, appels };
}

test("suppression : résiliation immédiate et remboursement du reste, sans double remboursement", async () => {
  const { client, appels } = fauxStripe();
  const r = await resilierEtRembourser({ stripe_subscription_id: "sub_1" }, 90 * J, client);
  assert.deepEqual(r, { resilie: true, rembourse_centimes: 24675 }, "329 € × 270/360");
  assert.deepEqual(appels.cancel, ["sub_1"]);
  assert.equal(appels.refunds[0].params.payment_intent, "pi_1");
  assert.equal(appels.refunds[0].opts.idempotencyKey, "lucien-suppression-sub_1", "a retry never refunds twice");
  // retry after a crash: already cancelled → not cancelled again
  const deja = fauxStripe("canceled");
  await resilierEtRembourser({ stripe_subscription_id: "sub_1" }, 90 * J, deja.client);
  assert.equal(deja.appels.cancel.length, 0);
  // no subscription: nothing to do
  assert.deepEqual(await resilierEtRembourser({ stripe_subscription_id: null }), { resilie: false, rembourse_centimes: 0 });
});

test("suppression : le titulaire efface tout le foyer, rien d'un autre foyer ; un membre ne supprime que son compte", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "1"; oublierDemandes();
  try {
    const dir = mkdtempSync(join(tmpdir(), "lucien-suppr-"));
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: dir });
    const login = async (email: string, household_id?: string) => {
      const r = await demanderLien(db, email, { household_id, prenom: email.split("@")[0] });
      const c = consommerLien(db, new URL(r.lien!).searchParams.get("token")!, 15); assert.ok(c.ok); return c.ok ? c : null!;
    };
    const ck = (s: string) => ({ cookie: `lucien_session=${s}`, "content-type": "application/json" });
    const supprimer = (s: string, confirmation = "SUPPRIMER") => api.request("/compte/supprimer", { method: "POST", headers: ck(s), body: JSON.stringify({ confirmation }) });

    const a = await login("a@x.fr");                    // owner of A
    const m = await login("m@x.fr", a.household.id);    // member of A
    const b = await login("b@y.fr");                    // another household
    const multi = await login("multi@x.fr", a.household.id); // also member of B
    db.joinHousehold(b.household.id, multi.user.id, "membre");
    writeFileSync(join(dir, "a.pdf"), "A"); writeFileSync(join(dir, "b.pdf"), "B");
    db.raw.prepare("INSERT INTO documents (id, household_id, title, category, fichier, confiance, verifie, cree_le, source) VALUES ('da', ?, 'Papier A', 'autre', 'a.pdf', 1, 1, '2026-10-01', 'upload')").run(a.household.id);
    db.raw.prepare("INSERT INTO documents (id, household_id, title, category, fichier, confiance, verifie, cree_le, source) VALUES ('db', ?, 'Papier B', 'autre', 'b.pdf', 1, 1, '2026-10-01', 'upload')").run(b.household.id);
    db.insertTransactions([{ household_id: a.household.id, compte: null, date: "2026-10-01", libelle: "X", marchand: null, montant: -10, categorie: "autre", empreinte: "x" } as any]);

    assert.equal((await supprimer(a.session, "oui")).status, 400, "confirmation word required");
    // a member deletes only his own account
    const rm = await supprimer(m.session);
    assert.equal(rm.status, 200); assert.equal((await rm.json()).portee, "compte");
    assert.ok(db.getHousehold(a.household.id), "household still there");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'm@x.fr'").get()!.n, 0, "member account gone");
    // the owner erases the household
    const ra = await supprimer(a.session);
    assert.equal(ra.status, 200); assert.equal((await ra.json()).portee, "foyer");
    assert.equal(db.getHousehold(a.household.id), undefined);
    for (const t of ["documents", "transactions", "members", "household_users"]) assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE household_id = ?`).get(a.household.id)!.n, 0, t);
    assert.ok(!existsSync(join(dir, "a.pdf")), "A's file removed");
    assert.ok(existsSync(join(dir, "b.pdf")) && db.listDocuments(b.household.id).length === 1, "B untouched");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'a@x.fr'").get()!.n, 0, "owner account gone");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'multi@x.fr'").get()!.n, 1, "someone still in another household keeps his account");
    assert.equal((await api.request("/household", { headers: ck(a.session) })).status, 401, "session closed");
    // the shared demo (no accounts) can never be erased
    process.env.LUCIEN_AUTH = "0";
    assert.equal((await api.request("/compte/supprimer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "SUPPRIMER" }) })).status, 403);
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});

test("suppression : si Stripe échoue, rien n'est effacé", async () => {
  const db = new Db(":memory:"); createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = db.createHousehold("Famille C");
  db.raw.prepare("UPDATE households SET stripe_subscription_id = 'sub_x' WHERE id = ?").run(h.id);
  const enPanne = { subscriptions: { retrieve: async () => { throw new Error("Stripe indisponible"); } } } as unknown as Stripe;
  await assert.rejects(supprimerFoyer(db, h.id, "/tmp/lucien-test-uploads", { prenom: null, email: null }, enPanne));
  assert.ok(db.getHousehold(h.id), "household kept");
});
