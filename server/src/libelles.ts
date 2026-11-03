/** Reading bank labels: pure functions, shared by the server and the app. */

const NOISE = /\b(CB|CARTE|PAIEMENT|PRLV|PRELEVEMENT|PRELEVT|SEPA|VIR|VIREMENT|INST|FACTURE|ECHEANCE|DU|LE|REF|FR\d{2}[A-Z0-9]*|\d{2}\/\d{2}(?:\/\d{2,4})?|\d{6,}|X{3,}\d*|N°?\d+)\b/gi;

/**
 * What a bank label says, read from the formats French banks use (BNP shown here):
 *  - « PRLV SEPA [B2B] SAUR ECH/011026 ID EMETTEUR/… MDT/… REF/… LIB/FACTURE SAUR »
 *  - « FACTURE CARTE DU 011026 LEGALSTART.FR/B CARTE 4974XXXXXXXX5420 FRA 16,80EUR »
 *  - « VIR SEPA INST EMIS /MOTIF APPORT SAS /BEN SAS CENTRE ESTHETIQUE ECUSSON /REFDO … /REF NOTPROVIDED »
 *  - « VIR SEPA RECU /DE M DUPONT /MOTIF LOYER », « ECHEANCE PRET 00640 61066114 »
 */
export type GenreOperation = "prelevement" | "carte" | "virement_emis" | "virement_recu" | "pret" | "autre";
export interface LectureLibelle { genre: GenreOperation; nom: string; motif: string | null }
const champ = (s: string, nom: string) => new RegExp(`/${nom}\\s+([^/]+?)\\s*(?:/|$)`).exec(s)?.[1]?.trim() || null;
export function lireLibelle(libelle: string): LectureLibelle {
  const s = libelle.toUpperCase().replace(/\s+/g, " ").trim();
  if (/^ECHEANCE PRET\b/.test(s)) return { genre: "pret", nom: "Échéance de prêt", motif: null };
  if (/^VIR(EMENT)?\b/.test(s) && /\/(BEN|DE)\s/.test(s)) {
    const emis = /\bEMIS\b|\/BEN\s/.test(s) && !/\bRECU\b/.test(s);
    const motif = champ(s, "MOTIF");
    return { genre: emis ? "virement_emis" : "virement_recu", nom: champ(s, emis ? "BEN" : "DE") ?? "", motif: motif && motif !== "NOTPROVIDED" ? motif : null };
  }
  const carte = /^(?:FACTURE CARTE|CARTE|CB|PAIEMENT CB)(?: DU)?(?: \d{4,8})? (.+?)(?: CARTE \d{4}X+\d{2,4}.*)?$/.exec(s);
  if (carte && /^(FACTURE CARTE|CB|PAIEMENT CB)/.test(s)) return { genre: "carte", nom: carte[1].replace(/\/[A-Z]{1,2}$/, "").replace(/\s+\d{2}\/\d{2}.*$/, "").trim(), motif: null };
  const coupe = s.replace(/(\S)\s+(?:ECH|ID EMETTEUR|IDEMETTEUR|EMETTEUR|MDT|RUM|ICS|REF|REFDO|LIB|MOTIF|NUM|NOTPROVIDED)\s*\/.*$/, "$1");
  if (/^(PRLV|PRELEVEMENT|PRELEVT)\b/.test(s)) {
    const nom = coupe.replace(/^(PRLV|PRELEVEMENT|PRELEVT)( SEPA)?( B2B| CORE)?\s*/, "").trim();
    // the creditor's own wording (« LIB/TVA1-082026-3310CA3 » → « TVA »), when it adds something to the name
    const lib = /\bLIB\/(.+?)(?:\s+[A-Z]{2,}\/.*)?$/.exec(s)?.[1] ?? "";
    const dejaDit = new Set(nom.split(/[\s-]+/));
    const mots = lib.split(/[\s,]+/).map((w) => /^[A-Z]{3,}/.exec(w)?.[0] ?? "").filter((w) => w && !dejaDit.has(w) && !["FACTURE", "ECHEANCE", "REF", "CLIENT", "CONTRAT", "NUMERO"].includes(w));
    return { genre: "prelevement", nom, motif: mots.length ? mots.slice(0, 4).join(" ") : null };
  }
  return { genre: "autre", nom: coupe, motif: null };
}

const casse = (x: string) => x.toLowerCase().replace(/(^|[\s'(-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(Sas|Sasu|Sarl|Eurl|Sci|Sa|Scm|Bnp|Edf|Sncf|Tva|Urssaf|Dgfip|Cic|Cm)\b/g, (m) => m.toUpperCase());

/** The label as a person would write it: « Prélèvement Saur », « Carte Legalstart.fr », « Virement à SAS Centre Esthetique Ecusson · Apport SAS ». */
export function libelleLisible(libelle: string): string {
  const l = lireLibelle(libelle);
  const nom = casse(l.nom.replace(/\s+\d[\d\s]*$/, "").replace(/\s+-?\s*/g, " ").split(" ").filter((w, i, a) => w.replace(/^-/, "") !== a[i - 1]?.replace(/^-/, "")).join(" ").replace(/ -(\S)/g, " $1")) || libelle;
  const motif = l.motif ? ` · ${casse(l.motif)}` : "";
  switch (l.genre) {
    case "prelevement": return `Prélèvement ${nom}${motif}`;
    case "carte": return `Carte ${nom}`;
    case "virement_emis": return `Virement à ${nom}${motif}`;
    case "virement_recu": return `Virement de ${nom}${motif}`;
    case "pret": return "Échéance de prêt";
    default: return casse(l.nom.replace(/^VIR(EMENT)?( SEPA)?( RECU| EMIS)?\s+/, "Virement ").replace(/^PRLV\s+/, "Prélèvement "));
  }
}

/** "CB CARREFOUR MARKET 11/10 MONTPELLIER" → "carrefour market" */
export function merchantOf(libelle: string): string {
  const l = lireLibelle(libelle);
  if (l.genre === "pret") return "echeance de pret";
  let s = (l.nom || libelle).toUpperCase();
  s = s.replace(/[*#_.:,'"]/g, " ").replace(NOISE, " ").replace(/[\/\\-]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\b(SAS|SARL|SA|SASU|EURL|FRANCE|FR|PARIS|LYON|MONTPELLIER|MARSEILLE|TOULOUSE|NANTES|BORDEAUX|LILLE|UZES|NIMES)\b/g, " ").replace(/\s+/g, " ").trim();
  // « ORANGE -ORANGE » → « ORANGE »: a name repeated by the bank; single letters (« LEGALSTART.FR/B ») dropped
  const mots = s.split(" ").filter((w, i, a) => w && w !== a[i - 1] && (w.length > 1 || a.length === 1));
  return (mots.slice(0, 3).join(" ") || libelle.slice(0, 40)).toLowerCase();
}

