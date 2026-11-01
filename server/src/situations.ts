/**
 * Situations de vie : déménagement, naissance, mariage ou PACS, séparation, décès d'un proche, nouvelle voiture,
 * perte d'emploi, achat d'un logement, enfant qui part étudier, départ à la retraite.
 * The household picks a situation and its date; each step lands in the Agenda at the right date (counted from that
 * date), linked to the papers concerned (energy, internet, insurance…), with its letter or its ready file.
 * Pure (no Node API): shared by the server and the demo. Durations and bodies from service-public.gouv.fr; amounts
 * that change every year are left out on purpose.
 */

export type CleSituation = "demenagement" | "naissance" | "union" | "separation" | "deces" | "voiture" | "emploi" | "achat" | "pret" | "etudes" | "retraite";

export interface Etape {
  cle: string;
  titre: string;
  detail: string;
  j: number;                                  // days from the situation's date (negative: before)
  lien?: { libelle: string; url: string };
  papiers?: { categories?: string[]; motif?: string };   // papers concerned (category, or words in the title / body)
  courrier?: "adresse" | "conge_locataire";   // letter Lucien prepares for each paper concerned (or once)
  dossier?: string;                           // a ready file (Dossiers prêts) to open
  ecran?: string;                             // a screen of the app to open
  si?: "locataire";                           // only asked when relevant
}

export interface Situation {
  cle: CleSituation; titre: string; accroche: string; question: string; icone: string; teinte: "peach" | "lilac" | "moss" | "yolk" | "coral";
  etapes: Etape[];
}

const SP = (chemin: string) => `https://www.service-public.gouv.fr/particuliers/vosdroits/${chemin}`;

