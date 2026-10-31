import { ensureSuppressionSchema, executerSuppressionsPrevues } from "./suppression.js";
import { entretienVeilles } from "./veille.js";
import { budgetReport } from "./budget.js";
import { envoyerPush } from "./push.js";
import { envoyerEmail } from "./mail.js";
import { echeancesFamille, coutsParMembre } from "./famille.js";
import { chargesReport, lignesFamille } from "./charges.js";
import { creneauDimanche, emailSemaine, pointDuFoyer } from "./hebdo.js";
const euro = (n) => `${Math.round(n).toLocaleString("fr-FR")} €`;
/**
 * Reverse-trial reminders for one household, computed from today's state:
 *  - two days before the end (day 13 of 15), - on the last day, - once, after the account is back on free.
 * Pure function: the daily job decides what to send, `rappels_envoyes` guarantees each one goes out once.
 */
export function rappelsEssai(db, h, now = new Date()) {
    if (h.plan === "famille" || !h.essai_fin)
        return [];
    const joursRestants = Math.ceil((new Date(h.essai_fin).getTime() - now.getTime()) / 864e5);
    const budget = budgetReport(db.listTransactions(h.id), db.listDocuments(h.id), db.listDecisions(h.id));
    const eco = budget.economies_possibles;
    const perdu = [eco > 0 ? `${euro(eco)} par an d'économies repérées` : null, "la lecture des papiers par l'IA", budget.nb_transactions ? "le suivi des dépenses" : null].filter(Boolean).join(", ");
    const out = [];
    if (joursRestants === 2)
        out.push({ cle: "essai:j2", titre: "Votre formule complète offerte se termine dans 2 jours", corps: `Après, votre compte passe en gratuit et met en pause ${perdu}. Vos papiers et vos rappels restent.`, route: "#/settings" });
    if (joursRestants === 1)
        out.push({ cle: "essai:dernier", titre: "Dernier jour de votre formule complète offerte", corps: eco > 0 ? `${euro(eco)} par an d'économies sont prêtes à être décidées. Gardez la formule complète pour 9,90 € par mois.` : "Gardez la lecture IA, la banque et les économies pour 9,90 € par mois ou 99 € par an.", route: "#/settings" });
    if (joursRestants <= 0 && joursRestants > -3)
        out.push({ cle: "essai:termine", titre: eco > 0 ? `${euro(eco)} par an d'économies vous attendent` : "Votre essai est terminé, vos papiers restent", corps: `Compte passé en gratuit : en pause, ${perdu}. La formule complète reprend là où vous en étiez.`, route: "#/settings" });
    return out;
}
/**
 * Deadline reminders due today: stored deadlines (from documents) and computed family ones, each once,
 * when today is within `rappel_jours` of the date (first day of the window), plus the day itself.
 */
export function rappelsEcheances(db, h, now = new Date()) {
    const today = now.toISOString().slice(0, 10);
    const out = [];
    const faits = db.familleFaits(h.id);
    const fam = echeancesFamille(h, db.listMembers(h.id), db.listActivites(h.id), now).filter((e) => !faits.has(e.cle)).map((e) => ({ id: `f:${e.cle}`, titre: e.titre, date: e.date, rappel_jours: e.rappel_jours, note: e.note, document_id: null }));
    const all = [...db.listDeadlines(h.id).map((d) => ({ id: d.id, titre: d.titre, date: d.date, rappel_jours: d.rappel_jours, note: d.note, document_id: d.document_id })), ...fam];
    for (const d of all) {
        const jours = Math.round((new Date(d.date).getTime() - new Date(today).getTime()) / 864e5);
        if (jours < 0 || jours > d.rappel_jours)
            continue;
        const first = jours === d.rappel_jours || jours === 0;
        if (!first)
            continue;
        const quand = jours === 0 ? "Aujourd'hui" : jours === 1 ? "Demain" : `Dans ${jours} jours`;
        out.push({ cle: `echeance:${d.id}:${d.date}:${jours === 0 ? "j" : "avant"}`, titre: `${quand} : ${d.titre.replace(/^[^:]+:\s*/, "")}`, corps: d.note ?? "Ouvrez Lucien pour voir le détail.", route: d.document_id ? `#/doc/${d.document_id}` : "#/deadlines" });
    }
    return out;
}
/**
 * Savings alerts on the household's contracts (price increase, duplicate, commitment over…), pushed once each.
 * Only "important" and "attention" ones: "info" alerts stay on the Budget screen. One per pass, so a new account
 * is not flooded on its first day. The free plan sees only the first alert in the app, so only that one is pushed.
 * A new increase on the same contract comes from a new document, hence a new key and a new push.
 */
