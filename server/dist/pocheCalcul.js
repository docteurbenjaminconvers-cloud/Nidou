const c2 = (n) => Math.round(n * 100) / 100;
const jourIso = (d) => d.toISOString().slice(0, 10);
const plusJours = (iso, n) => jourIso(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000));
const jourSemaine = (iso) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // lundi = 1
/** Is this day an allowance day? Weekly: the chosen weekday. Monthly: the chosen day (1 to 28). */
export const jourDeVersement = (r, iso) => (r.frequence === "semaine" ? jourSemaine(iso) === r.jour : Number(iso.slice(8, 10)) === r.jour);
/** The allowance days after `apres` (or from the start of the setting), up to today. At most a year of catching up. */
export function versementsDus(r, apres, aujourdhui) {
    if (!r.actif || !(r.montant > 0))
        return [];
    const out = [];
    let d = apres && apres >= r.depuis ? plusJours(apres, 1) : r.depuis;
    for (let n = 0; d <= aujourdhui && n < 400; n++, d = plusJours(d, 1))
        if (jourDeVersement(r, d))
            out.push(d);
    return out.slice(-60);
}
export function prochainVersement(r, aujourdhui) {
    if (!r || !r.actif || !(r.montant > 0))
        return null;
    for (let n = 1, d = plusJours(aujourdhui, 1); n <= 35; n++, d = plusJours(d, 1))
        if (jourDeVersement(r, d) && d >= r.depuis)
            return { date: d, montant: r.montant };
    return null;
}
export function etatPoche(o) {
    const mois = o.aujourdhui.slice(0, 7);
    const solde = c2(o.mouvements.reduce((s, m) => s + m.montant, 0));
    const cote = c2(o.objectifs.reduce((s, x) => s + x.mis_de_cote, 0));
    const duMois = o.mouvements.filter((m) => m.date.startsWith(mois));
    return {
        member_id: o.member_id, prenom: o.prenom, reglage: o.reglage, solde, mis_de_cote: cote, disponible: c2(solde - cote),
        recu_mois: c2(duMois.filter((m) => m.montant > 0).reduce((s, m) => s + m.montant, 0)),
        depense_mois: c2(-duMois.filter((m) => m.montant < 0).reduce((s, m) => s + m.montant, 0)),
        prochain: prochainVersement(o.reglage, o.aujourdhui),
        mouvements: [...o.mouvements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 120), // given newest first: the sort is stable within a day
        objectifs: o.objectifs, missions: o.missions,
    };
}
export const LIBELLE_VERSEMENT = (f) => (f === "semaine" ? "Argent de poche de la semaine" : "Argent de poche du mois");
/** The sign each kind of line carries. */
export const signe = (t) => (t === "depense" || t === "retenue" ? -1 : 1);
