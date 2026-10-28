import Stripe from "stripe";
import type { Db, HouseholdRow } from "./db.js";

/**
 * Famille plan billing with Stripe Checkout + Billing Portal + webhooks.
 * Prices live in Stripe (STRIPE_PRICE_MENSUEL 9,90 € TTC/mois, STRIPE_PRICE_ANNUEL 99 € TTC/an). Without a secret key the
 * module runs in "simulé" mode: checkout activates the plan immediately (prototype and demo).
 */
export const stripeOn = () => Boolean(process.env.STRIPE_SECRET_KEY);
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-08-27.basil" as never });
const publicUrl = () => (process.env.NIDOU_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
export type Periode = "mensuel" | "annuel";
export const PRIX: Record<Periode, number> = { mensuel: 9.9, annuel: 99 };

export async function creerCheckout(db: Db, h: HouseholdRow, periode: Periode, email: string | null): Promise<{ url: string; simule: boolean }> {
  if (!stripeOn()) return { url: `${publicUrl()}/api/abonnement/simule?periode=${periode}&h=${h.id}`, simule: true };
  const price = periode === "annuel" ? process.env.STRIPE_PRICE_ANNUEL : process.env.STRIPE_PRICE_MENSUEL;
  if (!price) throw new Error("STRIPE_PRICE_MENSUEL / STRIPE_PRICE_ANNUEL manquants");
  const s = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    customer: h.stripe_customer_id ?? undefined,
    customer_email: h.stripe_customer_id ? undefined : email ?? undefined,
    client_reference_id: h.id,
    metadata: { household_id: h.id, periode },
    subscription_data: { metadata: { household_id: h.id, periode } },
    allow_promotion_codes: true,
    locale: "fr",
    success_url: `${publicUrl()}/#/settings?paiement=ok`,
    cancel_url: `${publicUrl()}/#/settings?paiement=annule`,
  });
  return { url: s.url!, simule: false };
}

export async function portail(h: HouseholdRow): Promise<string | null> {
  if (!stripeOn() || !h.stripe_customer_id) return null;
  const s = await stripe().billingPortal.sessions.create({ customer: h.stripe_customer_id, return_url: `${publicUrl()}/#/settings`, locale: "fr" });
  return s.url;
}

/** Applies a subscription state to the household. Shared by the webhook and the simulated mode. */
export function appliquerAbonnement(db: Db, h: HouseholdRow, a: { customer?: string | null; subscription?: string | null; statut: string; periode?: Periode | null; fin?: string | null }) {
  const actif = ["active", "trialing", "past_due", "simule"].includes(a.statut);
  db.setAbonnement(h.id, {
    stripe_customer_id: a.customer ?? h.stripe_customer_id,
    stripe_subscription_id: a.subscription === undefined ? h.stripe_subscription_id : a.subscription,
    abonnement_statut: a.statut,
    abonnement_periode: a.periode === undefined ? h.abonnement_periode : a.periode,
    abonnement_fin: a.fin === undefined ? h.abonnement_fin : a.fin,
    plan: actif ? "famille" : "gratuit",
  });
}

/** Verifies the signature and applies the event. Returns what it did (for logs and tests). */
export async function traiterWebhook(db: Db, rawBody: string, signature: string | null): Promise<string> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET manquant");
  const event = await stripe().webhooks.constructEventAsync(rawBody, signature ?? "", secret);
  return appliquerEvenement(db, event as unknown as EvenementMinimal);
}

/** The subset of Stripe events we read; typed loosely so tests can feed plain objects. */
export interface EvenementMinimal {
  type: string;
  data: { object: { id: string; customer?: string | null; subscription?: string | null; status?: string; client_reference_id?: string | null; metadata?: Record<string, string>; current_period_end?: number; cancel_at_period_end?: boolean; items?: { data: { price: { id: string; recurring?: { interval: string } | null }; current_period_end?: number }[] } } };
}

export function appliquerEvenement(db: Db, event: EvenementMinimal): string {
  const o = event.data.object;
  const periodeDe = (): Periode | null => {
    const m = o.metadata?.periode; if (m === "mensuel" || m === "annuel") return m;
    const iv = o.items?.data[0]?.price.recurring?.interval; return iv === "year" ? "annuel" : iv === "month" ? "mensuel" : null;
  };
  const finDe = (): string | null => {
    const t = o.current_period_end ?? o.items?.data[0]?.current_period_end;
    return t ? new Date(t * 1000).toISOString().slice(0, 10) : null;
  };
  if (event.type === "checkout.session.completed") {
    const h = (o.client_reference_id && db.getHousehold(o.client_reference_id)) || (o.metadata?.household_id && db.getHousehold(o.metadata.household_id));
    if (!h) return "checkout: foyer inconnu";
    appliquerAbonnement(db, h, { customer: o.customer ?? null, subscription: o.subscription ?? null, statut: "active", periode: periodeDe() });
    return `checkout: ${h.nom} → famille`;
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created" || event.type === "customer.subscription.deleted") {
    const h = (o.customer && db.householdByStripeCustomer(o.customer)) || (o.metadata?.household_id && db.getHousehold(o.metadata.household_id));
    if (!h) return "subscription: foyer inconnu";
    const statut = event.type === "customer.subscription.deleted" ? "canceled" : o.status ?? "active";
    appliquerAbonnement(db, h, { customer: o.customer ?? null, subscription: o.id, statut, periode: periodeDe(), fin: finDe() });
    return `subscription ${statut}: ${h.nom} → ${db.getHousehold(h.id)!.plan}`;
  }
  if (event.type === "invoice.payment_failed") {
    const h = o.customer ? db.householdByStripeCustomer(o.customer) : undefined;
    if (h) appliquerAbonnement(db, h, { statut: "past_due" });
    return "invoice.payment_failed";
  }
  return `ignoré: ${event.type}`;
}

export function resumeAbonnement(h: HouseholdRow) {
  return {
    stripe: stripeOn(),
    statut: h.abonnement_statut,
    periode: h.abonnement_periode as Periode | null,
    fin: h.abonnement_fin,
    prix: PRIX,
    gerable: Boolean(h.stripe_customer_id) && stripeOn(),
  };
}
