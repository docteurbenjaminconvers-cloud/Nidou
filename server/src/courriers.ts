/**
 * Complaint and refund letters about a paper (« Réclamation », « Remboursement »): Lucien asks why, the person tells
 * what happened, and Lucien writes the letter from the paper itself, with the addressee it reads there (name, service,
 * postal address, email) and the references quoted (letter, invoice, contract numbers). The person then sends it by
 * email (from courrier@monlucien.fr, in their name, themselves in copy) or keeps the PDF.
 */
import type { DocumentRow } from "./db.js";
import { coordonnees, dateLongue, type Lettre } from "./lettres.js";
import { provider, structured } from "./ia.js";

import { MOTIFS, type TypeCourrier } from "./courriersMotifs.js";
export { MOTIFS, type TypeCourrier };

export interface Brouillon {
  lettre: Lettre;
  emails: string[];          // addresses read in the paper, best first (the only ones Lucien sends to)
  source: string;            // the paper they were read from
  avec_ia: boolean;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SANS_REPONSE = /no-?reply|ne-?pas-?repondre|nepasrepondre|donotreply|mailer-daemon|bounce/i;

/** Every email address written in a text (lower case, no « no-reply »). */
export function emailsDuTexte(t: string | null | undefined): string[] {
  return [...new Set((t ?? "").match(EMAIL)?.map((e) => e.toLowerCase().replace(/\.$/, "")) ?? [])].filter((e) => !SANS_REPONSE.test(e));
}

const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** The letter without AI: the paper's references, the person's own words, the usual request and delay. */
export function courrierModele(o: { type: TypeCourrier; doc: DocumentRow; motif: string; explication: string; expediteur: { nom: string; adresse: string | null }; aujourdhui?: string }): Lettre {
  const d = o.doc;
  const co = coordonnees([d], d.organisme ?? d.title);
  const refs = [d.numero_contrat ? `contrat n° ${d.numero_contrat}` : null].filter(Boolean).join(" · ") || null;
  const sujet = d.title.replace(/\s+—.*$/, "");
  const explication = o.explication.trim().replace(/\s+$/, "");
  const corps = o.type === "reclamation"
    ? [
      "Madame, Monsieur,",
      `Je vous écris au sujet de votre courrier « ${sujet} »${d.montant ? `, d'un montant de ${eur(d.montant)}` : ""}. ${o.motif}.`,
      explication.endsWith(".") ? explication : `${explication}.`,
      "Je vous remercie de bien vouloir réexaminer mon dossier, de procéder à la régularisation nécessaire et de m'apporter une réponse écrite sous quinze jours à compter de la réception du présent courrier.",
      "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
    ]
    : [
      "Madame, Monsieur,",
      `Je vous écris au sujet de « ${sujet} ». ${o.motif}.`,
      explication.endsWith(".") ? explication : `${explication}.`,
      `Je vous demande en conséquence de me rembourser ${d.montant ? `la somme de ${eur(d.montant)}` : "les sommes indûment perçues"} sous trente jours, et de me confirmer par écrit la prise en compte de cette demande.`,
      "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
    ];
  return {
    expediteur: o.expediteur,
    destinataire: { nom: d.organisme ?? "Service client", adresse: co.adresse },
    date: dateLongue(o.aujourdhui ?? new Date().toISOString().slice(0, 10)),
    objet: o.type === "reclamation" ? `Contestation — ${sujet}` : `Demande de remboursement — ${sujet}`,
    reference: refs, libelleReference: "Références",
    corps, signature: o.expediteur.nom,
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    destinataire_nom: { type: "string", description: "Organisme ou société destinataire, tel qu'écrit dans le courrier reçu (ex. « Centre des Finances Publiques — Service de gestion comptable d'Uzès »)." },
    destinataire_adresse: { type: "string", description: "Adresse postale du destinataire lue dans le courrier reçu, sur plusieurs lignes (service, rue, code postal et ville). Vide si absente." },
    destinataire_email: { type: "string", description: "Adresse email du destinataire écrite dans le courrier reçu, pour répondre ou réclamer. Vide si aucune n'y figure. Ne jamais en inventer." },
    references: { type: "string", description: "Les références à rappeler, séparées par « · » (ex. « Lettre n° 53894425132 · Facture n° 15695 du 5 août 2026 · Contrat n° EA-A05297 »). Vide si aucune." },
    objet: { type: "string", description: "Objet du courrier, court (ex. « Contestation de la relance du 12 octobre 2026 — facture n° 15695 »)." },
    paragraphes: { type: "array", items: { type: "string" }, description: "Le corps du courrier, paragraphe par paragraphe : « Madame, Monsieur, », l'exposé des faits, la demande, le délai de réponse, la formule de politesse. Sans l'en-tête ni la signature." },
  },
  required: ["destinataire_nom", "destinataire_adresse", "destinataire_email", "references", "objet", "paragraphes"],
};

/**
 * The letter Lucien writes: with the AI when available (the paper's text + the person's explanation), otherwise the
 * model letter. The addressee's email is kept only if it is really written in the paper.
 */
export async function redigerCourrier(o: { type: TypeCourrier; doc: DocumentRow; motif: string; explication: string; expediteur: { nom: string; adresse: string | null }; ia: boolean }): Promise<Brouillon> {
  const base = courrierModele(o);
  const lus = emailsDuTexte(o.doc.texte);
  const source = o.doc.title;
  if (!o.ia || !provider()) return { lettre: base, emails: lus, source, avec_ia: false };
  try {
    const { data } = await structured({
      tier: "rapide",
      system: "Tu rédiges, en français, des courriers de particuliers à des administrations et des entreprises : contestation, réclamation, demande de remboursement. Ton courtois, ferme et précis. Tu t'appuies uniquement sur le courrier reçu et sur ce que la personne explique : n'invente aucun fait, aucune date, aucun montant, aucune adresse. Cite les références utiles (numéros de lettre, de facture, de contrat, de dossier). Cite un texte de loi ou un médiateur seulement si c'est certain et utile.",
      content: [{ type: "text", text: [
        `Type de courrier : ${o.type === "reclamation" ? "réclamation / contestation" : "demande de remboursement"}`,
        `Motif choisi : ${o.motif}`,
        `Ce que la personne explique : ${o.explication}`,
        `Expéditeur : ${o.expediteur.nom}`,
        `Date du jour : ${base.date}`,
        `Courrier reçu — titre : ${o.doc.title}; organisme : ${o.doc.organisme ?? "?"}; montant : ${o.doc.montant ?? "?"}; n° de contrat : ${o.doc.numero_contrat ?? "?"}; date : ${o.doc.date_document ?? "?"}`,
        `Résumé : ${o.doc.resume ?? ""}`,
        `Texte du courrier reçu :\n${(o.doc.texte ?? "").slice(0, 12000)}`,
      ].join("\n") }],
      tool: { name: "courrier", description: "Le courrier rédigé et le destinataire lu dans le courrier reçu.", schema: SCHEMA },
      maxTokens: 1800,
    });
    const r = data as { destinataire_nom?: string; destinataire_adresse?: string; destinataire_email?: string; references?: string; objet?: string; paragraphes?: string[] };
    const paragraphes = (r.paragraphes ?? []).map((p) => p.trim()).filter(Boolean);
    if (paragraphes.length < 2) return { lettre: base, emails: lus, source, avec_ia: false };
    const email = (r.destinataire_email ?? "").trim().toLowerCase();
    const emails = email && lus.includes(email) ? [email, ...lus.filter((e) => e !== email)] : lus;
    return {
      lettre: {
        ...base,
        destinataire: { nom: r.destinataire_nom?.trim() || base.destinataire.nom, adresse: r.destinataire_adresse?.trim() || base.destinataire.adresse },
        objet: r.objet?.trim() || base.objet,
        reference: r.references?.trim() || base.reference,
        corps: paragraphes,
      },
      emails, source, avec_ia: true,
    };
  } catch {
    return { lettre: base, emails: lus, source, avec_ia: false };
  }
}
