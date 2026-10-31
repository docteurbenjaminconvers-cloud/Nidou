/** Rule-based bank categorisation, without any server dependency (shared with the app's demo mode). */
/** Spending categories shown to the family. Separate from document categories. */
export const TX_CATEGORIES = [
  "alimentation", "restaurants", "transport", "carburant", "logement", "energie", "telecom", "assurance", "sante",
  "abonnements", "shopping", "loisirs", "enfants", "impots", "frais_bancaires", "epargne", "virements", "revenus", "especes", "autre",
] as const;
export type TxCategory = (typeof TX_CATEGORIES)[number];

export const TX_LABEL: Record<TxCategory, string> = {
  alimentation: "Courses", restaurants: "Restaurants", transport: "Transports", carburant: "Carburant", logement: "Logement",
  energie: "Énergie", telecom: "Télécom", assurance: "Assurances", sante: "Santé", abonnements: "Abonnements", shopping: "Shopping",
  loisirs: "Loisirs", enfants: "Enfants", impots: "Impôts", frais_bancaires: "Frais bancaires", epargne: "Épargne",
  virements: "Virements", revenus: "Revenus", especes: "Retraits", autre: "Autre",
};


export const RULES: [RegExp, TxCategory][] = [
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

export function categorieRegle(libelle: string, montant: number): TxCategory {
  for (const [re, cat] of RULES) if (re.test(libelle)) return cat;
  if (montant > 0 && /remb|rembourse|avoir/i.test(libelle)) return "revenus";
  return "autre";
}

/** Parses the CSV produced by demoStatement (Date;Libellé;Montant, dd/mm/yyyy, decimal comma). */
export function lireReleveDemo(csv: string, compte: string | null = null) {
  return csv.split("\n").slice(1).filter(Boolean).map((l) => {
    const [d, libelle, m] = l.split(";");
    const montant = Number(m.replace(",", "."));
    return { date: d.split("/").reverse().join("-"), libelle, montant, categorie: categorieRegle(libelle, montant), compte };
  });
}
