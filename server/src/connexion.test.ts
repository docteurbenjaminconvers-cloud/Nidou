import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { demandeAutorisee, demanderLien, oublierDemandes } from "./auth.js";

const demander = (api: ReturnType<typeof createApi>, email: string, ip = "1.2.3.4") =>
  api.request("/auth/demander", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }) });

test("connexion : en production, un lien qui n'a pas pu partir par email n'est jamais renvoyé", async () => {
  const avant = { url: process.env.LUCIEN_PUBLIC_URL, key: process.env.BREVO_API_KEY, auth: process.env.LUCIEN_AUTH, fetch: globalThis.fetch };
  process.env.LUCIEN_PUBLIC_URL = "https://monlucien.fr"; process.env.BREVO_API_KEY = "cle"; process.env.LUCIEN_AUTH = "1";
  globalThis.fetch = (async () => new Response("quota dépassé", { status: 429 })) as typeof fetch; // Brevo en panne
  try {
    oublierDemandes();
    const db = new Db(":memory:");
    const r = await demanderLien(db, "victime@example.org");
    assert.equal(r.envoye, false); assert.equal(r.lien, null, "link never handed back");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const res = await demander(api, "victime@example.org");
    assert.equal(res.status, 503);
    assert.ok(!JSON.stringify(await res.json()).includes("token="), "no token in the response");
    // sans clé Brevo non plus, en production
    delete process.env.BREVO_API_KEY;
    assert.equal((await demanderLien(db, "victime@example.org")).lien, null);
  } finally {
    globalThis.fetch = avant.fetch;
    for (const [k, v] of [["LUCIEN_PUBLIC_URL", avant.url], ["BREVO_API_KEY", avant.key], ["LUCIEN_AUTH", avant.auth]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("connexion : 3 demandes par adresse et 10 par réseau toutes les 15 minutes", async () => {
  oublierDemandes();
  const t = 1_000_000;
  assert.ok([1, 2, 3].every(() => demandeAutorisee("email:a@x.fr", 3, t)));
  assert.equal(demandeAutorisee("email:a@x.fr", 3, t + 1000), false);
  assert.equal(demandeAutorisee("email:a@x.fr", 3, t + 15 * 60 * 1000 + 1), true, "window slides");
  oublierDemandes();
  const api = createApi(new Db(":memory:"), { uploadDir: "/tmp/lucien-test-uploads" });
  for (let i = 0; i < 10; i++) assert.equal((await demander(api, `p${i}@x.fr`)).status, 200);
  assert.equal((await demander(api, "p10@x.fr")).status, 429, "11th request from the same network refused");
  assert.equal((await demander(api, "p10@x.fr", "5.6.7.8")).status, 200, "another network still works");
  oublierDemandes();
});
