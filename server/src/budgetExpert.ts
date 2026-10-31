/**
 * Module « Budget expert » : les comptes du foyer tenus comme par un expert-comptable.
 * Plan de comptes du foyer (numéros inspirés du plan comptable général, pour le repère, pas une obligation),
 * compte de résultat mensuel, prévisionnel et écarts, bilan patrimonial, ratios, clôture du mois, grand livre.
 * Fonction pure : le serveur l'applique aux opérations bancaires du foyer, l'appli de démo aussi.
 */
import type { TxCategory } from "./categorie.js";

export interface TxB { date: string; libelle: string; montant: number; categorie: TxCategory | string; compte?: string | null }

export type Poste =
  | "travail" | "aides" | "autres_revenus"
  | "logement" | "energie" | "alimentation" | "restaurants" | "transport" | "telecom" | "assurance" | "sante"
  | "enfants" | "abonnements" | "loisirs" | "impots" | "banque" | "divers";

export const POSTES: Record<Poste, { compte: string; libelle: string; sens: "produit" | "charge" }> = {
  travail: { compte: "701", libelle: "Revenus du travail", sens: "produit" },
  aides: { compte: "741", libelle: "Prestations et aides", sens: "produit" },
  autres_revenus: { compte: "758", libelle: "Autres revenus et remboursements", sens: "produit" },
  logement: { compte: "613", libelle: "Logement (loyer ou crédit, copropriété)", sens: "charge" },
  energie: { compte: "606", libelle: "Énergie et eau", sens: "charge" },
  alimentation: { compte: "601", libelle: "Courses", sens: "charge" },
  restaurants: { compte: "625", libelle: "Restaurants et livraisons", sens: "charge" },
  transport: { compte: "624", libelle: "Transports et carburant", sens: "charge" },
  telecom: { compte: "626", libelle: "Télécom et internet", sens: "charge" },
  assurance: { compte: "616", libelle: "Assurances et mutuelle", sens: "charge" },
  sante: { compte: "615", libelle: "Santé", sens: "charge" },
  enfants: { compte: "628", libelle: "Enfants et scolarité", sens: "charge" },
  abonnements: { compte: "651", libelle: "Abonnements", sens: "charge" },
  loisirs: { compte: "623", libelle: "Loisirs et achats", sens: "charge" },
  impots: { compte: "635", libelle: "Impôts et taxes", sens: "charge" },
  banque: { compte: "627", libelle: "Frais bancaires", sens: "charge" },
  divers: { compte: "658", libelle: "Divers et retraits", sens: "charge" },
};
export const CHARGES = (Object.keys(POSTES) as Poste[]).filter((p) => POSTES[p].sens === "charge");
export const PRODUITS = (Object.keys(POSTES) as Poste[]).filter((p) => POSTES[p].sens === "produit");

export interface Actif { id: string; libelle: string; type: "compte" | "epargne" | "placement" | "immobilier" | "vehicule" | "autre"; valeur: number }
export interface Passif { id: string; libelle: string; type: "credit_immo" | "credit_conso" | "autre"; capital_restant: number; mensualite: number }
export interface DonneesBudget {
  previsionnel: Partial<Record<Poste, number>>;
  patrimoine: { actifs: Actif[]; passifs: Passif[] };
  comptes_exclus?: string[]; // professional accounts, kept out of the household's accounts
}
export const DONNEES_BUDGET_VIDES: DonneesBudget = { previsionnel: {}, patrimoine: { actifs: [], passifs: [] } };

/** Bank category → household account. Savings transfers are an allocation, not a charge. */
export function posteDe(t: TxB): Poste | "epargne" {
  const l = t.libelle.toLowerCase();
  switch (t.categorie) {
    case "revenus": return /caf\b|allocation|cpam|ameli|prime d.activite|france travail|pole emploi|apl\b/.test(l) ? "aides" : /salaire|paie|remuneration|honoraires|vir .*(sarl|sas|clinique|societe)/.test(l) ? "travail" : "autres_revenus";
    case "epargne": return "epargne";
    case "carburant": case "transport": return "transport";
    case "shopping": case "loisirs": return "loisirs";
    case "frais_bancaires": return "banque";
    case "especes": case "virements": case "autre": return t.montant > 0 ? "autres_revenus" : "divers";
    default: return (t.categorie in POSTES ? t.categorie : "divers") as Poste;
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const moisDe = (d: string) => d.slice(0, 7);
const moisPrec = (m: string, n = 1) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 - n, 1)); return d.toISOString().slice(0, 7); };

export interface MoisCompte {
  mois: string; complet: boolean;
  produits: Partial<Record<Poste, number>>; charges: Partial<Record<Poste, number>>;
  total_produits: number; total_charges: number; resultat: number; epargne_versee: number; taux_epargne: number | null;
}

