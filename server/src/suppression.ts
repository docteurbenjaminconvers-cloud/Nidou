/**
 * « Supprimer le compte » (RGPD, droit à l'effacement), as approved on 31/10/2026:
 * - the owner deletes the whole household; a plain member only deletes his own account and leaves the household;
 * - the Stripe subscription is cancelled at once and the unused part of the last payment is refunded pro rata;
 *   invoices stay at Stripe (kept 10 years by law);
 * - the bank access is revoked at Enable Banking or Bridge; every row and file of the household is erased;
 * - the other people connected to the household are told by email.
 */
import Stripe from "stripe";
import { unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Db } from "./db.js";
import { BridgeClient, bridgeConfig } from "./bridge.js";
import { EbClient, ebConfig } from "./enablebanking.js";
import { envoyerEmail } from "./mail.js";

/** Refund, in cents, of the unused part of a period: amount paid × days left / days in the period (never negative). */
export function remboursementProrata(payeCentimes: number, debutSec: number, finSec: number, maintenantSec = Math.floor(Date.now() / 1000)): number {
  if (payeCentimes <= 0 || finSec <= debutSec || maintenantSec >= finSec) return 0;
  const reste = (finSec - Math.max(maintenantSec, debutSec)) / (finSec - debutSec);
  return Math.floor(payeCentimes * reste);
}

export interface ResultatResiliation { resilie: boolean; rembourse_centimes: number }

/**
 * Cancels the household's subscription now and refunds the unused part of the last paid invoice.
 * Safe to run twice: an already cancelled subscription is not cancelled again, and the refund carries an
 * idempotency key, so a retry never refunds twice.
 */
export async function resilierEtRembourser(h: { stripe_subscription_id?: string | null }, maintenantSec = Math.floor(Date.now() / 1000), client?: Stripe): Promise<ResultatResiliation> {
  if (!h.stripe_subscription_id || (!client && !process.env.STRIPE_SECRET_KEY)) return { resilie: false, rembourse_centimes: 0 };
  const stripe = client ?? new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-08-27.basil" as never });
  const sub = await stripe.subscriptions.retrieve(h.stripe_subscription_id);
  const item = sub.items.data[0] as unknown as { current_period_start?: number; current_period_end?: number } | undefined;
  const debut = item?.current_period_start ?? (sub as unknown as { current_period_start?: number }).current_period_start ?? 0;
  const fin = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? 0;
  if (sub.status !== "canceled") await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });

  const invoiceId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
  if (!invoiceId) return { resilie: true, rembourse_centimes: 0 };
  const facture = await stripe.invoices.retrieve(invoiceId, { expand: ["payments"] });
  const montant = remboursementProrata(facture.amount_paid ?? 0, debut, fin, maintenantSec);
  if (montant <= 0) return { resilie: true, rembourse_centimes: 0 };
  const paiements = ((facture as unknown as { payments?: { data?: { payment?: { payment_intent?: string | { id: string } | null } }[] } }).payments?.data ?? []);
  const pi = paiements.map((p) => p.payment?.payment_intent).find(Boolean);
  const piId = typeof pi === "string" ? pi : pi?.id;
  if (!piId) throw new Error(`Aucun paiement trouvé sur la facture ${invoiceId} pour le remboursement`);
  await stripe.refunds.create(
    { payment_intent: piId, amount: montant, reason: "requested_by_customer", metadata: { motif: "suppression du compte Lucien", abonnement: sub.id } },
    { idempotencyKey: `lucien-suppression-${sub.id}` },
  );
  return { resilie: true, rembourse_centimes: montant };
}

/** Revokes the bank access at the aggregator; failures are logged, never block the deletion. */
async function couperBanque(db: Db, householdId: string) {
  const link = db.getBankLink(householdId);
  if (!link || link.user_uuid.startsWith("attente:")) return;
  try {
    if (link.fournisseur === "enablebanking") { const cfg = ebConfig(); if (cfg) await new EbClient(cfg).deleteSession(link.user_uuid); }
    else { const cfg = bridgeConfig(); if (cfg) await new BridgeClient(cfg).deleteUser(link.user_uuid); }
  } catch (e) { console.error("[suppression] accès bancaire non révoqué chez l'agrégateur :", (e as Error).message); }
}

