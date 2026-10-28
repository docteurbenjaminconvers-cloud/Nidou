import type { DocumentRow } from "./db.js";

export interface DeadlineDraft {
  titre: string;
  type: "echeance" | "resiliation" | "renouvellement" | "expiration" | "garantie" | "sante" | "declaration";
  date: string;
  rappel_jours: number;
  note: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Derives the deadlines a household should be reminded of from one document.
 * Rules are deliberately simple and explainable; every reminder names why it exists.
 */
export function deadlinesFor(doc: DocumentRow, today = new Date().toISOString().slice(0, 10)): DeadlineDraft[] {
  const out: DeadlineDraft[] = [];
  const org = doc.organisme ? ` (${doc.organisme})` : "";

  // Rolling contracts (insurance, energy, telecom, subscriptions): yearly renewal + notice window.
  const rolling: Set<string> = new Set(["assurance", "energie", "telecom", "abonnement", "logement", "banque"]);
  // Without a known end date, only insurance is assumed to renew yearly; contracts with no notice
  // period (cancel-anytime subscriptions) get no reminder — they are handled by the charges report.
  const tacit = Boolean(doc.date_fin) || doc.category === "assurance";
  if (rolling.has(doc.category) && doc.periodicite && doc.periodicite !== "unique" && tacit && doc.preavis_jours !== 0) {
    let renewal = doc.date_fin ?? (doc.date_debut ? addYears(doc.date_debut, 1) : null);
    // Roll forward to the next renewal after today.
    while (renewal && renewal < today) renewal = addYears(renewal, 1);
    if (renewal) {
      const preavis = doc.preavis_jours ?? (doc.category === "assurance" ? 60 : 30);
      const limite = addDays(renewal, -preavis);
      if (limite >= today) {
        out.push({
          titre: `Dernier jour pour résilier : ${doc.title}`,
          type: "resiliation",
          date: limite,
          rappel_jours: 14,
          note: `Préavis de ${preavis} jours avant le renouvellement du ${renewal}${org}. Au-delà, le contrat se renouvelle automatiquement.`,
        });
      }
      out.push({
        titre: `Renouvellement : ${doc.title}`,
        type: "renouvellement",
        date: renewal,
        rappel_jours: 7,
        note: `Comparer le tarif avant reconduction${org}.`,
      });
    }
  }

  // One-off invoices with a due date in the future.
  const payable = !["identite", "garantie", "sante", "vehicule", "education"].includes(doc.category);
  if (payable && doc.periodicite === "unique" && doc.date_fin && doc.date_fin >= today && doc.montant) {
    out.push({
      titre: `Paiement : ${doc.title}`,
      type: "echeance",
      date: doc.date_fin,
      rappel_jours: 5,
      note: `${doc.montant.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} € à régler${org}.`,
    });
  }

  // Fixed-term: identity papers, warranties, vehicle papers, education, health follow-ups, one-off dates.
  if (doc.date_fin && !rolling.has(doc.category)) {
    const type: DeadlineDraft["type"] =
      doc.category === "identite" ? "expiration"
        : doc.category === "garantie" ? "garantie"
          : doc.category === "sante" ? "sante"
            : doc.category === "impots" ? "declaration"
              : "echeance";
    const lead = type === "expiration" ? 90 : type === "garantie" ? 30 : 14;
    if (doc.date_fin >= today) {
      out.push({
        titre: `${labelFor(type)} : ${doc.title}`,
        type,
        date: doc.date_fin,
        rappel_jours: lead,
        note: noteFor(type, doc),
      });
    }
  }

  // Warranty bought without an explicit end date: assume 2 years legal conformity warranty in the EU.
  if (doc.category === "garantie" && !doc.date_fin && doc.date_document) {
    const fin = addYears(doc.date_document, 2);
    if (fin >= today) {
      out.push({
        titre: `Fin de garantie légale : ${doc.title}`,
        type: "garantie",
        date: fin,
        rappel_jours: 30,
        note: "Garantie légale de conformité de 2 ans à compter de l'achat. Vérifier la facture pour une extension.",
      });
    }
  }

  // One reminder per date for a given document
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = d.date;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function labelFor(type: DeadlineDraft["type"]): string {
  switch (type) {
    case "expiration": return "Expiration";
    case "garantie": return "Fin de garantie";
    case "sante": return "Suivi santé";
    case "declaration": return "Déclaration";
    default: return "Échéance";
  }
}

function noteFor(type: DeadlineDraft["type"], doc: DocumentRow): string | null {
  switch (type) {
    case "expiration": return "Prévoir le renouvellement : les délais en mairie ou préfecture peuvent dépasser 2 mois.";
    case "garantie": return "Dernier jour pour faire jouer la garantie.";
    case "sante": return doc.resume ?? null;
    case "declaration": return "Date limite indiquée sur le document.";
    default: return doc.resume ?? null;
  }
}
