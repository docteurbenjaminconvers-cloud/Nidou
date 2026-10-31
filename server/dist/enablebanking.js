import { budgetIa } from "./iaBudget.js";
import { createSign, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { categorise, merchantOf, fingerprint } from "./transactions.js";
export function ebConfig() {
    const appId = process.env.ENABLEBANKING_APP_ID;
    let key = process.env.ENABLEBANKING_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!key && process.env.ENABLEBANKING_PRIVATE_KEY_FILE) {
        try {
            key = readFileSync(process.env.ENABLEBANKING_PRIVATE_KEY_FILE, "utf8");
        }
        catch {
            key = undefined;
        }
    }
    if (!appId || !key)
        return null;
    return {
        appId, privateKey: key,
        publicUrl: (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
        baseUrl: process.env.ENABLEBANKING_BASE_URL ?? "https://api.enablebanking.com",
        consentDays: Number(process.env.ENABLEBANKING_CONSENT_DAYS ?? 180),
    };
}
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
/** RS256 JWT for the Enable Banking API (valid one hour). */
export function ebJwt(cfg, nowSec = Math.floor(Date.now() / 1000)) {
    const head = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: cfg.appId }));
    const body = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: nowSec, exp: nowSec + 3600 }));
    const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(cfg.privateKey);
    return `${head}.${body}.${b64url(sig)}`;
}
export class EbClient {
    cfg;
    fetchImpl;
    constructor(cfg, fetchImpl = fetch) {
        this.cfg = cfg;
        this.fetchImpl = fetchImpl;
    }
    async call(method, path, body) {
        const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
            method, body: body ? JSON.stringify(body) : undefined,
            headers: { Authorization: `Bearer ${ebJwt(this.cfg)}`, "Content-Type": "application/json", Accept: "application/json" },
        });
        if (!res.ok)
            throw new Error(`Enable Banking ${method} ${path} → ${res.status} ${await res.text().catch(() => "")}`);
        return (res.status === 204 ? {} : await res.json());
    }
    aspsps(country = "FR") { return this.call("GET", `/aspsps?country=${country}&psu_type=personal`).then((r) => r.aspsps ?? []); }
    /** Returns the bank's login URL. `state` comes back on the callback and tells us whose connection it is. */
    startAuth(aspsp, state, maxDays) {
        const days = Math.min(this.cfg.consentDays, maxDays ? Math.floor(maxDays / 86400) || this.cfg.consentDays : this.cfg.consentDays);
        return this.call("POST", "/auth", {
            access: { valid_until: new Date(Date.now() + days * 864e5).toISOString() },
            aspsp, state, redirect_url: `${this.cfg.publicUrl}/api/bank/eb/callback`, psu_type: "personal",
        });
    }
    createSession(code) { return this.call("POST", "/sessions", { code }); }
    session(id) { return this.call("GET", `/sessions/${id}`); }
    deleteSession(id) { return this.call("DELETE", `/sessions/${id}`); }
    balances(uid) { return this.call("GET", `/accounts/${uid}/balances`).then((r) => r.balances ?? []); }
    async transactions(uid, dateFrom) {
        const out = [];
        let key = null;
        for (let i = 0; i < 50; i++) {
            const q = new URLSearchParams({ date_from: dateFrom, ...(key ? { continuation_key: key } : {}) });
            const page = await this.call("GET", `/accounts/${uid}/transactions?${q}`);
            out.push(...(page.transactions ?? []));
            key = page.continuation_key ?? null;
            if (!key)
                break;
        }
        return out;
    }
}
/** Booked transactions only, signed amounts, a readable label, and Enable Banking's own reference as the dedup key. */
export function mapEbTransactions(txs, compte) {
    return txs
        .filter((t) => !t.status || t.status === "BOOK")
        .map((t) => {
        const montant = Math.abs(Number(t.transaction_amount.amount)) * (t.credit_debit_indicator === "DBIT" ? -1 : 1);
        const tiers = t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name;
        const info = (t.remittance_information ?? []).join(" ").replace(/\s+/g, " ").trim();
        const libelle = [info, tiers && !info.toUpperCase().includes(tiers.toUpperCase()) ? (t.credit_debit_indicator === "DBIT" ? `vers ${tiers}` : `de ${tiers}`) : null].filter(Boolean).join(" ") || "Opération";
        return { date: (t.booking_date ?? t.value_date ?? t.transaction_date ?? "").slice(0, 10), libelle, montant, compte, ref: t.entry_reference ?? t.transaction_id ?? null };
    })
        .filter((t) => t.date && Number.isFinite(t.montant));
}
// ---------- storage: bank_links gets the consent end and the account list ----------
export function ensureEbSchema(db) {
    const cols = db.raw.prepare("PRAGMA table_info(bank_links)").all().map((c) => c.name);
    if (!cols.includes("expire_le"))
        db.raw.exec("ALTER TABLE bank_links ADD COLUMN expire_le TEXT");
    if (!cols.includes("comptes"))
        db.raw.exec("ALTER TABLE bank_links ADD COLUMN comptes TEXT");
}
const setLinkExtra = (db, household_id, expire_le, comptes) => db.raw.prepare("UPDATE bank_links SET expire_le = ?, comptes = ? WHERE household_id = ?").run(expire_le, JSON.stringify(comptes.map((a) => ({ uid: a.uid, name: a.name ?? null, iban: a.account_id?.iban ?? null }))), household_id);
export const linkExtra = (db, household_id) => db.raw.prepare("SELECT expire_le, comptes FROM bank_links WHERE household_id = ?").get(household_id);
export const newState = () => randomBytes(18).toString("base64url");
/** Starts a household connection: remembers the pending state, returns the bank's URL. */
export async function ebConnectHousehold(db, client, householdId, aspsp) {
    const state = `h.${newState()}`;
    db.upsertBankLink({ household_id: householdId, fournisseur: "enablebanking", user_uuid: `attente:${state}`, external_user_id: `${aspsp.name}|${aspsp.country}`, derniere_synchro: null, curseur: null, statut: "en_attente" });
    const { url } = await client.startAuth({ name: aspsp.name, country: aspsp.country }, state, aspsp.maximum_consent_validity);
    return { url };
}
/** Callback for a household: opens the session and records the accounts and the consent end. */
export async function ebFinishHousehold(db, client, state, code) {
    const link = db.getBankLinkByUser(`attente:${state}`);
    if (!link)
        return null;
    const s = await client.createSession(code);
    db.upsertBankLink({ ...link, user_uuid: s.session_id, statut: "connecte" });
    setLinkExtra(db, link.household_id, s.access?.valid_until ?? null, s.accounts ?? []);
    return link.household_id;
}
/** Pulls balances and new booked transactions for every account of the household. */
export async function ebSyncHousehold(db, client, householdId) {
    const link = db.getBankLink(householdId);
    if (!link || link.fournisseur !== "enablebanking" || link.user_uuid.startsWith("attente:"))
        throw new Error("Aucune connexion bancaire pour ce foyer");
    const extra = linkExtra(db, householdId);
    if (extra?.expire_le && new Date(extra.expire_le).getTime() < Date.now()) {
        db.upsertBankLink({ ...link, statut: "erreur" });
        throw new Error("L'autorisation de la banque a expiré : reconnectez la banque.");
    }
    const banque = link.external_user_id.split("|")[0] || null;
    const comptes = JSON.parse(extra?.comptes ?? "[]");
    const from = (link.curseur ?? new Date(Date.now() - 90 * 864e5).toISOString()).slice(0, 10);
    let lues = 0, ajoutees = 0;
    for (const a of comptes) {
        const nom = a.name || (a.iban ? `Compte ••${a.iban.slice(-4)}` : "Compte");
        const bal = await client.balances(a.uid).catch(() => []);
        const solde = bal.find((b) => ["CLBD", "ITAV", "XPCD", "ITBD"].includes(b.balance_type ?? "")) ?? bal[0];
        db.upsertBankAccount({ id: `eb:${a.uid}`, household_id: householdId, item_id: link.user_uuid, nom, banque, type: null, solde: solde ? Number(solde.balance_amount.amount) : null, devise: solde?.balance_amount.currency ?? "EUR", maj_le: new Date().toISOString() });
        const parsed = mapEbTransactions(await client.transactions(a.uid, from), nom);
        lues += parsed.length;
        const cats = await categorise(parsed, budgetIa(db, householdId));
        ajoutees += db.insertTransactions(parsed.map((t, i) => ({
            household_id: householdId, compte: t.compte, date: t.date, libelle: t.libelle, marchand: merchantOf(t.libelle), montant: t.montant, categorie: cats[i],
            empreinte: t.ref ? `eb:${a.uid}:${t.ref}` : fingerprint(householdId, t),
        })));
    }
    const now = new Date().toISOString();
    // Overlap of 3 days: banks book some transactions late.
    db.upsertBankLink({ ...link, derniere_synchro: now, curseur: new Date(Date.now() - 3 * 864e5).toISOString(), statut: "connecte" });
    return { comptes: comptes.length, lues, ajoutees, derniere_synchro: now };
}
/** Bank list for the picker, cached a day (it barely changes). */
let cacheBanques = null;
export async function banquesFR(client) {
    if (cacheBanques && Date.now() - cacheBanques.at < 864e5)
        return cacheBanques.list;
    const list = (await client.aspsps("FR")).filter((a) => !a.psu_types || a.psu_types.includes("personal")).sort((x, y) => x.name.localeCompare(y.name, "fr"));
    cacheBanques = { at: Date.now(), list };
    return list;
}
/** Simulated mode (no keys): a short list so the picker can be tried. */
export const BANQUES_DEMO = ["BNP Paribas", "Boursorama", "Caisse d'Épargne", "Crédit Agricole", "Crédit Mutuel", "La Banque Postale", "LCL", "Société Générale"].map((name) => ({ name, country: "FR" }));