const tables = (db: Db) => (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as unknown as { name: string }[]).map((t) => t.name);
const colonnes = (db: Db, t: string) => (db.raw.prepare(`PRAGMA table_info(${t})`).all() as unknown as { name: string }[]).map((c) => c.name);

/** Deletes a user who no longer belongs to any household (account, sessions, pending links). */
function effacerUtilisateurOrphelin(db: Db, userId: string) {
  if ((db.raw.prepare("SELECT COUNT(*) AS n FROM household_users WHERE user_id = ?").get(userId) as { n: number }).n > 0) return false;
  const u = db.raw.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string } | undefined;
  db.raw.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  if (u) db.raw.prepare("DELETE FROM auth_links WHERE email = ? AND household_id IS NULL").run(u.email);
  db.raw.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return true;
}

/** The owner's choice: the whole household, its rows, its files, its bank access and its subscription. */
export async function supprimerFoyer(db: Db, householdId: string, uploadDir: string, par: { prenom: string | null; email: string | null }, stripeClient?: Stripe): Promise<ResultatResiliation & { prevenus: number }> {
  const h = db.getHousehold(householdId);
  if (!h) return { resilie: false, rembourse_centimes: 0, prevenus: 0 };
  // 1. money first: if Stripe fails, nothing is erased and the person can try again
  const res = await resilierEtRembourser(h, undefined, stripeClient);
  // 2. bank access
  await couperBanque(db, householdId);
  // 3. who to tell, and which files to remove, before the rows go
  const autres = db.usersOfHousehold(householdId).filter((u) => u.email !== par.email);
  const membres = db.usersOfHousehold(householdId).map((u) => u.id);
  const fichiers = [
    ...(db.raw.prepare("SELECT fichier AS f FROM documents WHERE household_id = ? AND fichier IS NOT NULL").all(householdId) as { f: string }[]),
    ...(db.raw.prepare("SELECT photo AS f FROM members WHERE household_id = ? AND photo IS NOT NULL").all(householdId) as { f: string }[]),
  ].map((x) => x.f);
  // 4. every row, in one transaction
  db.raw.exec("BEGIN");
  try {
    const ts = tables(db);
    if (ts.includes("veilles")) for (const t of ts) if (t !== "veilles" && colonnes(db, t).includes("veille_id")) db.raw.prepare(`DELETE FROM ${t} WHERE veille_id IN (SELECT id FROM veilles WHERE household_id = ?)`).run(householdId);
    for (const t of ts) if (t !== "households" && colonnes(db, t).includes("household_id")) db.raw.prepare(`DELETE FROM ${t} WHERE household_id = ?`).run(householdId);
    db.raw.prepare("DELETE FROM households WHERE id = ?").run(householdId);
    for (const id of membres) effacerUtilisateurOrphelin(db, id);
    db.raw.exec("COMMIT");
  } catch (e) { db.raw.exec("ROLLBACK"); throw e; }
  // 5. files (after the commit: a row never points to a missing file)
  for (const f of fichiers) await unlink(join(uploadDir, basename(f))).catch(() => {});
  // 6. the others are told
  let prevenus = 0;
  for (const u of autres) {
    const ok = await envoyerEmail({ to: u.email, subject: `Le foyer « ${h.nom} » a été supprimé de Lucien`, text:
      `Bonjour${u.prenom ? ` ${u.prenom}` : ""},\n\n${par.prenom ?? "Le titulaire"} a supprimé le foyer « ${h.nom} » de Lucien. Ses papiers, échéances et données ont été effacés, et votre accès à ce foyer est fermé.\n\nSi vous pensez qu'il s'agit d'une erreur, parlez-en avec ${par.prenom ?? "le titulaire"}. Pour toute question : bonjour@monlucien.fr.` }).catch(() => false);
    if (ok) prevenus++;
  }
  return { ...res, prevenus };
}

/** A member who is not the owner: leaves the household and deletes his own account; the household stays. */
export function quitterFoyer(db: Db, householdId: string, userId: string) {
  db.raw.exec("BEGIN");
  try {
    db.raw.prepare("DELETE FROM household_users WHERE household_id = ? AND user_id = ?").run(householdId, userId);
    db.raw.prepare("DELETE FROM push_subscriptions WHERE household_id = ? AND user_id = ?").run(householdId, userId);
    effacerUtilisateurOrphelin(db, userId);
    db.raw.exec("COMMIT");
  } catch (e) { db.raw.exec("ROLLBACK"); throw e; }
}
