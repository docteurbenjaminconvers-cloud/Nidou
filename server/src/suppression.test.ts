import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Stripe from "stripe";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { consommerLien, demanderLien, oublierDemandes } from "./auth.js";
import { annulerSuppression, arreterALEcheance, demanderSuppression, ensureSuppressionSchema, etatFin, executerSuppressionsPrevues, reprendreAbonnement } from "./suppression.js";
import { rappelsRenouvellement } from "./rappels.js";

const FIN = Date.parse("2027-03-15T00:00:00Z") / 1000;

/** A Stripe stand-in that records what Lucien asks; it can never refund (no refunds API at all). */
function fauxStripe(statut = "active") {
  const appels = { update: [] as Record<string, unknown>[], cancel: [] as string[] };
  let sub = { id: "sub_1", status: statut, cancel_at_period_end: false, items: { data: [{ current_period_end: FIN }] } };
  const client = {
    subscriptions: {
      retrieve: async () => sub,
      update: async (_id: string, p: Record<string, unknown>) => { appels.update.push(p); sub = { ...sub, ...p } as typeof sub; return sub; },
      cancel: async (id: string) => { appels.cancel.push(id); sub = { ...sub, status: "canceled" }; return sub; },
    },
  } as unknown as Stripe;
  return { client, appels };
}

const foyerAbonne = (db: Db, nom = "Famille A") => {
  const h = db.createHousehold(nom);
  db.raw.prepare("UPDATE households SET stripe_subscription_id = 'sub_1', abonnement_statut = 'active', abonnement_periode = 'annuel', plan = 'famille' WHERE id = ?").run(h.id);
  return h;
};

test("résiliation : l'abonnement s'arrête à la fin de la période payée, sans remboursement, et peut reprendre", async () => {
  const db = new Db(":memory:"); ensureSuppressionSchema(db);
  const h = foyerAbonne(db);
  const { client, appels } = fauxStripe();
  assert.equal(await arreterALEcheance(db, h.id, client), "2027-03-15");
  assert.deepEqual(appels.update, [{ cancel_at_period_end: true }]);
  assert.equal(appels.cancel.length, 0, "never cancelled at once");
  assert.equal(etatFin(db, h.id).abonnement_resilie, true);
  await reprendreAbonnement(db, h.id, client);
  assert.deepEqual(appels.update.at(-1), { cancel_at_period_end: false });
  assert.equal(etatFin(db, h.id).abonnement_resilie, false);
});

test("suppression : programmée à la fin de la période payée, annulable, puis exécutée à la date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lucien-suppr-"));
  const db = new Db(":memory:"); createApi(db, { uploadDir: dir });
  const h = foyerAbonne(db), autre = foyerAbonne(db, "Famille B");
  writeFileSync(join(dir, "a.pdf"), "A");
  db.raw.prepare("INSERT INTO documents (id, household_id, title, category, fichier, confiance, verifie, cree_le, source) VALUES ('da', ?, 'Papier A', 'autre', 'a.pdf', 1, 1, '2026-10-01', 'upload')").run(h.id);
  const { client, appels } = fauxStripe();

  const r = await demanderSuppression(db, h.id, dir, { prenom: "Ben", email: "ben@x.fr" }, { client, aujourdhui: "2026-10-31" });
  assert.equal(r.le, "2027-03-15", "erased at the end of the paid year");
  assert.ok(db.getHousehold(h.id) && existsSync(join(dir, "a.pdf")), "everything still there until then");
  assert.equal(etatFin(db, h.id).suppression_le, "2027-03-15");
  // he changes his mind
  await annulerSuppression(db, h.id, client);
  assert.deepEqual(etatFin(db, h.id), { abonnement_resilie: false, suppression_le: null });
  // asks again; the daily job does nothing before the date, everything on the date
  await demanderSuppression(db, h.id, dir, { prenom: "Ben", email: "ben@x.fr" }, { client, aujourdhui: "2026-10-31" });
  assert.equal(await executerSuppressionsPrevues(db, dir, "2027-03-14", client), 0);
  assert.ok(db.getHousehold(h.id));
  assert.equal(await executerSuppressionsPrevues(db, dir, "2027-03-15", client), 1);
  assert.equal(db.getHousehold(h.id), undefined);
  assert.ok(!existsSync(join(dir, "a.pdf")), "file removed");
  assert.ok(db.getHousehold(autre.id), "other household untouched");
  assert.equal(appels.cancel.length, 1, "subscription stopped, never refunded (the stand-in has no refund API)");
});

