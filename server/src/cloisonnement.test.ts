import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { consommerLien, demanderLien, oublierDemandes } from "./auth.js";

/** Two households on the same server: nothing one does may touch the other's data. */
test("cloisonnement : un foyer ne peut ni voir les jetons d'invitation ni modifier les données d'un autre foyer", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "1"; oublierDemandes();
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const login = async (email: string, household_id?: string) => {
      const r = await demanderLien(db, email, { household_id, prenom: email.split("@")[0] });
      const c = consommerLien(db, new URL(r.lien!).searchParams.get("token")!, 15); assert.ok(c.ok); return c.ok ? c : null!;
    };
    const ck = (s: string) => ({ cookie: `lucien_session=${s}`, "content-type": "application/json" });
    const a = await login("a@x.fr"), b = await login("b@y.fr");
    assert.notEqual(a.household.id, b.household.id);

    // A's data
    const d = db.insertDeadline({ household_id: a.household.id, document_id: null, titre: "Assurance auto", type: "echeance", date: "2027-01-10", rappel_jours: 30, note: null } as any);
    db.insertTransactions([{ household_id: a.household.id, compte: null, date: "2026-10-01", libelle: "NETFLIX", marchand: "Netflix", montant: -13.49, categorie: "abonnements", empreinte: "e1" } as any]);
    const tx = db.listTransactions(a.household.id)[0];
    db.savePushSubscription({ household_id: a.household.id, user_id: a.user.id, endpoint: "https://push.example/a", p256dh: "k", auth: "x", appareil: null });

    // B tries to change them with the ids
    assert.equal((await api.request(`/deadlines/${d.id}`, { method: "PATCH", headers: ck(b.session), body: JSON.stringify({ fait: true }) })).status, 404);
    assert.equal(db.listDeadlines(a.household.id).find((x) => x.id === d.id)?.fait, 0, "A's deadline untouched");
    assert.equal((await api.request(`/transactions/${tx.id}`, { method: "PATCH", headers: ck(b.session), body: JSON.stringify({ categorie: "loisirs" }) })).status, 404);
    assert.equal(db.listTransactions(a.household.id)[0].categorie, "abonnements", "A's transaction untouched");
    await api.request("/push/abonner", { method: "DELETE", headers: ck(b.session), body: JSON.stringify({ endpoint: "https://push.example/a" }) });
    assert.equal(db.listPushSubscriptions(a.household.id).length, 1, "A's device still subscribed");
    // A itself still can
    assert.equal((await api.request(`/deadlines/${d.id}`, { method: "PATCH", headers: ck(a.session), body: JSON.stringify({ fait: true }) })).status, 200);

    // invitations: members see an opaque id, never the login token
    assert.equal((await api.request("/invitations", { method: "POST", headers: ck(a.session), body: JSON.stringify({ email: "c@x.fr", prenom: "C" }) })).status, 201);
    const token = db.listInvitations(a.household.id)[0].token;
    const vue = await (await api.request("/foyer/comptes", { headers: ck(a.session) })).json();
    assert.ok(!JSON.stringify(vue).includes(token), "token not exposed");
    const id = vue.invitations[0].id;
    assert.equal((await api.request(`/invitations/${encodeURIComponent(id)}`, { method: "DELETE", headers: ck(b.session) })).status, 404, "another household cannot cancel it");
    assert.equal((await api.request(`/invitations/${encodeURIComponent(id)}`, { method: "DELETE", headers: ck(a.session) })).status, 200);
    assert.equal(db.listInvitations(a.household.id).length, 0);
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});

test("boîte de réception : fermée en production tant que son secret n'est pas configuré", async () => {
  const avant = { url: process.env.LUCIEN_PUBLIC_URL, s: process.env.LUCIEN_INBOX_SECRET };
  process.env.LUCIEN_PUBLIC_URL = "https://monlucien.fr"; delete process.env.LUCIEN_INBOX_SECRET;
  try {
    const api = createApi(new Db(":memory:"), { uploadDir: "/tmp/lucien-test-uploads" });
    const r = await api.request("/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message_id: "m1", to: ["foyer-abcdef@in.monlucien.fr"], from: "x@y.fr", subject: "Facture", text: "...", attachments: [] }) });
    assert.equal(r.status, 503);
    process.env.LUCIEN_INBOX_SECRET = "s3cret";
    const r2 = await api.request("/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message_id: "m1", to: ["foyer-abcdef@in.monlucien.fr"], from: null, subject: null, text: null, attachments: [] }) });
    assert.equal(r2.status, 401, "wrong secret refused");
  } finally {
    for (const [k, v] of [["LUCIEN_PUBLIC_URL", avant.url], ["LUCIEN_INBOX_SECRET", avant.s]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
