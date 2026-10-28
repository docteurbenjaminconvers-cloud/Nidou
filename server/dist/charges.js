const FACTOR = { mensuel: 1, trimestriel: 1 / 3, annuel: 1 / 12 };
/** Builds the household's recurring charges and savings alerts from its documents. */
export function chargesReport(docs, today = new Date().toISOString().slice(0, 10)) {
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
        const mensuel = d.montant * FACTOR[d.periodicite];
        charges.push({
            document_id: d.id,
            titre: d.title,
            category: d.category,
            organisme: d.organisme,
            montant_periode: d.montant,
            periodicite: d.periodicite,
            montant_mensuel: round2(mensuel),
            montant_annuel: round2(mensuel * 12),
            date_fin: d.date_fin,
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
                document_ids: g.map((c) => c.document_id),
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
            document_ids: streaming.map((c) => c.document_id),
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
    // 3. Not renegotiated: insurance / energy / telecom contracts older than 2 years.
    for (const c of charges) {
        const d = byId.get(c.document_id);
        const start = d.date_debut ?? d.date_document;
        if (!start)
            continue;
        const years = (Date.parse(today) - Date.parse(start)) / (365.25 * 864e5);
        if (years >= 2 && ["assurance", "energie", "telecom"].includes(c.category)) {
            alerts.push({
                type: "non_renegocie",
                gravite: "info",
                titre: `${c.titre} : ${Math.floor(years)} ans sans renégociation`,
                detail: "Les tarifs d'entrée des concurrents sont souvent 10 à 20 % plus bas. Demander un devis comparatif.",
                economie_estimee: round2(c.montant_annuel * 0.1),
                document_ids: [c.document_id],
            });
        }
    }
    // 4. Weight: one charge above 35 % of the total.
    for (const c of charges) {
        if (total > 0 && c.montant_mensuel / total > 0.35 && charges.length >= 3) {
            alerts.push({
                type: "poids",
                gravite: "info",
                titre: `${c.titre} pèse ${Math.round((c.montant_mensuel / total) * 100)} % des charges fixes`,
                detail: "C'est le poste où un effort de négociation rapporte le plus.",
                economie_estimee: null,
                document_ids: [c.document_id],
            });
        }
    }
    const order = { important: 0, attention: 1, info: 2 };
    return alerts.sort((a, b) => order[a.gravite] - order[b.gravite] || (b.economie_estimee ?? 0) - (a.economie_estimee ?? 0));
}
function isRolling(category) {
    return ["assurance", "energie", "telecom", "abonnement", "logement", "banque"].includes(category);
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
