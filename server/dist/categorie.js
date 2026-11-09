/** Rule-based bank categorisation, without any server dependency (shared with the app's demo mode). */
/** Spending categories shown to the family. Separate from document categories. */
export const TX_CATEGORIES = [
    "alimentation", "restaurants", "transport", "carburant", "logement", "energie", "telecom", "assurance", "sante",
    "abonnements", "shopping", "loisirs", "enfants", "impots", "frais_bancaires", "epargne", "virements", "revenus", "especes", "autre",
];
export const TX_LABEL = {
    alimentation: "Courses", restaurants: "Restaurants", transport: "Transports", carburant: "Carburant", logement: "Logement",
    energie: "Énergie", telecom: "Télécom", assurance: "Assurances", sante: "Santé", abonnements: "Abonnements", shopping: "Shopping",
    loisirs: "Loisirs", enfants: "Enfants", impots: "Impôts", frais_bancaires: "Frais bancaires", epargne: "Épargne",
    virements: "Virements", revenus: "Revenus", especes: "Retraits", autre: "Autre",
};
export const RULES = [
    [/salaire|paie|remuneration|cpam|caf\b|pole emploi|france travail|urssaf remb/i, "revenus"],
    [/retrait|dab\b|atm/i, "especes"],
    [/livret|epargne|pel\b|assurance vie|bourse|pea\b/i, "epargne"],
    [/frais|cotisation carte|commission|agios|interets debiteurs|tenue de compte/i, "frais_bancaires"],
    [/impot|dgfip|tresor public|amende|taxe/i, "impots"],
    [/loyer|syndic|copro|foncia|nexity|credit immo|pret immo/i, "logement"],
    [/edf|engie|total ?energies|eni\b|ohm|ilek|veolia|suez|gaz|electric/i, "energie"],
    [/orange|sfr|bouygues|free\b|sosh|red by|b&you|la poste mobile|prixtel/i, "telecom"],
    [/maif|macif|axa|allianz|matmut|gmf|groupama|mma\b|maaf|assur|mutuelle|harmonie|malakoff|alan\b/i, "assurance"],
    [/pharmacie|medecin|docteur|dr\b|clinique|hopital|labo|dentiste|opticien|kine/i, "sante"],
    [/netflix|spotify|disney|canal|amazon prime|prime video|apple\.com\/bill|itunes|google play|youtube|deezer|basic.?fit|fitness|salle de sport|keepcool|neoness|ocs|paramount|crunchyroll|audible|dropbox|icloud|chatgpt|openai|anthropic|microsoft 365|adobe/i, "abonnements"],
    [/carrefour|leclerc|lidl|aldi|auchan|intermarche|monoprix|casino|franprix|super u|u express|biocoop|picard|grand frais|naturalia|boulangerie|boucherie|marche/i, "alimentation"],
    [/uber eats|deliveroo|just eat|mcdo|mcdonald|burger|kfc|pizza|restaurant|resto|brasserie|cafe|bistro|sushi|kebab|starbucks/i, "restaurants"],
    [/total\b|esso|shell|bp\b|station|carburant|avia|leclerc station/i, "carburant"],
    [/sncf|ratp|tam\b|tisseo|uber\b|bolt|blablacar|autoroute|vinci|aprr|sanef|parking|indigo|q-park|peage/i, "transport"],
    [/ecole|cantine|creche|garderie|college|lycee|periscolaire|scolaire|jouet|king jouet|smyths/i, "enfants"],
    [/amazon|fnac|darty|boulanger|zara|h&m|decathlon|ikea|leroy merlin|castorama|action\b|primark|kiabi|zalando|vinted|shein|apple store|cdiscount|temu|aliexpress/i, "shopping"],
    [/cinema|ugc|pathe|theatre|concert|musee|piscine|golf|tennis|club|billetterie|fnac spectacles|steam|playstation|nintendo|xbox/i, "loisirs"],
    [/virement|vir\b/i, "virements"],
];
export function categorieRegle(libelle, montant) {
    for (const [re, cat] of RULES)
        if (re.test(libelle))
            return cat;
    if (montant > 0 && /remb|rembourse|avoir/i.test(libelle))
        return "revenus";
    return "autre";
}
/** Parses the CSV produced by demoStatement (Date;Libellé;Montant, dd/mm/yyyy, decimal comma). */
export function lireReleveDemo(csv, compte = null) {
    return csv.split("\n").slice(1).filter(Boolean).map((l) => {
        const [d, libelle, m] = l.split(";");
        const montant = Number(m.replace(",", "."));
        return { date: d.split("/").reverse().join("-"), libelle, montant, categorie: categorieRegle(libelle, montant), compte };
    });
}
/**
 * Debits that are not subscriptions: nothing to cancel, Lucien never offers « Résilier » for them (nor a « price went up,
 * cancel » alert). Taxes, compulsory social contributions and pension funds of the self-employed, professional orders,
 * loan repayments, rent and building charges, savings, transfers, bank fees, cash, care.
 */
const SANS_RESILIATION = [
    [/\b(impots?|dgfip|tresor public|finances publiques|\bsip\b|\bsie\b|prelevement a la source|taxe (fonciere|d habitation|habitation|ordures)|amendes?|antai|contraventions?|douanes?)\b/, "impôt ou taxe"],
    [/\b(urssaf|ssi|rsi|cpam|msa|caf|france travail|pole emploi|cotisations? sociales?|csg|crds)\b/, "cotisation sociale obligatoire"],
    [/\b(carmf|cipav|carpimko|cavp|cavec|cnbf|carcdsf|crpcen|cavamac|cavom|carpv|agirc|arrco|ircantec|cnav|caisse de retraite|retraite complementaire|ircec)\b/, "caisse de retraite obligatoire"],
    [/\b(ordre (national )?des? (medecins|pharmaciens|infirmiers|masseurs|kinesitherapeutes|avocats|architectes|experts|chirurgiens|sages|veterinaires)|cnom|cdom|cnoi|cnop)\b/, "cotisation à un ordre professionnel"],
    [/\b(pret|prets|emprunt|echeance|credit (immo|immobilier|conso|renouvelable)|cetelem|cofidis|sofinco|franfinance|oney|floa|younited|financo|remboursement anticipe)\b/, "remboursement de prêt"],
    [/\b(loyer|syndic|copropriete|copro|charges locatives|pension alimentaire|salaire)\b/, "loyer, charges ou obligation"],
];
const CATEGORIES_SANS_RESILIATION = {
    impots: "impôt ou taxe", logement: "loyer ou crédit", epargne: "épargne", virements: "virement", revenus: "revenu",
    frais_bancaires: "frais bancaires", especes: "retrait d'espèces", sante: "dépense de santé",
};
const sansAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
/** Why this recurring debit cannot be cancelled, or null when it can (a subscription, a contract, a membership…). */
export function pourquoiPasResiliable(categorie, marchand) {
    const m = ` ${sansAccents(marchand)} `;
    for (const [re, raison] of SANS_RESILIATION)
        if (re.test(m))
            return raison;
    return CATEGORIES_SANS_RESILIATION[categorie] ?? null;
}
export const estResiliable = (categorie, marchand) => pourquoiPasResiliable(categorie, marchand) === null;
