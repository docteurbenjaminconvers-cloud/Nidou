import { marquerDebutAbonnement } from "./retractation.js";
import { ensureSuppressionSchema } from "./suppression.js";
import Stripe from "stripe";
import { lignesModules, modulesDepuisItems, planChangement, prixManquants, tousLesPrix } from "./stripeModules.js";
import { devis, normaliser, PACKS } from "./offre.js";
import { joursOfferts } from "./partenaires.js";
/**
 * Paid plans billed with Stripe Checkout + Billing Portal + webhooks. Three formules, priced by the number of people
 * who log in on the household (member cards without a login, such as children or an elderly parent, are unlimited):
 *   Solo  1 personne   6,90 €/mois ou 69 €/an
 *   Duo   2 personnes  9,90 €/mois ou 99 €/an
 *   Tribu 6 personnes 13,90 €/mois ou 139 €/an
 * Annual = 10 × monthly (« 2 mois offerts »). Prices live in Stripe: STRIPE_PRICE_<FORMULE>_<PERIODE>.
 * Without a secret key the module runs in "simulé" mode: checkout activates the formule immediately (prototype and demo).
 */
export const stripeOn = () => Boolean(process.env.STRIPE_SECRET_KEY);
/** Simulated payments (no money taken) only on a test instance that asks for them explicitly; never in production. */
// never in the production image: a simulated payment there would hand out real subscriptions for nothing
export const simulationPaiement = () => !stripeOn() && process.env.LUCIEN_PAIEMENT_SIMULE === "1" && process.env.NODE_ENV !== "production";
export const paiementDisponible = () => stripeOn() || simulationPaiement();
/** A new subscription needs the consumer's express request to start before the 14-day withdrawal period ends. */
export class ConsentementRequis extends Error {
    constructor() { super("Cochez la case demandant que l'abonnement commence tout de suite pour continuer."); }
}
export class PaiementIndisponible extends Error {
    constructor() { super("Le paiement en ligne arrive bientôt. D'ici là, rien ne change pour vous."); }
}
let stripeDeTest = null;
/** Tests only: a fake Stripe client. */
export const remplacerStripe = (c) => { stripeDeTest = c; };
const stripe = () => stripeDeTest ?? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
const publicUrl = () => (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const FORMULES = {
    solo: { nom: "Solo", comptes: 1, prix: { mensuel: 6.9, annuel: 69 } },
    duo: { nom: "Duo", comptes: 2, prix: { mensuel: 9.9, annuel: 99 } },
    tribu: { nom: "Tribu", comptes: 6, prix: { mensuel: 13.9, annuel: 139 } },
};
/** Accounts allowed on the free plan, and during the trial (full Tribu). */
export const COMPTES_GRATUIT = 1;
export const COMPTES_ESSAI = FORMULES.tribu.comptes;
/** Kept for older callers: the Duo prices. */
export const PRIX = FORMULES.duo.prix;
const priceEnv = (f, p) => `STRIPE_PRICE_${f.toUpperCase()}_${p.toUpperCase()}`;
/** Price id → formule/periode, for webhooks that carry no metadata (changes made in the Stripe portal). */
function depuisPrix(priceId) {
    if (!priceId)
        return null;
    for (const f of Object.keys(FORMULES))
        for (const p of ["mensuel", "annuel"])
            if (process.env[priceEnv(f, p)] === priceId)
                return { formule: f, periode: p };
    return null;
}
/** People allowed to log in on this household today. */
export function capaciteComptes(db, h) {
    const plan = db.effectivePlan(h);
    if (plan === "gratuit")
        return COMPTES_GRATUIT;
    if (h.plan !== "famille")
        return COMPTES_ESSAI; // trial
    return FORMULES[h.formule ?? "duo"]?.comptes ?? FORMULES.duo.comptes;
}
export async function creerCheckout(db, h, formule, periode, email, modules, demarrageImmediat = false) {
    if (!demarrageImmediat)
        throw new ConsentementRequis();
    if (!stripeOn()) {
        if (!simulationPaiement())
            throw new PaiementIndisponible();
        return { url: `${publicUrl()}/api/abonnement/simule?formule=${formule}&periode=${periode}`, simule: true };
    }
    const price = process.env[priceEnv(formule, periode)];
    if (!price)
        throw new Error(`${priceEnv(formule, periode)} manquant`);
    const lignes = modules ? lignesModules({ ...modules, formule, periode }) : [];
    const manquants = prixManquants(lignes);
    if (manquants.length)
        throw new Error(`Prix Stripe manquants : ${manquants.join(", ")}`);
    const choix = modules ? JSON.stringify({ modules: modules.modules, pack: modules.pack, biens: modules.biens ?? 0, proches: modules.proches ?? 0 }) : "";
    const s = await stripe().checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }, ...lignes.map((l) => ({ price: process.env[l.env], quantity: l.quantite }))],
        customer: h.stripe_customer_id ?? undefined,
        customer_email: h.stripe_customer_id ? undefined : email ?? undefined,
        client_reference_id: h.id,
        metadata: { household_id: h.id, formule, periode, demarrage_immediat: "demande", ...(choix ? { modules: choix } : {}) },
        // Partner cabinets: the first subscription of their clients starts with one month free.
        subscription_data: { metadata: { household_id: h.id, formule, periode, ...(choix ? { modules: choix } : {}) }, ...(joursOfferts(db, h) ? { trial_period_days: joursOfferts(db, h) } : {}) },
        allow_promotion_codes: true,
        locale: "fr",
        success_url: `${publicUrl()}/#/settings?paiement=ok`,
        cancel_url: `${publicUrl()}/#/settings?paiement=annule`,
    });
    return { url: s.url, simule: false };
}
/** Modules removed during a paid period stay open until its end (no refund, like an insurance contract). */
export function ensureConservesSchema(db) {
    db.raw.exec("CREATE TABLE IF NOT EXISTS modules_conserves (household_id TEXT NOT NULL, module TEXT NOT NULL, jusqu_au TEXT NOT NULL, PRIMARY KEY (household_id, module))");
    const cols = db.raw.prepare("PRAGMA table_info(households)").all().map((c) => c.name);
    if (!cols.includes("modules_choix"))
        db.raw.exec("ALTER TABLE households ADD COLUMN modules_choix TEXT");
}
const aujourdhui = () => new Date().toISOString().slice(0, 10);
export function modulesConserves(db, householdId, jour = aujourdhui()) {
    ensureConservesSchema(db);
    return db.raw.prepare("SELECT module, jusqu_au FROM modules_conserves WHERE household_id = ? AND jusqu_au > ? ORDER BY module").all(householdId, jour);
}
function noterConserves(db, householdId, liste) {
    ensureConservesSchema(db);
    const st = db.raw.prepare("INSERT INTO modules_conserves (household_id, module, jusqu_au) VALUES (?, ?, ?) ON CONFLICT(household_id, module) DO UPDATE SET jusqu_au = excluded.jusqu_au");
    for (const c of liste)
        st.run(householdId, c.module, c.jusqu_au);
}
/** Modules billed on Stripe, plus those removed but still paid until the end of the period. */
export function fixerModules(db, householdId, factures) {
    const enCours = modulesConserves(db, householdId).map((c) => c.module);
    db.raw.prepare("DELETE FROM modules_conserves WHERE household_id = ? AND (jusqu_au <= ? OR module IN (SELECT value FROM json_each(?)))").run(householdId, aujourdhui(), JSON.stringify(factures));
    db.setModules(householdId, normaliser([...factures, ...enCours]));
}
/** What the household pays for, as the offer screen shows it (pack, modules, properties, close ones). */
export function choixAbonnement(db, householdId) {
    ensureConservesSchema(db);
    const r = db.raw.prepare("SELECT modules_choix FROM households WHERE id = ?").get(householdId);
    try {
        return r?.modules_choix ? JSON.parse(r.modules_choix) : null;
    }
    catch {
        return null;
    }
}
function noterChoix(db, householdId, items) {
    ensureConservesSchema(db);
    const lu = modulesDepuisItems(items.map((i) => ({ price: { id: i.price.id }, quantity: i.quantity ?? 1 })));
    const horsPack = lu.modules.filter((m) => !(PACKS.find((p) => p.id === lu.pack)?.modules ?? []).includes(m));
    db.raw.prepare("UPDATE households SET modules_choix = ? WHERE id = ?").run(JSON.stringify({ pack: lu.pack, modules: horsPack, biens_supp: lu.biens_supp, proches: lu.proches }), householdId);
    return lu;
}
/**
 * Modules and packs of a household. Without Stripe: simulated on a test instance only. Without a running subscription:
 * Checkout (socle + modules in one subscription). With a subscription: first an estimate (`confirmer` false), then the
 * change itself, billed by planChangement's rules: additions are charged today and switch on only once paid.
 */
