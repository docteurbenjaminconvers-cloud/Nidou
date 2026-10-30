import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { ebJwt, mapEbTransactions, type EbTransaction } from "./enablebanking.js";
import { tacheBanques } from "./banques.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

test("enable banking : JWT RS256 signé avec la clé de l'application", () => {
  const jwt = ebJwt({ appId: "app-123", privateKey }, 1_800_000_000);
  const [h, b, sig] = jwt.split(".");
  const head = JSON.parse(Buffer.from(h, "base64url").toString());
  const body = JSON.parse(Buffer.from(b, "base64url").toString());
  assert.deepEqual(head, { typ: "JWT", alg: "RS256", kid: "app-123" });
  assert.equal(body.aud, "api.enablebanking.com"); assert.equal(body.exp - body.iat, 3600);
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, "base64url")));
});

const tx = (ref: string, amount: string, ind: "CRDT" | "DBIT", info: string[], date: string, extra: Partial<EbTransaction> = {}): EbTransaction =>
  ({ entry_reference: ref, transaction_amount: { amount, currency: "EUR" }, credit_debit_indicator: ind, status: "BOOK", booking_date: date, remittance_information: info, ...extra });

test("enable banking : montants signés, libellé lisible, opérations en attente ignorées", () => {
  const r = mapEbTransactions([
    tx("1", "62.00", "DBIT", ["PRLV EDF"], "2026-10-01"),
    tx("2", "1420.00", "CRDT", ["PENSION"], "2026-10-02", { debtor: { name: "CARSAT" } }),
    tx("3", "500.00", "DBIT", [], "2026-10-03", { creditor: { name: "M DUBOIS" } }),
    tx("4", "9.99", "DBIT", ["EN COURS"], "2026-10-04", { status: "PDNG" }),
  ], "Compte");
  assert.equal(r.length, 3);
  assert.equal(r[0].montant, -62); assert.equal(r[1].montant, 1420);
  assert.equal(r[1].libelle, "PENSION de CARSAT"); assert.equal(r[2].libelle, "vers M DUBOIS");
  assert.equal(r[0].ref, "1");
});

