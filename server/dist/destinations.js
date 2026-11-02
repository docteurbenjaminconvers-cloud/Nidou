/**
 * Where each bank account goes. A bank often returns several accounts at once (current account, joint account,
 * savings, a company's account): each one is given a destination, suggested by Lucien and confirmed by the person.
 *  - foyer   : the household budget (spending, savings found, end of month)
 *  - pro     : Vie pro, kept out of the household budget
 *  - locatif : rents and charges (SCI, rental account), kept out of the household budget
 *  - epargne : only its balance counts (balance sheet); its movements are not spending
 *  - ignore  : not followed; its operations are not imported (and those already imported are removed)
 */
export const DESTINATIONS = ["foyer", "pro", "locatif", "epargne", "ignore"];
export const LIBELLE_DESTINATION = {
    foyer: "Budget du foyer", pro: "Professionnel", locatif: "Location / SCI", epargne: "Épargne", ignore: "Ne pas suivre",
};
const SOCIETE = /\b(sci|sarl|sas|sasu|eurl|selarl|selas|snc|scm|scp|sa|ei|eirl|holding)\b/i;
const EPARGNE = /\b(livret|ldds|ldd|lep|pel|cel|codevi|epargne|épargne|assurance[- ]vie|pea|compte titres?|csl)\b/i;
/** Lucien's suggestion, before the person confirms. */
export function suggererDestination(a, connexionPro = false) {
    const texte = [a.name, a.product, a.details].filter(Boolean).join(" ");
    if (a.cash_account_type === "SVGS" || EPARGNE.test(texte))
        return "epargne";
    if (/\bsci\b/i.test(texte))
        return "locatif";
    if (connexionPro || a.usage === "ORGA" || SOCIETE.test(texte))
        return "pro";
    return "foyer";
}
/**
 * The account's name in Lucien: what the bank calls it, its kind and the last 4 digits, so that two accounts with
 * the same holder name (« CONVERS BENJAMIN » twice) never get mixed up. Operations are linked to this name.
 */
export function nomCompte(a, prefixe = "") {
    const genre = a.product || (a.cash_account_type === "SVGS" ? "Épargne" : a.cash_account_type === "CARD" ? "Carte" : null);
    const base = [a.name, genre && genre !== a.name ? genre : null].filter(Boolean).join(" · ") || "Compte";
    const fin = a.iban ? ` ••${a.iban.replace(/\s/g, "").slice(-4)}` : "";
    return `${prefixe}${base}${fin}`.slice(0, 120);
}
/** Makes names unique within one connection when the bank gives no IBAN to tell them apart. */
export function nomsUniques(comptes, nom) {
    const vus = new Map();
    return comptes.map((c) => {
        const n = nom(c);
        const k = (vus.get(n) ?? 0) + 1;
        vus.set(n, k);
        return k === 1 ? n : `${n} (${k})`;
    });
}