export const SITUATIONS: Situation[] = [
  {
    cle: "demenagement", titre: "Déménagement", accroche: "Préavis, énergie, box, assurance, courrier, carte grise : tout dans l'ordre.", question: "Date du déménagement", teinte: "peach",
    icone: "M3 13h11V6H3zM14 9h4l3 4v3h-7zM6.5 19a2 2 0 100-4 2 2 0 000 4zM17.5 19a2 2 0 100-4 2 2 0 000 4z",
    etapes: [
      { cle: "conge", titre: "Donner congé au bailleur", si: "locataire", j: -95, courrier: "conge_locataire",
        detail: "Par lettre recommandée, remise en main propre ou acte de commissaire de justice. Préavis de 3 mois en location vide, 1 mois en meublé, en zone tendue ou dans les cas prévus par la loi (mutation, perte d'emploi, raison de santé…).", lien: { libelle: "Le préavis du locataire", url: SP("F1168") } },
      { cle: "demenageur", titre: "Réserver le déménageur ou l'utilitaire", j: -45, detail: "Plusieurs devis, surtout en fin de mois et l'été. Pour un salarié, certaines conventions collectives accordent un jour de congé pour déménagement." },
      { cle: "reexpedition", titre: "Faire suivre le courrier", j: -15, detail: "Contrat de réexpédition de La Poste, à souscrire environ deux semaines avant, pour 6 ou 12 mois.", lien: { libelle: "La Poste", url: "https://www.laposte.fr/demenagement" } },
      { cle: "energie", titre: "Électricité et gaz : résilier ou transférer", j: -10, papiers: { categories: ["energie"] }, courrier: "adresse",
        detail: "Prévenez le fournisseur du départ et ouvrez le compteur du nouveau logement à votre nom. Relevez les compteurs le jour même, dans les deux logements." },
      { cle: "box", titre: "Internet : transférer la box", j: -21, papiers: { categories: ["telecom"], motif: "box|fibre|internet|adsl" }, courrier: "adresse",
        detail: "Le transfert de ligne prend souvent deux à trois semaines. Si le service n'est pas disponible à la nouvelle adresse, la résiliation se fait sans frais sur justificatif." },
      { cle: "assurance", titre: "Assurer le nouveau logement", j: -3, papiers: { categories: ["assurance"], motif: "habitation|logement|multirisque|mrh" }, courrier: "adresse",
        detail: "Le locataire doit être assuré dès la remise des clés. Le déménagement permet de résilier l'ancien contrat ; après un an de contrat, la résiliation est de toute façon possible à tout moment." },
      { cle: "edl", titre: "États des lieux et relevés des compteurs", j: 0, detail: "État des lieux de sortie dans l'ancien logement, d'entrée dans le nouveau, avec photos. Notez les index des compteurs d'eau, d'électricité et de gaz.", si: "locataire" },
      { cle: "adresse_admin", titre: "Changer d'adresse auprès des administrations", j: 3, detail: "Un seul formulaire en ligne pour la CAF, les impôts, l'Assurance maladie, les caisses de retraite, France Travail et les fournisseurs d'énergie partenaires.", lien: { libelle: "Déclarer un changement de coordonnées", url: "https://www.service-public.gouv.fr/particuliers/vosdroits/R11193" } },
      { cle: "banque_contrats", titre: "Banque, mutuelle, employeur, abonnements : nouvelle adresse", j: 7, papiers: { categories: ["banque", "abonnement", "sante"], motif: "mutuelle|banque|compte" }, courrier: "adresse", detail: "Lucien prépare le courrier de changement d'adresse pour chaque contrat de vos papiers." },
      { cle: "carte_grise", titre: "Carte grise : changer l'adresse", j: 30, papiers: { categories: ["vehicule"] }, detail: "Obligatoire dans le mois qui suit le déménagement, gratuit, en ligne sur le site de l'ANTS.", lien: { libelle: "ANTS", url: "https://immatriculation.ants.gouv.fr" } },
      { cle: "ecole", titre: "Inscrire les enfants à l'école", j: -30, dossier: "ecole", detail: "Inscription en mairie de la nouvelle commune, puis admission à l'école. Lucien prépare le dossier." },
      { cle: "electorale", titre: "S'inscrire sur les listes électorales", j: 30, detail: "Dans la nouvelle commune, en ligne. Possible toute l'année, au plus tard le sixième vendredi avant une élection.", lien: { libelle: "Inscription en ligne", url: SP("R16396") } },
      { cle: "depot", titre: "Récupérer le dépôt de garantie", si: "locataire", j: 30, detail: "Le bailleur a un mois après la remise des clés si l'état des lieux de sortie est conforme à l'entrée, deux mois sinon. Au-delà, il doit 10 % du loyer par mois de retard." },
    ],
  },
  {
    cle: "naissance", titre: "Naissance", accroche: "Déclaration, CAF, Assurance maladie, mutuelle, congés et garde.", question: "Date de naissance (ou date prévue)", teinte: "lilac",
    icone: "M12 21c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7zM9 13h.01M15 13h.01M10 16c1.1.7 2.9.7 4 0M12 7V3",
    etapes: [
      { cle: "grossesse", titre: "Déclarer la grossesse", j: -182, detail: "Avant la fin du troisième mois (14e semaine) à la CAF et à l'Assurance maladie : le médecin ou la sage-femme la transmet en ligne." },
      { cle: "creche", titre: "Chercher un mode de garde", j: -150, detail: "Crèche, assistante maternelle : les inscriptions se font souvent dès la grossesse. Le site monenfant.fr recense les places près de chez vous.", lien: { libelle: "monenfant.fr", url: "https://monenfant.fr" } },
      { cle: "reconnaissance", titre: "Reconnaissance anticipée (parents non mariés)", j: -60, detail: "En mairie, avant la naissance, pour établir la filiation du père. Elle peut aussi se faire au moment de la déclaration de naissance." },
      { cle: "conges", titre: "Prévenir l'employeur des congés", j: -30, detail: "Congé de maternité, et congé de paternité et d'accueil de l'enfant de 25 jours (dont 4 à prendre juste après la naissance) : prévenez l'employeur un mois avant pour la partie restante." },
      { cle: "declaration", titre: "Déclarer la naissance en mairie", j: 5, detail: "Dans les 5 jours qui suivent l'accouchement, à la mairie du lieu de naissance (souvent possible à la maternité). Sans cette déclaration, l'acte de naissance ne peut être établi.", lien: { libelle: "Déclaration de naissance", url: SP("F961") } },
      { cle: "ameli", titre: "Rattacher l'enfant à l'Assurance maladie", j: 15, detail: "Dans votre compte ameli, avec l'acte de naissance, pour qu'il soit pris en charge sur la carte Vitale d'un parent ou des deux." },
      { cle: "mutuelle", titre: "Ajouter l'enfant à la mutuelle", j: 30, papiers: { categories: ["assurance", "sante"], motif: "mutuelle|complémentaire|sante" }, detail: "Avec l'acte de naissance, pour qu'il soit couvert dès ses premiers soins." },
      { cle: "caf", titre: "Informer la CAF", j: 15, dossier: "caf", detail: "Déclarez la naissance dans votre espace CAF : allocations, prestation d'accueil du jeune enfant." },
      { cle: "impots", titre: "Impôts : mettre à jour le prélèvement à la source", j: 60, detail: "Signalez la naissance dans les 60 jours dans « Gérer mon prélèvement à la source » pour baisser le taux tout de suite.", lien: { libelle: "impots.gouv.fr", url: "https://www.impots.gouv.fr" } },
      { cle: "lucien", titre: "Ajouter l'enfant dans Lucien", j: 1, ecran: "famille", detail: "Sa page, ses papiers et ses dates clés : vaccins, inscriptions, aides." },
    ],
  },
  {
    cle: "union", titre: "Mariage ou PACS", accroche: "Impôts, CAF, mutuelle, banque et assurances à mettre à jour.", question: "Date du mariage ou du PACS", teinte: "coral",
    icone: "M9 15a5 5 0 100-10 5 5 0 000 10zM15 19a5 5 0 100-10 5 5 0 000 10z",
    etapes: [
      { cle: "dossier", titre: "Déposer le dossier", j: -60, detail: "Mariage : dossier en mairie, avec publication des bans. PACS : en mairie ou chez un notaire, sur rendez-vous.", lien: { libelle: "Se pacser", url: SP("F1618") } },
      { cle: "impots", titre: "Impôts : déclarer le changement dans les 60 jours", j: 60, detail: "Dans « Gérer mon prélèvement à la source ». Imposition commune dès l'année du mariage ou du PACS ; une déclaration séparée reste possible cette année-là." },
      { cle: "caf", titre: "Informer la CAF et l'Assurance maladie", j: 30, detail: "Le changement de situation peut modifier les aides (APL, prime d'activité)." },
      { cle: "mutuelle", titre: "Mutuelle et assurances : regrouper ?", j: 45, papiers: { categories: ["assurance", "sante"] }, detail: "Un contrat famille revient souvent moins cher que deux contrats. Les assurances habitation et auto peuvent aussi être regroupées." },
      { cle: "employeur", titre: "Prévenir l'employeur", j: 15, detail: "Pour la mutuelle d'entreprise, et le congé pour mariage ou PACS (4 jours)." },
      { cle: "banque", titre: "Banque : compte joint, bénéficiaires", j: 45, papiers: { categories: ["banque"] }, detail: "Compte joint, procurations, et bénéficiaires des contrats d'assurance vie à revoir." },
      { cle: "nom", titre: "Nom d'usage (si vous le souhaitez)", j: 60, dossier: "identite", detail: "Le nom d'usage figure sur les nouveaux papiers d'identité, à la demande. Rien n'oblige à le changer." },
    ],
  },
  {
    cle: "separation", titre: "Séparation", accroche: "Logement, comptes, impôts, CAF, enfants : ce qui doit changer.", question: "Date de la séparation", teinte: "lilac",
    icone: "M8 12h8M5 5l14 14",
    etapes: [
      { cle: "logement", titre: "Logement : bail ou prêt immobilier", j: 15, papiers: { categories: ["logement"] }, detail: "Locataires : celui qui part donne congé (sa solidarité peut durer jusqu'à 6 mois). Propriétaires : vente, rachat de la part de l'autre ou indivision, avec le notaire et la banque." },
      { cle: "banque", titre: "Comptes joints et crédits", j: 7, papiers: { categories: ["banque"] }, detail: "Désolidarisez-vous du compte joint par lettre à la banque, et faites le point sur les crédits en commun." },
      { cle: "impots", titre: "Impôts : déclarer le changement dans les 60 jours", j: 60, detail: "Dans « Gérer mon prélèvement à la source ». Chacun fait ensuite sa propre déclaration." },
      { cle: "caf", titre: "Informer la CAF", j: 15, detail: "Les aides sont recalculées. En cas de pension alimentaire, l'intermédiation financière (ARIPA) sécurise son versement.", lien: { libelle: "Pension alimentaire (ARIPA)", url: "https://www.pension-alimentaire.caf.fr" } },
      { cle: "enfants", titre: "Organisation des enfants", j: 30, detail: "Résidence, droit de visite, pension : par accord écrit, convention homologuée ou décision du juge aux affaires familiales." },
      { cle: "contrats", titre: "Assurances, mutuelle, abonnements : séparer", j: 30, papiers: { categories: ["assurance", "sante", "abonnement", "telecom", "energie"] }, courrier: "adresse", detail: "Chaque contrat au nom de celui qui le garde ; nouvelle adresse pour celui qui part." },
      { cle: "lucien", titre: "Mettre à jour le foyer dans Lucien", j: 30, ecran: "famille", detail: "Personnes du foyer, dépenses partagées : Lucien peut calculer qui doit quoi pour solder les comptes." },
    ],
  },
  {
    cle: "deces", titre: "Décès d'un proche", accroche: "Les démarches de la première semaine, puis des premiers mois, dans l'ordre.", question: "Date du décès", teinte: "moss",
    icone: "M12 3v18M7 8h10",
    etapes: [
      { cle: "declaration", titre: "Déclarer le décès en mairie", j: 1, detail: "Dans les 24 heures, à la mairie du lieu du décès, avec le certificat de décès ; les pompes funèbres s'en chargent souvent.", lien: { libelle: "Démarches après un décès", url: SP("F16507") } },
      { cle: "obseques", titre: "Organiser les obsèques", j: 14, detail: "L'inhumation ou la crémation a lieu au plus tard 14 jours après le décès. Les frais peuvent être prélevés en partie sur le compte du défunt, sur présentation de la facture." },
      { cle: "employeur", titre: "Prévenir l'employeur, la banque et les caisses", j: 7, detail: "Employeur ou caisses de retraite, banque (les comptes personnels sont bloqués), Assurance maladie, CAF, mutuelle." },
      { cle: "assurance_vie", titre: "Rechercher les assurances vie", j: 30, detail: "Le service AGIRA retrouve les contrats d'assurance vie dont le défunt était titulaire.", lien: { libelle: "AGIRA", url: "https://www.agira.asso.fr" } },
      { cle: "contrats", titre: "Résilier ou transférer les contrats", j: 30, papiers: { categories: ["energie", "telecom", "abonnement", "assurance"] }, detail: "Énergie, box, abonnements, assurance habitation et auto : un certificat de décès suffit pour résilier sans frais." },
      { cle: "notaire", titre: "Notaire et succession", j: 30, detail: "Le notaire établit l'acte de notoriété et la déclaration de succession, à déposer dans les 6 mois." },
      { cle: "succession", titre: "Déclaration de succession", j: 180, detail: "Dans les 6 mois du décès (en France), sauf petites successions exonérées de déclaration." },
      { cle: "impots", titre: "Impôts : déclaration des revenus du défunt", j: 120, detail: "Au printemps suivant, pour la période du 1er janvier au décès ; le conjoint ou partenaire de PACS signale le décès dans les 60 jours pour adapter le prélèvement." },
    ],
  },
  {
    cle: "voiture", titre: "Nouvelle voiture", accroche: "Assurance, carte grise, vente de l'ancienne : rien n'oublie.", question: "Date d'achat", teinte: "yolk",
    icone: "M5 17h14M6 17V12l2-5h8l2 5v5M7.5 17a1.5 1.5 0 100 .01M16.5 17a1.5 1.5 0 100 .01",
    etapes: [
      { cle: "assurance", titre: "Assurer la voiture avant de rouler", j: -2, papiers: { categories: ["assurance"], motif: "auto|automobile|véhicule|vehicule" }, detail: "L'assurance au tiers au minimum est obligatoire dès la première sortie. Faites jouer la concurrence : après un an, l'ancien contrat se résilie à tout moment." },
      { cle: "carte_grise", titre: "Faire la carte grise", j: 30, detail: "Voiture d'occasion : changement de titulaire dans le mois, en ligne sur le site de l'ANTS. Voiture neuve : le concessionnaire s'en charge souvent.", lien: { libelle: "ANTS", url: "https://immatriculation.ants.gouv.fr" } },
      { cle: "ct", titre: "Contrôle technique de moins de 6 mois", j: -7, detail: "Pour une voiture d'occasion de plus de 4 ans, le vendeur doit le fournir." },
      { cle: "cession", titre: "Vendre l'ancienne : déclaration de cession", j: 15, papiers: { categories: ["vehicule"] }, detail: "Le vendeur déclare la cession sur le site de l'ANTS dans les 15 jours, et résilie l'assurance de l'ancien véhicule à la date de vente." },
      { cle: "critair", titre: "Vignette Crit'Air", j: 30, detail: "Obligatoire dans les zones à faibles émissions de nombreuses villes. Commande uniquement sur le site officiel.", lien: { libelle: "certificat-air.gouv.fr", url: "https://www.certificat-air.gouv.fr" } },
    ],
  },
  {
    cle: "emploi", titre: "Perte d'emploi", accroche: "France Travail, mutuelle, aides, budget : les bons réflexes.", question: "Dernier jour du contrat", teinte: "coral",
    icone: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
    etapes: [
      { cle: "documents", titre: "Récupérer les documents de fin de contrat", j: 0, detail: "Certificat de travail, attestation employeur pour France Travail, reçu pour solde de tout compte. Rangez-les dans Lucien." },
      { cle: "inscription", titre: "S'inscrire à France Travail", j: 2, detail: "Dès le lendemain de la fin du contrat, en ligne. L'inscription ouvre les droits à l'allocation chômage s'ils existent.", lien: { libelle: "francetravail.fr", url: "https://www.francetravail.fr" } },
      { cle: "mutuelle", titre: "Mutuelle d'entreprise : la portabilité", j: 7, papiers: { categories: ["assurance", "sante"], motif: "mutuelle|prévoyance|prevoyance" }, detail: "La mutuelle et la prévoyance de l'entreprise sont maintenues gratuitement pendant la durée du chômage indemnisé, jusqu'à 12 mois." },
      { cle: "caf", titre: "Revoir les aides de la CAF", j: 15, detail: "Prime d'activité, APL : déclarez le changement de ressources." },
      { cle: "budget", titre: "Ajuster le budget", j: 7, ecran: "budget", detail: "Lucien repère les abonnements à suspendre et annonce le solde de fin de mois." },
      { cle: "cpf", titre: "Formation : votre compte CPF", j: 30, detail: "Les droits acquis restent utilisables pendant la recherche d'emploi.", lien: { libelle: "Mon compte formation", url: "https://www.moncompteformation.gouv.fr" } },
    ],
  },
  {
    cle: "achat", titre: "Achat d'un logement", accroche: "Prêt, assurance emprunteur, signature, puis le déménagement.", question: "Date de signature chez le notaire", teinte: "yolk",
    icone: "M3 11l9-7 9 7v9H3zM9 20v-6h6v6",
    etapes: [
      { cle: "compromis", titre: "Compromis et délai de rétractation", j: -90, detail: "Après la signature du compromis, l'acheteur dispose de 10 jours pour se rétracter. Le prêt fait en général l'objet d'une condition suspensive." },
      { cle: "pret", titre: "Dossier de prêt", j: -80, dossier: "pret", detail: "Lucien rassemble les pièces demandées par la banque ou le courtier." },
      { cle: "assurance_pret", titre: "Assurance emprunteur : comparer", j: -60, detail: "Vous pouvez choisir une autre assurance que celle de la banque, et en changer à tout moment pendant le prêt." },
      { cle: "habitation", titre: "Assurer le logement dès la remise des clés", j: 0, papiers: { categories: ["assurance"], motif: "habitation|logement|multirisque" }, detail: "En copropriété, l'assurance responsabilité civile est obligatoire pour le propriétaire." },
      { cle: "taxe", titre: "Taxe foncière", j: 30, detail: "Due par le propriétaire au 1er janvier ; l'acte prévoit souvent un remboursement au prorata au vendeur." },
      { cle: "demenagement", titre: "Lancer la situation Déménagement", j: 0, ecran: "situations", detail: "Énergie, box, courrier, carte grise : Lucien enchaîne avec le déménagement." },
    ],
  },
  {
    cle: "pret", titre: "Obtenir un prêt immobilier", accroche: "Capacité d'emprunt, comptes, dossier, assurance, offre : le prêt au meilleur prix.", question: "Date à laquelle il vous faut les fonds", teinte: "moss",
    icone: "M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5M12 7.5h.01",
    etapes: [
      { cle: "capacite", titre: "Calculer votre capacité d'emprunt", j: -120, ecran: "espace/budget", detail: "Les banques limitent les mensualités de crédit à 35 % des revenus, assurance comprise, sur 25 ans au plus. Lucien calcule votre taux d'endettement actuel et votre reste à vivre dans le Budget expert." },
      { cle: "comptes", titre: "Soigner vos comptes", j: -110, ecran: "budget", detail: "La banque lit vos 3 derniers relevés : pas de découvert, épargne régulière, pas d'abonnements inutiles ni de crédits renouvelables. Lucien repère ce qui peut faire mauvaise impression." },
      { cle: "dossier", titre: "Constituer le dossier", j: -100, dossier: "pret", detail: "Pièces d'identité, bulletins de salaire, avis d'impôt, relevés, justificatif d'apport : Lucien rassemble tout et signale ce qui manque ou est trop ancien." },
      { cle: "comparer", titre: "Comparer les banques, ou passer par un courtier", j: -90, detail: "Taux, frais de dossier, garantie, assurance, conditions de remboursement anticipé : comparez au moins trois offres. Un courtier doit être immatriculé à l'ORIAS.", lien: { libelle: "Vérifier un courtier (ORIAS)", url: "https://www.orias.fr" } },
      { cle: "assurance", titre: "Comparer l'assurance emprunteur", j: -75, detail: "Vous pouvez choisir une autre assurance que celle de la banque, à garanties équivalentes. Pas de questionnaire de santé si la part assurée est inférieure à 200 000 € par personne et que le prêt se termine avant vos 60 ans." },
      { cle: "garantie", titre: "Choisir la garantie", j: -60, detail: "Caution d'un organisme spécialisé ou hypothèque : le coût et les frais de sortie diffèrent, demandez le détail." },
      { cle: "offre", titre: "Recevoir et accepter l'offre de prêt", j: -40, detail: "L'offre est envoyée par écrit et reste valable 30 jours. Vous ne pouvez l'accepter qu'après un délai de réflexion de 10 jours pleins, par écrit." },
      { cle: "condition", titre: "Respecter la date de la condition suspensive", j: -30, papiers: { categories: ["logement"], motif: "compromis|promesse|vente" }, detail: "Si l'achat est sous condition d'obtention du prêt, prévenez le notaire avant la date fixée au compromis, avec l'offre ou les refus de banque." },
      { cle: "deblocage", titre: "Signature et déblocage des fonds", j: 0, detail: "Les fonds sont versés au notaire (achat) ou sur présentation des factures (travaux)." },
      { cle: "ranger", titre: "Ranger l'offre et le tableau d'amortissement", j: 15, ecran: "add", detail: "Lucien suit alors les mensualités dans le budget, le capital restant dû dans le bilan, et la date anniversaire de l'assurance." },
      { cle: "renegocier", titre: "Revoir l'assurance du prêt", j: 365, detail: "L'assurance emprunteur peut être changée à tout moment, sans frais : faites jouer la concurrence chaque année." },
    ],
  },
  {
    cle: "etudes", titre: "Un enfant part étudier", accroche: "Bourse, logement, APL, assurance, impôts : la rentrée sans oubli.", question: "Date de rentrée", teinte: "lilac",
    icone: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5",
    etapes: [
      { cle: "dse", titre: "Dossier social étudiant (bourse et logement CROUS)", j: -200, detail: "À déposer entre mi-janvier et fin mai, sans attendre l'affectation.", lien: { libelle: "messervices.etudiant.gouv.fr", url: "https://www.messervices.etudiant.gouv.fr" } },
      { cle: "logement", titre: "Trouver le logement", j: -60, dossier: "location", detail: "Résidence CROUS, colocation ou studio : Lucien prépare le dossier de location. La garantie Visale peut remplacer un garant." },
      { cle: "apl", titre: "Demander l'APL", j: 7, detail: "En ligne sur le site de la CAF dès l'entrée dans le logement." },
      { cle: "assurance", titre: "Assurance habitation étudiante", j: -1, detail: "Obligatoire pour le locataire, dès la remise des clés." },
      { cle: "cvec", titre: "Payer la CVEC", j: -15, detail: "Contribution vie étudiante et de campus, à acquitter avant l'inscription administrative (les boursiers en sont exonérés).", lien: { libelle: "cvec.etudiant.gouv.fr", url: "https://cvec.etudiant.gouv.fr" } },
      { cle: "impots", titre: "Rattachement fiscal ou pension ?", j: 200, detail: "À la déclaration suivante : garder l'enfant rattaché au foyer, ou le détacher et déduire la pension versée. Lucien compare dans la page Famille." },
    ],
  },
  {
    cle: "retraite", titre: "Départ à la retraite", accroche: "Relevé de carrière, demande unique, mutuelle : six mois d'avance.", question: "Date de départ souhaitée", teinte: "moss",
    icone: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
    etapes: [
      { cle: "carriere", titre: "Vérifier le relevé de carrière", j: -365, detail: "Trimestres manquants, périodes à corriger : faites-les rectifier avant la demande.", lien: { libelle: "info-retraite.fr", url: "https://www.info-retraite.fr" } },
      { cle: "demande", titre: "Faire la demande de retraite", j: -180, detail: "Une seule demande en ligne pour tous les régimes, six mois avant la date choisie." },
      { cle: "employeur", titre: "Prévenir l'employeur", j: -90, detail: "Départ volontaire à la retraite : respectez le préavis prévu par la loi ou la convention collective." },
      { cle: "mutuelle", titre: "Mutuelle : garder sa couverture", j: -30, papiers: { categories: ["assurance", "sante"], motif: "mutuelle|complémentaire|prévoyance" }, detail: "En quittant la mutuelle d'entreprise, vous pouvez demander à la conserver à titre individuel dans les 6 mois (loi Évin), ou comparer d'autres contrats." },
      { cle: "impots", titre: "Impôts : adapter le prélèvement", j: 60, detail: "Pension plus basse que le salaire : signalez la baisse de revenus dans « Gérer mon prélèvement à la source »." },
    ],
  },
];