export async function changerModules(db, h, c, email, demarrageImmediat = false, opts = {}) {
    const voulus = normaliser([...(PACKS.find((p) => p.id === c.pack)?.modules ?? []), ...c.modules]);
    if (!stripeOn()) {
        if (!simulationPaiement())
            throw new PaiementIndisponible();
        db.setModules(h.id, voulus);
        return { simule: true, modules: voulus };
    }
    if (!h.stripe_subscription_id || !["active", "trialing", "past_due"].includes(h.abonnement_statut ?? "")) {
        const r = await creerCheckout(db, h, c.formule, c.periode, email, c, demarrageImmediat);
        return { url: r.url, simule: false, modules: voulus };
    }
    if (h.abonnement_statut === "past_due")
        throw new Error("Votre dernier paiement n'est pas passé : mettez à jour votre carte dans « Gérer mon abonnement », puis réessayez.");
    // module lines follow the subscription's own formule and period
    const choix = { ...c, periode: h.abonnement_periode ?? c.periode, formule: h.formule ?? c.formule };
    const lignes = lignesModules(choix);
    const manquants = prixManquants(lignes);
    if (manquants.length)
        throw new Error(`Prix Stripe manquants : ${manquants.join(", ")}`);
    const sub = await stripe().subscriptions.retrieve(h.stripe_subscription_id);
    const maintenant = Math.floor(Date.now() / 1000);
    const prorationDate = opts.prorationDate && opts.prorationDate <= maintenant && opts.prorationDate > maintenant - 3600 ? opts.prorationDate : maintenant;
    const plan = planChangement(sub.items.data, lignes, { maintenant: prorationDate, essai: sub.status === "trialing", conserves: modulesConserves(db, h.id).map((x) => x.module) });
    const fin = h.abonnement_fin ?? (sub.items.data[0]?.current_period_end ? new Date(sub.items.data[0].current_period_end * 1000).toISOString().slice(0, 10) : null);
    if (!opts.confirmer) {
        let debit = 0;
        if (plan.payant.items.length) {
            const p = await stripe().invoices.createPreview({ customer: sub.customer, subscription: sub.id, subscription_details: { items: plan.payant.items, proration_behavior: "create_prorations", proration_date: prorationDate } });
            // only the proration lines of this change (not the renewal, nor prorations left from earlier changes)
            for (const l of p.lines.data) {
                const pr = l.parent?.subscription_item_details?.proration ?? l.parent?.invoice_item_details?.proration ?? false;
                if (pr && l.period?.start === prorationDate)
                    debit += l.amount;
            }
        }
        const credit = plan.payant.credits.reduce((s, x) => s + x.montant, 0);
        return {
            simule: false, modules: voulus,
            apercu: { aujourdhui: Math.max(0, debit - credit) / 100, credit: credit / 100, avoir: Math.max(0, credit - debit) / 100, prochain: { montant: devis({ ...choix, biens: c.biens ?? 0 }).total, date: fin }, retraits: plan.conserves, proration_date: prorationDate },
        };
    }
    // 1. what costs nothing (removals, fewer units, modules coming back): first, since a later update with items would drop a pending one
    noterConserves(db, h.id, plan.conserves);
    if (plan.gratuit.length)
        await stripe().subscriptions.update(sub.id, { items: plan.gratuit, proration_behavior: "none" });
    // 2. what costs: charged now, applied by Stripe only once paid
    let attente = false, url;
    if (plan.payant.items.length) {
        const maj = await stripe().subscriptions.update(sub.id, {
            items: plan.payant.items,
            proration_behavior: "always_invoice", proration_date: prorationDate,
            payment_behavior: "pending_if_incomplete",
            ...(plan.payant.credits.length ? { add_invoice_items: plan.payant.credits.map((x) => ({ price_data: { currency: "eur", product: x.product, unit_amount: -x.montant, tax_behavior: "inclusive" }, quantity: 1 })) } : {}),
            // lines replaced by the new pack are removed once the payment went through (here, or by the webhook)
            metadata: { lucien_retirer: plan.apresPaiement.join(",") },
            expand: ["latest_invoice"],
        });
        if (maj.pending_update) {
            attente = true;
            url = maj.latest_invoice?.hosted_invoice_url ?? undefined;
        }
        else
            await retirerApresPaiement(maj.id);
    }
    const apres = await stripe().subscriptions.retrieve(sub.id);
    const lu = noterChoix(db, h.id, apres.items.data);
    fixerModules(db, h.id, lu.modules);
    return { simule: false, modules: db.getModules(h.id), attente, url };
}
/** Removes the lines a paid pack replaced (already credited on that payment). Safe to run twice. */
export async function retirerApresPaiement(subscriptionId) {
    const sub = await stripe().subscriptions.retrieve(subscriptionId);
    const ids = (sub.metadata?.lucien_retirer ?? "").split(",").filter(Boolean);
    if (!ids.length || sub.pending_update)
        return;
    const presents = ids.filter((id) => sub.items.data.some((i) => i.id === id));
    await stripe().subscriptions.update(sub.id, { ...(presents.length ? { items: presents.map((id) => ({ id, deleted: true })) } : {}), proration_behavior: "none", metadata: { lucien_retirer: "" } });
}
/** Option still sold on its own screen: with Stripe, it goes through the offer, which shows the amount before paying. */
export async function ajouterVeillePayante(db, h, periode) {
    const actuel = db.raw.prepare("SELECT veilles_supp FROM households WHERE id = ?").get(h.id)?.veilles_supp ?? 0;
    if (!stripeOn()) {
        if (!simulationPaiement())
            throw new PaiementIndisponible();
        db.raw.prepare("UPDATE households SET veilles_supp = ? WHERE id = ?").run(actuel + 1, h.id);
        return { simule: true, total: actuel + 1 };
    }
    void periode;
    throw new Error("Ajoutez la veille depuis « L'offre Lucien » : le montant vous est indiqué avant le paiement.");
}
/**
 * « Demander à Lucien » option. Adding it with Stripe goes through the offer (amount shown before paying); removing it
 * keeps it open until the end of the period already paid.
 */
