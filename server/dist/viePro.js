/**
 * Micro-entrepreneur (régime micro-social), 2026: contributions on turnover, optional income-tax prepayment (versement
 * libératoire), training contribution (CFP), ceilings, VAT exemption thresholds. Sources: service-public F37353,
 * A18813, F23257, F21746, F23459; impots.gouv « régimes réservés aux petites entreprises 2026 ». Re-check every January.
 */
export const MICRO = {
    vente: { libelle: "Vente de marchandises", cotisations: 0.123, vl: 0.01, cfp: 0.001, plafond: 203100, tva: 85000, tva_tolerance: 93500 },
    services_bic: { libelle: "Prestations de services commerciales ou artisanales (BIC)", cotisations: 0.212, vl: 0.017, cfp: 0.001, plafond: 83600, tva: 37500, tva_tolerance: 41250 },
    bnc_ssi: { libelle: "Activité libérale (BNC, sécurité sociale des indépendants)", cotisations: 0.256, vl: 0.022, cfp: 0.002, plafond: 83600, tva: 37500, tva_tolerance: 41250 },
    bnc_cipav: { libelle: "Activité libérale réglementée (BNC, Cipav)", cotisations: 0.232, vl: 0.022, cfp: 0.002, plafond: 83600, tva: 37500, tva_tolerance: 41250 },
};
/** Due date of the URSSAF declaration covering `periode` (YYYY-MM for monthly, YYYY-Qn for quarterly): last day of the following month, quarters on 30 Apr, 31 Jul, 31 Oct, 31 Jan. */
export function echeanceUrssaf(periode) {
    const q = periode.match(/^(\d{4})-Q([1-4])$/);
    const [y, m] = q ? [Number(q[1]), Number(q[2]) * 3] : periode.split("-").map(Number);
    const d = new Date(Date.UTC(y, m + 1, 0)); // last day of the month after the period
    return d.toISOString().slice(0, 10);
}
const MOIS_C = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function rapportMicro(m, recettes, today) {
    const t = MICRO[m.type];
    const annee = Number(today.slice(0, 4));
    const cles = m.periodicite === "mensuelle"
        ? Array.from({ length: 12 }, (_, k) => ({ p: `${annee}-${String(k + 1).padStart(2, "0")}`, mois: [k + 1], lib: `${MOIS_C[k]} ${annee}` }))
        : [1, 2, 3, 4].map((q) => ({ p: `${annee}-Q${q}`, mois: [q * 3 - 2, q * 3 - 1, q * 3], lib: `${q}${q === 1 ? "er" : "e"} trimestre ${annee}` }));
    const r2 = (n) => Math.round(n * 100) / 100;
    const periodes = cles.map(({ p, mois, lib }) => {
        const ca = r2(recettes.filter((x) => mois.includes(Number(x.date.slice(5, 7))) && x.date.startsWith(String(annee))).reduce((s, x) => s + x.montant, 0));
        const cot = r2(ca * t.cotisations), vl = m.versement_liberatoire ? r2(ca * t.vl) : 0, cfp = r2(ca * t.cfp);
        const fin = `${annee}-${String(mois[mois.length - 1]).padStart(2, "0")}-31`;
        const echeance = echeanceUrssaf(p);
        const statut = today <= fin.slice(0, 7) + "-28" && today.slice(0, 7) <= fin.slice(0, 7) ? "en_cours" : today > echeance ? "passee" : "a_declarer";
        return { periode: p, libelle: lib, ca, cotisations: cot, vl, cfp, total: r2(cot + vl + cfp), echeance, statut };
    }).filter((x) => x.periode <= (m.periodicite === "mensuelle" ? today.slice(0, 7) : `${annee}-Q${Math.ceil(Number(today.slice(5, 7)) / 3)}`));
    const ca_annee = r2(periodes.reduce((s, x) => s + x.ca, 0));
    const partTva = ca_annee / t.tva;
    return {
        type: m.type, libelle: t.libelle, periodicite: m.periodicite, versement_liberatoire: m.versement_liberatoire,
        taux: { cotisations: t.cotisations, vl: m.versement_liberatoire ? t.vl : 0, cfp: t.cfp },
        ca_annee, plafond: t.plafond, part_plafond: Math.round((ca_annee / t.plafond) * 100),
        tva: { seuil: t.tva, tolerance: t.tva_tolerance, part: Math.round(partTva * 100), alerte: ca_annee > t.tva_tolerance ? "Seuil majoré de la franchise de TVA dépassé : la TVA est due dès le jour du dépassement." : ca_annee > t.tva ? "Seuil de la franchise de TVA dépassé : la TVA s'appliquera l'an prochain (ou dès le dépassement du seuil majoré)." : partTva > 0.8 ? "Plus de 80 % du seuil de franchise de TVA : surveillez les prochains encaissements." : null },
        periodes, prochaine: periodes.find((x) => x.statut === "a_declarer") ?? null, total_annee: r2(periodes.reduce((s, x) => s + x.total, 0)),
    };
}
export const DONNEES_PRO_VIDES = { personnes: [] };
/** Rubriques de la déclaration 2035 (libellés du formulaire, ligne « 2035-A »). */
export const RUBRIQUES = {
    recettes: "Recettes encaissées",
    achats: "Achats",
    cet: "Contribution économique territoriale",
    autres_impots: "Autres impôts",
    loyers: "Loyers et charges locatives",
    location_materiel: "Location de matériel et de mobilier",
    entretien: "Entretien et réparations",
    petit_outillage: "Petit outillage",
    energie: "Chauffage, eau, gaz, électricité",
    honoraires: "Honoraires ne constituant pas des rétrocessions",
    assurances: "Primes d'assurances",
    vehicule: "Frais de véhicules",
    deplacements: "Autres frais de déplacements",
    sociales_obligatoires: "Charges sociales personnelles obligatoires",
    urssaf: "URSSAF : cotisations, CSG et CRDS (à ventiler)",
    csg_deductible: "CSG déductible",
    salaires: "Salaires nets et avantages en nature",
    charges_salaires: "Charges sociales sur salaires",
    tva: "TVA reversée",
    interimaire: "Personnel intérimaire",
    pertes: "Pertes diverses",
    sociales_facultatives: "Charges sociales personnelles facultatives (Madelin)",
    reception: "Frais de réception, de représentation et de congrès",
    fournitures: "Fournitures de bureau, frais de documentation, de correspondance et de téléphone",
    actes: "Frais d'actes et de contentieux",
    cotisations_pro: "Cotisations syndicales et professionnelles",
    divers_gestion: "Autres frais divers de gestion",
    frais_financiers: "Frais financiers",
    immobilisation: "À immobiliser et amortir (achat de plus de 500 € HT ?)",
    prelevements: "Prélèvements personnels (non déductibles)",
    a_classer: "À classer",
};
const REGLES = [
    [/vir(ement)? (vers|pour)? ?(compte joint|perso|personnel|m\.? ?martin|mme)/i, "prelevements"],
    [/urssaf/i, "urssaf"],
    [/carpimko|carmf|cipav|carcdsf|cavp|carpv|cnbf|crpcen|cavamac|cavec/i, "sociales_obligatoires"],
    [/dgfip tva|tva\b/i, "tva"],
    [/salaire|paie\b/i, "salaires"],
    [/madelin|prevoyance|retraite complementaire facultative/i, "sociales_facultatives"],
    [/\bcfe\b|cotisation fonciere/i, "cet"],
    [/scm|loyer|bail|cabinet/i, "loyers"],
    [/macsf|hiscox|rcp|responsabilite civile|assurance/i, "assurances"],
    [/edf|engie|total ?energies? (gaz|elec)|veolia|eau\b/i, "energie"],
    [/total|esso|shell|bp\b|carburant|peage|vinci|aprr|garage|norauto|midas|parking/i, "vehicule"],
    [/sncf|air france|easyjet|hotel|ibis|uber\b|taxi/i, "deplacements"],
    [/ordre des|syndicat|urps|fnmk|csmf|cotisation (ordinale|professionnelle)/i, "cotisations_pro"],
    [/comptable|expert.?comptable|\baga\b|\boga\b|association de gestion/i, "honoraires"],
    [/frais|commission|tenue de compte|cotisation carte|agios|interets/i, "frais_financiers"],
    [/orange|sfr|bouygues|free\b|sosh|la poste|bureau vallee|fournitures|papeterie|amazon|fnac/i, "fournitures"],
    [/doctolib|logiciel|abonnement|microsoft|google workspace|ovh|stripe fee|sumup fee/i, "divers_gestion"],
    [/restaurant|brasserie|traiteur|congres|seminaire/i, "reception"],
    [/huissier|avocat|greffe|notaire/i, "actes"],
];
/** Class of a professional bank line, for the 2035. Manual choices (by label) win. */
export function rubriqueDe(t, forcees = {}) {
    const k = cleLibelle(t.libelle);
    if (forcees[k])
        return forcees[k];
    if (t.montant > 0)
        return /vir(ement)? (de|depuis) (compte joint|perso)/i.test(t.libelle) ? "a_classer" : "recettes";
    for (const [re, r] of REGLES)
        if (re.test(t.libelle))
            return r === "fournitures" && t.montant <= -500 ? "immobilisation" : r;
    return t.montant <= -500 ? "immobilisation" : "a_classer";
}
export const cleLibelle = (l) => l.toUpperCase().replace(/\d{2}\/\d{2}|\d{4,}/g, "").replace(/\s+/g, " ").trim();
const r2 = (n) => Math.round(n * 100) / 100;
/** Micro-BNC: ceiling by year of income, 34 % allowance (305 € minimum). Revenus 2023-2025: 77 700 €; 2026-2028: 83 600 €. */
export const seuilMicroBnc = (annee) => (annee >= 2026 ? 83600 : 77700);
export const ABATTEMENT_MICRO_BNC = 0.34;
/** Online deadline of the 2035: second working day after 1 May, plus 15 days (rule announced each year; check it). */
export function limite2035(anneeDepot) {
    const d = new Date(Date.UTC(anneeDepot, 4, 1));
    let ouvres = 0;
    while (ouvres < 2) {
        d.setUTCDate(d.getUTCDate() + 1);
        const j = d.getUTCDay();
        if (j !== 0 && j !== 6 && !(d.getUTCMonth() === 4 && d.getUTCDate() === 8))
            ouvres++;
    }
    d.setUTCDate(d.getUTCDate() + 15);
    return d.toISOString().slice(0, 10);
}
const moisListe = (de, a) => { const out = []; let [y, m] = de.split("-").map(Number); const [ya, ma] = a.split("-").map(Number); while (y < ya || (y === ya && m <= ma)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
        m = 1;
        y++;
    }
} return out; };
const moisPrec = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
export function rapportSalarie(s, txs, today) {
    const annee = Number(today.slice(0, 4));
    const bs = [...s.bulletins].sort((a, b) => a.mois.localeCompare(b.mois));
    const del = bs.filter((b) => b.mois.startsWith(String(annee)));
    const dernierMois = moisPrec(today.slice(0, 7));
    const debut = s.date_entree.slice(0, 7) > `${annee}-01` ? s.date_entree.slice(0, 7) : `${annee}-01`;
    const manquants = moisListe(debut, dernierMois).filter((m) => !bs.some((b) => b.mois === m));
    const nets = del.map((b) => b.net_paye).sort((a, b) => a - b);
    const mediane = nets.length ? nets[Math.floor(nets.length / 2)] : 0;
    const anomalies = [];
    for (const b of del) {
        if (b.net_imposable > b.brut)
            anomalies.push({ mois: b.mois, texte: "Net imposable supérieur au brut : un chiffre est mal lu ou mal saisi." });
        else if (mediane && Math.abs(b.net_paye - mediane) / mediane > 0.15)
            anomalies.push({ mois: b.mois, texte: `Net payé ${b.net_paye > mediane ? "plus élevé" : "plus bas"} que d'habitude (${Math.round(b.net_paye)} € pour ${Math.round(mediane)} €) : prime, absence, régularisation ? Un coup d'œil suffit.` });
    }
    const mot = s.employeur.split(/\s+/).filter((w) => w.length > 3).map((w) => w.toUpperCase());
    const verses = txs.filter((t) => t.montant > 0 && /salaire|paie/i.test(t.libelle) && mot.some((w) => t.libelle.toUpperCase().includes(w)))
        .map((t) => ({ mois: t.date.slice(0, 7), montant: t.montant, date: t.date }));
    const ent = new Date(s.date_entree + "T00:00:00Z"), auj = new Date(today + "T00:00:00Z");
    return {
        employeur: s.employeur, poste: s.poste, type_contrat: s.type_contrat,
        anciennete_ans: Math.max(0, Math.floor((auj.getTime() - ent.getTime()) / (365.25 * 864e5))),
        annee, cumul_net_imposable: r2(del.reduce((x, b) => x + b.net_imposable, 0)), cumul_net_paye: r2(del.reduce((x, b) => x + b.net_paye, 0)),
        dernier: bs.at(-1) ?? null, manquants, anomalies, verses,
    };
}
export function rapportIndependant(i, txs, today) {
    const annee = Number(today.slice(0, 4));
    const ops = txs.filter((t) => t.compte === i.compte_pro && t.date.startsWith(String(annee)));
    const livre = ops.map((t) => ({ date: t.date, libelle: t.libelle, montant: t.montant, rubrique: rubriqueDe(t, i.rubriques) })).sort((a, b) => a.date.localeCompare(b.date));
    const tot = new Map();
    for (const l of livre) {
        const x = tot.get(l.rubrique) ?? { montant: 0, nb: 0 };
        x.montant = r2(x.montant + Math.abs(l.montant));
        x.nb++;
        tot.set(l.rubrique, x);
    }
    const recettes = tot.get("recettes")?.montant ?? 0;
    const horsDeductible = ["recettes", "prelevements", "a_classer", "immobilisation"];
    const depenses = r2([...tot].filter(([r]) => !horsDeductible.includes(r)).reduce((s, [, v]) => s + v.montant, 0));
    const benefice = r2(recettes - depenses);
    const seuil = seuilMicroBnc(annee);
    const base_micro = r2(Math.max(recettes * (1 - ABATTEMENT_MICRO_BNC), Math.min(recettes, 305)));
    const eligible = recettes <= seuil;
    const conseil = !eligible
        ? `Recettes au-dessus de ${seuil.toLocaleString("fr-FR")} € : la déclaration contrôlée (2035) s'impose.`
        : benefice < base_micro
            ? `Au réel (2035), vous déclarez ${Math.round(base_micro - benefice).toLocaleString("fr-FR")} € de moins qu'en micro à ce stade de l'année : vos charges dépassent l'abattement de 34 %.`
            : `En micro, l'abattement de 34 % dépasse vos charges réelles : le micro-BNC vous ferait déclarer ${Math.round(benefice - base_micro).toLocaleString("fr-FR")} € de moins à ce stade.`;
    const urssaf = tot.get("urssaf")?.montant ?? 0;
    const noteUrssaf = urssaf > 0 ? ` Les prélèvements URSSAF (${Math.round(urssaf).toLocaleString("fr-FR")} €) mêlent cotisations, CSG et CRDS : sur la 2035, la CSG déductible a sa propre ligne et la part non déductible (CSG non déductible, CRDS) ne se déduit pas. Reprenez le détail de votre attestation annuelle URSSAF : le bénéfice réel sera un peu plus élevé que cette estimation.` : "";
    const lim = limite2035(annee + 1);
    const me = i.regime === "micro_entrepreneur" && i.micro ? rapportMicro(i.micro, livre.filter((l) => l.rubrique === "recettes"), today) : null;
    const echeances = me ? [
        ...me.periodes.filter((p) => p.statut !== "passee").map((p) => ({ date: p.echeance, titre: `Déclaration URSSAF : ${p.libelle}`, detail: `Chiffre d'affaires ${Math.round(p.ca).toLocaleString("fr-FR")} €, à payer environ ${Math.round(p.total).toLocaleString("fr-FR")} € (cotisations${me.versement_liberatoire ? ", impôt libératoire" : ""} et formation professionnelle).` })),
        { date: `${annee}-12-15`, titre: "CFE à payer", detail: "Exonérée l'année de création. Avis dans votre espace professionnel impots.gouv.fr." },
        { date: lim, titre: "Chiffre d'affaires sur la 2042-C-PRO", detail: me.versement_liberatoire ? "À déclarer même avec le versement libératoire (il sert au revenu fiscal de référence)." : "L'abattement forfaitaire est appliqué par l'administration." },
    ].filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)) : [
        { date: `${annee}-12-15`, titre: "CFE à payer", detail: "Cotisation foncière des entreprises, avis dans votre espace professionnel impots.gouv.fr." },
        ...(i.regime === "bnc_2035" ? [{ date: lim, titre: `Déclaration 2035 des revenus ${annee}`, detail: "En ligne, avec ses annexes 2035-A et 2035-B. Date limite indicative : elle est fixée chaque année." }] : []),
        { date: lim, titre: "Report sur la 2042-C-PRO", detail: i.regime === "bnc_2035" ? "Le bénéfice de la 2035 se reporte sur la déclaration complémentaire des revenus." : "Les recettes encaissées se déclarent sur la 2042-C-PRO, l'abattement de 34 % est appliqué par l'administration." },
    ].filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    return {
        activite: i.activite, regime: i.regime, annee, compte_pro: i.compte_pro, micro_entreprise: me,
        recettes, depenses, benefice, prelevements: tot.get("prelevements")?.montant ?? 0,
        par_rubrique: [...tot].map(([r, v]) => ({ rubrique: r, libelle: RUBRIQUES[r], ...v })).sort((a, b) => b.montant - a.montant),
        a_classer: livre.filter((l) => l.rubrique === "a_classer").map(({ date, libelle, montant }) => ({ date, libelle, montant })),
        immobilisations: livre.filter((l) => l.rubrique === "immobilisation").map(({ date, libelle, montant }) => ({ date, libelle, montant })),
        livre, micro: { eligible, seuil, base_micro, base_reel: benefice, conseil: conseil + noteUrssaf }, echeances,
    };
}
export function rapportPro(d, txs, docs, today = new Date().toISOString().slice(0, 10)) {
    const papiers = docs.flatMap((x) => {
        const t = x.title.toLowerCase();
        const type = /bulletin|fiche de paie|paie\b/.test(t) ? "bulletin" : /avenant/.test(t) ? "avenant" : /contrat de travail|\bcdi\b|\bcdd\b|promesse d.embauche/.test(t) ? "contrat" : /attestation (employeur|pole emploi|france travail)|certificat de travail|solde de tout compte/.test(t) ? "attestation" : null;
        return type ? [{ id: x.id, title: x.title, type: type }] : [];
    });
    return {
        personnes: d.personnes.map((p) => ({ member_id: p.member_id, prenom: p.prenom, salarie: p.salarie ? rapportSalarie(p.salarie, txs, today) : null, independant: p.independant ? rapportIndependant(p.independant, txs, today) : null })),
        papiers,
    };
}
/** Livre des recettes et des dépenses (CSV « ; »), pour le comptable ou l'association de gestion agréée. */
export function livreCsv(r) {
    const csv = (s) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const l = ["Date;Libellé;Rubrique 2035;Recette;Dépense"];
    for (const x of r.livre) {
        const v = Math.abs(x.montant).toFixed(2).replace(".", ",");
        l.push([x.date.split("-").reverse().join("/"), csv(x.libelle), csv(RUBRIQUES[x.rubrique]), x.montant > 0 ? v : "", x.montant < 0 ? v : ""].join(";"));
    }
    return l.join("\r\n") + "\r\n";
}
// ---------- démo : Camille, kinésithérapeute salariée à mi-temps et libérale ----------
export const COMPTE_PRO_DEMO = "Pro Camille";
export const COMPTE_MICRO_DEMO = "Micro Moi";
/** Fictional professional account of Camille, from January to `today`. */
export function demoComptePro(today) {
    const out = [];
    const annee = Number(today.slice(0, 4));
    const add = (m, j, libelle, montant) => {
        const date = `${annee}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
        if (date <= today)
            out.push({ date, libelle, montant, categorie: montant > 0 ? "revenus" : "autre", compte: COMPTE_PRO_DEMO });
    };
    for (let m = 1; m <= 12; m++) {
        const saison = m === 8 ? 0.45 : m === 12 ? 0.8 : 1;
        add(m, 6, "VIR CPAM HERAULT TIERS PAYANT", Math.round(1680 * saison + m * 7));
        add(m, 14, "REMISE CB SUMUP PATIENTS", Math.round(1240 * saison + m * 11));
        add(m, 22, "VIR CPAM HERAULT TIERS PAYANT", Math.round(1520 * saison));
        add(m, 26, "VIR MUTUELLES TIERS PAYANT", Math.round(380 * saison));
        add(m, 5, "PRLV URSSAF LANGUEDOC ROUSSILLON", -640);
        add(m, 5, "PRLV CARPIMKO COTISATIONS", -415);
        add(m, 1, "PRLV SCM CABINET KINE ECUSSON", -880);
        add(m, 10, "PRLV MACSF RCP PRO", -31.5);
        add(m, 12, "PRLV ORANGE PRO", -39.99);
        add(m, 15, "CB DOCTOLIB ABONNEMENT", -139);
        add(m, 18, "CB TOTALENERGIES RELAIS", -58.4);
        add(m, 28, "FRAIS TENUE DE COMPTE PRO", -12);
        add(m, 28, "VIR VERS COMPTE JOINT", -2800);
        if (m % 3 === 0)
            add(m, 20, "CB BUREAU VALLEE MONTPELLIER", -46.8);
    }
    add(2, 9, "PRLV ORDRE DES MASSEURS KINESITHERAPEUTES", -330);
    add(3, 17, "CB ALLTRICKS MATERIEL TABLE DE MASSAGE", -1290);
    add(4, 3, "PRLV AGA LANGUEDOC ADHESION", -240);
    add(6, 11, "CB FORMATION CONTINUE FIFPL", -180);
    add(9, 24, "CB RESTAURANT LE CLOS", -64);
    add(12, 14, "PRLV IMPOTS CFE", -412);
    // « Moi » : cours de yoga en micro-entreprise, sur un petit compte dédié
    for (let m = 1; m <= 12; m++) {
        const d = (j) => `${annee}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
        const vac = m === 8 ? 0 : 1;
        for (const [j, mt] of [[7, 240], [14, 180], [21, 240], [27, 150 + m * 5]])
            if (vac && d(j) <= today)
                out.push({ date: d(j), libelle: j === 14 ? "REMISE SUMUP COURS YOGA" : "VIR ADHERENTS COURS YOGA", montant: mt, categorie: "revenus", compte: COMPTE_MICRO_DEMO });
        if (d(10) <= today && vac)
            out.push({ date: d(10), libelle: "PRLV LOCATION SALLE ASSOCIATION", montant: -90, categorie: "autre", compte: COMPTE_MICRO_DEMO });
    }
    return out;
}
export function demoPro(memberIds, today) {
    const annee = Number(today.slice(0, 4));
    const mois = (m) => `${annee}-${String(m).padStart(2, "0")}`;
    const dernier = Number(today.slice(5, 7)) - 1;
    const bul = (net, brut, imp, sauf = [], prime = {}) => Array.from({ length: Math.max(0, dernier) }, (_, i) => i + 1).filter((m) => !sauf.includes(m)).map((m) => ({ mois: mois(m), brut: brut + (prime[m] ?? 0) * 1.3, net_paye: net + (prime[m] ?? 0), net_imposable: imp + (prime[m] ?? 0) * 1.03 }));
    return {
        personnes: [
            { member_id: memberIds.moi, prenom: "Moi", salarie: { employeur: "Atelier Verdier", poste: "Responsable des achats, cadre", type_contrat: "CDI", date_entree: "2017-03-01", convention: "Syntec", bulletins: bul(2850, 3700, 2960, [7], { 6: 900 }) },
                independant: { activite: "Professeure de yoga, micro-entreprise", regime: "micro_entrepreneur", compte_pro: COMPTE_MICRO_DEMO, debut_activite: "2024-09-02", micro: { type: "bnc_ssi", periodicite: "trimestrielle", versement_liberatoire: false } } },
            { member_id: memberIds.camille, prenom: "Camille", salarie: { employeur: "Clinique Saint Roch", poste: "Masseur-kinésithérapeute, mi-temps", type_contrat: "CDI", date_entree: "2021-09-01", convention: "FHP", bulletins: bul(2100, 2690, 2180) },
                independant: { activite: "Masseur-kinésithérapeute libérale", regime: "bnc_2035", compte_pro: COMPTE_PRO_DEMO, debut_activite: "2022-01-03" } },
        ],
    };
}