export function rappelsAlertes(db, h) {
    const lignes = lignesFamille(coutsParMembre(db.listMembers(h.id), db.listActivites(h.id)));
    let alertes = chargesReport(db.listDocuments(h.id), undefined, lignes).alertes;
    if (db.effectivePlan(h) !== "famille")
        alertes = alertes.slice(0, 1);
    const deja = new Set(db.listRappels(h.id).map((r) => r.cle));
    for (const a of alertes) {
        if (a.gravite === "info")
            continue;
        const cle = `alerte:${a.type}:${[...a.document_ids].sort().join(",")}`;
        if (deja.has(cle))
            continue;
        const gain = a.economie_estimee ? ` Jusqu'à ${euro(a.economie_estimee)} par an.` : "";
        return [{ cle, titre: a.titre, corps: `${a.detail}${gain}`, route: a.document_ids.length === 1 ? `#/doc/${a.document_ids[0]}` : "#/budget" }];
    }
    return [];
}
/**
 * Annual subscriptions renew tacitly: the law (Code de la consommation, art. L215-1) requires telling the customer,
 * between three months and one month before the end, that he may refuse the renewal. Sent once per period,
 * 45 to 30 days before the date; nothing when the renewal is already stopped.
 */
export function rappelsRenouvellement(db, h, now = new Date()) {
    ensureSuppressionSchema(db);
    const r = db.raw.prepare("SELECT abonnement_periode, abonnement_statut, abonnement_fin, abonnement_resilie, suppression_le FROM households WHERE id = ?").get(h.id);
    if (!r || r.abonnement_periode !== "annuel" || !r.abonnement_fin || r.abonnement_resilie || r.suppression_le)
        return [];
    if (!["active", "trialing", "past_due"].includes(r.abonnement_statut ?? ""))
        return [];
    const jours = Math.round((Date.parse(r.abonnement_fin) - Date.parse(now.toISOString().slice(0, 10))) / 86400_000);
    if (jours > 45 || jours < 30)
        return [];
    const date = r.abonnement_fin.split("-").reverse().join("/");
    return [{ cle: `renouvellement:${r.abonnement_fin}`, titre: `Votre abonnement annuel Lucien se renouvelle le ${date}`,
            corps: `Votre abonnement annuel se renouvellera automatiquement le ${date}, pour un an, au tarif de votre formule. Si vous ne souhaitez pas le renouveler, vous pouvez le résilier d'ici là en un geste, dans Réglages, Votre formule, « Résilier l'abonnement » : il restera actif jusqu'au ${date}, sans autre prélèvement.`,
            route: "#/settings" }];
}
/** Default transport: push to every device of the household; email too for Famille households (free = push only). */
export async function transportParDefaut(db, h, r) {
    const n = await envoyerPush(db, h.id, { titre: r.titre, corps: r.corps, url: `/${r.route}`, tag: r.cle.split(":")[0] });
    if (db.effectivePlan(h) === "famille") {
        const base = (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
        for (const u of db.usersOfHousehold(h.id)) {
            if (r.semaine) {
                await envoyerEmail({ to: u.email, ...emailSemaine(r.semaine, u.prenom, base) });
                continue;
            }
            await envoyerEmail({ to: u.email, subject: r.titre, text: `${r.corps}\n\nOuvrir Lucien : ${base}/${r.route}` });
        }
    }
    if (!n)
        console.log(`[rappel] ${h.nom} · ${r.cle} · ${r.titre}`);
}
/** Daily pass over every household: trial reminders, deadline reminders and savings alerts, each sent once. */
export async function passeQuotidienne(db, envoyer = (h, r) => transportParDefaut(db, h, r)) {
    let n = 0;
    for (const h of db.listHouseholds()) {
        for (const r of [...rappelsEssai(db, h), ...rappelsEcheances(db, h), ...rappelsAlertes(db, h), ...rappelsRenouvellement(db, h)]) {
            if (db.marquerRappel(h.id, r.cle)) {
                await envoyer(h, r);
                n++;
            }
        }
    }
    return n;
}
/**
 * « La semaine de Lucien » for one household, if it is due: Sunday from 17:00 (Paris), once per ISO week,
 * unless switched off in the settings or there is truly nothing to say.
 */
export function rappelHebdo(db, h, now = new Date()) {
    if (h.hebdo === 0 || !creneauDimanche(now))
        return [];
    const p = pointDuFoyer(db, h, now);
    if (p.vide)
        return [];
    return [{ cle: `hebdo:${p.cle}`, titre: p.notification.titre, corps: p.notification.corps, route: "#/semaine", semaine: p }];
}
/** Weekly pass (runs with the daily one): the Sunday point, once per household and per week. */
export async function passeHebdo(db, envoyer = (h, r) => transportParDefaut(db, h, r), now = new Date()) {
    let n = 0;
    for (const h of db.listHouseholds()) {
        for (const r of rappelHebdo(db, h, now))
            if (db.marquerRappel(h.id, r.cle)) {
                await envoyer(h, r);
                n++;
            }
    }
    return n;
}
export function demarrerRappels(db, opts = {}) {
    const tick = () => {
        try {
            entretienVeilles(db);
        }
        catch (e) {
            console.error("[veille]", e);
        }
        const suppressions = opts.uploadDir ? executerSuppressionsPrevues(db, opts.uploadDir).catch((e) => console.error("[suppression prévue]", e)) : Promise.resolve();
        return suppressions.then(() => passeQuotidienne(db)).then(() => passeHebdo(db)).catch((e) => console.error("[rappel]", e));
    };
    setTimeout(tick, 5_000);
    const t = setInterval(tick, 3 * 3600_000); // every 3 h (the Sunday point goes out between 17:00 and 20:00); idempotent thanks to rappels_envoyes
    t.unref?.();
}
