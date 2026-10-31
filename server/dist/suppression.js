/**
 * Ending a subscription and deleting an account, as decided on 31/10/2026 (« comme pour les assurances ») :
 * - no refund: a subscription stops at the end of the period already paid (the current month, or the current year);
 * - « Résilier l'abonnement » stops the renewal; the account and the papers stay readable afterwards;
 * - « Supprimer le compte » by the owner stops the renewal too, and the household is erased on that date
 *   (everything stays available until then, and the deletion can be cancelled); he may also ask to erase at once,
 *   losing the rest of the paid period; without a running paid subscription the erasure is immediate;
 * - a plain member only deletes his own account and leaves the household;
 * - the bank access is revoked at Enable Banking or Bridge; invoices stay at Stripe (kept 10 years by law);
 * - the other people connected to the household are told by email.
 */
import Stripe from "stripe";
import { unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { BridgeClient, bridgeConfig } from "./bridge.js";
import { EbClient, ebConfig } from "./enablebanking.js";
import { envoyerEmail } from "./mail.js";
export function ensureSuppressionSchema(db) {
    const cols = db.raw.prepare("PRAGMA table_info(households)").all().map((c) => c.name);
    if (!cols.includes("suppression_le"))
        db.raw.exec("ALTER TABLE households ADD COLUMN suppression_le TEXT");
    if (!cols.includes("suppression_par"))
        db.raw.exec("ALTER TABLE households ADD COLUMN suppression_par TEXT");
    if (!cols.includes("abonnement_resilie"))
        db.raw.exec("ALTER TABLE households ADD COLUMN abonnement_resilie INTEGER NOT NULL DEFAULT 0");
}
export const etatFin = (db, householdId) => {
    const r = db.raw.prepare("SELECT abonnement_resilie, suppression_le FROM households WHERE id = ?").get(householdId);
    return { abonnement_resilie: !!r?.abonnement_resilie, suppression_le: r?.suppression_le ?? null };
};
const stripeDe = (client) => client ?? (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" }) : null);
const jour = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const finDePeriode = (sub) => {
    const item = sub.items?.data?.[0];
    return item?.current_period_end ?? sub.current_period_end ?? 0;
};
const dateFr = (iso) => iso.split("-").reverse().join("/");
/**
 * Stops the renewal: the subscription runs to the end of the period already paid, then ends. No refund.
 * Returns that date (YYYY-MM-DD), or null when no paid subscription is running.
 */
export async function arreterALEcheance(db, householdId, client) {
    const h = db.getHousehold(householdId);
    const stripe = stripeDe(client);
    let fin = null;
    if (h?.stripe_subscription_id && stripe) {
        const sub = await stripe.subscriptions.retrieve(h.stripe_subscription_id);
        if (sub.status === "canceled")
            return null;
        const maj = sub.cancel_at_period_end ? sub : await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
        fin = jour(finDePeriode(maj));
    }
    else if (h?.abonnement_statut === "simule")
        fin = h.abonnement_fin; // test instance without Stripe
    if (fin || h?.abonnement_statut === "simule")
        db.raw.prepare("UPDATE households SET abonnement_resilie = 1, abonnement_fin = COALESCE(?, abonnement_fin) WHERE id = ?").run(fin, householdId);
    return fin;
}
/** Changes his mind before the end date: the subscription renews again as usual. */
export async function reprendreAbonnement(db, householdId, client) {
    const h = db.getHousehold(householdId);
    const stripe = stripeDe(client);
    if (h?.stripe_subscription_id && stripe) {
        const sub = await stripe.subscriptions.retrieve(h.stripe_subscription_id);
        if (sub.status !== "canceled" && sub.cancel_at_period_end)
            await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
    }
    db.raw.prepare("UPDATE households SET abonnement_resilie = 0 WHERE id = ?").run(householdId);
}
/** Immediate end, only when the owner asks to erase at once: no more payment, no refund. */
async function arreterMaintenant(db, householdId, client) {
    const h = db.getHousehold(householdId);
    const stripe = stripeDe(client);
    if (!h?.stripe_subscription_id || !stripe)
        return;
    const sub = await stripe.subscriptions.retrieve(h.stripe_subscription_id);
    if (sub.status !== "canceled")
        await stripe.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
}
/** Revokes the bank access at the aggregator; failures are logged, never block the deletion. */
async function couperBanque(db, householdId) {
    const link = db.getBankLink(householdId);
    if (!link || link.user_uuid.startsWith("attente:"))
        return;
    try {
        if (link.fournisseur === "enablebanking") {
            const cfg = ebConfig();
            if (cfg)
                await new EbClient(cfg).deleteSession(link.user_uuid);
        }
        else {
            const cfg = bridgeConfig();
            if (cfg)
                await new BridgeClient(cfg).deleteUser(link.user_uuid);
        }
    }
    catch (e) {
        console.error("[suppression] accès bancaire non révoqué chez l'agrégateur :", e.message);
    }
}
const tables = (db) => db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
const colonnes = (db, t) => db.raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
/** Deletes a user who no longer belongs to any household (account, sessions, pending links). */
function effacerUtilisateurOrphelin(db, userId) {
    if (db.raw.prepare("SELECT COUNT(*) AS n FROM household_users WHERE user_id = ?").get(userId).n > 0)
        return false;
    const u = db.raw.prepare("SELECT email FROM users WHERE id = ?").get(userId);
    db.raw.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    if (u)
        db.raw.prepare("DELETE FROM auth_links WHERE email = ? AND household_id IS NULL").run(u.email);
    db.raw.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return true;
}
const prevenir = async (db, householdId, sauf, sujet, corps) => {
    let n = 0;
    for (const u of db.usersOfHousehold(householdId).filter((x) => x.email !== sauf))
        if (await envoyerEmail({ to: u.email, subject: sujet, text: corps(u.prenom) }).catch(() => false))
            n++;
    return n;
};
/** Erases the whole household now: rows, files, bank access; the subscription is stopped without refund. */
export async function supprimerFoyer(db, householdId, uploadDir, par, client) {
    const h = db.getHousehold(householdId);
    if (!h)
        return { prevenus: 0 };
    // 1. payment first: if Stripe fails, nothing is erased and the person can try again
    await arreterMaintenant(db, householdId, client);
    // 2. bank access
    await couperBanque(db, householdId);
    // 3. who to tell, and which files to remove, before the rows go
    const nom = h.nom;
    const destinataires = db.usersOfHousehold(householdId).filter((u) => u.email !== par.email).map((u) => ({ email: u.email, prenom: u.prenom }));
    const membres = db.usersOfHousehold(householdId).map((u) => u.id);
    const fichiers = [
        ...db.raw.prepare("SELECT fichier AS f FROM documents WHERE household_id = ? AND fichier IS NOT NULL").all(householdId),
        ...db.raw.prepare("SELECT photo AS f FROM members WHERE household_id = ? AND photo IS NOT NULL").all(householdId),
    ].map((x) => x.f);
    // 4. every row, in one transaction
    db.raw.exec("BEGIN");
    try {
        const ts = tables(db);
        if (ts.includes("veilles"))
            for (const t of ts)
                if (t !== "veilles" && colonnes(db, t).includes("veille_id"))
                    db.raw.prepare(`DELETE FROM ${t} WHERE veille_id IN (SELECT id FROM veilles WHERE household_id = ?)`).run(householdId);
        for (const t of ts)
            if (t !== "households" && colonnes(db, t).includes("household_id"))
                db.raw.prepare(`DELETE FROM ${t} WHERE household_id = ?`).run(householdId);
        db.raw.prepare("DELETE FROM households WHERE id = ?").run(householdId);
        for (const id of membres)
            effacerUtilisateurOrphelin(db, id);
        db.raw.exec("COMMIT");
    }
    catch (e) {
        db.raw.exec("ROLLBACK");
        throw e;
    }
    // 5. files (after the commit: a row never points to a missing file)
    for (const f of fichiers)
        await unlink(join(uploadDir, basename(f))).catch(() => { });
    // 6. the others are told
    let prevenus = 0;
    for (const u of destinataires) {
        const ok = await envoyerEmail({ to: u.email, subject: `Le foyer « ${nom} » a été supprimé de Lucien`, text: `Bonjour${u.prenom ? ` ${u.prenom}` : ""},\n\n${par.prenom ?? "Le titulaire"} a supprimé le foyer « ${nom} » de Lucien. Ses papiers, échéances et données ont été effacés, et votre accès à ce foyer est fermé.\n\nPour toute question : bonjour@monlucien.fr.` }).catch(() => false);
        if (ok)
            prevenus++;
    }
    return { prevenus };
}
/**
 * The owner's « Supprimer le compte »: by default the household is erased at the end of the period already paid
 * (nothing renews, everything stays available until then); `immediat` erases now and the rest of the period is lost.
 * Without a running paid subscription (trial, already ended) the erasure is immediate.
 */
export async function demanderSuppression(db, householdId, uploadDir, par, opts = {}) {
    const aujourdhui = opts.aujourdhui ?? new Date().toISOString().slice(0, 10);
    if (!opts.immediat) {
        const fin = await arreterALEcheance(db, householdId, opts.client);
        if (fin && fin > aujourdhui) {
            const h = db.getHousehold(householdId);
            db.raw.prepare("UPDATE households SET suppression_le = ?, suppression_par = ? WHERE id = ?").run(fin, par.prenom ?? par.email ?? "le titulaire", householdId);
            const prevenus = await prevenir(db, householdId, par.email, `Le foyer « ${h.nom} » sera supprimé le ${dateFr(fin)}`, (p) => `Bonjour${p ? ` ${p}` : ""},\n\n${par.prenom ?? "Le titulaire"} a demandé la suppression du foyer « ${h.nom} » sur Lucien. L'abonnement ne sera pas renouvelé et tout sera effacé le ${dateFr(fin)}, à la fin de la période déjà payée.\n\nD'ici là, tout reste accessible : pensez à exporter ce dont vous avez besoin (Réglages, Exporter tout).`);
            return { le: fin, prevenus };
        }
    }
    const r = await supprimerFoyer(db, householdId, uploadDir, par, opts.client);
    return { le: null, prevenus: r.prevenus };
}
/** Cancels a planned deletion: nothing is erased and the subscription renews again. */
export async function annulerSuppression(db, householdId, client) {
    await reprendreAbonnement(db, householdId, client);
    db.raw.prepare("UPDATE households SET suppression_le = NULL, suppression_par = NULL WHERE id = ?").run(householdId);
}
/** Daily job: erases the households whose planned deletion date has come. */
export async function executerSuppressionsPrevues(db, uploadDir, aujourdhui = new Date().toISOString().slice(0, 10), client) {
    ensureSuppressionSchema(db);
    const dus = db.raw.prepare("SELECT id, suppression_par FROM households WHERE suppression_le IS NOT NULL AND suppression_le <= ?").all(aujourdhui);
    let n = 0;
    for (const h of dus) {
        try {
            await supprimerFoyer(db, h.id, uploadDir, { prenom: h.suppression_par, email: null }, client);
            n++;
        }
        catch (e) {
            console.error("[suppression prévue] échec, nouvel essai au prochain passage :", e.message);
        }
    }
    return n;
}
/** A member who is not the owner: leaves the household and deletes his own account; the household stays. */
export function quitterFoyer(db, householdId, userId) {
    db.raw.exec("BEGIN");
    try {
        db.raw.prepare("DELETE FROM household_users WHERE household_id = ? AND user_id = ?").run(householdId, userId);
        db.raw.prepare("DELETE FROM push_subscriptions WHERE household_id = ? AND user_id = ?").run(householdId, userId);
        effacerUtilisateurOrphelin(db, userId);
        db.raw.exec("COMMIT");
    }
    catch (e) {
        db.raw.exec("ROLLBACK");
        throw e;
    }
}
