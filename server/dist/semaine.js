/**
 * « La semaine de Lucien » : le point hebdomadaire du majordome (échéances, agenda des enfants, budget, papiers, un conseil).
 * Fonction pure, sans dépendance au serveur : l'appli l'importe telle quelle (y compris en démo) et le serveur s'en sert
 * pour la notification et l'email du dimanche soir. Mêmes règles des deux côtés.
 */
const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const jour = (iso) => new Date(iso + "T12:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (isoDate, n) => { const d = jour(isoDate); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const ecart = (a, b) => Math.round((jour(b).getTime() - jour(a).getTime()) / 864e5);
const jourSemaine = (isoDate) => ((jour(isoDate).getUTCDay() + 6) % 7) + 1; // 1 = lundi … 7 = dimanche
const euro = (n) => `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} €`;
const dateCourte = (isoDate) => { const d = jour(isoDate); return `${JOURS[jourSemaine(isoDate)].toLowerCase()} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`; };
const pluriel = (n, s, p = s + "s") => `${n} ${n > 1 ? p : s}`;
/** « La semaine de la famille Martin » pour un foyer nommé « Famille Martin », sinon « La semaine de <nom> ». */
export function titreFoyer(nom) {
    const n = nom.replace(/\s*\(démo\)$/, "").trim();
    if (/^famille\s+/i.test(n))
        return `La semaine de la famille ${n.replace(/^famille\s+/i, "")}`;
    return n ? `La semaine de ${n}` : "Votre semaine";
}
/** ISO 8601 week key (YYYY-Www) of a date. */
export function semaineIso(isoDate) {
    const d = jour(isoDate);
    d.setUTCDate(d.getUTCDate() + 4 - jourSemaine(isoDate)); // Thursday of that week decides the year
    const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const n = Math.floor(Math.floor((d.getTime() - debutAnnee.getTime()) / 864e5) / 7) + 1; // d is at noon: whole days only
    return `${d.getUTCFullYear()}-W${String(n).padStart(2, "0")}`;
}
/** Date (YYYY-MM-DD) and hour in Paris, whatever the server's time zone. */
export function heureParis(now) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour) };
}
/**
 * The week covered: from today for 7 days; on Sunday from noon onwards, the week that starts tomorrow
 * (that is the one the Sunday evening email talks about).
 */
