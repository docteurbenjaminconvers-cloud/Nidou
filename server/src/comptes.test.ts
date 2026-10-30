import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { consommerLien, demanderLien } from "./auth.js";
import { appliquerAbonnement } from "./abonnement.js";

test("comptes : invitations limitées par la formule, compte en trop mis en pause", async () => {
  process.env.LUCIEN_AUTH = "1";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const login = async (email: string, household_id?: string) => {
    const r = await demanderLien(db, email, { household_id, prenom: email.split("@")[0] });
    const c = consommerLien(db, new URL(r.lien!).searchParams.get("token")!, 15);
    assert.ok(c.ok); return c.ok ? c : null!;
  };
  const a = await login("a@x.fr");
  const ck = (s: string) => ({ cookie: `lucien_session=${s}`, "content-type": "application/json" });
  const inviter = (sess: string, email: string) => api.request("/invitations", { method: "POST", headers: ck(sess), body: JSON.stringify({ email, prenom: null }) });
  // trial (Tribu): inviting works
  assert.equal((await inviter(a.session, "b@x.fr")).status, 201);
  const b = await login("b@x.fr", a.household.id);
  // end of trial, free plan: 1 person → B is paused, A keeps access, no more invitations
  db.setTrialEnd(a.household.id, new Date(0).toISOString());
  assert.equal((await api.request("/household", { headers: ck(a.session) })).status, 200);
  const rb = await api.request("/household", { headers: ck(b.session) });
  assert.equal(rb.status, 402); assert.equal((await rb.json()).error, "compte_en_pause");
  assert.equal((await inviter(a.session, "c@x.fr")).status, 402);
  // checkout refuses a formule smaller than the people already connected
  const solo = await api.request("/abonnement/checkout", { method: "POST", headers: ck(a.session), body: JSON.stringify({ formule: "solo", periode: "mensuel" }) });
  assert.equal(solo.status, 400);
  // Duo: B is back; a third person still needs Tribu
  appliquerAbonnement(db, db.getHousehold(a.household.id)!, { statut: "simule", formule: "duo", periode: "annuel" });
  assert.equal((await api.request("/household", { headers: ck(b.session) })).status, 200);
  const r3 = await inviter(a.session, "c@x.fr");
  assert.equal(r3.status, 402); assert.match((await r3.json()).message, /Tribu/);
  const h = await (await api.request("/household", { headers: ck(a.session) })).json();
  assert.equal(h.capacite_comptes, 2); assert.equal(h.abonnement.formule, "duo");
});
