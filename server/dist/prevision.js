import { findRecurrences } from "./budget.js";
const r2 = (n) => Math.round(n * 100) / 100;
const ym = (d) => d.slice(0, 7);
const nom = (m) => m.replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
/** Regular incomes (salary, benefits): same payer, at least two months, about monthly. */
function revenusReguliers(txs) {
    const par = new Map();
    for (const t of txs)
        if (t.montant > 0 && t.categorie === "revenus")
            par.set(t.marchand, [...(par.get(t.marchand) ?? []), t]);
    const out = [];
    for (const [marchand, l] of par) {
        const mois = new Set(l.map((t) => ym(t.date)));
        if (mois.size < 2)
            continue;
        const dernier = [...l].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
        out.push({ marchand, montant: dernier.montant, jour: Math.round(l.reduce((s, t) => s + Number(t.date.slice(8, 10)), 0) / l.length), mois });
    }
    return out;
}
export function prevoirFinDeMois(soldeActuel, txs, aujourdhui) {
    const mois = ym(aujourdhui), jourAuj = Number(aujourdhui.slice(8, 10));
    const [y, m] = mois.split("-").map(Number);
    const dernierJour = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const fin_mois = `${mois}-${String(dernierJour).padStart(2, "0")}`;
    const jours_restants = dernierJour - jourAuj;
    const dejaCeMois = (marchand, signe) => txs.some((t) => t.marchand === marchand && ym(t.date) === mois && Math.sign(t.montant) === signe);
    // recurring debits still to come this month
    const recs = findRecurrences(txs).filter((r) => r.frequence === "mensuel" && r.jour_du_mois);
    const prelevements_a_venir = recs
        .filter((r) => r.jour_du_mois > jourAuj && r.jour_du_mois <= dernierJour && !dejaCeMois(r.marchand, -1))
        .map((r) => ({ libelle: nom(r.marchand), montant: r2(r.dernier_montant), jour: r.jour_du_mois }))
        .sort((a, b) => a.jour - b.jour);
    // incomes expected (received last month, not yet this month)
    const moisPrec = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    const revenus_attendus = revenusReguliers(txs)
        .filter((r) => r.mois.has(moisPrec) && !dejaCeMois(r.marchand, 1))
        .map((r) => ({ libelle: nom(r.marchand), montant: r2(r.montant), jour: Math.min(dernierJour, Math.max(jourAuj + 1, r.jour)) }))
        .sort((a, b) => a.jour - b.jour);
    // everyday spending: the non-recurring debits of the last three full months, per day
    const recurrents = new Set(recs.map((r) => r.marchand));
    const base = [1, 2, 3].map((k) => new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7)).filter((mm) => txs.some((t) => ym(t.date) === mm));
    const joursBase = base.reduce((s, mm) => { const [yy, mo] = mm.split("-").map(Number); return s + new Date(Date.UTC(yy, mo, 0)).getUTCDate(); }, 0);
    const courant = txs.filter((t) => t.montant < 0 && base.includes(ym(t.date)) && !recurrents.has(t.marchand) && !["virements", "epargne"].includes(t.categorie)).reduce((s, t) => s - t.montant, 0);
    const depense_courante_jour = joursBase ? r2(courant / joursBase) : 0;
    // day by day
    let solde = soldeActuel;
    let plus_bas = { jour: aujourdhui, solde: r2(solde) };
    let alerte = null;
    for (let j = jourAuj + 1; j <= dernierJour; j++) {
        solde += revenus_attendus.filter((x) => x.jour === j).reduce((s, x) => s + x.montant, 0);
        solde -= prelevements_a_venir.filter((x) => x.jour === j).reduce((s, x) => s + x.montant, 0);
        solde -= depense_courante_jour;
        const jour = `${mois}-${String(j).padStart(2, "0")}`;
        if (solde < plus_bas.solde)
            plus_bas = { jour, solde: r2(solde) };
        if (!alerte && solde < 0)
            alerte = { jour, solde: r2(solde) };
    }
    return { solde_actuel: r2(soldeActuel), revenus_attendus, prelevements_a_venir, depenses_courantes: r2(depense_courante_jour * jours_restants), depense_courante_jour,
        solde_prevu: r2(solde), fin_mois, jours_restants, plus_bas, alerte };
}
