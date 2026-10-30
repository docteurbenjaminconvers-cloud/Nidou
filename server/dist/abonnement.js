import Stripe from "stripe";
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
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
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
export async function creerCheckout(db, h, formule, periode, email) {
    if (!stripeOn())
        return { url: `${publicUrl()}/api/abonnement/simule?formule=${formule}&periode=${periode}&h=${h.id}`, simule: true };
    const price = process.env[priceEnv(formule, periode)];
    if (!price)
        throw new Error(`${priceEnv(formule, periode)} manquant`);
    const s = await stripe().checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        customer: h.stripe_customer_id ?? undefined,
        customer_email: h.stripe_customer_id ? undefined : email ?? undefined,
        client_reference_id: h.id,
        metadata: { household_id: h.id, formule, periode },
        subscription_data: { metadata: { household_id: h.id, formule, periode } },
        allow_promotion_codes: true,
        locale: "fr",
        success_url: `${publicUrl()}/#/settings?paiement=ok`,
        cancel_url: `${publicUrl()}/#/settings?paiement=annule`,
    });
    return { url: s.url, simule: false };
}
/** Extra protected-person watch (« veille d'un proche », 3,90 €/mois ou 39 €/an), added to the existing subscription. */
export async function ajouterVeillePayante(db, h, periode) {
    const actuel = db.raw.prepare("SELECT veilles_supp FROM households WHERE id = ?").get(h.id)?.veilles_supp ?? 0;
    if (!stripeOn()) {
        db.raw.prepare("UPDATE households SET veilles_supp = ? WHERE id = ?").run(actuel + 1, h.id);
        return { simule: true, total: actuel + 1 };
    }
    if (!h.stripe_subscription_id)
        throw new Error("Choisissez d'abord une formule Solo, Duo ou Tribu.");
    const price = process.env[`STRIPE_PRICE_VEILLE_${(h.abonnement_periode ?? periode).toUpperCase()}`];
    if (!price)
        throw new Error("Prix Stripe de la veille manquant (STRIPE_PRICE_VEILLE_MENSUEL / _ANNUEL).");
    const sub = await stripe().subscriptions.retrieve(h.stripe_subscription_id);
    const item = sub.items.data.find((i) => i.price.id === price);
    if (item)
        await stripe().subscriptionItems.update(item.id, { quantity: (item.quantity ?? 0) + 1, proration_behavior: "create_prorations" });
    else
        await stripe().subscriptionItems.create({ subscription: sub.id, price, quantity: 1, proration_behavior: "create_prorations" });
    // the webhook (customer.subscription.updated) sets veilles_supp from the billed quantity
    return { simule: false, total: actuel + 1 };
}
/**
 * « Demander à Lucien » option (2,90 €/mois ou 29 €/an), added to or removed from the existing subscription.
 * Stripe prices: STRIPE_PRICE_ASSISTANT_MENSUEL / _ANNUEL, matched to the subscription's own period.
 */
export async function basculerAssistant(db, h, actif) {
    const set = (v) => db.raw.prepare("UPDATE households SET assistant_option = ? WHERE id = ?").run(v ? 1 : 0, h.id);
    if (!stripeOn()) {
        set(actif);
        return { simule: true, actif };
    }
    if (!h.stripe_subscription_id)
        throw new Error("Choisissez d'abord une formule Solo, Duo ou Tribu.");
    const price = process.env[`STRIPE_PRICE_ASSISTANT_${(h.abonnement_periode ?? "mensuel").toUpperCase()}`];
    if (!price)
        throw new Error("Prix Stripe de l'assistant manquant (STRIPE_PRICE_ASSISTANT_MENSUEL / _ANNUEL).");
    const sub = await stripe().subscriptions.retrieve(h.stripe_subscription_id);
    const item = sub.items.data.find((i) => i.price.id === price);
    if (actif && !item)
        await stripe().subscriptionItems.create({ subscription: sub.id, price, quantity: 1, proration_behavior: "create_prorations" });
    if (!actif && item)
        await stripe().subscriptionItems.del(item.id, { proration_behavior: "create_prorations" });
    set(actif); // the webhook confirms it from the billed items
    return { simule: false, actif };
}
export async function portail(h) {
    if (!stripeOn() || !h.stripe_customer_id)
        return null;
    const s = await stripe().billingPortal.sessions.create({ customer: h.stripe_customer_id, return_url: `${publicUrl()}/#/settings`, locale: "fr" });
    return s.url;
}
/** Applies a subscription state to the household. Shared by the webhook and the simulated mode. */
export function appliquerAbonnement(db, h, a) {
    const actif = ["active", "trialing", "past_due", "simule"].includes(a.statut);
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
    return appliquerEvenement(db, event);
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
        return `checkout: ${h.nom} → famille`;
    }
    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created" || event.type === "customer.subscription.deleted") {
        const h = (o.customer && db.householdByStripeCustomer(o.customer)) || (o.metadata?.household_id && db.getHousehold(o.metadata.household_id));
        if (!h)
            return "subscription: foyer inconnu";
        const statut = event.type === "customer.subscription.deleted" ? "canceled" : o.status ?? "active";
        appliquerAbonnement(db, h, { customer: o.customer ?? null, subscription: o.id, statut, formule: formuleDe(), periode: periodeDe(), fin: finDe() });
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
export function resumeAbonnement(h) {
    return {
        stripe: stripeOn(),
        statut: h.abonnement_statut,
        formule: h.formule ?? (h.plan === "famille" ? "duo" : null),
        periode: h.abonnement_periode,
        fin: h.abonnement_fin,
        prix: PRIX,
        formules: FORMULES,
        gerable: Boolean(h.stripe_customer_id) && stripeOn(),
    };
}