export function fenetre(now) {
    const { date, heure } = heureParis(now);
    const du = jourSemaine(date) === 7 && heure >= 12 ? plus(date, 1) : date;
    return { du, au: plus(du, 6) };
}
export function pointSemaine(e, now = new Date()) {
    const { du, au } = fenetre(now);
    const sections = [];
    // 1. Échéances : en retard (au plus 3), puis celles de la semaine.
    const ouvertes = e.echeances.filter((x) => !x.fait).sort((a, b) => a.date.localeCompare(b.date));
    const retard = ouvertes.filter((x) => x.date < du).slice(-3);
    const cetteSemaine = ouvertes.filter((x) => x.date >= du && x.date <= au);
    const route = (x) => (x.document_id ? `doc/${x.document_id}` : "deadlines");
    const echeances = [
        ...retard.map((x) => ({ titre: x.titre, detail: `En retard depuis le ${dateCourte(x.date)}. Si c'est réglé, cochez-la.`, quand: x.date, route: route(x), urgent: true })),
        ...cetteSemaine.map((x) => ({ titre: x.titre, detail: x.note ?? null, quand: x.date, route: route(x), urgent: ecart(du, x.date) <= 1 })),
    ];
    if (echeances.length)
        sections.push({ cle: "echeances", titre: "À ne pas manquer", items: echeances });
    // 2. Agenda des enfants : activités récurrentes jour par jour (la cantine est comptée à part, sans encombrer).
    const agenda = [];
    let nbActivites = 0;
    for (let i = 0; i < 7; i++) {
        const d = plus(du, i);
        const lignes = e.creneaux.filter((c) => c.jour === jourSemaine(d) && c.type !== "cantine");
        if (!lignes.length)
            continue;
        nbActivites += lignes.length;
        agenda.push({ titre: JOURS[jourSemaine(d)], detail: lignes.map((c) => `${c.heure_debut ? c.heure_debut + " " : ""}${c.titre}${c.membre ? ` (${c.membre})` : ""}`).join(" · "), quand: d, route: "famille" });
    }
    const repasCantine = e.creneaux.filter((c) => c.type === "cantine").length;
    if (agenda.length)
        sections.push({ cle: "agenda", titre: "L'agenda de la famille", items: agenda });
    // 3. Budget : ce qui est déjà récupéré, et le geste qui rapporte le plus.
    const budget = [];
    const geste = e.economies?.geste ?? null;
    if (geste)
        budget.push({ titre: geste.titre, detail: `Le geste de la semaine : ${geste.effort} pour ${euro(geste.gain)} par an.`, quand: null, route: "budget", montant: geste.gain });
    if (e.economies && e.economies.decidees > 0)
        budget.push({ titre: `${euro(e.economies.decidees)} par an déjà récupérés`, detail: "Le total des économies que vous avez décidées depuis votre arrivée.", quand: null, route: "budget", montant: e.economies.decidees });
    else if (e.economies && e.economies.possibles > 0 && !geste)
        budget.push({ titre: `${euro(e.economies.possibles)} par an d'économies repérées`, detail: "Elles attendent votre décision dans Budget.", quand: null, route: "budget", montant: e.economies.possibles });
    if (budget.length)
        sections.push({ cle: "budget", titre: "Côté budget", items: budget });
    // 4. Papiers à vérifier.
    if (e.aVerifier > 0)
        sections.push({ cle: "papiers", titre: "Papiers", items: [{ titre: `${pluriel(e.aVerifier, "papier")} à vérifier`, detail: "J'ai eu un doute en les lisant : un coup d'œil suffit.", quand: null, route: "docs" }] });
    // 5. Un conseil, différent chaque semaine.
    if (e.conseils.length) {
        const n = Number(semaineIso(du).slice(-2));
        const c = e.conseils[n % e.conseils.length];
        sections.push({ cle: "conseil", titre: "Le conseil de Lucien", items: [{ titre: c.titre, detail: c.detail, quand: null, route: "famille" }] });
    }
    // Intro et notification, dans la voix du majordome.
    const morceaux = [];
    if (retard.length)
        morceaux.push(`${pluriel(retard.length, "échéance")} en retard`);
    if (cetteSemaine.length)
        morceaux.push(pluriel(cetteSemaine.length, "échéance"));
    if (nbActivites)
        morceaux.push(pluriel(nbActivites, "activité"));
    if (geste)
        morceaux.push(`un geste qui rapporte ${euro(geste.gain)} par an`);
    const liste = morceaux.length > 1 ? `${morceaux.slice(0, -1).join(", ")} et ${morceaux[morceaux.length - 1]}` : morceaux[0];
    const vide = !echeances.length && !agenda.length && !budget.length && !e.aVerifier;
    const intro = vide
        ? "Une semaine calme : rien d'urgent dans vos papiers. Je veille, profitez-en."
        : `Voici ce qui vous attend du ${dateCourte(du)} au ${dateCourte(au)} : ${liste}.${repasCantine ? ` La cantine est notée ${pluriel(repasCantine, "jour")} sur 7.` : ""} Je vous préviens le moment venu.`;
    const premiere = cetteSemaine[0] ?? retard[0];
    const corps = vide
        ? "Rien d'urgent cette semaine. Je veille."
        : [premiere ? `${premiere.titre.replace(/^[^:]+:\s*/, "")}, ${dateCourte(premiere.date)}` : null, nbActivites ? pluriel(nbActivites, "activité") : null, geste ? `${euro(geste.gain)}/an à gagner` : null].filter(Boolean).join(" · ");
    return {
        cle: semaineIso(du), du, au,
        titre: titreFoyer(e.foyer),
        intro, sections, vide,
        notification: { titre: "Votre semaine avec Lucien", corps },
    };
}