export interface RapportBudget {
  mois_courant: string;
  mois: MoisCompte[];                       // oldest first, the current (incomplete) month last
  moyenne: { produits: number; charges: number; resultat: number; taux_epargne: number | null; par_poste: Partial<Record<Poste, number>> };
  previsionnel: { poste: Poste; compte: string; libelle: string; prevu: number; moyenne: number; mois_courant: number; avancement: number; statut: "ok" | "attention" | "depasse" | "libre"; propose: boolean }[];
  bilan: { actifs: Actif[]; passifs: Passif[]; total_actifs: number; total_passifs: number; valeur_nette: number; liquidites: number; par_type: Record<string, number> };
  ratios: { endettement: number | null; epargne_precaution_mois: number | null; taux_epargne: number | null; reste_a_vivre: number };
  cloture: { mois: string; operations: number; a_classer: number; a_justifier: { date: string; libelle: string; montant: number }[]; pret: boolean };
  alertes: { niveau: "info" | "attention"; titre: string; detail: string }[];
}

export function rapportBudget(txs: TxB[], d: DonneesBudget, today = new Date().toISOString().slice(0, 10)): RapportBudget {
  const exclus = new Set(d.comptes_exclus ?? []);
  const ops = txs.filter((t) => !t.compte || !exclus.has(t.compte));
  const courant = moisDe(today);
  const liste = [5, 4, 3, 2, 1, 0].map((n) => moisPrec(courant, n));
  const premier = ops.reduce((m, t) => (t.date < m ? t.date : m), "9999");
  const mois: MoisCompte[] = liste.filter((m) => m >= moisDe(premier)).map((m) => {
    const produits: Partial<Record<Poste, number>> = {}, charges: Partial<Record<Poste, number>> = {};
    let epargne = 0;
    for (const t of ops.filter((x) => moisDe(x.date) === m)) {
      const p = posteDe(t);
      if (p === "epargne") { epargne -= t.montant; continue; }
      if (POSTES[p].sens === "produit") produits[p] = r2((produits[p] ?? 0) + t.montant);
      else charges[p] = r2((charges[p] ?? 0) - t.montant);
    }
    const tp = r2(Object.values(produits).reduce((s, v) => s + v!, 0)), tc = r2(Object.values(charges).reduce((s, v) => s + v!, 0));
    return { mois: m, complet: m !== courant, produits, charges, total_produits: tp, total_charges: tc, resultat: r2(tp - tc), epargne_versee: r2(epargne), taux_epargne: tp > 0 ? Math.round(((tp - tc) / tp) * 1000) / 10 : null };
  });
  const complets = mois.filter((m) => m.complet).slice(-3);
  const n = complets.length || 1;
  const par_poste: Partial<Record<Poste, number>> = {};
  for (const m of complets) for (const [p, v] of Object.entries({ ...m.charges, ...m.produits })) par_poste[p as Poste] = r2((par_poste[p as Poste] ?? 0) + v! / n);
  const moyP = r2(complets.reduce((s, m) => s + m.total_produits, 0) / n), moyC = r2(complets.reduce((s, m) => s + m.total_charges, 0) / n);
  const moyenne = { produits: moyP, charges: moyC, resultat: r2(moyP - moyC), taux_epargne: moyP > 0 ? Math.round(((moyP - moyC) / moyP) * 1000) / 10 : null, par_poste };

  // Prévisionnel: the household's own figures, otherwise a proposal (3-month average rounded up to 10 €).
  const cm = mois.find((m) => m.mois === courant);
  const [y, mo, dd] = today.split("-").map(Number);
  const prorata = Number(dd) / new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const previsionnel = CHARGES.filter((p) => (par_poste[p] ?? 0) > 0 || d.previsionnel[p] !== undefined).map((p) => {
    const propose = d.previsionnel[p] === undefined;
    const prevu = d.previsionnel[p] ?? Math.ceil((par_poste[p] ?? 0) / 10) * 10;
    const reel = cm?.charges[p] ?? 0;
    const avancement = prevu > 0 ? Math.round((reel / prevu) * 100) : 0;
    const statut: "ok" | "attention" | "depasse" | "libre" = prevu <= 0 ? "libre" : reel > prevu ? "depasse" : reel > prevu * Math.min(1, prorata + 0.15) ? "attention" : "ok";
    return { poste: p, compte: POSTES[p].compte, libelle: POSTES[p].libelle, prevu, moyenne: par_poste[p] ?? 0, mois_courant: reel, avancement, statut, propose };
  }).sort((a, b) => b.prevu - a.prevu);

  // Bilan
  const { actifs, passifs } = d.patrimoine;
  const total_actifs = r2(actifs.reduce((s, a) => s + a.valeur, 0)), total_passifs = r2(passifs.reduce((s, p) => s + p.capital_restant, 0));
  const par_type: Record<string, number> = {};
  for (const a of actifs) par_type[a.type] = r2((par_type[a.type] ?? 0) + a.valeur);
  const liquidites = r2((par_type.compte ?? 0) + (par_type.epargne ?? 0));
  const bilan = { actifs, passifs, total_actifs, total_passifs, valeur_nette: r2(total_actifs - total_passifs), liquidites, par_type };

  const mensualites = passifs.reduce((s, p) => s + p.mensualite, 0);
  const ratios = {
    endettement: moyP > 0 && mensualites > 0 ? Math.round((mensualites / moyP) * 1000) / 10 : null,
    epargne_precaution_mois: moyC > 0 && actifs.length ? Math.round((liquidites / moyC) * 10) / 10 : null,
    taux_epargne: moyenne.taux_epargne,
    reste_a_vivre: moyenne.resultat,
  };

  // Clôture of the last complete month.
  const mc = moisPrec(courant, 1);
  const opsMc = ops.filter((t) => moisDe(t.date) === mc);
  const cloture = {
    mois: mc, operations: opsMc.length,
    a_classer: opsMc.filter((t) => t.categorie === "autre").length,
    a_justifier: opsMc.filter((t) => t.montant <= -150 && ["shopping", "autre", "loisirs"].includes(String(t.categorie))).map((t) => ({ date: t.date, libelle: t.libelle, montant: t.montant })).slice(0, 5),
    pret: false,
  };
  cloture.pret = cloture.a_classer === 0 && cloture.a_justifier.length === 0;

  const alertes: RapportBudget["alertes"] = [];
  for (const p of previsionnel.filter((x) => x.statut === "depasse" && !x.propose)) alertes.push({ niveau: "attention", titre: `${p.libelle} : prévisionnel dépassé`, detail: `${Math.round(p.mois_courant)} € dépensés ce mois pour ${p.prevu} € prévus.` });
  if (ratios.endettement !== null && ratios.endettement > 35) alertes.push({ niveau: "attention", titre: `Taux d'endettement de ${ratios.endettement} %`, detail: "Au-delà de 35 % (assurance comprise), les banques refusent en général un nouveau crédit : c'est la norme du Haut Conseil de stabilité financière." });
  if (ratios.epargne_precaution_mois !== null && ratios.epargne_precaution_mois < 3) alertes.push({ niveau: "attention", titre: `Épargne de précaution : ${ratios.epargne_precaution_mois} mois de dépenses`, detail: "On conseille souvent 3 à 6 mois de dépenses disponibles sans délai, pour un coup dur." });
  const deficits = mois.filter((m) => m.complet).slice(-2).filter((m) => m.resultat < 0).length;
  if (deficits === 2) alertes.push({ niveau: "attention", titre: "Deux mois de suite en déficit", detail: "Les dépenses dépassent les revenus : regardez les postes au-dessus de leur prévisionnel." });
  if (!cloture.pret) alertes.push({ niveau: "info", titre: `Clôture de ${nomMois(mc)} à finir`, detail: `${cloture.a_classer} opération${cloture.a_classer > 1 ? "s" : ""} à classer, ${cloture.a_justifier.length} grosse${cloture.a_justifier.length > 1 ? "s" : ""} dépense${cloture.a_justifier.length > 1 ? "s" : ""} à justifier.` });

  return { mois_courant: courant, mois, moyenne, previsionnel, bilan, ratios, cloture, alertes };
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const nomMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Grand livre (CSV, séparateur « ; ») : une ligne par opération, avec le compte du foyer. */
export function grandLivre(txs: TxB[], d: Pick<DonneesBudget, "comptes_exclus">): string {
  const exclus = new Set(d.comptes_exclus ?? []);
  const lignes = ["Date;Compte;Intitulé du compte;Libellé;Débit;Crédit"];
  const csv = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  for (const t of [...txs].filter((x) => !x.compte || !exclus.has(x.compte)).sort((a, b) => a.date.localeCompare(b.date))) {
    const p = posteDe(t);
    const [compte, intitule] = p === "epargne" ? ["512", "Virements vers l'épargne"] : [POSTES[p].compte, POSTES[p].libelle];
    const v = Math.abs(t.montant).toFixed(2).replace(".", ",");
    lignes.push([t.date.split("-").reverse().join("/"), compte, csv(intitule), csv(t.libelle), t.montant < 0 ? v : "", t.montant > 0 ? v : ""].join(";"));
  }
  return lignes.join("\r\n") + "\r\n";
}

/** Demo patrimony and budget for the Martin family (fictional). */
export const DEMO_BUDGET: DonneesBudget = {
  previsionnel: { alimentation: 520, restaurants: 120, loisirs: 200, transport: 160 },
  patrimoine: {
    actifs: [
      { id: "a1", libelle: "Compte joint Crédit Agricole", type: "compte", valeur: 3840 },
      { id: "a2", libelle: "Livret A", type: "epargne", valeur: 9200 },
      { id: "a3", libelle: "Assurance-vie", type: "placement", valeur: 24500 },
      { id: "a4", libelle: "Maison, Montpellier (estimation)", type: "immobilier", valeur: 385000 },
      { id: "a5", libelle: "Peugeot 3008 (cote)", type: "vehicule", valeur: 14500 },
    ],
    passifs: [
      { id: "p1", libelle: "Crédit immobilier BNP", type: "credit_immo", capital_restant: 168400, mensualite: 1180 },
    ],
  },
};
