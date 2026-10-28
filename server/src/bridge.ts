import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { categorise, merchantOf, fingerprint, type ParsedTx } from "./transactions.js";
import { demoStatement } from "./seed-statement.js";
import { parseStatement } from "./transactions.js";

/**
 * Bridge (bridgeapi.io) aggregation — API version 2025-01-15.
 *
 * Flow: create a Bridge user for the household → user access token (2 h) → Connect session URL where the
 * family picks its bank → accounts and transactions are pulled, then kept fresh by the `item.refreshed` webhook.
 *
 * Without BRIDGE_CLIENT_ID / BRIDGE_CLIENT_SECRET the module runs in simulated mode: the Connect URL points to
 * a local page that "links" a fictional bank, so the whole product flow can be exercised end to end.
 */

export interface BridgeConfig {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  publicUrl: string;        // https://app.nidou.fr — used for callback_url
  baseUrl: string;          // https://api.bridgeapi.io
  version: string;          // 2025-01-15
}

export function bridgeConfig(): BridgeConfig | null {
  const { BRIDGE_CLIENT_ID, BRIDGE_CLIENT_SECRET } = process.env;
  if (!BRIDGE_CLIENT_ID || !BRIDGE_CLIENT_SECRET) return null;
  return {
    clientId: BRIDGE_CLIENT_ID,
    clientSecret: BRIDGE_CLIENT_SECRET,
    webhookSecret: process.env.BRIDGE_WEBHOOK_SECRET ?? "",
    publicUrl: (process.env.NIDOU_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    baseUrl: process.env.BRIDGE_BASE_URL ?? "https://api.bridgeapi.io",
    version: process.env.BRIDGE_VERSION ?? "2025-01-15",
  };
}

// ---------- minimal HTTP client ----------

type Fetch = typeof fetch;

export class BridgeClient {
  constructor(private cfg: BridgeConfig, private fetchImpl: Fetch = fetch) {}

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Client-Id": this.cfg.clientId,
      "Client-Secret": this.cfg.clientSecret,
      "Bridge-Version": this.cfg.version,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private async call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { method, headers: this.headers(token), body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`Bridge ${method} ${path} → ${res.status} ${await res.text().catch(() => "")}`);
    return (await res.json()) as T;
  }

  /** POST /v3/aggregation/users */
  createUser(externalUserId: string) {
    return this.call<{ uuid: string; external_user_id?: string }>("POST", "/v3/aggregation/users", { external_user_id: externalUserId });
  }

  /** POST /v3/aggregation/authorization/token — access token valid 2 hours */
  userToken(userUuid: string) {
    return this.call<{ access_token: string; expires_at: string }>("POST", "/v3/aggregation/authorization/token", { user_uuid: userUuid });
  }

  /** POST /v3/aggregation/connect-sessions — returns the URL of the bank-selection funnel */
  connectSession(token: string, userEmail: string, context?: string) {
    return this.call<{ id: string; url: string }>("POST", "/v3/aggregation/connect-sessions", {
      user_email: userEmail,
      callback_url: `${this.cfg.publicUrl}/api/bank/callback`,
      ...(context ? { context } : {}),
    }, token);
  }

  /** GET /v3/aggregation/accounts */
  async accounts(token: string): Promise<BridgeAccount[]> {
    return this.paginate<BridgeAccount>(token, "/v3/aggregation/accounts?limit=100");
  }

  /** GET /v3/aggregation/transactions — `since` returns new or updated transactions after that instant */
  async transactions(token: string, since?: string | null): Promise<BridgeTransaction[]> {
    const q = new URLSearchParams({ limit: "500" });
    if (since) q.set("since", since);
    return this.paginate<BridgeTransaction>(token, `/v3/aggregation/transactions?${q}`);
  }

  private async paginate<T>(token: string, firstPath: string): Promise<T[]> {
    const out: T[] = [];
    let path: string | null = firstPath;
    for (let i = 0; path && i < 50; i++) {
      const page: { resources: T[]; pagination?: { next_uri?: string | null } } = await this.call("GET", path, undefined, token);
      out.push(...(page.resources ?? []));
      path = page.pagination?.next_uri ?? null;
    }
    return out;
  }
}

export interface BridgeAccount {
  id: number | string;
  item_id?: number | string;
  name: string;
  balance?: number;
  currency_code?: string;
  type?: string;
  provider_id?: number;
  data_access?: string;
  updated_at?: string;
}

export interface BridgeTransaction {
  id: number | string;
  account_id: number | string;
  clean_description?: string;
  provider_description?: string;
  amount: number;
  currency_code?: string;
  date: string;
  booking_date?: string;
  operation_type?: string;
  future?: boolean;
  deleted?: boolean;
  updated_at?: string;
}

