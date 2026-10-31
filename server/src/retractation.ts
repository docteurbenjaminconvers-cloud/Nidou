/**
 * Droit de rétractation (Code de la consommation, L221-18 et L221-25), as approved on 31/10/2026:
 * - at payment the subscriber asks for an immediate start (checkbox, recorded in the Checkout metadata);
 * - for 14 days after a NEW paid subscription (renewals are not concerned), Réglages offers « Me rétracter »;
 * - the subscription stops at once and Stripe refunds what was paid minus the days already used, once only;
 * - the account goes back to read-only, nothing is erased.
 */
import Stripe from "stripe";
import type { Db } from "./db.js";
import { appliquerAbonnement } from "./abonnement.js";
import { ensureSuppressionSchema } from "./suppression.js";

export const DELAI_RETRACTATION_JOURS = 14;

export function ensureRetractationSchema(db: Db) {
  const cols = (db.raw.prepare("PRAGMA table_info(households)").all() as unknown as { name: string }[]).map((c) => c.name);
  if (!cols.includes("abonnement_debut")) db.raw.exec("ALTER TABLE households ADD COLUMN abonnement_debut TEXT");
  if (!cols.includes("retractation_le")) db.raw.exec("ALTER TABLE households ADD COLUMN retractation_le TEXT");
}

/** Called when a new subscription contract starts (Checkout completed, or simulated payment). */
export function marquerDebutAbonnement(db: Db, householdId: string, quand = new Date()) {
  ensureRetractationSchema(db);
  db.raw.prepare("UPDATE households SET abonnement_debut = ?, retractation_le = NULL WHERE id = ?").run(quand.toISOString(), householdId);
}

/** Refund, in cents, of the unused part of a period: amount paid × time left / period length (never negative). */
export function remboursementProrata(payeCentimes: number, debutSec: number, finSec: number, maintenantSec = Math.floor(Date.now() / 1000)): number {
  if (payeCentimes <= 0 || finSec <= debutSec || maintenantSec >= finSec) return 0;
  const reste = (finSec - Math.max(maintenantSec, debutSec)) / (finSec - debutSec);
  return Math.floor(payeCentimes * reste);
}

export interface EtatRetractation { possible: boolean; jusquau: string | null }

export function etatRetractation(db: Db, householdId: string, maintenant = new Date()): EtatRetractation {
  ensureRetractationSchema(db);
  const h = db.raw.prepare("SELECT abonnement_debut, retractation_le, abonnement_statut FROM households WHERE id = ?").get(householdId) as
    { abonnement_debut: string | null; retractation_le: string | null; abonnement_statut: string | null } | undefined;
  if (!h?.abonnement_debut || h.retractation_le) return { possible: false, jusquau: null };
  if (!["active", "trialing", "past_due", "simule"].includes(h.abonnement_statut ?? "")) return { possible: false, jusquau: null };
  const fin = new Date(Date.parse(h.abonnement_debut) + DELAI_RETRACTATION_JOURS * 86400_000);
  return { possible: maintenant < fin, jusquau: fin.toISOString().slice(0, 10) };
}

const stripeDe = (client?: Stripe) => client ?? (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" as never }) : null);

/**
 * Withdraws: the subscription is cancelled at once, the unused part of the first payment is refunded.
 * Safe to retry: an already cancelled subscription is not cancelled again; the refund carries an idempotency key.
 */
export async function seRetracter(db: Db, householdId: string, opts: { client?: Stripe; maintenant?: Date } = {}): Promise<{ rembourse_centimes: number }> {
  const maintenant = opts.maintenant ?? new Date();
  if (!etatRetractation(db, householdId, maintenant).possible) throw new Error("Le délai de rétractation de 14 jours est passé, ou la rétractation a déjà été faite.");
  ensureSuppressionSchema(db);
  const h = db.getHousehold(householdId)!;
  let rembourse = 0;
  const stripe = stripeDe(opts.client);
  if (h.stripe_subscription_id && stripe) {
    const sub = await stripe.subscriptions.retrieve(h.stripe_subscription_id);
    const item = sub.items?.data?.[0] as unknown as { current_period_start?: number; current_period_end?: number } | undefined;
    const debut = item?.current_period_start ?? 0, fin = item?.current_period_end ?? 0;
    if (sub.status !== "canceled") await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
    const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
    if (invoiceId) {
      const facture = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
      rembourse = remboursementProrata(facture.amount_paid ?? 0, debut, fin, Math.floor(maintenant.getTime() / 1000));
      if (rembourse > 0) {
        const paiements = (facture as unknown as { payments?: { data?: { payment?: { payment_intent?: string | { id: string } | null } }[] } }).payments?.data ?? [];
        const pi = paiements.map((p) => p.payment?.payment_intent).find(Boolean);
        const piId = typeof pi === "string" ? pi : pi?.id;
        if (!piId) throw new Error(`Aucun paiement trouvé sur la facture ${invoiceId}`);
        await stripe.refunds.create(
          { payment_intent: piId, amount: rembourse, reason: "requested_by_customer", metadata: { motif: "rétractation Lucien", abonnement: sub.id } },
          { idempotencyKey: `lucien-retractation-${sub.id}` },
        );
      }
    }
  }
  db.raw.prepare("UPDATE households SET retractation_le = ?, abonnement_resilie = 0 WHERE id = ?").run(maintenant.toISOString(), householdId);
  appliquerAbonnement(db, db.getHousehold(householdId)!, { statut: "canceled" });
  db.setModules(householdId, []);
  return { rembourse_centimes: rembourse };
}