export const situationParCle = (cle: string) => SITUATIONS.find((s) => s.cle === cle) ?? null;

export const dateEtape = (date: string, j: number) => {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + j); return d.toISOString().slice(0, 10);
};

/** Papers of the household concerned by a step (contracts to move, cancel or update). */
export function papiersConcernes<T extends { id: string; title: string; category: string; organisme: string | null; texte?: string | null }>(e: Etape, docs: T[]): T[] {
  if (!e.papiers) return [];
  const re = e.papiers.motif ? new RegExp(e.papiers.motif, "i") : null;
  return docs.filter((d) => {
    const cat = !e.papiers!.categories || e.papiers!.categories.includes(d.category);
    const mot = !re || re.test(`${d.title} ${d.organisme ?? ""}`);
    return e.papiers!.categories && re ? cat && mot : e.papiers!.categories ? cat : mot;
  }).slice(0, 8);
}

/** The steps that apply (a homeowner moving has no notice to give his landlord). */
export const etapesApplicables = (s: Situation, opts: { locataire: boolean }) => s.etapes.filter((e) => e.si !== "locataire" || opts.locataire).sort((a, b) => a.j - b.j);

const dateLongue = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(/^1 /, "1er ");

/** Change-of-address letter for one contract. */
export function lettreAdresse(o: { expediteur: string; organisme: string; contrat?: string | null; ancienne: string; nouvelle: string; date: string; aujourdhui?: string }): string {
  return `${o.expediteur}\n${o.ancienne || "[ancienne adresse]"}\n\n${o.organisme}\nService client\n\nLe ${dateLongue(o.aujourdhui ?? new Date().toISOString().slice(0, 10))}\n\nObjet : Changement d'adresse${o.contrat ? `\nRéférence : ${o.contrat}` : ""}\n\nMadame, Monsieur,\n\nJe vous informe de mon changement d'adresse à compter du ${dateLongue(o.date)}. Ma nouvelle adresse est :\n${o.nouvelle || "[nouvelle adresse]"}\n\nJe vous remercie de mettre à jour mon dossier et de m'adresser désormais vos courriers à cette adresse. Si ce contrat ne peut pas être transféré, je vous demande de le résilier à cette date et de m'adresser le décompte de fin de contrat.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n${o.expediteur}`;
}

