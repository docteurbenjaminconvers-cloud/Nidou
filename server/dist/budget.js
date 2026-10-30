import { TX_LABEL } from "./transactions.js";
const round2 = (n) => Math.round(n * 100) / 100;
const ym = (iso) => iso.slice(0, 7);
const daysBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
function monthsSpan(txs) {
    const set = new Set(txs.map((t) => ym(t.date)));
    return [...set].sort();
}
/** Finds recurring charges: same merchant, similar amount, regular spacing. */
export function findRecurrences(txs) {
    const byMerchant = new Map();
    for (const t of txs) {
        if (t.montant >= 0)
            continue;
        if (["especes", "virements", "epargne", "alimentation", "restaurants", "carburant"].includes(t.categorie))
            continue;
        byMerchant.set(t.marchand, [...(byMerchant.get(t.marchand) ?? []), t]);
    }
    const out = [];
    for (const [marchand, list] of byMerchant) {
        if (list.length < 2)
            continue;
        const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
        const amounts = sorted.map((t) => -t.montant);
        const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        const spread = Math.max(...amounts) / Math.min(...amounts);
        if (spread > 2.5)
            continue; // too variable to be a subscription
        const gaps = sorted.slice(1).map((t, i) => daysBetween(t.date, sorted[i].date));
        const gap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        let frequence = "irregulier";
        if (gap >= 25 && gap <= 36)
            frequence = "mensuel";
        else if (gap >= 5 && gap <= 9)
            frequence = "hebdomadaire";
        else if (gap >= 350 && gap <= 380)
            frequence = "annuel";
        if (frequence === "irregulier" && !(gaps.every((g) => g >= 25 && g <= 40)))
            continue;
        if (frequence === "irregulier")
            frequence = "mensuel";
        const monthly = frequence === "mensuel" ? mean : frequence === "hebdomadaire" ? mean * 52 / 12 : mean / 12;
        const days = sorted.map((t) => Number(t.date.slice(8, 10)));
        out.push({
            cle: marchand, marchand, categorie: sorted[sorted.length - 1].categorie,
            montant_moyen: round2(mean), dernier_montant: round2(amounts[amounts.length - 1]), premier_montant: round2(amounts[0]),
            occurrences: sorted.length, frequence, derniere_date: sorted[sorted.length - 1].date,
            jour_du_mois: frequence === "mensuel" ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null,
            mensuel_equivalent: round2(monthly), contrat_id: null,
        });
    }
    return out.sort((a, b) => b.mensuel_equivalent - a.mensuel_equivalent);
}
function matchContracts(recs, docs) {
    const contracts = docs.filter((d) => d.montant && d.periodicite && d.periodicite !== "unique");
    for (const r of recs) {
        const words = r.marchand.split(" ").filter((w) => w.length > 2);
        const hit = contracts.find((d) => {
            const hay = `${d.organisme ?? ""} ${d.title}`.toLowerCase();
            return words.some((w) => hay.includes(w));
        });
        if (hit)
            r.contrat_id = hit.id;
    }
}
/**
 * Builds the household budget: spend by category, recurring charges, and the ranked list of easy savings.
 * `today` lets tests pin the clock.
 */
