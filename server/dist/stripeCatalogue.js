/**
 * Prepares Stripe from Lucien's price grid, so that switching Stripe on only takes the secret key.
 *
 * - Every price Lucien may bill (formules, modules, packs, extra property, legacy option prices) has a Stripe price
 *   with a lookup_key equal to its env var name in lower case (stripe_price_duo_mensuel…). Missing ones are created;
 *   when the grid changes, a new price takes over the lookup_key and the old one stays for running subscriptions.
 *   The env vars (STRIPE_PRICE_…) still win when set by hand.
 * - The webhook endpoint (LUCIEN_PUBLIC_URL/api/stripe/webhook) is created if it does not exist; Stripe gives its
 *   signing secret only at creation, so it is kept in the database (table reglages) unless STRIPE_WEBHOOK_SECRET is set.
 *
 * Works the same in test mode (sk_test_…) and live mode. Runs at start-up, never blocks it.
 */
import Stripe from "stripe";
import { FORMULES } from "./abonnement.js";
import { LOCATIF_BIEN_SUPP, MODULES, PACKS, SOCLE, devis } from "./offre.js";
import { envBien, envModule, envPack } from "./stripeModules.js";
const r2 = (n) => Math.round(n * 100) / 100;
const parPeriode = (mensuel, p) => (p === "annuel" ? r2(mensuel * 10) : mensuel);
export const lookupKey = (env) => env.toLowerCase();
/** Every price of the grid, with the env var that holds its Stripe id. Amounts in euros, VAT included. */
export function catalogue() {
    const out = [];
    for (const p of ["mensuel", "annuel"]) {
        const suffixe = p === "annuel" ? " (annuel)" : "";
        for (const f of Object.keys(FORMULES))
            out.push({ env: `STRIPE_PRICE_${f.toUpperCase()}_${p.toUpperCase()}`, nom: `Lucien ${FORMULES[f].nom}${suffixe}`, montant: FORMULES[f].prix[p], periode: p });
        for (const m of Object.keys(MODULES))
            out.push({ env: envModule(m, p), nom: `${MODULES[m].nom}${suffixe}`, montant: parPeriode(MODULES[m].mensuel, p), periode: p });
        out.push({ env: envBien(p), nom: `Bien locatif supplémentaire${suffixe}`, montant: parPeriode(LOCATIF_BIEN_SUPP, p), periode: p });
        for (const pk of PACKS)
            for (const f of Object.keys(SOCLE)) {
                // same amount as the pack line of a checkout (stripeModules.lignesModules): pack price minus the socle
                const d = devis({ formule: f, periode: "mensuel", modules: [], pack: pk.id, biens: 0 });
                out.push({ env: envPack(pk.id, f, p), nom: `Pack ${pk.nom} · ${SOCLE[f].nom}${suffixe}`, montant: parPeriode(r2(d.mensuel - SOCLE[f].mensuel), p), periode: p });
            }
        // the option prices read by abonnement.ts (veille payante, assistant) are the module prices
        out.push({ env: `STRIPE_PRICE_VEILLE_${p.toUpperCase()}`, nom: `${MODULES.veille.nom} (option)${suffixe}`, montant: parPeriode(MODULES.veille.mensuel, p), periode: p });
        out.push({ env: `STRIPE_PRICE_ASSISTANT_${p.toUpperCase()}`, nom: `${MODULES.assistant.nom} (option)${suffixe}`, montant: parPeriode(MODULES.assistant.mensuel, p), periode: p });
    }
    return out;
}
export function ensureReglages(db) {
    db.raw.exec("CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL, maj_le TEXT NOT NULL)");
}
const lireReglage = (db, cle) => db.raw.prepare("SELECT valeur FROM reglages WHERE cle = ?").get(cle)?.valeur;
const ecrireReglage = (db, cle, valeur) => db.raw.prepare("INSERT INTO reglages (cle, valeur, maj_le) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le").run(cle, valeur, new Date().toISOString());
export const EVENEMENTS_WEBHOOK = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"];
export async function preparerStripe(db, client, env = process.env) {
    ensureReglages(db);
    const s = client ?? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
    const cat = catalogue();
    // read the existing prices by lookup key (10 per call)
    const parCle = new Map();
    for (let i = 0; i < cat.length; i += 10) {
        const r = await s.prices.list({ lookup_keys: cat.slice(i, i + 10).map((x) => lookupKey(x.env)), active: true, limit: 10 });
        for (const p of r.data)
            if (p.lookup_key)
                parCle.set(p.lookup_key, { id: p.id, unit_amount: p.unit_amount, interval: p.recurring?.interval ?? null });
    }
    let crees = 0, existants = 0;
    for (const x of cat) {
        const cents = Math.round(x.montant * 100), intervalle = x.periode === "annuel" ? "year" : "month";
        const ex = parCle.get(lookupKey(x.env));
        let id;
        if (ex && ex.unit_amount === cents && ex.interval === intervalle) {
            id = ex.id;
            existants++;
        }
        else {
            const p = await s.prices.create({
                currency: "eur", unit_amount: cents, recurring: { interval: intervalle }, lookup_key: lookupKey(x.env), transfer_lookup_key: true,
                tax_behavior: "inclusive", product_data: { name: x.nom, metadata: { lucien: x.env } }, metadata: { lucien: x.env },
            });
            id = p.id;
            crees++;
        }
        if (!env[x.env])
            env[x.env] = id;
    }
    // webhook
    let webhook = "ignore";
    const base = (env.LUCIEN_PUBLIC_URL ?? "").replace(/\/$/, "");
    if (/^https:\/\//.test(base)) {
        const url = `${base}/api/stripe/webhook`;
        const mode = (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live") || (env.STRIPE_SECRET_KEY ?? "").startsWith("rk_live") ? "live" : "test";
        const cleSecret = `stripe_webhook:${mode}:${url}`;
        const secretGarde = lireReglage(db, cleSecret);
        const existant = (await s.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === url && w.status === "enabled");
        if (existant) {
            webhook = env.STRIPE_WEBHOOK_SECRET || secretGarde ? "existant" : "secret_inconnu";
        }
        else {
            const w = await s.webhookEndpoints.create({ url, enabled_events: [...EVENEMENTS_WEBHOOK], description: "Lucien (créé automatiquement)" });
            if (w.secret)
                ecrireReglage(db, cleSecret, w.secret);
            webhook = "cree";
        }
        const secret = lireReglage(db, cleSecret);
        if (!env.STRIPE_WEBHOOK_SECRET && secret)
            env.STRIPE_WEBHOOK_SECRET = secret;
    }
    // customer portal (« Gérer mon abonnement »): Stripe refuses to open it until a configuration exists
    if (s.billingPortal && !env.LUCIEN_STRIPE_PORTAIL) {
        const site = "https://monlucien.fr";
        const ex = (await s.billingPortal.configurations.list({ limit: 100, active: true })).data.find((c) => c.metadata?.lucien === "portail");
        env.LUCIEN_STRIPE_PORTAIL = ex?.id ?? (await s.billingPortal.configurations.create({
            metadata: { lucien: "portail" },
            business_profile: { privacy_policy_url: `${site}/confidentialite.html`, terms_of_service_url: `${site}/cgv.html` },
            features: {
                invoice_history: { enabled: true },
                payment_method_update: { enabled: true },
                customer_update: { enabled: true, allowed_updates: ["email", "address", "name"] },
                // like an insurance contract: a cancellation takes effect at the end of the period already paid (CGV)
                subscription_cancel: { enabled: true, mode: "at_period_end" },
            },
        })).id;
    }
    return { crees, existants, webhook };
}