/** The tenant's notice to the landlord. */
export function lettreCongeLocataire(o: { expediteur: string; adresse: string; bailleur?: string | null; meuble: boolean; zone_tendue: boolean; date: string; aujourdhui?: string }): string {
  const court = o.meuble || o.zone_tendue;
  return `${o.expediteur}\n${o.adresse || "[adresse du logement loué]"}\n\n${o.bailleur || "[nom et adresse du bailleur]"}\n\nLe ${dateLongue(o.aujourdhui ?? new Date().toISOString().slice(0, 10))}\n\nLettre recommandée avec accusé de réception\nObjet : Congé du logement\n\nMadame, Monsieur,\n\nJe vous informe par la présente de ma décision de quitter le logement que je loue au ${o.adresse || "[adresse]"}.\n\n${court ? `Le préavis est d'un mois${o.meuble ? ", s'agissant d'un logement meublé" : ", le logement étant situé en zone tendue (article 15 de la loi du 6 juillet 1989)"}.` : "Le préavis est de trois mois, conformément à l'article 15 de la loi du 6 juillet 1989."} Il court à compter de la réception de cette lettre. Je souhaite libérer le logement le ${dateLongue(o.date)}.\n\nJe vous propose de convenir d'une date pour l'état des lieux de sortie et la remise des clés, et vous remercie de me restituer le dépôt de garantie dans les délais légaux.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n${o.expediteur}`;
}
