import { provider, text } from "./ia.js";
function fmtDate(iso) {
    if (!iso)
        return "";
    return new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
export function templateLetter({ kind, doc, expediteur, motif }) {
    const today = fmtDate(new Date().toISOString().slice(0, 10));
    const ref = doc.numero_contrat ? `Référence : contrat n° ${doc.numero_contrat}\n` : "";
    const head = `${expediteur.nom}\n${expediteur.adresse ?? ""}\n\n${doc.organisme ?? "Service client"}\n\nLe ${today}\n\n${ref}`;
    switch (kind) {
        case "resiliation":
            return `${head}Objet : Résiliation de mon contrat — ${doc.title}\n\nMadame, Monsieur,\n\nPar la présente, je vous informe de ma décision de résilier le contrat référencé ci-dessus${motif ? `, ${motif}` : ""}.\n\nConformément aux conditions générales et aux dispositions légales applicables, je vous remercie de prendre en compte cette résiliation à la date la plus proche possible${doc.date_fin ? `, et au plus tard à l'échéance du ${fmtDate(doc.date_fin)}` : ""}, et de m'adresser une confirmation écrite précisant la date effective de fin de contrat.\n\nJe vous demande également de cesser tout prélèvement à compter de cette date et de me rembourser, le cas échéant, les sommes perçues au-delà.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n${expediteur.nom}`;
        case "reclamation":
            return `${head}Objet : Réclamation — ${doc.title}\n\nMadame, Monsieur,\n\nJe me permets de vous contacter au sujet du contrat référencé ci-dessus. ${motif ?? "Je constate une anomalie que je vous demande de corriger."}\n\nJe vous remercie de bien vouloir examiner ma demande et de m'apporter une réponse écrite sous 15 jours. À défaut de réponse satisfaisante, je me réserve la possibilité de saisir le médiateur compétent.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n${expediteur.nom}`;
        case "remboursement":
            return `${head}Objet : Demande de remboursement — ${doc.title}\n\nMadame, Monsieur,\n\n${motif ?? "Je vous demande le remboursement des sommes indûment perçues au titre du contrat référencé ci-dessus."}${doc.montant ? ` Le montant concerné s'élève à ${doc.montant.toFixed(2)} €.` : ""}\n\nJe vous remercie de procéder à ce remboursement sous 30 jours et de me confirmer par écrit sa prise en compte.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n${expediteur.nom}`;
    }
}
/** Letter generation: the fast model polishes the template when a provider is configured, otherwise the template. */
export async function generateLetter(input) {
    const base = templateLetter(input);
    if (!provider())
        return base;
    try {
        const out = await text({
            tier: "rapide",
            system: "Tu rédiges des courriers administratifs en français pour un particulier. Ton formel, clair, sans jargon inutile, avec les mentions légales utiles (droit de résiliation, délais). Ne mets jamais de données que tu n'as pas. Réponds uniquement avec le courrier, prêt à envoyer.",
            prompt: `Améliore ce courrier sans changer les faits. Document concerné : ${JSON.stringify({
                title: input.doc.title, organisme: input.doc.organisme, numero_contrat: input.doc.numero_contrat, montant: input.doc.montant,
                periodicite: input.doc.periodicite, date_fin: input.doc.date_fin, preavis_jours: input.doc.preavis_jours, category: input.doc.category,
            })}\nMotif donné par l'utilisateur : ${input.motif ?? "(aucun)"}\n\nCourrier :\n${base}`,
        });
        return out.trim() || base;
    }
    catch {
        return base;
    }
}