// ---------- webhook signature ----------

/** Verifies `BridgeApi-Signature: v1=<HMAC-SHA256 hex, uppercase>` over the raw body. */
export function verifyBridgeSignature(rawBody: string, header: string | null | undefined, secrets: string[]): boolean {
  if (!header) return false;
  const given = header.split(",").map((s) => s.trim()).find((s) => s.startsWith("v1="))?.slice(3);
  if (!given) return false;
  return secrets.filter(Boolean).some((secret) => {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex").toUpperCase();
    return expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given.toUpperCase()));
  });
}

// ---------- mapping + sync ----------

export function mapTransactions(txs: BridgeTransaction[], accountNames: Map<string, string>): ParsedTx[] {
  return txs
    .filter((t) => !t.deleted && !t.future)
    .map((t) => ({
      date: (t.booking_date ?? t.date).slice(0, 10),
      libelle: (t.clean_description || t.provider_description || "Opération").replace(/\s+/g, " ").trim(),
      montant: Number(t.amount),
      compte: accountNames.get(String(t.account_id)) ?? `Compte ${t.account_id}`,
    }));
}

export interface SyncResult { comptes: number; lues: number; ajoutees: number; derniere_synchro: string }

/** Pulls accounts and new transactions for a household and stores them. */
export async function syncHousehold(db: Db, client: BridgeClient, householdId: string): Promise<SyncResult> {
  const link = db.getBankLink(householdId);
  if (!link) throw new Error("Aucune connexion bancaire pour ce foyer");
  const { access_token } = await client.userToken(link.user_uuid);
  const accounts = (await client.accounts(access_token)).filter((a) => a.data_access !== "disabled");
  const names = new Map<string, string>();
  for (const a of accounts) {
    names.set(String(a.id), a.name);
    db.upsertBankAccount({ id: `bridge:${a.id}`, household_id: householdId, item_id: a.item_id ? String(a.item_id) : null, nom: a.name, banque: a.provider_id ? String(a.provider_id) : null, type: a.type ?? null, solde: a.balance ?? null, devise: a.currency_code ?? "EUR", maj_le: a.updated_at ?? null });
  }
  const raw = await client.transactions(access_token, link.curseur);
  const parsed = mapTransactions(raw, names);
  const cats = await categorise(parsed);
  const added = db.insertTransactions(parsed.map((t, i) => ({
    household_id: householdId, compte: t.compte, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i],
    // Bridge ids are stable: use them so an updated transaction never duplicates.
    empreinte: `bridge:${raw.filter((x) => !x.deleted && !x.future)[i]?.id ?? fingerprint(householdId, t)}`,
  })));
  const now = new Date().toISOString();
  // Keep a little overlap so a transaction updated right at the boundary is not missed.
  const cursor = new Date(Date.now() - 24 * 3600e3).toISOString();
  db.upsertBankLink({ ...link, derniere_synchro: now, curseur: cursor, statut: "connecte" });
  return { comptes: accounts.length, lues: parsed.length, ajoutees: added, derniere_synchro: now };
}

// ---------- simulated provider (no Bridge credentials) ----------

/** Simulated flow: creates the link and loads a fictional bank so the product can be tried without credentials. */
export async function simulatedConnect(db: Db, householdId: string): Promise<{ url: string }> {
  const link = db.getBankLink(householdId) ?? { household_id: householdId, fournisseur: "simule", user_uuid: randomUUID(), external_user_id: householdId, derniere_synchro: null, curseur: null, statut: "en_attente" as const };
  db.upsertBankLink(link);
  return { url: `/api/bank/callback?user_uuid=${link.user_uuid}&item_id=sim-1&success=true&source=simulated` };
}

export async function simulatedSync(db: Db, householdId: string): Promise<SyncResult> {
  const link = db.getBankLink(householdId);
  if (!link) throw new Error("Aucune connexion bancaire pour ce foyer");
  db.upsertBankAccount({ id: "sim:1", household_id: householdId, item_id: "sim-1", nom: "Compte joint", banque: "Banque de démonstration", type: "checking", solde: 2487.91, devise: "EUR", maj_le: new Date().toISOString() });
  const parsed = parseStatement(demoStatement(), "Compte joint");
  const cats = await categorise(parsed);
  const added = db.insertTransactions(parsed.map((t, i) => ({ household_id: householdId, compte: t.compte, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i], empreinte: fingerprint(householdId, t) })));
  const now = new Date().toISOString();
  db.upsertBankLink({ ...link, derniere_synchro: now, curseur: now, statut: "connecte" });
  return { comptes: 1, lues: parsed.length, ajoutees: added, derniere_synchro: now };
}
