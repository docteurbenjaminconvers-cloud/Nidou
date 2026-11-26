import { dateLongue } from "./lettres.js";
export const DELAI_REPONSE = 15; // days Lucien waits before offering the next step
/** Who to turn to when the organisation does not answer, by kind of paper (official routes, checked Nov. 2026). */
export function mediateurPour(category) {
    switch (category) {
        case "energie": return { nom: "Médiateur national de l'énergie", dans_lettre: "le Médiateur national de l'énergie", site: "https://www.energie-mediateur.fr", attente_jours: 60, conditions: "Gratuit. Vous pouvez le saisir deux mois après votre réclamation écrite restée sans réponse (ou si la réponse ne vous convient pas), et au plus tard un an après cette réclamation. Joignez la copie de vos courriers et la facture." };
        case "telecom": return { nom: "Médiateur des communications électroniques", dans_lettre: "le Médiateur des communications électroniques", site: "https://www.mediation-telecom.org", attente_jours: 60, conditions: "Gratuit. Après une réclamation écrite au service clients, puis au service consommateurs, restées un mois sans réponse satisfaisante ; ou directement si le service clients n'a pas répondu en deux mois. Au plus tard un an après votre première réclamation écrite." };
        case "assurance": return { nom: "La Médiation de l'Assurance", dans_lettre: "la Médiation de l'Assurance", site: "https://www.mediation-assurance.org", attente_jours: 60, conditions: "Gratuit. Vous pouvez la saisir deux mois après votre première réclamation écrite, que l'assureur ait répondu ou non, et au plus tard un an après. Certaines mutuelles ont leur propre médiateur : il est indiqué dans votre contrat." };
        case "banque": return { nom: "Le médiateur de votre banque", dans_lettre: "le médiateur de votre établissement", site: null, attente_jours: 60, conditions: "Gratuit. Chaque banque a son médiateur : son nom et son adresse figurent sur vos relevés, dans votre convention de compte et sur le site de la banque. Vous pouvez le saisir deux mois après votre réclamation écrite, et au plus tard un an après." };
        case "impots": return { nom: "Conciliateur fiscal départemental", dans_lettre: "le conciliateur fiscal départemental", site: "https://www.impots.gouv.fr/particulier/le-conciliateur-departemental", attente_jours: null, conditions: "Gratuit. Il se saisit quand le service des impôts a rejeté votre réclamation ou n'y a fait droit qu'en partie ; il s'engage à répondre sous 30 jours. Ensuite seulement, le Médiateur des ministères économiques et financiers. Attention : les sommes réclamées restent dues pendant ces démarches." };
        default: return { nom: "Le médiateur de la consommation du professionnel", dans_lettre: "le médiateur de la consommation dont vous relevez", site: "https://www.economie.gouv.fr/mediation-conso", attente_jours: null, conditions: "Gratuit. Tout professionnel doit indiquer son médiateur (conditions générales, contrat, site internet, facture). Il se saisit après une réclamation écrite restée sans suite, au plus tard un an après. Pour un service public ou une administration : le Défenseur des droits (defenseurdesdroits.fr)." };
    }
}
const jour = (iso) => iso.slice(0, 10);
const plus = (iso, n) => new Date(Date.parse(jour(iso) + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
const ecart = (a, b) => Math.round((Date.parse(jour(b) + "T00:00:00Z") - Date.parse(jour(a) + "T00:00:00Z")) / 86400_000);
/** Where one paper's letters stand. */
export function etatSuivi(doc, envois, repondu_le, aujourdhui) {
    const dernier = envois[envois.length - 1];
    const depuis = ecart(dernier.envoye_le, aujourdhui);
    const med = mediateurPour(doc.category);
    const statut = repondu_le ? "repondu" : depuis < DELAI_REPONSE ? "attente" : envois.length === 1 ? "relancer" : "mediateur";
    return {
        document_id: doc.id, titre: doc.title, organisme: doc.organisme, envois, statut, depuis_jours: depuis,
        prochaine_etape_le: plus(dernier.envoye_le, DELAI_REPONSE), repondu_le, mediateur: med,
        mediateur_des_le: med.attente_jours ? plus(envois[0].envoye_le, med.attente_jours) : null,
    };
}
/** Every letter of the household that is being followed (résiliations have their own follow-up). */
export function suivisCourriers(db, householdId, aujourdhui = new Date().toISOString().slice(0, 10)) {
    const lignes = db.raw.prepare("SELECT id, cle, destinataire, objet, envoye_le FROM lettres_envoyees WHERE household_id = ? AND cle LIKE 'doc:%' ORDER BY envoye_le").all(householdId);
    const repondus = new Map(db.raw.prepare("SELECT cle, repondu_le FROM courrier_suivis WHERE household_id = ?").all(householdId).map((r) => [r.cle, r.repondu_le]));
    const docs = new Map(db.listDocuments(householdId).map((d) => [d.id, d]));
    const par = new Map();
    for (const { cle, ...e } of lignes)
        par.set(cle, [...(par.get(cle) ?? []), e]);
    const ordre = { relancer: 0, mediateur: 0, attente: 1, repondu: 2 };
    return [...par].flatMap(([cle, envois]) => {
        const doc = docs.get(cle.slice(4));
        return doc ? [etatSuivi(doc, envois, repondus.get(cle) ?? null, aujourdhui)] : [];
    }).sort((a, b) => ordre[a.statut] - ordre[b.statut] || b.envois[b.envois.length - 1].envoye_le.localeCompare(a.envois[a.envois.length - 1].envoye_le));
}
/** The agenda line that waits for the answer: one per paper, moved at each new letter, ticked when answered. */
export function poserAttente(db, householdId, doc, envoyeLe, relance) {
    db.raw.prepare("DELETE FROM deadlines WHERE household_id = ? AND document_id = ? AND type = 'courrier' AND fait = 0").run(householdId, doc.id);
    db.insertDeadline({
        household_id: householdId, document_id: doc.id, type: "courrier", date: plus(envoyeLe, DELAI_REPONSE), rappel_jours: 0,
        titre: `Réponse attendue de ${doc.organisme ?? doc.title}`.slice(0, 120),
        note: relance ? "Relance envoyée. Toujours rien à cette date ? Ouvrez le papier : Lucien vous indique le médiateur à saisir." : "Courrier envoyé. Pas de réponse à cette date ? Ouvrez le papier : Lucien a préparé la relance.",
    });
    db.raw.prepare("DELETE FROM courrier_suivis WHERE household_id = ? AND cle = ?").run(householdId, `doc:${doc.id}`); // a new letter reopens the wait
}
export function marquerRepondu(db, householdId, documentId, repondu, quand = new Date().toISOString()) {
    const cle = `doc:${documentId}`;
    if (repondu) {
        db.raw.prepare("INSERT INTO courrier_suivis (household_id, cle, repondu_le) VALUES (?, ?, ?) ON CONFLICT(household_id, cle) DO UPDATE SET repondu_le = excluded.repondu_le").run(householdId, cle, quand);
        db.raw.prepare("UPDATE deadlines SET fait = 1 WHERE household_id = ? AND document_id = ? AND type = 'courrier'").run(householdId, documentId);
    }
    else {
        db.raw.prepare("DELETE FROM courrier_suivis WHERE household_id = ? AND cle = ?").run(householdId, cle);
    }
}
/** The reminder letter: the first one recalled by its date, a firm delay, the mediator named as the next step. */
export function courrierRelance(o) {
    const p = o.premiere;
    const objet = p.objet.replace(/^(Relance\s*[—-]\s*)+/i, "");
    return {
        expediteur: p.expediteur, destinataire: p.destinataire,
        date: dateLongue(o.aujourdhui ?? new Date().toISOString().slice(0, 10)),
        objet: `Relance — ${objet}`.slice(0, 200), reference: p.reference, libelleReference: "Références",
        corps: [
            "Madame, Monsieur,",
            `Par courrier du ${dateLongue(jour(o.envoyee_le))}, ayant pour objet « ${objet} », je vous ai écrit. Sauf erreur de ma part, ce courrier est resté sans réponse à ce jour.`,
            "Je vous renouvelle donc ma demande et vous remercie de bien vouloir y répondre par écrit sous quinze jours à compter de la réception du présent courrier.",
            `À défaut de réponse dans ce délai, je saisirai ${o.mediateur.dans_lettre}, en joignant la copie de mes courriers.`,
            "Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
        ],
        signature: p.expediteur.nom,
    };
}
