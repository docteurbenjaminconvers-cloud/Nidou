import { deadlinesFor } from "./deadlines.js";
function iso(offsetDays, base = new Date()) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}
/** A realistic, fully fictional household used for demos and tests. */
export function demoDocuments() {
    return [
        { title: "Assurance auto — Peugeot 3008", category: "assurance", organisme: "MAIF", numero_contrat: "AUT-4471-8820", montant: 612, periodicite: "annuel", date_document: iso(-700), date_debut: iso(-700), date_fin: iso(30), preavis_jours: 60, resume: "Contrat tous risques, franchise 300 €. Renouvellement tacite chaque année.", membre: "Moi" },
        { title: "Assurance habitation — Maison", category: "assurance", organisme: "Matmut", numero_contrat: "HAB-20931", montant: 38.5, periodicite: "mensuel", date_document: iso(-1100), date_debut: iso(-1100), date_fin: iso(-5), preavis_jours: 60, resume: "Multirisque habitation, 120 m², responsabilité civile incluse." },
        { title: "Mutuelle santé famille", category: "assurance", organisme: "Harmonie Mutuelle", numero_contrat: "MUT-77-3301", montant: 148, periodicite: "mensuel", date_document: iso(-400), date_debut: iso(-400), date_fin: iso(-35), preavis_jours: 60, resume: "Couverture famille, 2 adultes 2 enfants, niveau 3." },
        { title: "Électricité — facture", category: "energie", organisme: "EDF", numero_contrat: "EDF-301-2288", montant: 96, periodicite: "mensuel", date_document: iso(-380), date_debut: iso(-380), date_fin: null, preavis_jours: null, resume: "Mensualisation 96 €/mois, option heures creuses." },
        { title: "Électricité — nouvel échéancier", category: "energie", organisme: "EDF", numero_contrat: "EDF-301-2288", montant: 117, periodicite: "mensuel", date_document: iso(-20), date_debut: iso(-20), date_fin: null, preavis_jours: null, resume: "Nouvel échéancier : 117 €/mois suite à révision annuelle." },
        { title: "Fibre + mobile", category: "telecom", organisme: "Orange", numero_contrat: "ORG-55820019", montant: 64.99, periodicite: "mensuel", date_document: iso(-900), date_debut: iso(-900), date_fin: null, preavis_jours: 10, resume: "Livebox fibre + 2 forfaits mobiles 100 Go. Engagement terminé." },
        { title: "Netflix", category: "abonnement", organisme: "Netflix", numero_contrat: null, montant: 13.49, periodicite: "mensuel", date_document: iso(-15), date_debut: iso(-800), date_fin: null, preavis_jours: 0, resume: "Abonnement Standard." },
        { title: "Disney+", category: "abonnement", organisme: "Disney+", numero_contrat: null, montant: 8.99, periodicite: "mensuel", date_document: iso(-12), date_debut: iso(-300), date_fin: null, preavis_jours: 0, resume: "Abonnement Standard avec pub." },
        { title: "Spotify Famille", category: "abonnement", organisme: "Spotify", numero_contrat: null, montant: 17.99, periodicite: "mensuel", date_document: iso(-10), date_debut: iso(-500), date_fin: null, preavis_jours: 0, resume: "Plan Famille, 6 comptes." },
        { title: "Salle de sport", category: "abonnement", organisme: "Basic-Fit", numero_contrat: "BF-991022", montant: 29.99, periodicite: "mensuel", date_document: iso(-200), date_debut: iso(-200), date_fin: iso(165), preavis_jours: 30, resume: "Abonnement Comfort, engagement 12 mois." },
        { title: "Passeport — Léa", category: "identite", organisme: "Préfecture", numero_contrat: "21FR88213", montant: null, periodicite: null, date_document: iso(-1700), date_debut: iso(-1700), date_fin: iso(55), preavis_jours: null, resume: "Passeport mineur, validité 5 ans.", membre: "Léa" },
        { title: "Lave-linge Bosch — facture", category: "garantie", organisme: "Darty", numero_contrat: null, montant: 549, periodicite: "unique", date_document: iso(-640), date_debut: null, date_fin: null, preavis_jours: null, resume: "Achat lave-linge Bosch Série 6, garantie légale 2 ans." },
        { title: "Demi-pension — lycée Joffre", category: "education", organisme: "Lycée Joffre", numero_contrat: "DP-2201", montant: 68, periodicite: "mensuel", date_document: iso(-50), date_debut: iso(-50), date_fin: iso(240), preavis_jours: null, resume: "Forfait demi-pension 4 jours (Léa), tarif tranche C.", membre: "Léa" },
        { title: "Contrôle technique — Peugeot 3008", category: "vehicule", organisme: "Autosur", numero_contrat: null, montant: 79, periodicite: "unique", date_document: iso(-680), date_debut: null, date_fin: iso(50), preavis_jours: null, resume: "Contrôle technique favorable, prochain contrôle dans 2 ans." },
        { title: "Taxe foncière 2026", category: "impots", organisme: "DGFIP", numero_contrat: null, montant: 1240, periodicite: "unique", date_document: iso(-30), date_debut: null, date_fin: iso(18), preavis_jours: null, resume: "Avis de taxe foncière, paiement en ligne avant la date limite." },
    ];
}
export function seedDemo(db) {
    const h = db.createHousehold("Famille Martin (démo)", 2); // demo: 2 trial days left, shows the day-13 reminder
    db.setSituation(h.id, "couple");
    const moi = db.addMember(h.id, "Moi", "adulte", { date_naissance: "1984-05-14" });
    db.addMember(h.id, "Camille", "adulte", { date_naissance: "1986-09-02" });
    const lea = db.addMember(h.id, "Léa", "enfant", { date_naissance: "2009-03-21", etablissement: "Lycée Joffre, Montpellier", classe: "Terminale", cantine_jours: "lun,mar,jeu,ven", cantine_cout_mois: 68 });
    const jean = db.addMember(h.id, "Jean", "enfant", { date_naissance: "2016-11-08", etablissement: "École Jules-Ferry", classe: "CM1", cantine_jours: "lun,mar,jeu,ven", cantine_cout_mois: 58 });
    db.addMember(h.id, "Mamie Jeanne", "parent_a_charge", { date_naissance: "1947-02-10", notes: "Vit à Uzès, aide pour les papiers avec son accord." });
    const y = new Date().getFullYear();
    const juin = `${new Date().getMonth() >= 6 ? y + 1 : y}-06-30`;
    db.insertActivite({ household_id: h.id, member_id: jean.id, titre: "Judo", type: "sport", jour: 3, heure_debut: "14:00", heure_fin: "15:30", lieu: "Dojo municipal", cout_mois: 22, date_debut: `${y}-09-10`, date_fin: juin, note: null });
    db.insertActivite({ household_id: h.id, member_id: jean.id, titre: "Piano", type: "musique", jour: 2, heure_debut: "17:30", heure_fin: "18:15", lieu: "Conservatoire", cout_mois: 45, date_debut: `${y}-09-15`, date_fin: juin, note: null });
    db.insertActivite({ household_id: h.id, member_id: lea.id, titre: "Volley", type: "sport", jour: 4, heure_debut: "18:30", heure_fin: "20:00", lieu: "Gymnase Pierre-de-Coubertin", cout_mois: 18, date_debut: `${y}-09-12`, date_fin: juin, note: null });
    db.insertActivite({ household_id: h.id, member_id: lea.id, titre: "Cours de conduite", type: "autre", jour: 6, heure_debut: "10:00", heure_fin: "11:00", lieu: "Auto-école du Peyrou", cout_mois: 160, date_debut: `${y}-10-01`, date_fin: null, note: "Forfait 20 h, à renouveler" });
    db.insertActivite({ household_id: h.id, member_id: null, titre: "Mamie Jeanne : courses et papiers", type: "garde", jour: 6, heure_debut: "15:00", heure_fin: "17:00", lieu: "Uzès", cout_mois: null, date_debut: null, date_fin: null, note: null });
    for (const s of demoDocuments()) {
        const doc = db.insertDocument({
            household_id: h.id,
            member_id: s.membre === "Léa" ? lea.id : s.membre ? moi.id : null,
            title: s.title, category: s.category, organisme: s.organisme, numero_contrat: s.numero_contrat, montant: s.montant,
            periodicite: s.periodicite, date_document: s.date_document, date_debut: s.date_debut, date_fin: s.date_fin,
            preavis_jours: s.preavis_jours, resume: s.resume, texte: null, fichier: null, mime: null, confiance: 0.95, verifie: 1,
        });
        db.replaceDeadlinesForDocument(doc.id, h.id, deadlinesFor(doc));
    }
    return h;
}