test("suppression : immédiate si demandée, ou sans abonnement payant en cours (essai)", async () => {
  const db = new Db(":memory:"); createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = foyerAbonne(db);
  const { client, appels } = fauxStripe();
  const r = await demanderSuppression(db, h.id, "/tmp/lucien-test-uploads", { prenom: null, email: null }, { immediat: true, client });
  assert.equal(r.le, null); assert.equal(db.getHousehold(h.id), undefined);
  assert.deepEqual(appels.cancel, ["sub_1"], "stopped now, the rest of the period is lost");
  const essai = db.createHousehold("En essai");
  await demanderSuppression(db, essai.id, "/tmp/lucien-test-uploads", { prenom: null, email: null });
  assert.equal(db.getHousehold(essai.id), undefined, "nothing paid running: erased at once");
});

test("suppression : si Stripe échoue, rien n'est effacé", async () => {
  const db = new Db(":memory:"); createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = foyerAbonne(db);
  const enPanne = { subscriptions: { retrieve: async () => { throw new Error("Stripe indisponible"); } } } as unknown as Stripe;
  await assert.rejects(demanderSuppression(db, h.id, "/tmp/lucien-test-uploads", { prenom: null, email: null }, { client: enPanne }));
  await assert.rejects(demanderSuppression(db, h.id, "/tmp/lucien-test-uploads", { prenom: null, email: null }, { immediat: true, client: enPanne }));
  assert.ok(db.getHousehold(h.id), "household kept");
});

test("renouvellement annuel : un rappel entre 45 et 30 jours avant, jamais si résilié", () => {
  const db = new Db(":memory:"); ensureSuppressionSchema(db);
  const h = foyerAbonne(db);
  db.raw.prepare("UPDATE households SET abonnement_fin = '2027-03-15' WHERE id = ?").run(h.id);
  const le = (d: string) => rappelsRenouvellement(db, db.getHousehold(h.id)!, new Date(`${d}T09:00:00Z`));
  assert.equal(le("2027-01-10").length, 0, "64 days before: too early");
  assert.equal(le("2027-02-01")[0].cle, "renouvellement:2027-03-15", "42 days before");
  assert.match(le("2027-02-01")[0].corps, /Résilier l'abonnement/);
  assert.equal(le("2027-02-20").length, 0, "23 days before: too late, never sent late");
  db.raw.prepare("UPDATE households SET abonnement_resilie = 1 WHERE id = ?").run(h.id);
  assert.equal(le("2027-02-01").length, 0, "already stopped");
  db.raw.prepare("UPDATE households SET abonnement_resilie = 0, abonnement_periode = 'mensuel' WHERE id = ?").run(h.id);
  assert.equal(le("2027-02-01").length, 0, "monthly: no reminder");
});

test("suppression par l'appli : un membre ne supprime que son compte ; démo protégée ; mot de confirmation", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "1"; oublierDemandes();
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const login = async (email: string, household_id?: string) => {
      const r = await demanderLien(db, email, { household_id, prenom: email.split("@")[0] });
      const c = consommerLien(db, new URL(r.lien!).searchParams.get("token")!, 15); assert.ok(c.ok); return c.ok ? c : null!;
    };
    const ck = (s: string) => ({ cookie: `lucien_session=${s}`, "content-type": "application/json" });
    const supprimer = (s: string, confirmation = "SUPPRIMER") => api.request("/compte/supprimer", { method: "POST", headers: ck(s), body: JSON.stringify({ confirmation }) });
    const a = await login("a@x.fr"), m = await login("m@x.fr", a.household.id);
    assert.equal((await supprimer(a.session, "oui")).status, 400);
    const rm = await supprimer(m.session);
    assert.equal((await rm.json()).portee, "compte");
    assert.ok(db.getHousehold(a.household.id), "household still there");
    // owner in trial (nothing paid): erased now
    const ra = await supprimer(a.session);
    assert.deepEqual([(await ra.json()).le, db.getHousehold(a.household.id)], [null, undefined]);
    process.env.LUCIEN_AUTH = "0";
    assert.equal((await api.request("/compte/supprimer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "SUPPRIMER" }) })).status, 403);
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});
