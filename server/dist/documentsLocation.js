/**
 * Bail d'habitation et état des lieux, préparés depuis le Patrimoine locatif puis signés en ligne.
 * Pure (no Node API): the server builds the PDF from it, the app shows the same text before signing, and the demo
 * works without a server.
 *
 * Bail : structure du contrat type du décret n° 2015-587 du 29 mai 2015 (loi n° 89-462 du 6 juillet 1989), location
 * nue ou meublée à usage de résidence principale. Le texte reste un modèle à relire : Lucien le pré-remplit, le
 * bailleur vérifie et complète, puis les deux parties signent.
 * État des lieux : pièce par pièce (décret n° 2016-382 du 30 mars 2016), avec relevés de compteurs, clés et, pour un
 * meublé, l'inventaire du mobilier minimal (décret n° 2015-981 du 31 juillet 2015).
 */
const r2 = (n) => Math.round(n * 100) / 100;
export const eurTxt = (n) => `${r2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ")} €`;
export const dateTxt = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso))
        return iso || "—";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][m - 1];
    return `${d === 1 ? "1er" : d} ${mois} ${y}`;
};
const TRIMESTRE = ["", "1er", "2e", "3e", "4e"];
const dureeTxt = (mois) => (mois % 12 === 0 ? `${mois / 12} an${mois > 12 ? "s" : ""}` : `${mois} mois`);
/** Legal ceilings and checks shown before signing (never blocking: the landlord decides). */
export function controlesBail(d) {
    const a = [];
    const plafond = d.meuble ? 2 : 1;
    if (d.depot_garantie > r2(d.loyer_hc * plafond) + 0.01)
        a.push(`Dépôt de garantie au-dessus du plafond légal : ${plafond} mois de loyer hors charges en location ${d.meuble ? "meublée" : "nue"}, soit ${eurTxt(d.loyer_hc * plafond)} au plus.`);
    if (!d.meuble && d.charges_mode === "forfait")
        a.push("En location nue, les charges se paient par provisions avec régularisation annuelle : le forfait est réservé au meublé et à la colocation.");
    const dureeMin = d.meuble ? (d.etudiant ? 9 : 12) : d.bailleur.qualite === "personne_morale" ? 72 : 36;
    if (d.duree_mois < dureeMin)
        a.push(`Durée trop courte : ${dureeTxt(dureeMin)} au minimum pour ce bail.`);
    if ((d.logement.dpe ?? "").toUpperCase() === "G")
        a.push("Logement classé G au DPE : depuis le 1er janvier 2025, il n'est plus considéré comme décent pour un nouveau bail. Des travaux sont nécessaires avant de le louer.");
    if (!d.logement.surface)
        a.push("Indiquez la surface habitable : elle doit figurer au bail.");
    if (!d.locataires.length || d.locataires.some((l) => !l.nom.trim()))
        a.push("Indiquez le nom de chaque locataire.");
    if (d.encadrement?.loyer_reference_majore && d.loyer_hc > d.encadrement.loyer_reference_majore + (d.encadrement.complement ?? 0) + 0.01)
        a.push("Loyer au-dessus du loyer de référence majoré : seul un complément de loyer justifié peut le dépasser.");
    return a;
}
/** The lease, section by section, in the order of the official model contract. */
export function contenuBail(d) {
    const L = d.logement;
    const noms = d.locataires.map((l) => l.nom).filter(Boolean);
    const qualite = { personne_physique: "personne physique", sci_familiale: "société civile immobilière familiale", personne_morale: "personne morale" }[d.bailleur.qualite];
    const sections = [];
    sections.push({ titre: "I. Désignation des parties", paragraphes: [
            `Le présent contrat est conclu entre les soussignés :`,
            `${d.bailleur.nom}, ${qualite}, demeurant ${d.bailleur.adresse || "[adresse du bailleur]"}${d.bailleur.email ? `, ${d.bailleur.email}` : ""}, désigné ci-après « le bailleur » ;`,
            `${noms.length ? noms.join(", ") : "[nom du locataire]"}, désigné${noms.length > 1 ? "s" : ""} ci-après « le locataire »${noms.length > 1 ? " (ensemble « les locataires »)" : ""}.`,
        ] });
    sections.push({ titre: "II. Objet du contrat", paragraphes: [
            `Le présent contrat a pour objet la location d'un logement ${d.meuble ? "meublé" : "non meublé"} ainsi déterminé :`,
            `Adresse : ${L.adresse}${L.etage ? `, ${L.etage}` : ""}.`,
            `Type d'habitat : ${L.regime_juridique === "copropriete" ? "immeuble collectif en copropriété" : "immeuble en monopropriété"}${L.periode_construction ? `, construit ${L.periode_construction}` : ""} ; ${L.type}${L.pieces ? `, ${L.pieces} pièce${L.pieces > 1 ? "s" : ""} principale${L.pieces > 1 ? "s" : ""}` : ""}.`,
            `Surface habitable : ${L.surface ? `${L.surface} m²` : "[à compléter]"}.`,
            ...(L.equipements ? [`Équipements du logement : ${L.equipements}.`] : []),
            ...(L.annexes_privatives ? [`Locaux et équipements accessoires à usage privatif : ${L.annexes_privatives}.`] : []),
            `Chauffage ${L.chauffage} ; production d'eau chaude ${L.eau_chaude === "individuelle" ? "individuelle" : "collective"}.`,
            `Destination des locaux : usage exclusif d'habitation, à titre de résidence principale du locataire.`,
        ] });
    const finIso = (() => { const x = new Date(`${d.debut}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + d.duree_mois); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); })();
    sections.push({ titre: "III. Date de prise d'effet et durée du contrat", paragraphes: [
            `Le contrat prend effet le ${dateTxt(d.debut)}, pour une durée de ${dureeTxt(d.duree_mois)}, soit jusqu'au ${dateTxt(finIso)}.`,
            d.meuble && d.etudiant
                ? "Ce bail est consenti à un étudiant pour une durée de neuf mois ; il n'est pas reconduit tacitement à son terme."
                : `À défaut de congé donné dans les conditions de la loi, il est reconduit tacitement ou renouvelé pour une durée ${d.meuble ? "d'un an" : `de ${dureeTxt(d.duree_mois)}`}.`,
            `Le locataire peut donner congé à tout moment, par lettre recommandée avec accusé de réception, acte de commissaire de justice ou remise en main propre contre émargement, en respectant un préavis ${d.meuble ? "d'un mois" : "de trois mois, réduit à un mois dans les cas prévus par la loi (notamment logement situé en zone tendue)"}. Le bailleur ne peut donner congé que pour le terme du bail, pour vendre, reprendre le logement pour l'habiter ou pour un motif légitime et sérieux, avec un préavis ${d.meuble ? "de trois mois" : "de six mois"}.`,
        ] });
    const fin = [
        `Le loyer mensuel est fixé à ${eurTxt(d.loyer_hc)} hors charges.`,
    ];
    if (d.encadrement) {
        const e = d.encadrement;
        fin.push(`Le logement est situé dans une commune où les loyers sont encadrés : loyer de référence ${e.loyer_reference != null ? `${eurTxt(e.loyer_reference)} par mois` : "[à compléter]"}, loyer de référence majoré ${e.loyer_reference_majore != null ? `${eurTxt(e.loyer_reference_majore)} par mois` : "[à compléter]"}${e.complement ? `, complément de loyer de ${eurTxt(e.complement)} justifié par : ${e.complement_motif || "[caractéristiques à préciser]"}` : ""}.`);
    }
    if (d.dernier_loyer_precedent)
        fin.push(`Montant du dernier loyer acquitté par le précédent locataire : ${eurTxt(d.dernier_loyer_precedent.montant)}, versé le ${dateTxt(d.dernier_loyer_precedent.date)}.`);
    fin.push(`Le loyer est révisé chaque année à la date anniversaire du contrat, selon la variation de l'indice de référence des loyers (IRL) publié par l'Insee, l'indice de référence étant celui du ${TRIMESTRE[d.irl_trimestre]} trimestre${d.irl_reference ? ` (dernier indice publié à la signature : ${d.irl_reference})` : ""}.`);
    fin.push(d.charges_mode === "provision"
        ? `Les charges récupérables sont payées par provisions mensuelles de ${eurTxt(d.charges)}, régularisées chaque année au vu des dépenses réelles ; les justificatifs sont tenus à la disposition du locataire.`
        : `Les charges récupérables sont payées sous la forme d'un forfait mensuel de ${eurTxt(d.charges)}, non régularisable, révisable chaque année dans les mêmes conditions que le loyer.`);
    fin.push(`Le loyer et les charges, soit ${eurTxt(d.loyer_hc + d.charges)} par mois, sont payables mensuellement et d'avance, au plus tard le ${d.jour_paiement} de chaque mois. Une quittance est remise gratuitement au locataire qui en fait la demande.`);
    sections.push({ titre: "IV. Conditions financières", paragraphes: fin });
    sections.push({ titre: "V. Travaux", paragraphes: [d.travaux?.trim() || "Aucuns travaux n'ont été réalisés depuis la fin du dernier contrat de location ou le dernier renouvellement, ni ne sont convenus entre les parties."] });
    sections.push({ titre: "VI. Garanties", paragraphes: [
            `Un dépôt de garantie de ${eurTxt(d.depot_garantie)} est versé à la signature du contrat. Il ne porte pas intérêt et ne peut être révisé. Il est restitué dans un délai d'un mois après la remise des clés lorsque l'état des lieux de sortie est conforme à l'état des lieux d'entrée, et de deux mois dans le cas contraire, déduction faite des sommes dûment justifiées restant dues au bailleur.`,
        ] });
    if (noms.length > 1 && d.solidaires)
        sections.push({ titre: "VII. Clause de solidarité", paragraphes: [
                "Les locataires sont tenus solidairement et indivisiblement de l'exécution des obligations du présent contrat. En cas de départ de l'un d'eux, sa solidarité cesse lorsqu'un nouveau colocataire le remplace, et au plus tard six mois après la date d'effet de son congé.",
            ] });
    sections.push({ titre: `${noms.length > 1 && d.solidaires ? "VIII" : "VII"}. Clause résolutoire`, paragraphes: [
            "Le présent contrat est résilié de plein droit, dans les conditions et délais prévus par l'article 24 de la loi du 6 juillet 1989 : à défaut de paiement du loyer, des charges ou du dépôt de garantie aux termes convenus, après un commandement de payer resté infructueux ; à défaut d'assurance des risques locatifs, après un commandement resté infructueux ; en cas de troubles de voisinage constatés par une décision de justice passée en force de chose jugée.",
        ] });
    const n = noms.length > 1 && d.solidaires ? ["IX", "X", "XI"] : ["VIII", "IX", "X"];
    sections.push({ titre: `${n[0]}. Obligations des parties`, paragraphes: [
            "Le bailleur remet un logement décent, en bon état d'usage et de réparation, assure au locataire la jouissance paisible du logement et entretient les locaux en état de servir à l'usage prévu.",
            "Le locataire paie le loyer et les charges aux termes convenus, use paisiblement des locaux, répond des dégradations survenues pendant la location, prend à sa charge l'entretien courant et les menues réparations, et s'assure contre les risques locatifs en justifiant de cette assurance chaque année.",
        ] });
    if (d.clauses_particulieres?.trim())
        sections.push({ titre: `${n[1]}. Autres conditions particulières`, paragraphes: d.clauses_particulieres.split(/\n+/).map((x) => x.trim()).filter(Boolean) });
    const annexes = [
        "Le dossier de diagnostic technique : diagnostic de performance énergétique" + (L.dpe ? ` (classe ${L.dpe.toUpperCase()})` : "") + ", état des risques et pollutions, et selon le logement : constat de risque d'exposition au plomb (immeuble construit avant 1949), états des installations intérieures d'électricité et de gaz (installations de plus de 15 ans), diagnostic bruit (zones d'exposition au bruit des aérodromes)",
        "La notice d'information relative aux droits et obligations des locataires et des bailleurs",
        "L'état des lieux d'entrée" + (d.meuble ? " et l'inventaire du mobilier" : ""),
        ...(L.regime_juridique === "copropriete" ? ["Les extraits du règlement de copropriété concernant la destination de l'immeuble, la jouissance et l'usage des parties privatives et communes, et la quote-part des charges"] : []),
        ...(d.encadrement ? ["Les références aux loyers habituellement constatés dans le voisinage, le cas échéant"] : []),
    ];
    sections.push({ titre: `${d.clauses_particulieres?.trim() ? n[2] : n[1]}. Annexes`, paragraphes: ["Sont annexés au présent contrat et remis au locataire :", ...annexes.map((x) => `– ${x}.`)] });
    sections.push({ titre: "Signatures", paragraphes: [
            `Fait${d.lieu_signature ? ` à ${d.lieu_signature}` : ""}, en autant d'exemplaires que de parties, signé électroniquement par chacune d'elles. Chaque signataire reconnaît avoir reçu un exemplaire du contrat et de ses annexes.`,
        ] });
    return {
        titre: `Contrat de location ${d.meuble ? "meublée" : "non meublée"}`,
        sous_titre: `${L.adresse} · loi n° 89-462 du 6 juillet 1989`,
        sections,
        avertissements: controlesBail(d),
    };
}
// ---------- état des lieux ----------
const ELEMENTS_PIECE = ["Sol", "Murs", "Plafond", "Porte", "Fenêtres et volets", "Prises et interrupteurs", "Éclairage", "Chauffage"];
const ELEMENTS_EAU = ["Lavabo ou évier", "Robinetterie", "Douche ou baignoire", "Meubles"];
/** Default rooms for a property, refined by the number of rooms. */
export function piecesParDefaut(type, pieces) {
    const el = (noms) => noms.map((nom) => ({ nom, etat: "", commentaire: "" }));
    const sejour = type === "studio" ? ["Pièce principale"] : ["Séjour", ...Array.from({ length: Math.max(0, (pieces ?? 2) - 1) }, (_, i) => `Chambre ${i + 1}`)];
    return [
        { nom: "Entrée", elements: el(["Sol", "Murs", "Plafond", "Porte d'entrée et serrure", "Éclairage", "Interphone ou sonnette"]) },
        ...sejour.map((nom) => ({ nom, elements: el(ELEMENTS_PIECE) })),
        { nom: "Cuisine", elements: el([...ELEMENTS_PIECE.slice(0, 6), "Évier et robinetterie", "Plaques de cuisson", "Hotte", "Placards"]) },
        { nom: "Salle de bain", elements: el([...ELEMENTS_PIECE.slice(0, 4), ...ELEMENTS_EAU, "Ventilation"]) },
        { nom: "WC", elements: el(["Sol", "Murs", "Cuvette et chasse d'eau", "Éclairage"]) },
    ];
}
/** Minimal furniture of a furnished home (décret n° 2015-981). */
export const INVENTAIRE_MEUBLE = [
    "Literie avec couette ou couverture", "Volets ou rideaux occultants dans les chambres", "Plaques de cuisson", "Four ou four à micro-ondes",
    "Réfrigérateur avec compartiment congélation", "Vaisselle pour prendre les repas", "Ustensiles de cuisine", "Table et sièges",
    "Étagères de rangement", "Luminaires", "Matériel d'entretien ménager",
];
export function edlVide(type, base) {
    return {
        type, date: base.date, bailleur: base.bailleur, locataires: base.locataires, adresse: base.adresse, meuble: base.meuble,
        pieces: piecesParDefaut(base.typeBien, base.pieces),
        compteurs: { electricite: "", gaz: "", eau_froide: "", eau_chaude: "" },
        cles: [{ type: "Clés du logement", nombre: 2 }, { type: "Badge ou bip", nombre: 0 }, { type: "Clé de boîte aux lettres", nombre: 1 }],
        inventaire: base.meuble ? INVENTAIRE_MEUBLE.map((nom) => ({ nom, nombre: 1, etat: "" })) : undefined,
        observations: "",
    };
}
const ETAT_TXT = { neuf: "Neuf", bon: "Bon état", moyen: "État d'usage", mauvais: "Mauvais état", "": "Non renseigné" };
const RANG = { neuf: 4, bon: 3, moyen: 2, mauvais: 1, "": 0 };
/** What got worse between the entry and the exit inventories, element by element. */
export function comparerEdl(entree, sortie) {
    const out = [];
    for (const p of sortie.pieces) {
        const pe = entree.pieces.find((x) => x.nom === p.nom);
        for (const e of p.elements) {
            const avant = pe?.elements.find((x) => x.nom === e.nom)?.etat ?? "";
            if (avant && e.etat && RANG[e.etat] < RANG[avant])
                out.push({ piece: p.nom, element: e.nom, avant, apres: e.etat, commentaire: e.commentaire });
        }
    }
    return out;
}
export function contenuEdl(e, entree) {
    const sections = [{ titre: "Parties et logement", paragraphes: [
                `État des lieux ${e.type === "entree" ? "d'entrée" : "de sortie"} établi contradictoirement le ${dateTxt(e.date)}.`,
                `Bailleur : ${e.bailleur}. Locataire${e.locataires.length > 1 ? "s" : ""} : ${e.locataires.join(", ") || "[à compléter]"}.`,
                `Logement ${e.meuble ? "meublé" : "non meublé"} : ${e.adresse}.`,
            ] }];
    sections.push({ titre: "Relevés des compteurs", paragraphes: [
            `Électricité : ${e.compteurs.electricite || "—"} · Gaz : ${e.compteurs.gaz || "—"} · Eau froide : ${e.compteurs.eau_froide || "—"} · Eau chaude : ${e.compteurs.eau_chaude || "—"}.`,
        ] });
    for (const p of e.pieces)
        sections.push({ titre: p.nom, paragraphes: p.elements.map((x) => `${x.nom} : ${ETAT_TXT[x.etat]}${x.commentaire ? ` — ${x.commentaire}` : ""}`) });
    if (e.inventaire?.length)
        sections.push({ titre: "Inventaire du mobilier", paragraphes: e.inventaire.map((x) => `${x.nom} : ${x.nombre} · ${ETAT_TXT[x.etat]}`) });
    sections.push({ titre: "Clés remises", paragraphes: e.cles.filter((c) => c.nombre > 0).map((c) => `${c.type} : ${c.nombre}`).concat(e.cles.every((c) => !c.nombre) ? ["Aucune"] : []) });
    if (e.type === "sortie" && entree) {
        const d = comparerEdl(entree, e);
        sections.push({ titre: "Comparaison avec l'état des lieux d'entrée", paragraphes: d.length
                ? d.map((x) => `${x.piece}, ${x.element} : ${ETAT_TXT[x.avant]} à l'entrée, ${ETAT_TXT[x.apres].toLowerCase()} à la sortie${x.commentaire ? ` (${x.commentaire})` : ""}.`).concat(["L'usure normale due au temps n'est pas imputable au locataire (vétusté)."])
                : ["Aucune dégradation par rapport à l'état des lieux d'entrée."] });
    }
    if (e.observations?.trim())
        sections.push({ titre: "Observations", paragraphes: e.observations.split(/\n+/).filter(Boolean) });
    sections.push({ titre: "Signatures", paragraphes: [
            "Les parties reconnaissent l'exactitude du présent état des lieux, établi contradictoirement et signé électroniquement par chacune d'elles. Le locataire peut demander à le compléter dans les dix jours qui suivent son établissement, et pendant le premier mois de la période de chauffe pour les éléments de chauffage.",
        ] });
    const manquants = e.pieces.reduce((s, p) => s + p.elements.filter((x) => !x.etat).length, 0);
    return {
        titre: `État des lieux ${e.type === "entree" ? "d'entrée" : "de sortie"}`,
        sous_titre: `${e.adresse} · décret n° 2016-382 du 30 mars 2016`,
        sections,
        avertissements: manquants ? [`${manquants} élément${manquants > 1 ? "s" : ""} sans état renseigné.`] : [],
    };
}