export function budgetReport(txs, docs, decisions, today = new Date().toISOString().slice(0, 10)) {
    const months = monthsSpan(txs);
    const current = ym(today);
    const pastMonths = months.filter((m) => m < current);
    const avgBase = pastMonths.length ? pastMonths : months;
    const n = Math.max(1, avgBase.length);
    const spend = (f) => txs.filter((t) => t.montant < 0 && !["virements", "epargne"].includes(t.categorie) && f(t)).reduce((s, t) => s - t.montant, 0);
    const income = txs.filter((t) => t.montant > 0 && t.categorie === "revenus");
    const recs = findRecurrences(txs);
    matchContracts(recs, docs);
    // --- by category
    const cats = [...new Set(txs.filter((t) => t.montant < 0).map((t) => t.categorie))];
    const par_categorie = cats
        .map((c) => {
        const cur = spend((t) => t.categorie === c && ym(t.date) === current);
        const avg = spend((t) => t.categorie === c && avgBase.includes(ym(t.date))) / n;
        return { categorie: c, libelle: TX_LABEL[c] ?? c, mois_courant: round2(cur), moyenne: round2(avg), variation: avg > 20 && cur > 0 ? round2((cur - avg) / avg) : null };
    })
        .filter((c) => c.moyenne > 0 || c.mois_courant > 0)
        .sort((a, b) => b.moyenne - a.moyenne);
    // --- actions
    const actions = [];
    const push = (a) => actions.push({ ...a, decision: decisions[a.cle] ?? null });
    // 1. Ghost subscriptions: recurring, no matching contract, "abonnements" or unknown category.
    for (const r of recs) {
        if (r.categorie === "abonnements" && !r.contrat_id) {
            push({
                cle: `fantome:${r.cle}`, type: "fantome", priorite: 1, effort: "2 min",
                titre: `${cap(r.marchand)} : ${fmt(r.montant_moyen)} chaque ${r.frequence === "mensuel" ? "mois" : r.frequence === "hebdomadaire" ? "semaine" : "année"}`,
                detail: `Prélevé ${r.occurrences} fois, aucun contrat enregistré dans Lucien. Si vous ne l'utilisez plus, résiliez avant le ${r.jour_du_mois ?? "prochain prélèvement"}.`,
                economie_annuelle: round2(r.mensuel_equivalent * 12), marchand: r.marchand, document_id: null,
            });
        }
    }
    // 2. Silent increases on any recurring charge.
    for (const r of recs) {
        if (r.occurrences >= 3 && r.premier_montant > 0 && r.dernier_montant > r.premier_montant * 1.05) {
            const pct = Math.round(((r.dernier_montant - r.premier_montant) / r.premier_montant) * 100);
            push({
                cle: `hausse:${r.cle}`, type: "hausse", priorite: ["assurance", "telecom", "energie"].includes(r.categorie) ? 1 : 2, effort: "15 min",
                titre: `${cap(r.marchand)} a augmenté de ${pct} %`,
                detail: `${fmt(r.premier_montant)} → ${fmt(r.dernier_montant)}. Une hausse de tarif ouvre souvent un droit de résiliation sans frais ; demandez un devis concurrent.`,
                economie_annuelle: round2((r.dernier_montant - r.premier_montant) * (r.frequence === "mensuel" ? 12 : r.frequence === "hebdomadaire" ? 52 : 1)),
                marchand: r.marchand, document_id: r.contrat_id,
            });
        }
    }
    // 3. Recurring charge with no contract in Lucien (insurance, telecom, energy) → add the paper.
    for (const r of recs) {
        if (!r.contrat_id && ["assurance", "telecom", "energie", "logement"].includes(r.categorie)) {
            push({
                cle: `sans_contrat:${r.cle}`, type: "sans_contrat", priorite: 3, effort: "2 min",
                titre: `${cap(r.marchand)} prélève ${fmt(r.mensuel_equivalent)} / mois sans contrat dans Lucien`,
                detail: "Ajoutez le contrat ou la dernière facture : Lucien pourra surveiller l'échéance et comparer le tarif.",
                economie_annuelle: 0, marchand: r.marchand, document_id: null,
            });
        }
    }
    // 4. Contract in Lucien with no matching debit over the last 2 months (cancelled? paid elsewhere?)
    const lastTwo = months.slice(-2);
    for (const d of docs) {
        if (!d.montant || d.periodicite !== "mensuel")
            continue;
        if (recs.some((r) => r.contrat_id === d.id))
            continue;
        const org = (d.organisme ?? "").toLowerCase();
        if (!org)
            continue;
        const seen = txs.some((t) => lastTwo.includes(ym(t.date)) && t.marchand.includes(org.split(" ")[0]));
        if (!seen && months.length >= 2) {
            push({
                cle: `contrat_sans_prelevement:${d.id}`, type: "contrat_sans_prelevement", priorite: 3, effort: "2 min",
                titre: `${d.title} : aucun prélèvement vu depuis 2 mois`,
                detail: "Le contrat est peut-être payé depuis un autre compte, ou déjà résilié. Vérifiez et mettez le document à jour.",
                economie_annuelle: 0, marchand: null, document_id: d.id,
            });
        }
    }
    // 5. Bank fees.
    const fees = txs.filter((t) => t.montant < 0 && t.categorie === "frais_bancaires");
    const feesTotal = fees.reduce((s, t) => s - t.montant, 0);
    if (feesTotal > 0) {
        push({
            cle: "frais:banque", type: "frais", priorite: feesTotal / n * 12 > 60 ? 1 : 2, effort: "15 min",
            titre: `${fmt(feesTotal)} de frais bancaires sur ${months.length} mois`,
            detail: `${fees.length} ligne${fees.length > 1 ? "s" : ""} : ${[...new Set(fees.map((t) => cap(t.marchand)))].slice(0, 3).join(", ")}. Une banque en ligne ou une négociation de l'agence les ramène souvent à zéro.`,
            economie_annuelle: round2((feesTotal / n) * 12), marchand: null, document_id: null,
        });
    }
    // 6. Drift by category: current month vs average, when the month is far enough along.
    const dayOfMonth = Number(today.slice(8, 10));
    for (const c of par_categorie) {
        if (c.variation !== null && c.variation >= 0.25 && c.moyenne >= 100 && dayOfMonth >= 20 && !["impots", "assurance", "logement"].includes(c.categorie)) {
            push({
                cle: `derive:${c.categorie}:${current}`, type: "derive", priorite: 2, effort: "15 min",
                titre: `${c.libelle} : +${Math.round(c.variation * 100)} % ce mois-ci`,
                detail: `${fmt(c.mois_courant)} contre ${fmt(c.moyenne)} en moyenne : ${fmt(c.mois_courant - c.moyenne)} de plus ce mois-ci. Regardez les marchands du mois pour voir d'où vient l'écart.`,
                economie_annuelle: round2(c.mois_courant - c.moyenne), marchand: null, document_id: null,
            });
        }
    }
    // 7. Duplicates: two recurring charges in the same category with the same purpose.
    const subs = recs.filter((r) => r.categorie === "abonnements");
    const streaming = subs.filter((r) => /netflix|disney|prime|canal|ocs|paramount|apple tv|crunchyroll/.test(r.marchand));
    if (streaming.length >= 3) {
        const cheapest = streaming.reduce((a, b) => (a.mensuel_equivalent < b.mensuel_equivalent ? a : b));
        push({
            cle: "doublon:streaming", type: "doublon", priorite: 1, effort: "2 min",
            titre: `${streaming.length} services de streaming en parallèle`,
            detail: `${streaming.map((r) => cap(r.marchand)).join(", ")} : ${fmt(streaming.reduce((s, r) => s + r.mensuel_equivalent, 0))} par mois. Alternez-les plutôt que de les cumuler.`,
            economie_annuelle: round2(cheapest.mensuel_equivalent * 12), marchand: null, document_id: null,
        });
    }
    const gyms = subs.filter((r) => /basic.?fit|keepcool|fitness|neoness|salle|gym|sport/.test(r.marchand));
    if (gyms.length >= 2) {
        const cheapest = gyms.reduce((a, b) => (a.mensuel_equivalent < b.mensuel_equivalent ? a : b));
        push({
            cle: "doublon:sport", type: "doublon", priorite: 1, effort: "2 min",
            titre: `${gyms.length} abonnements de sport en même temps`,
            detail: `${gyms.map((r) => cap(r.marchand)).join(" et ")} : ${fmt(gyms.reduce((s, r) => s + r.mensuel_equivalent, 0))} par mois. Un seul suffit rarement à être utilisé deux fois.`,
            economie_annuelle: round2(cheapest.mensuel_equivalent * 12), marchand: null, document_id: null,
        });
    }
    const order = (a, b) => a.priorite - b.priorite || b.economie_annuelle - a.economie_annuelle;
    actions.sort(order);
    const curSpend = spend((t) => ym(t.date) === current);
    const avgSpend = spend((t) => avgBase.includes(ym(t.date))) / n;
    const avgIncome = income.filter((t) => avgBase.includes(ym(t.date))).reduce((s, t) => s + t.montant, 0) / n;
    return {
        periode: { de: months[0] ?? current, a: months[months.length - 1] ?? current, mois: months.length },
        depenses_mois_courant: round2(curSpend),
        depenses_moyenne_mensuelle: round2(avgSpend),
        revenus_moyenne_mensuelle: round2(avgIncome),
        reste_a_vivre_moyen: round2(avgIncome - avgSpend),
        par_categorie,
        recurrences: recs,
        actions,
        economies_possibles: round2(actions.filter((a) => a.decision !== "garde").reduce((s, a) => s + a.economie_annuelle, 0)),
        economies_decidees: round2(actions.filter((a) => a.decision === "resilie").reduce((s, a) => s + a.economie_annuelle, 0)),
        nb_transactions: txs.length,
    };
}
const fmt = (n) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
