import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Db } from "./db.js";
import { BridgeClient, mapTransactions, syncHousehold, verifyBridgeSignature, type BridgeConfig } from "./bridge.js";
import { seedDemo } from "./seed.js";

const cfg: BridgeConfig = { clientId: "id", clientSecret: "secret", webhookSecret: "whsec", publicUrl: "https://app.test", baseUrl: "https://bridge.test", version: "2025-01-15" };

/** A fake Bridge API: records calls, serves two pages of transactions, honours `since`. */
function fakeBridge() {
  const calls: { method: string; path: string; headers: Record<string, string>; body?: any }[] = [];
  const page1 = [
    { id: 1, account_id: 10, clean_description: "Netflix", provider_description: "CB NETFLIX.COM", amount: -13.49, date: "2026-10-10", booking_date: "2026-10-10" },
    { id: 2, account_id: 10, clean_description: "Carrefour", provider_description: "CB CARREFOUR MARKET", amount: -54.3, date: "2026-10-12" },
    { id: 3, account_id: 10, clean_description: "Futur", amount: -10, date: "2026-11-02", future: true },
  ];
  const page2 = [
    { id: 4, account_id: 10, clean_description: "Salaire", provider_description: "VIR SALAIRE", amount: 2850, date: "2026-10-01" },
    { id: 5, account_id: 10, clean_description: "Supprimée", amount: -5, date: "2026-10-03", deleted: true },
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.replace(cfg.baseUrl, "");
    const headers = init?.headers as Record<string, string>;
    calls.push({ method: init?.method ?? "GET", path, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/v3/aggregation/users") return json({ uuid: "user-1", external_user_id: calls.at(-1)!.body.external_user_id });
    if (path === "/v3/aggregation/authorization/token") return json({ access_token: "tok", expires_at: "2026-10-28T12:00:00Z" });
    if (path === "/v3/aggregation/connect-sessions") return json({ id: "cs-1", url: "https://connect.bridgeapi.io/session/cs-1" });
    if (path.startsWith("/v3/aggregation/accounts")) return json({ resources: [{ id: 10, item_id: 100, name: "Compte courant", balance: 1200.5, currency_code: "EUR", type: "checking", provider_id: 6, data_access: "enabled" }, { id: 11, item_id: 100, name: "Fermé", data_access: "disabled" }], pagination: {} });
    if (path.startsWith("/v3/aggregation/transactions")) {
      const since = new URL(url).searchParams.get("since");
      if (since) return json({ resources: [page1[0]], pagination: {} }); // incremental: one updated tx
      if (path.includes("starting_after")) return json({ resources: page2, pagination: {} });
      return json({ resources: page1, pagination: { next_uri: "/v3/aggregation/transactions?limit=500&starting_after=3" } });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

test("le client envoie les en-têtes Bridge et suit la pagination", async () => {
  const { fetchImpl, calls } = fakeBridge();
  const client = new BridgeClient(cfg, fetchImpl);
  const user = await client.createUser("lucien-h1");
  assert.equal(user.uuid, "user-1");
  const tok = await client.userToken(user.uuid);
  const session = await client.connectSession(tok.access_token, "famille@example.org", "h1");
  assert.match(session.url, /connect\.bridgeapi\.io/);
  const txs = await client.transactions(tok.access_token);
  assert.equal(txs.length, 5);
  const h = calls[0].headers;
  assert.equal(h["Bridge-Version"], "2025-01-15");
  assert.equal(h["Client-Id"], "id");
  assert.equal(calls[2].headers.Authorization, "Bearer tok");
  assert.equal(calls[2].body.callback_url, "https://app.test/api/bank/callback");
  assert.equal(calls[2].body.user_email, "famille@example.org");
});

test("les transactions futures ou supprimées sont ignorées et les comptes nommés", () => {
  const names = new Map([["10", "Compte courant"]]);
  const mapped = mapTransactions([
    { id: 1, account_id: 10, clean_description: "Netflix", amount: -13.49, date: "2026-10-10T00:00:00Z" },
    { id: 3, account_id: 10, amount: -10, date: "2026-11-02", future: true },
    { id: 5, account_id: 10, amount: -5, date: "2026-10-03", deleted: true },
  ], names);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].date, "2026-10-10");
  assert.equal(mapped[0].compte, "Compte courant");
});

test("la synchronisation enregistre comptes et opérations, puis reprend depuis le curseur", async () => {
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const { fetchImpl, calls } = fakeBridge();
  const client = new BridgeClient(cfg, fetchImpl);
  db.upsertBankLink({ household_id: h.id, fournisseur: "bridge", user_uuid: "user-1", external_user_id: "x", derniere_synchro: null, curseur: null, statut: "en_attente" });
  const r1 = await syncHousehold(db, client, h.id);
  assert.equal(r1.comptes, 1, "le compte désactivé est exclu");
  assert.equal(r1.ajoutees, 3, "3 opérations valides (ni future ni supprimée)");
  assert.equal(db.getBankLink(h.id)!.statut, "connecte");
  assert.equal(db.listBankAccounts(h.id)[0].nom, "Compte courant");
  const r2 = await syncHousehold(db, client, h.id);
  assert.equal(r2.ajoutees, 0, "une opération déjà connue n'est pas dupliquée");
  const lastTxCall = calls.filter((c) => c.path.includes("/transactions")).at(-1)!;
  assert.ok(lastTxCall.path.includes("since="), "la seconde synchro utilise since");
});

test("la signature des webhooks est vérifiée en HMAC-SHA256 hex majuscule", () => {
  const body = JSON.stringify({ type: "item.refreshed", content: { user_uuid: "user-1", item_id: 100 } });
  const sig = createHmac("sha256", "whsec").update(body).digest("hex").toUpperCase();
  assert.equal(verifyBridgeSignature(body, `v1=${sig}`, ["whsec"]), true);
  assert.equal(verifyBridgeSignature(body, `v1=${sig}`, ["autre"]), false);
  assert.equal(verifyBridgeSignature(body, `v1=${sig}`, ["ancien", "whsec"]), true, "rotation : l'ancien ou le nouveau secret");
  assert.equal(verifyBridgeSignature(body + " ", `v1=${sig}`, ["whsec"]), false);
  assert.equal(verifyBridgeSignature(body, null, ["whsec"]), false);
});
