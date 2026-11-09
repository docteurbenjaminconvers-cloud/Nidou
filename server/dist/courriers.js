import { coordonnees, dateLongue } from "./lettres.js";
import { provider, structured } from "./ia.js";
import { MOTIFS } from "./courriersMotifs.js";
export { MOTIFS };
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SANS_REPONSE = /no-?reply|ne-?pas-?repondre|nepasrepondre|donotreply|mailer-daemon|bounce/i;
/** Every email address written in a text (lower case, no « no-reply »). */
export function emailsDuTexte(t) {
    return [...new Set((t ?? "").match(EMAIL)?.map((e) => e.toLowerCase().replace(/\.$/, "")) ?? [])].filter((e) => !SANS_REPONSE.test(e));
}
const eur = (n) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
/** The letter without AI: the paper's references, the person's own words, the usual request and delay. */
export function courrierModele(o) {
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
export const LISIBLE_PAR_IA = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/;
const EMAIL_SEUL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
/**
 * `fichier`: the paper itself (photo or PDF) when its text was not kept at upload — the AI then reads the addressee,
 * the email and the references on the page, as one would. An email read this way is kept (it is the household's own
 * paper), and the caller records it so that Lucien may send to it.
 */
export async function redigerCourrier(o) {
    const base = courrierModele(o);
    const lus = emailsDuTexte(o.doc.texte);
    const source = o.doc.title;
    if (!o.ia || !provider())
        return { lettre: base, emails: lus, source, avec_ia: false };
    try {
        const { data } = await structured({
            tier: o.fichier ? "precis" : "rapide",
            system: "Tu rédiges, en français, des courriers de particuliers à des administrations et des entreprises : contestation, réclamation, demande de remboursement. Ton courtois, ferme et précis. Tu t'appuies uniquement sur le courrier reçu et sur ce que la personne explique : n'invente aucun fait, aucune date, aucun montant, aucune adresse. Cite les références utiles (numéros de lettre, de facture, de contrat, de dossier). Cite un texte de loi ou un médiateur seulement si c'est certain et utile.",
            content: [...(o.fichier ? [o.fichier.mime === "application/pdf" ? { type: "pdf", base64: o.fichier.base64 } : { type: "image", mime: o.fichier.mime, base64: o.fichier.base64 }] : []), { type: "text", text: [
                        `Type de courrier : ${o.type === "reclamation" ? "réclamation / contestation" : "demande de remboursement"}`,
                        `Motif choisi : ${o.motif}`,
                        `Ce que la personne explique : ${o.explication}`,
                        `Expéditeur : ${o.expediteur.nom}`,
                        `Date du jour : ${base.date}`,
                        `Courrier reçu — titre : ${o.doc.title}; organisme : ${o.doc.organisme ?? "?"}; montant : ${o.doc.montant ?? "?"}; n° de contrat : ${o.doc.numero_contrat ?? "?"}; date : ${o.doc.date_document ?? "?"}`,
                        `Résumé : ${o.doc.resume ?? ""}`,
                        ...(o.doc.details ? [`Coordonnées et références déjà lues sur ce courrier (JSON) : ${o.doc.details}`] : []),
                        o.doc.texte ? `Texte du courrier reçu :\n${o.doc.texte.slice(0, 12000)}` : "Le courrier reçu est joint (photo ou PDF) : lis-y le destinataire, son adresse postale, son adresse email (souvent après « Mél », « Courriel » ou « Email ») et les références.",
                    ].join("\n") }],
            tool: { name: "courrier", description: "Le courrier rédigé et le destinataire lu dans le courrier reçu.", schema: SCHEMA },
            maxTokens: 1800,
        });
        const r = data;
        const paragraphes = (r.paragraphes ?? []).map((p) => p.trim()).filter(Boolean);
        if (paragraphes.length < 2)
            return { lettre: base, emails: lus, source, avec_ia: false };
        const email = (r.destinataire_email ?? "").trim().toLowerCase().replace(/\s+/g, "");
        // from the text: only an address really written there; from the page itself: the address the AI read on it
        const fiable = EMAIL_SEUL.test(email) && !SANS_REPONSE.test(email) && (lus.includes(email) || !!o.fichier);
        const emails = fiable ? [email, ...lus.filter((e) => e !== email)] : lus;
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
    }
    catch {
        return { lettre: base, emails: lus, source, avec_ia: false };
    }
}