export async function basculerAssistant(db, h, actif) {
    const set = (v) => db.raw.prepare("UPDATE households SET assistant_option = ? WHERE id = ?").run(v ? 1 : 0, h.id);
    if (!stripeOn()) {
        if (actif && !simulationPaiement())
            throw new PaiementIndisponible(); // switching off never needs a payment
        set(actif);
        return { simule: true, actif };
    }
    if (actif)
        throw new Error("Ajoutez l'assistant depuis « L'offre Lucien » : le montant vous est indiqué avant le paiement.");
    if (!h.stripe_subscription_id) {
        set(false);
        return { simule: false, actif: false };
    }
    const sub = await stripe().subscriptions.retrieve(h.stripe_subscription_id);
    const lu = modulesDepuisItems(sub.items.data.map((i) => ({ price: { id: i.price.id }, quantity: i.quantity ?? 1 })));
    const pack = PACKS.find((p) => p.id === lu.pack);
    if (pack?.modules.includes("assistant"))
        throw new Error(`L'assistant fait partie de votre pack ${pack.nom} : changez de pack depuis « L'offre Lucien ».`);
    const horsPack = lu.modules.filter((m) => m !== "assistant" && !(pack?.modules ?? []).includes(m));
    await changerModules(db, h, { formule: h.formule ?? "duo", periode: h.abonnement_periode ?? "mensuel", modules: horsPack, pack: lu.pack, biens: lu.biens_supp + 2, proches: lu.proches || undefined }, null, true, { confirmer: true });
    return { simule: false, actif: false };
}
export async function portail(h) {
    if (!stripeOn() || !h.stripe_customer_id)
        return null;
    const s = await stripe().billingPortal.sessions.create({ customer: h.stripe_customer_id, return_url: `${publicUrl()}/#/settings`, locale: "fr", ...(process.env.LUCIEN_STRIPE_PORTAIL ? { configuration: process.env.LUCIEN_STRIPE_PORTAIL } : {}) });
    return s.url;
}
/** Applies a subscription state to the household. Shared by the webhook and the simulated mode. */
export function appliquerAbonnement(db, h, a) {
    const actif = ["active", "trialing", "past_due", "simule", "offert"].includes(a.statut);
    db.setAbonnement(h.id, {
        stripe_customer_id: a.customer ?? h.stripe_customer_id,
        stripe_subscription_id: a.subscription === undefined ? h.stripe_subscription_id : a.subscription,
        abonnement_statut: a.statut,
        abonnement_periode: a.periode === undefined ? h.abonnement_periode : a.periode,
        formule: a.formule === undefined || a.formule === null ? h.formule : a.formule,
        abonnement_fin: a.fin === undefined ? h.abonnement_fin : a.fin,
        plan: actif ? "famille" : "gratuit",
    });
}
/** Verifies the signature and applies the event. Returns what it did (for logs and tests). */
export async function traiterWebhook(db, rawBody, signature) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret)
        throw new Error("STRIPE_WEBHOOK_SECRET manquant");
    const event = await stripe().webhooks.constructEventAsync(rawBody, signature ?? "", secret);
    const r = appliquerEvenement(db, event);
    // a pack paid after a bank check (3-D Secure): the lines it replaces can now go
    const o = event.data.object;
    if (event.type === "customer.subscription.updated" && o.metadata?.lucien_retirer && !o.pending_update) {
        try {
            await retirerApresPaiement(o.id);
        }
        catch (e) {
            console.error("[stripe] retrait après paiement", e.message);
        }
    }
    return r;
}
export function appliquerEvenement(db, event) {
    const o = event.data.object;
    const parPrix = (o.items?.data ?? []).map((i) => depuisPrix(i.price.id)).find(Boolean) ?? null;
    const periodeDe = () => {
        if (parPrix)
            return parPrix.periode;
        const m = o.metadata?.periode;
        if (m === "mensuel" || m === "annuel")
            return m;
        const iv = o.items?.data[0]?.price.recurring?.interval;
        return iv === "year" ? "annuel" : iv === "month" ? "mensuel" : null;
    };
    // The price actually billed wins over metadata: a change of formule in the Stripe portal keeps the old metadata.
    const formuleDe = () => parPrix?.formule ?? (o.metadata?.formule in FORMULES ? o.metadata.formule : null);
    const finDe = () => {
        const t = o.current_period_end ?? o.items?.data[0]?.current_period_end;
        return t ? new Date(t * 1000).toISOString().slice(0, 10) : null;
    };
    if (event.type === "checkout.session.completed") {
        const h = (o.client_reference_id && db.getHousehold(o.client_reference_id)) || (o.metadata?.household_id && db.getHousehold(o.metadata.household_id));
        if (!h)
            return "checkout: foyer inconnu";
        appliquerAbonnement(db, h, { customer: o.customer ?? null, subscription: o.subscription ?? null, statut: "active", formule: formuleDe(), periode: periodeDe() });
        marquerDebutAbonnement(db, h.id); // a new contract: the 14-day withdrawal period starts
        try {
            const m = o.metadata?.modules ? JSON.parse(o.metadata.modules) : null;
            if (m)
                db.setModules(h.id, (Array.isArray(m) ? m : modulesDuChoix(m)));
        }
        catch { /* malformed metadata: the subscription event will set them */ }
        return `checkout: ${h.nom} → famille`;
    }
    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created" || event.type === "customer.subscription.deleted") {
        const h = (o.customer && db.householdByStripeCustomer(o.customer)) || (o.metadata?.household_id && db.getHousehold(o.metadata.household_id));
        if (!h)
            return "subscription: foyer inconnu";
        const statut = event.type === "customer.subscription.deleted" ? "canceled" : o.status ?? "active";
        appliquerAbonnement(db, h, { customer: o.customer ?? null, subscription: o.id, statut, formule: formuleDe(), periode: periodeDe(), fin: finDe() });
        // cancelled in the Stripe portal or by Lucien: no renewal at the end of the period
        if (typeof o.cancel_at_period_end === "boolean") {
            ensureSuppressionSchema(db);
            db.raw.prepare("UPDATE households SET abonnement_resilie = ? WHERE id = ?").run(o.cancel_at_period_end ? 1 : 0, h.id);
        }
        const prixAssistant = [process.env.STRIPE_PRICE_ASSISTANT_MENSUEL, process.env.STRIPE_PRICE_ASSISTANT_ANNUEL].filter(Boolean);
        if (prixAssistant.length) {
            const on = statut !== "canceled" && (o.items?.data ?? []).some((i) => prixAssistant.includes(i.price.id));
            db.raw.prepare("UPDATE households SET assistant_option = ? WHERE id = ?").run(on ? 1 : 0, h.id);
        }
        const prixVeille = [process.env.STRIPE_PRICE_VEILLE_MENSUEL, process.env.STRIPE_PRICE_VEILLE_ANNUEL].filter(Boolean);
        if (prixVeille.length) {
            const n = statut === "canceled" ? 0 : (o.items?.data ?? []).filter((i) => prixVeille.includes(i.price.id)).reduce((s2, i) => s2 + (i.quantity ?? 1), 0);
            db.raw.prepare("UPDATE households SET veilles_supp = ? WHERE id = ?").run(n, h.id);
        }
        if (statut === "canceled") {
            ensureConservesSchema(db);
            db.raw.prepare("DELETE FROM modules_conserves WHERE household_id = ?").run(h.id);
            db.setModules(h.id, []);
        }
        else if (o.items?.data?.length && tousLesPrix().some((x) => process.env[x.env])) { // only once module prices exist
            const lus = noterChoix(db, h.id, o.items.data);
            fixerModules(db, h.id, lus.modules); // plus modules removed but paid until the end of the period
        }
        return `subscription ${statut}: ${h.nom} → ${db.getHousehold(h.id).plan}`;
    }
    if (event.type === "invoice.payment_failed") {
        const h = o.customer ? db.householdByStripeCustomer(o.customer) : undefined;
        if (h)
            appliquerAbonnement(db, h, { statut: "past_due" });
        return "invoice.payment_failed";
    }
    return `ignoré: ${event.type}`;
}
function modulesDuChoix(m) {
    return normaliser([...(PACKS.find((p) => p.id === m.pack)?.modules ?? []), ...(m.modules ?? [])]);
}
export function resumeAbonnement(h) {
    return {
        stripe: stripeOn(),
        paiement: paiementDisponible(),
        statut: h.abonnement_statut,
        formule: h.formule ?? (h.plan === "famille" ? "duo" : null),
        periode: h.abonnement_periode,
        fin: h.abonnement_fin,
        prix: PRIX,
        formules: FORMULES,
        gerable: Boolean(h.stripe_customer_id) && stripeOn(),
    };
}