test("enable banking : connexion du foyer et d'un proche, synchro, fermeture du consentement", async () => {
  process.env.ENABLEBANKING_APP_ID = "app-123"; process.env.ENABLEBANKING_PRIVATE_KEY = privateKey;
  process.env.LUCIEN_AUTH = "0"; process.env.LUCIEN_VEILLE = "1";
  const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const states: string[] = []; const appels: string[] = []; let pages = 0;
  const vieux = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url); const path = u.pathname; const m = init?.method ?? "GET";
    appels.push(`${m} ${path}`);
    assert.match(String((init?.headers as Record<string, string>).Authorization), /^Bearer ey/);
    const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/aspsps") return j({ aspsps: [{ name: "La Banque Postale", country: "FR", psu_types: ["personal"] }, { name: "BNP Paribas", country: "FR", psu_types: ["personal", "business"] }] });
    if (path === "/auth") { const b = JSON.parse(String(init!.body)); states.push(b.state); assert.match(b.redirect_url, /\/api\/bank\/eb\/callback$/); return j({ url: `https://bank.example/login?s=${b.state}` }); }
    if (path === "/sessions" && m === "POST") { const code = JSON.parse(String(init!.body)).code; return j({ session_id: `sess-${code}`, accounts: [{ uid: `acc-${code}`, name: "Compte courant", account_id: { iban: "FR7612345000001234567890123" } }], access: { valid_until: new Date(Date.now() + 180 * 864e5).toISOString() }, aspsp: { name: "La Banque Postale", country: "FR" } }); }
    if (path.startsWith("/sessions/") && m === "GET") { const id = path.split("/")[2]; return j({ accounts: [`acc-${id.replace("sess-", "")}`], access: { valid_until: new Date(Date.now() + 100 * 864e5).toISOString() } }); }
    if (path.startsWith("/sessions/") && m === "DELETE") return new Response(null, { status: 204 });
    if (path.endsWith("/balances")) return j({ balances: [{ balance_amount: { amount: "2487.91", currency: "EUR" }, balance_type: "CLBD" }] });
    if (path.endsWith("/transactions")) {
      const uid = path.split("/")[2];
      if (uid === "acc-foyer") {
        if (!u.searchParams.get("continuation_key")) { pages++; return j({ transactions: [tx("a1", "45.20", "DBIT", ["CB CARREFOUR"], d(5))], continuation_key: "p2" }); }
        return j({ transactions: [tx("a2", "13.49", "DBIT", ["PRLV NETFLIX"], d(4)), tx("a3", "2100", "CRDT", ["SALAIRE"], d(3))], continuation_key: null });
      }
      return j({ transactions: [tx("m1", "1420", "CRDT", ["VIR PENSION CARSAT"], d(20)), tx("m2", "62", "DBIT", ["PRLV EDF"], d(15)), tx("m3", "500", "DBIT", ["CB TRANSCASH RECHARGE"], d(2))] });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const h = db.createHousehold("Test");
    const json = { "content-type": "application/json" };

    const banques = await (await api.request("/bank/banques")).json();
    assert.equal(banques.fournisseur, "enablebanking"); assert.equal(banques.banques[0].name, "BNP Paribas");

    // household: pick the bank → bank login → callback → first sync (two pages of transactions)
    const r = await (await api.request("/bank/connect", { method: "POST", headers: json, body: JSON.stringify({ aspsp: { name: "La Banque Postale", country: "FR" } }) })).json();
    assert.match(r.url, /^https:\/\/bank\.example/);
    assert.match(states[0], /^h\./);
    const cb = await api.request(`/bank/eb/callback?state=${states[0]}&code=foyer`);
    assert.equal(cb.status, 302); assert.equal(cb.headers.get("location"), "/#budget");
    const st = await (await api.request("/bank/status")).json();
    assert.equal(st.connecte, true); assert.equal(st.fournisseur, "enablebanking"); assert.ok(st.expire_le);
    assert.equal(st.comptes[0].solde, 2487.91);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM transactions WHERE household_id = ?").get(h.id)!.n, 3);
    // the 6-hour task re-reads without duplicating
    await tacheBanques(db);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM transactions WHERE household_id = ?").get(h.id)!.n, 3);
    assert.equal(pages, 2);

    // protected relative: consent, then she connects her own bank
    const mamie = db.addMember(h.id, "Josette", "parent_a_charge");
    const v = await (await api.request("/veilles", { method: "POST", headers: json, body: JSON.stringify({ member_id: mamie.id, mesure: "aucune", personne_peut_consentir: true }) })).json();
    const jeton = v.lien_personne.split("/consentement/")[1];
    await api.request(`/veille/p/${jeton}/consentir`, { method: "POST", headers: json, body: JSON.stringify({ nom_signataire: "Josette M", en_qualite_de: "personne", accepte: true }) });
    assert.equal((await api.request(`/veille/p/${jeton}/banques`)).status, 200);
    const rb = await (await api.request(`/veille/p/${jeton}/banque`, { method: "POST", headers: json, body: JSON.stringify({ aspsp: { name: "La Banque Postale", country: "FR" } }) })).json();
    assert.ok(rb.url);
    assert.match(states[1], /^v\./);
    const cbv = await api.request(`/bank/eb/callback?state=${states[1]}&code=mamie`);
    assert.equal(cbv.headers.get("location"), `/#/consentement/${jeton}?banque=ok`);
    const det = await (await api.request(`/veilles/${v.id}`)).json();
    assert.equal(det.banque_connectee, true);
    assert.ok(det.alertes.some((a: { gravite: string }) => a.gravite === "urgente"));

    // she withdraws: the bank consent is closed at the source
    await api.request(`/veille/p/${jeton}/retirer`, { method: "POST", headers: json, body: JSON.stringify({ nom: "Josette" }) });
    assert.ok(appels.includes("DELETE /sessions/sess-mamie"));
    // the family disconnects its bank: same
    await api.request("/bank", { method: "DELETE" });
    assert.ok(appels.includes("DELETE /sessions/sess-foyer"));
  } finally {
    globalThis.fetch = vieux;
    delete process.env.ENABLEBANKING_APP_ID; delete process.env.ENABLEBANKING_PRIVATE_KEY;
  }
});
