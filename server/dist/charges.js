import { dateFinCourante } from "./deadlines.js";
const FACTOR = { mensuel: 1, trimestriel: 1 / 3, annuel: 1 / 12 };
/** Builds the household's recurring charges and savings alerts from its documents. */
export function chargesReport(docs, today = new Date().toISOString().slice(0, 10), famille = []) {
    // When the family's canteen costs are known per child, a canteen invoice would count them twice.
    const cantineParMembre = famille.some((l) => l.category === "education");
    // Several documents can describe the same contract (successive invoices, a new payment schedule):
    // keep the most recent one per contract number so the total counts each contract once.
    const latestByContract = new Map();
    for (const d of docs) {
        if (!d.montant || !d.periodicite || d.periodicite === "unique")
            continue;
        const key = d.numero_contrat ? `${d.category}|${d.numero_contrat.toLowerCase()}` : d.id;
        const prev = latestByContract.get(key);
        if (!prev || (d.date_document ?? "") > (prev.date_document ?? ""))
            latestByContract.set(key, d);
    }
    const charges = [];
    for (const d of latestByContract.values()) {
        if (!d.montant || !d.periodicite || d.periodicite === "unique")
            continue;
        if (d.date_fin && d.date_fin < today && !isRolling(d.category))
            continue;
        if (cantineParMembre && d.category === "education" && /cantine|demi-pension|restauration scolaire/i.test(d.title))
            continue;
        const mensuel = d.montant * FACTOR[d.periodicite];
        charges.push({
            document_id: d.id,
            source: "contrat",
            titre: d.title,
            category: d.category,
            organisme: d.organisme,
            montant_periode: d.montant,
            periodicite: d.periodicite,
            montant_mensuel: round2(mensuel),
            montant_annuel: round2(mensuel * 12),
            date_fin: dateFinCourante(d, today),
        });
    }
    for (const l of famille) {
        if (!(l.mensuel > 0))
            continue;
        charges.push({
            document_id: null,
            source: "famille",
            titre: l.titre,
            category: l.category,
            organisme: null,
            montant_periode: round2(l.mensuel),
            periodicite: "mensuel",
            montant_mensuel: round2(l.mensuel),
            montant_annuel: round2(l.mensuel * 12),
            date_fin: null,
        });
    }
    charges.sort((a, b) => b.montant_mensuel - a.montant_mensuel);
    const total_mensuel = round2(charges.reduce((s, c) => s + c.montant_mensuel, 0));
    const byCat = new Map();
    for (const c of charges)
        byCat.set(c.category, (byCat.get(c.category) ?? 0) + c.montant_mensuel);
    const par_categorie = [...byCat.entries()]
        .map(([category, mensuel]) => ({ category, mensuel: round2(mensuel), part: total_mensuel ? round2(mensuel / total_mensuel) : 0 }))
        .sort((a, b) => b.mensuel - a.mensuel);
    return {
        total_mensuel,
        total_annuel: round2(total_mensuel * 12),
        par_categorie,
        charges,
        alertes: buildAlerts(docs, charges, total_mensuel, today),
    };
}
function buildAlerts(docs, charges, total, today) {
    const alerts = [];
    const byId = new Map(docs.map((d) => [d.id, d]));
    // 1. Duplicates: same category + same organisme, or several streaming/fitness subscriptions.
    const groups = new Map();
    for (const c of charges) {
        const key = `${c.category}|${(c.organisme ?? c.titre).toLowerCase()}`;
        groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    for (const [, g] of groups) {
        if (g.length > 1) {
            const cheapest = Math.min(...g.map((c) => c.montant_mensuel));
            alerts.push({
                type: "doublon",
                gravite: "important",
                titre: `${g.length} contrats chez ${g[0].organisme ?? g[0].titre}`,
                detail: `Vérifier qu'il ne s'agit pas d'un doublon : ${g.map((c) => `${c.titre} (${c.montant_mensuel} €/mois)`).join(", ")}.`,
                economie_estimee: round2((g.reduce((s, c) => s + c.montant_mensuel, 0) - cheapest) * 12),
                document_ids: ids(g),
            });
        }
    }
    const streaming = charges.filter((c) => c.category === "abonnement");
    if (streaming.length >= 3) {
        const smallest = streaming.reduce((a, b) => (a.montant_mensuel < b.montant_mensuel ? a : b));
        alerts.push({
            type: "doublon",
            gravite: "attention",
            titre: `${streaming.length} abonnements en cours`,
            detail: `${streaming.map((c) => c.titre).join(", ")}. Garder ceux réellement utilisés ce mois-ci.`,
            economie_estimee: round2(smallest.montant_mensuel * 12),
            document_ids: ids(streaming),
        });
    }
    // 2. Increases: same organisme + same category, two documents with different amounts over time.
    const byContract = new Map();
    for (const d of docs) {
        if (!d.montant || !d.periodicite || d.periodicite === "unique")
            continue;
        const key = `${d.category}|${(d.numero_contrat ?? d.organisme ?? d.title).toLowerCase()}`;
        byContract.set(key, [...(byContract.get(key) ?? []), d]);
    }
    for (const [, g] of byContract) {
        if (g.length < 2)
            continue;
        const sorted = [...g].filter((d) => d.date_document).sort((a, b) => a.date_document.localeCompare(b.date_document));
        if (sorted.length < 2)
            continue;
        const prev = sorted[sorted.length - 2], last = sorted[sorted.length - 1];
        if (prev.montant > 0 && last.montant > prev.montant * 1.05) {
            const pct = Math.round(((last.montant - prev.montant) / prev.montant) * 100);
            alerts.push({
                type: "hausse",
                gravite: pct >= 15 ? "important" : "attention",
                titre: `+${pct} % sur ${last.title}`,
                detail: `${prev.montant} € → ${last.montant} € (${last.periodicite}). Une hausse de tarif ouvre souvent un droit de résiliation sans frais.`,
                economie_estimee: round2((last.montant - prev.montant) * FACTOR[last.periodicite] * 12),
                document_ids: [prev.id, last.id],
            });
        }
    }
    // 3. Commitment over or ending soon: the household can switch or negotiate without cancellation fees.
    //    One alert per contract, and it replaces the generic "not renegotiated" one below.
    const libres = new Set();
    for (const c of charges) {
        const d = c.document_id ? byId.get(c.document_id) : undefined;
        if (!d || !["telecom", "energie", "abonnement", "assurance"].includes(c.category))
            continue;
        const engagement = engagementDe(d, today);
        if (!engagement)
            continue;
        libres.add(c.document_id);
        const taux = c.category === "telecom" ? 0.2 : 0.1;
        alerts.push(engagement.fin === null || engagement.fin < today
            ? {
                type: "fin_engagement",
                gravite: "attention",
                titre: `${c.titre} : plus d'engagement`,
                detail: `Vous pouvez ${CHANGER[c.category] ?? "résilier"} ou demander une baisse sans frais de résiliation.${c.category === "telecom" ? " Les offres d'entrée box + mobile sont souvent 20 à 30 % moins chères." : ""}`,
                economie_estimee: round2(c.montant_annuel * taux),
                document_ids: ids([c]),
            }
            : {
                type: "fin_engagement",
                gravite: "info",
                titre: `${c.titre} : fin d'engagement le ${frDate(engagement.fin)}`,
                detail: "Ensuite, le contrat se résilie ou se renégocie sans frais. Bon moment pour comparer.",
                economie_estimee: round2(c.montant_annuel * taux),
                document_ids: ids([c]),
            });
    }
    // 4. Insurance held more than a year (car, home, complementary health): cancellable at any time
    //    (loi Hamon, résiliation infra-annuelle), even when the yearly notice window has been missed.
    const resiliables = new Set();
    for (const c of charges) {
        const d = c.document_id ? byId.get(c.document_id) : undefined;
        if (!d || c.category !== "assurance" || libres.has(d.id) || !hamon(d.title))
            continue;
        const start = d.date_debut ?? d.date_document;
        if (!start)
            continue;
        const years = (Date.parse(today) - Date.parse(start)) / (365.25 * 864e5);
        if (years < 1 || years >= 2)
            continue; // from 2 years on, the "not renegotiated" alert says it
        resiliables.add(d.id);
        alerts.push({
            type: "resiliable",
            gravite: "info",
            titre: `${c.titre} : résiliable à tout moment`,
            detail: "Après un an de contrat, la loi permet de changer d'assureur quand vous voulez, sans attendre l'échéance. Un devis moins cher suffit : le nouvel assureur s'occupe de la résiliation.",
            economie_estimee: round2(c.montant_annuel * 0.1),
            document_ids: ids([c]),
        });
    }
    // 5. Not renegotiated: insurance / energy / telecom contracts older than 2 years.
    for (const c of charges) {
        const d = c.document_id ? byId.get(c.document_id) : undefined;
        if (!d || libres.has(d.id) || resiliables.has(d.id))
            continue;
        const start = d.date_debut ?? d.date_document;
        if (!start)
            continue;
        const years = (Date.parse(today) - Date.parse(start)) / (365.25 * 864e5);
        if (years >= 2 && ["assurance", "energie", "telecom"].includes(c.category)) {
            alerts.push({
                type: "non_renegocie",
                gravite: "info",
                titre: `${c.titre} : ${Math.floor(years)} ans sans renégociation`,
                detail: `Les tarifs d'entrée des concurrents sont souvent 10 à 20 % plus bas. Demander un devis comparatif.${c.category === "assurance" && hamon(d.title) ? " Résiliable à tout moment : le nouvel assureur s'occupe de la résiliation." : ""}`,
                economie_estimee: round2(c.montant_annuel * 0.1),
                document_ids: ids([c]),
            });
        }
    }
    // 6. Weight: one charge above 35 % of the total.
    for (const c of charges) {
        if (total > 0 && c.montant_mensuel / total > 0.35 && charges.length >= 3) {
            alerts.push({
                type: "poids",
                gravite: "info",
                titre: `${c.titre} pèse ${Math.round((c.montant_mensuel / total) * 100)} % des charges fixes`,
                detail: "C'est le poste où un effort de négociation rapporte le plus.",
                economie_estimee: null,
                document_ids: ids([c]),
            });
        }
    }
    const order = { important: 0, attention: 1, info: 2 };
    return alerts.sort((a, b) => order[a.gravite] - order[b.gravite] || (b.economie_estimee ?? 0) - (a.economie_estimee ?? 0));
}
const CHANGER = { telecom: "changer d'opérateur", energie: "changer de fournisseur", assurance: "changer d'assureur", abonnement: "résilier" };
/** Car, home and complementary-health insurance: cancellable at any time after one year (loi Hamon, RIA). */
function hamon(title) {
    return /auto|moto|v[ée]hicule|habitation|maison|appartement|logement|mutuelle|sant[ée]|compl[ée]mentaire/i.test(title);
}
/**
 * The contract's minimum commitment, when the document mentions one.
 * `fin: null` = said to be over without a date. Returns null when there is none, or when it ends more than 45 days away.
 */
export function engagementDe(d, today) {
    const txt = `${d.title} ${d.resume ?? ""}`;
    if (/sans engagement/i.test(txt))
        return null;
    if (/engagement\s+(termin|échu|echu|fini|expir|écoulé|ecoule)|fin d'engagement (atteinte|passée|passee)/i.test(txt))
        return { fin: null };
    if (!/engag/i.test(txt) || !d.date_fin)
        return null;
    const jours = (Date.parse(d.date_fin) - Date.parse(today)) / 864e5;
    return jours <= 45 ? { fin: d.date_fin } : null;
}
function frDate(iso) {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
}
function ids(charges) {
    return charges.map((c) => c.document_id).filter((x) => Boolean(x));
}
/** Family lines (canteen and paid activities per member) for the charges report. */
export function lignesFamille(couts) {
    const out = [];
    for (const m of couts) {
        if (m.cantine > 0)
            out.push({ titre: `Cantine — ${m.prenom}`, category: "education", mensuel: m.cantine });
        for (const l of m.lignes)
            out.push({ titre: `${l.titre} — ${m.prenom}`, category: "activites", mensuel: l.mensuel });
    }
    return out;
}
function isRolling(category) {
    return ["assurance", "energie", "telecom", "abonnement", "logement", "banque"].includes(category);
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
