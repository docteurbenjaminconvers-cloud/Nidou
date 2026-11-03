import { findRecurrences } from "./budget.js";
import { suivis } from "./resiliations.js";
/**
 * Wording common to the « annuaire » and « registre » scams aimed at businesses (fake directories, fake official
 * registers, paid « mises en conformité »). A match is only « à vérifier », never an accusation.
 */
const ARNAQUE = /\b(annuaire|referencement|référencement|registre (des|national|du commerce et des)|guide (des|du) (pro|entreprises|professionnels)|kbis|extrait k ?bis|mise en conformit|conformite rgpd|conformité rgpd|fichier (des|national des) entreprises|info.?legales?|infos? entreprises?|inscription (au|à l.)|declaration (en ligne|d.activit)|eco.?participation)\b/i;
const r2 = (n) => Math.round(n * 100) / 100;
const jours = (a, b) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 864e5);
const nomPropre = (s) => s.replace(/(^|[\s-])(\p{L})/gu, (_, x, y) => x + y.toUpperCase());
/** The professional accounts: those sent to « Professionnel », and the account each self-employed member declared. */
export function comptesProfessionnels(db, hid) {
    const bancaires = db.listBankAccounts(hid).filter((a) => db.destinationCompte(a) === "pro").map((a) => a.nom);
    const viePro = (db.getModuleData(hid, "pro")?.personnes ?? [])
        .map((p) => p.independant?.compte_pro).filter((c) => !!c);
    return [...new Set([...bancaires, ...viePro])];
}
export function analyserPro(txs, decisions, today = new Date().toISOString().slice(0, 10)) {
    const debits = txs.filter((t) => t.montant < 0 && !["virements", "epargne", "impots"].includes(t.categorie));
    const dates = txs.map((t) => t.date).sort();
    const mois = dates.length ? Math.max(1, Math.round(jours(dates[dates.length - 1], dates[0]) / 30)) : 0;
    const texte = (t) => `${t.libelle} ${t.marchand}`;
    const prelevements = findRecurrences(debits).map((r) => {
        const lignes = debits.filter((t) => t.marchand === r.marchand);
        const depuis = lignes.map((t) => t.date).sort()[0] ?? r.derniere_date;
        const signaux = [];
        if (jours(today, depuis) <= 60 && mois >= 3)
            signaux.push("nouveau");
        if (lignes.some((t) => ARNAQUE.test(texte(t))))
            signaux.push("suspect");
        if (r.hausse)
            signaux.push("hausse");
        const cle = `rec:${r.cle}`;
        return {
            cle, marchand: nomPropre(r.marchand), frequence: r.frequence, montant: r.dernier_montant, annuel: r2(r.mensuel_equivalent * 12), depuis,
            derniere_date: r.derniere_date, occurrences: r.occurrences, compte: lignes[lignes.length - 1]?.compte ?? null, signaux, hausse: r.hausse ?? null, decision: decisions[cle] ?? null,
        };
    }).sort((a, b) => b.signaux.length - a.signaux.length || b.annuel - a.annuel);
    const recurrents = new Set(prelevements.map((p) => p.marchand.toLowerCase()));
    const alertes = [];
    const pousser = (a) => alertes.push({ ...a, decision: decisions[a.cle] ?? null });
    // one-off charges worded like a known scam
    for (const t of debits) {
        if (recurrents.has(t.marchand.toLowerCase()) || !ARNAQUE.test(texte(t)))
            continue;
        pousser({ cle: `suspect:${t.id}`, type: "suspect", titre: `${nomPropre(t.marchand)} : ${r2(-t.montant).toLocaleString("fr-FR")} € à vérifier`,
            detail: "Ce libellé ressemble aux fausses offres d'annuaire, de registre ou de mise en conformité qui visent les professionnels. Si vous n'avez rien commandé, contestez le prélèvement auprès de votre banque.",
            montant: r2(-t.montant), date: t.date, marchand: nomPropre(t.marchand) });
    }
    // the same amount charged twice by the same company within 3 days
    const vus = new Set();
    for (const t of debits) {
        if (["alimentation", "restaurants", "carburant", "transport", "frais_bancaires"].includes(t.categorie))
            continue;
        const double = debits.find((u) => u.id !== t.id && u.marchand === t.marchand && u.montant === t.montant && Math.abs(jours(u.date, t.date)) <= 3);
        const cle = `doublon:${[t.id, double?.id].sort().join(":")}`;
        if (!double || vus.has(cle) || -t.montant < 5)
            continue;
        vus.add(cle);
        pousser({ cle, type: "doublon", titre: `${nomPropre(t.marchand)} prélevé deux fois : ${r2(-t.montant).toLocaleString("fr-FR")} €`,
            detail: `Même montant le ${[t.date, double.date].sort().map((d) => d.split("-").reverse().join("/")).join(" et le ")}. Si vous n'avez payé qu'une fois, demandez le remboursement du doublon au fournisseur ou à la banque.`,
            montant: r2(-t.montant), date: t.date, marchand: nomPropre(t.marchand) });
    }
    // tiny debits from a company seen once or twice: sometimes a card being tested before a larger fraud
    const parMarchand = new Map();
    for (const t of debits)
        parMarchand.set(t.marchand, [...(parMarchand.get(t.marchand) ?? []), t]);
    for (const [m, l] of parMarchand) {
        if (l.length > 2 || recurrents.has(m.toLowerCase()) || l.some((t) => t.categorie === "frais_bancaires"))
            continue;
        for (const t of l.filter((x) => -x.montant > 0 && -x.montant <= 2)) {
            pousser({ cle: `micro:${t.id}`, type: "micro", titre: `${nomPropre(m)} : petit débit de ${r2(-t.montant).toLocaleString("fr-FR")} €`,
                detail: "Un très petit débit d'un inconnu sert parfois à tester une carte avant une fraude plus importante. Si vous ne reconnaissez pas ce commerçant, faites opposition sur la carte.",
                montant: r2(-t.montant), date: t.date, marchand: nomPropre(m) });
        }
    }
    // bank fees on the business accounts
    const frais = debits.filter((t) => t.categorie === "frais_bancaires");
    const totalFrais = frais.reduce((s, t) => s - t.montant, 0);
    if (totalFrais > 0 && mois > 0) {
        pousser({ cle: "frais:pro", type: "frais", titre: `${r2(totalFrais).toLocaleString("fr-FR")} € de frais bancaires pro sur ${mois} mois`,
            detail: `Soit environ ${Math.round((totalFrais / mois) * 12).toLocaleString("fr-FR")} € par an. Les banques en ligne pour professionnels facturent souvent bien moins : comparez, ou négociez avec votre conseiller.`,
            montant: r2((totalFrais / mois) * 12), date: null, marchand: null });
    }
    const ordre = { suspect: 0, doublon: 1, micro: 2, frais: 3 };
    alertes.sort((a, b) => ordre[a.type] - ordre[b.type] || b.montant - a.montant);
    const a_verifier = prelevements.filter((p) => p.signaux.length && !p.decision).length + alertes.filter((a) => a.type !== "frais" && !a.decision).length;
    return { mois, prelevements, alertes, total_annuel: r2(prelevements.reduce((s, p) => s + p.annuel, 0)), a_verifier };
}
/** The recurring debits of the business accounts (same reading as the analysis), to cancel one of them. */
export function recurrencesPro(db, hid) {
    const set = new Set(comptesProfessionnels(db, hid));
    return findRecurrences(db.listTransactions(hid).filter((t) => t.compte && set.has(t.compte) && t.montant < 0 && !["virements", "epargne", "impots"].includes(t.categorie)));
}
export function analyseProFoyer(db, hid) {
    const comptes = comptesProfessionnels(db, hid);
    const set = new Set(comptes);
    const txs = comptes.length ? db.listTransactions(hid).filter((t) => t.compte && set.has(t.compte)) : [];
    const decisions = db.getModuleData(hid, "verif_pro")?.decisions ?? {};
    const r = analyserPro(txs, decisions);
    const liste = suivis(db, hid, db.listTransactions(hid)).liste;
    for (const p of r.prelevements) {
        const s = liste.find((x) => `rec:${x.cle}` === p.cle);
        p.suivi = s ? { statut: s.statut, message: s.message } : null;
    }
    return { comptes, ...r };
}
export function deciderPro(db, hid, cle, decision) {
    const d = db.getModuleData(hid, "verif_pro")?.decisions ?? {};
    if (decision)
        d[cle] = decision;
    else
        delete d[cle];
    db.setModuleData(hid, "verif_pro", { decisions: d });
}
