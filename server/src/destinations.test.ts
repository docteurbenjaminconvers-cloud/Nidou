import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { tacheBanques } from "./banques.js";
import { nomCompte, nomsUniques, suggererDestination } from "./destinations.js";

test("destinations : suggestion selon ce que dit la banque", () => {
  assert.equal(suggererDestination({ name: "CONVERS BENJAMIN", cash_account_type: "CACC", usage: "PRIV" }), "foyer");
  assert.equal(suggererDestination({ name: "SCI SKOPELOS" }), "locatif");
  assert.equal(suggererDestination({ name: "CONVERS BENJAMIN", product: "Livret A" }), "epargne");
  assert.equal(suggererDestination({ name: "X", cash_account_type: "SVGS" }), "epargne");
  assert.equal(suggererDestination({ name: "CENTRE ECUSSON SASU" }), "pro");
  assert.equal(suggererDestination({ name: "Dupont", usage: "ORGA" }), "pro");
  assert.equal(suggererDestination({ name: "Compte courant" }, true), "pro");
  assert.equal(nomCompte({ name: "CONVERS BENJAMIN", product: "Compte de chèques", iban: "FR76 3000 4000 0100 0123 4567 890" }), "CONVERS BENJAMIN · Compte de chèques ••7890");
  assert.deepEqual(nomsUniques(["A", "A", "B"], (x) => x), ["A", "A (2)", "B"]);
});

test("destinations : plusieurs comptes d'une même banque, chacun à sa place, « ne pas suivre » efface ses opérations", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  process.env.ENABLEBANKING_APP_ID = "app-123"; process.env.ENABLEBANKING_PRIVATE_KEY = privateKey; process.env.LUCIEN_AUTH = "0";
  const d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const tx = (ref: string, amount: string, ind: "CRDT" | "DBIT", info: string, date: string) => ({ entry_reference: ref, transaction_amount: { amount, currency: "EUR" }, credit_debit_indicator: ind, status: "BOOK", booking_date: date, remittance_information: [info] });
  const comptes = [
    { uid: "perso", name: "CONVERS BENJAMIN", product: "Compte de chèques", cash_account_type: "CACC", usage: "PRIV", account_id: { iban: "FR7630004000010001234561111" } },
    { uid: "perso2", name: "CONVERS BENJAMIN", product: "Compte de chèques", cash_account_type: "CACC", usage: "PRIV", account_id: { iban: "FR7630004000010001234562222" } },
    { uid: "sci", name: "SCI SKOPELOS", cash_account_type: "CACC", account_id: { iban: "FR7630004000010001234563333" } },
    { uid: "livret", name: "CONVERS BENJAMIN", product: "Livret A", cash_account_type: "SVGS", account_id: { iban: "FR7630004000010001234564444" } },
  ];
  const vieux = globalThis.fetch;
  const states: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url); const path = u.pathname; const m = init?.method ?? "GET";
    const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/auth") { states.push(JSON.parse(String(init!.body)).state); return j({ url: "https://bank.example/login" }); }
    if (path === "/sessions" && m === "POST") return j({ session_id: "sess-1", accounts: comptes, access: { valid_until: new Date(Date.now() + 180 * 864e5).toISOString() }, aspsp: { name: "BNP Paribas", country: "FR" } });
    if (path.endsWith("/balances")) { const uid = path.split("/")[2]; return j({ balances: [{ balance_amount: { amount: { perso: "1284.35", perso2: "9359.44", sci: "775.63", livret: "12000" }[uid] ?? "0", currency: "EUR" }, balance_type: "CLBD" }] }); }
    if (path.endsWith("/transactions")) { const uid = path.split("/")[2]; return j({ transactions: [tx(`${uid}-1`, "40", "DBIT", `CB COURSES ${uid}`, d(5)), tx(`${uid}-2`, "900", "CRDT", `VIR ${uid}`, d(3))], continuation_key: null }); }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const h = db.createHousehold("Test");
    const json = { "content-type": "application/json" };
    await api.request("/bank/connect", { method: "POST", headers: json, body: JSON.stringify({ aspsp: { name: "BNP Paribas", country: "FR" } }) });
    await api.request(`/bank/eb/callback?state=${states[0]}&code=x`);
    const st = await (await api.request("/bank/status")).json();
    const par = Object.fromEntries(st.comptes.map((c: { id: string }) => [c.id, c])) as Record<string, { nom: string; destination: string; confirme: boolean }>;
    assert.equal(new Set(st.comptes.map((c: { nom: string }) => c.nom)).size, 4, "4 distinct names");
    assert.match(par["eb:perso"].nom, /••1111$/);
    assert.deepEqual([par["eb:perso"].destination, par["eb:perso2"].destination, par["eb:sci"].destination, par["eb:livret"].destination], ["foyer", "foyer", "locatif", "epargne"]);
    assert.equal(par["eb:perso"].confirme, false);
    // household budget: only the two personal accounts, and their balances only
    assert.equal(db.transactionsFoyer(h.id).length, 4);
    assert.equal(db.soldeFoyer(h.id), 10643.79);
    // savings balance in the balance sheet, read from the bank
    const budget = await (await api.request("/espaces/budget")).json();
    if (budget.rapport?.bilan) assert.ok(budget.rapport.bilan.actifs.some((a: { id: string; valeur: number }) => a.id === "banque:eb:livret" && a.valeur === 12000));
    // the person confirms, and does not want the second personal account followed
    const r = await (await api.request("/bank/comptes", { method: "PUT", headers: json, body: JSON.stringify({ comptes: [{ id: "eb:perso", destination: "foyer" }, { id: "eb:perso2", destination: "ignore" }, { id: "eb:sci", destination: "locatif" }, { id: "eb:livret", destination: "epargne" }] }) })).json();
    assert.equal(r.operations_retirees, 2);
    assert.equal(db.transactionsFoyer(h.id).length, 2);
    assert.equal(db.soldeFoyer(h.id), 1284.35);
    // the next synchronisation does not import the account that is not followed
    await tacheBanques(db);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM transactions WHERE household_id = ? AND compte LIKE '%2222'").get(h.id)!.n, 0);
    const st2 = await (await api.request("/bank/status")).json();
    assert.ok(st2.comptes.every((c: { confirme: boolean }) => c.confirme));
    assert.equal((await api.request("/bank/comptes", { method: "PUT", headers: json, body: JSON.stringify({ comptes: [{ id: "eb:inconnu", destination: "foyer" }] }) })).status, 404);
  } finally {
    globalThis.fetch = vieux;
    delete process.env.ENABLEBANKING_APP_ID; delete process.env.ENABLEBANKING_PRIVATE_KEY;
  }
});
