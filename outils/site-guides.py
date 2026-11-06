#!/usr/bin/env python3
"""Génère les guides pratiques du site vitrine (monlucien.fr/guides/…), en français.

Chaque guide répond à une question que les familles tapent dans un moteur de recherche (combien de temps garder ses
papiers, résilier une assurance, dossier de location, déménagement), d'après les sources officielles citées en bas de
page, et montre comment Lucien s'en charge. Page statique, sans script : titre, description, données structurées
(article, fil d'Ariane, questions), aperçu de partage.

À relancer après chaque modification :  python3 outils/site-guides.py site   (puis outils/site-langues.py pour le plan du site)
Avant de changer une durée ou une règle : la vérifier sur la source officielle et mettre à jour VERIFIE.
"""
import html, json, re, sys
from pathlib import Path

BASE = "https://monlucien.fr/"
VERIFIE = "2026-11-05"
VERIFIE_FR = "5 novembre 2026"
SP = "https://www.service-public.gouv.fr/particuliers/vosdroits/"

LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="32" fill="#D95F45"/><path d="M12 21.5c0-2.6 2.7-4.3 5-3.2l11.5 6.2v15l-11.5 6.2c-2.3 1.1-5-.6-5-3.2z" fill="#FBF4F0"/><path d="M52 21.5c0-2.6-2.7-4.3-5-3.2l-11.5 6.2v15l11.5 6.2c2.3 1.1 5-.6 5-3.2z" fill="#FBF4F0"/><rect x="26.5" y="24.5" width="11" height="15" rx="4" fill="#E9B23A"/></svg>'


def tableau(entetes, lignes):
    th = "".join(f"<th scope=\"col\">{h}</th>" for h in entetes)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in l) + "</tr>" for l in lignes)
    return f'<div class="defile"><table class="tableau"><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'


GUIDES = []

# ---------------------------------------------------------------------------------------------------------------
GUIDES.append(dict(
    slug="combien-de-temps-garder-ses-papiers",
    titre="Combien de temps garder ses papiers ? Le tableau complet",
    titre_court="Combien de temps garder ses papiers",
    description="Banque, impôts, factures, assurance, logement, santé, travail : les durées minimales de conservation de vos papiers, d'après service-public.gouv.fr. Tableau vérifié en novembre 2026.",
    resume="Relevés, avis d'impôt, factures, bulletins de salaire : ce qu'on garde, combien de temps, et ce qui peut partir.",
    chapo="Faut-il garder ce relevé de 2019, cette facture de box, ce vieil avis d'impôt ? Voici les durées minimales de conservation des papiers de la vie courante, catégorie par catégorie, telles que les publie l'administration.",
    corps=lambda: f"""
<div class="note">Ces durées sont des <b>minimums</b> : c'est le temps pendant lequel vous pouvez faire valoir un droit (demander un remboursement, contester) ou pendant lequel on peut vous réclamer quelque chose. En cas de litige ou de procédure, gardez le papier plus longtemps.</div>
<nav class="sommaire" aria-label="Sommaire"><b>Sommaire</b><ol>
<li><a href="#banque">Banque et crédit</a></li><li><a href="#impots">Impôts</a></li><li><a href="#logement">Logement et factures</a></li>
<li><a href="#location">Location</a></li><li><a href="#assurance">Assurance</a></li><li><a href="#achats">Achats et véhicule</a></li>
<li><a href="#famille">Famille, scolarité</a></li><li><a href="#sante">Santé</a></li><li><a href="#travail">Travail, chômage, retraite</a></li></ol></nav>

<h2 id="banque">Banque et crédit</h2>
{tableau(["Document", "Durée minimale"], [
    ["Relevé de compte (compte courant, livret A, PEL…), talon de chèque", "5 ans à partir de l'opération"],
    ["Convention d'ouverture de compte", "5 ans après la clôture du compte"],
    ["Contrat de crédit immobilier ou à la consommation, et ses justificatifs", "5 ans après la fin du prêt"],
    ["Ticket de carte bancaire (paiement, retrait)", "Jusqu'au relevé où figure l'opération"],
    ["Chèque à encaisser", "1 an et 8 jours"],
])}

<h2 id="impots">Impôts</h2>
{tableau(["Document", "Durée minimale"], [
    ["Impôt sur le revenu : déclaration, avis, justificatifs (frais réels…)", "Jusqu'au 31 décembre de la 2<sup>e</sup> année après l'avis (avis de 2026 : jusqu'à fin 2028)"],
    ["Taxe foncière, taxe d'habitation sur une résidence secondaire, taxe sur les logements vacants", "Jusqu'au 31 décembre de l'année qui suit l'avis"],
    ["Impôt sur la fortune immobilière", "Jusqu'au 31 décembre de la 2<sup>e</sup> année après l'avis"],
    ["Déclaration de succession et justificatifs", "Jusqu'au 31 décembre de la 3<sup>e</sup> année après son dépôt"],
])}

<h2 id="logement">Logement et factures du foyer</h2>
{tableau(["Document", "Durée minimale"], [
    ["Facture d'électricité, de gaz, d'eau", "5 ans"],
    ["Facture de téléphone fixe ou mobile, facture internet", "5 ans"],
    ["Preuve de restitution d'une box ou d'un décodeur (reçu, accusé de réception, email)", "5 ans"],
    ["Facture de gros travaux (fondations, charpente, toiture, murs…)", "10 ans"],
    ["Attestation d'entretien annuel de la chaudière, attestation de ramonage", "2 ans"],
    ["Diagnostic de performance énergétique (réalisé depuis le 1<sup>er</sup> juillet 2021)", "10 ans"],
    ["Charges de copropriété payées, courriers du syndic, procès-verbaux d'assemblée générale", "5 ans"],
    ["Acte de vente (titre de propriété)", "À vie"],
])}

<h2 id="location">Location</h2>
{tableau(["Document", "Durée minimale"], [
    ["Bail, état des lieux, quittances de loyer, courrier de révision du loyer, inventaire du meublé", "Durée de la location + 3 ans"],
    ["Justificatif de versement de l'APL", "Fin des droits + 5 ans"],
    ["Contrat de déménagement", "1 an"],
])}
<p>Vous cherchez un logement ? Voir aussi <a href="../dossier-de-location-pieces-justificatives/">les pièces qu'un propriétaire peut demander</a>.</p>

<h2 id="assurance">Assurance</h2>
{tableau(["Document", "Durée minimale"], [
    ["Contrat d'assurance habitation ou auto", "2 ans après la fin du contrat"],
    ["Quittance, avis d'échéance, courrier de résiliation, preuve de paiement", "2 ans"],
    ["Relevé d'informations automobile", "À vie"],
    ["Contrat d'assurance-vie", "À vie"],
])}
<p>Un sinistre avec dommage corporel ouvre un délai plus long (10 ans à partir de la consolidation) : gardez alors tout le dossier.</p>

<h2 id="achats">Achats et véhicule</h2>
{tableau(["Document", "Durée minimale"], [
    ["Facture d'un appareil ou d'un meuble (lave-linge, téléviseur…)", "5 ans après l'achat"],
    ["Preuve d'achat (facture, ticket, bon de livraison) pour la garantie", "Jusqu'à la fin de la garantie"],
    ["Facture d'achat ou de réparation du véhicule, certificat de cession", "Tant que vous avez le véhicule"],
    ["Avis de contravention", "3 ans après la décision définitive"],
    ["Certificat d'examen du permis de conduire", "Jusqu'à la réception du permis"],
])}

<h2 id="famille">Famille, état civil, scolarité</h2>
{tableau(["Document", "Durée minimale"], [
    ["Livret de famille, actes d'état civil, jugement de divorce ou d'adoption, contrat de mariage, convention de PACS", "À vie"],
    ["Avis de versement d'allocations familiales", "5 ans"],
    ["Factures de cantine, garderie, activités périscolaires, transport scolaire", "5 ans"],
    ["Certificat de scolarité, justificatif de bourse", "Fin des études + 5 ans"],
    ["Diplômes, relevés de notes d'études supérieures", "À vie"],
])}

<h2 id="sante">Santé</h2>
{tableau(["Document", "Durée minimale"], [
    ["Ordonnance", "1 an (sauf lunettes après 16 ans et audioprothèses)"],
    ["Feuille de soins, relevé de remboursement de l'Assurance maladie", "2 ans"],
    ["Facture d'un hôpital public", "4 ans"],
    ["Facture d'une clinique privée", "2 ans"],
    ["Carnet de santé, carnet de vaccination, carte de groupe sanguin, examens et certificats médicaux", "À vie"],
    ["Relevés de la mutuelle", "Selon l'organisme"],
])}

<h2 id="travail">Travail, chômage, retraite</h2>
{tableau(["Document", "Durée minimale"], [
    ["Bulletins de salaire, contrat de travail, certificat de travail", "Jusqu'à la liquidation de la retraite"],
    ["Relevés d'indemnités journalières (maladie, maternité)", "Jusqu'à la liquidation de la retraite"],
    ["Solde de tout compte", "5 ans"],
    ["Attestation France Travail, justificatifs d'allocations chômage", "5 ans"],
    ["Relevé d'épargne salariale (PEE, Perco, PER)", "Clôture + 5 ans"],
    ["Titre de pension, bulletins de pension de retraite", "À vie"],
])}
""",
    lucien="Chaque papier rangé dans Lucien affiche sa durée de conservation, calculée d'après ces règles. Le « grand ménage » liste ce qui peut partir, et jamais un contrat encore en cours.",
    faq=[
        ("Combien de temps garder ses relevés bancaires ?", "5 ans à partir de la date de l'opération. La convention d'ouverture de compte se garde 5 ans après la clôture du compte."),
        ("Combien de temps garder ses avis d'impôt sur le revenu ?", "Jusqu'au 31 décembre de la 2e année qui suit l'avis : un avis reçu en 2026 se garde jusqu'à fin 2028, avec la déclaration et les justificatifs."),
        ("Combien de temps garder ses factures d'électricité et de téléphone ?", "5 ans pour l'électricité, le gaz, l'eau, le téléphone et internet, comme la preuve de restitution d'une box."),
        ("Faut-il garder ses bulletins de salaire toute sa vie ?", "Jusqu'à la liquidation de votre retraite : ils peuvent prouver vos droits. Le titre de pension, lui, se garde à vie."),
        ("Peut-on jeter un papier dès que la durée est passée ?", "En général oui. Mais ces durées sont des minimums : en cas de litige, de procédure ou de sinistre en cours, gardez le papier plus longtemps."),
    ],
    sources=[("Durée de conservation des papiers — service-public.gouv.fr (vérifié le 13 octobre 2026)", SP + "F19134")],
))

# ---------------------------------------------------------------------------------------------------------------
LETTRE = """Prénom Nom
Adresse

Nom de l'assureur ou de l'entreprise
Service résiliation
Adresse

Le [date]

Objet : résiliation du contrat n° [numéro]
Lettre recommandée avec avis de réception

Madame, Monsieur,

Je vous demande de résilier le contrat n° [numéro], souscrit le [date], [motif : « en application de l'article L113-15-2 du code des assurances, ce contrat ayant plus d'un an » / « à son échéance du [date] »].

Je vous remercie de m'adresser une confirmation indiquant la date à laquelle la résiliation prend effet et, le cas échéant, de me rembourser la part de cotisation correspondant à la période non couverte.

Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.

Signature"""

GUIDES.append(dict(
    slug="resilier-assurance-abonnement",
    titre="Résilier une assurance ou un abonnement : vos droits, la bonne méthode",
    titre_court="Résilier une assurance ou un abonnement",
    description="Assurance auto ou habitation après un an, mutuelle, abonnements en ligne avec la résiliation en 3 clics : ce que dit la loi, qui envoie la demande, et une lettre type gratuite.",
    resume="Assurance après un an, mutuelle, résiliation en 3 clics, lettre type : comment arrêter un contrat sans frais inutiles.",
    chapo="Un contrat qui ne sert plus coûte chaque mois. Bonne nouvelle : la plupart des assurances et des abonnements se résilient bien plus facilement qu'avant. Voici les règles, et qui doit faire quoi.",
    corps=lambda: f"""
<nav class="sommaire" aria-label="Sommaire"><b>Sommaire</b><ol>
<li><a href="#assurance">Assurance auto et habitation</a></li><li><a href="#mutuelle">Mutuelle</a></li>
<li><a href="#trois-clics">Abonnements : la résiliation en 3 clics</a></li><li><a href="#lettre">Lettre type</a></li></ol></nav>

<h2 id="assurance">Assurance auto et habitation</h2>
<h3>Pendant la première année</h3>
<p>Vous pouvez résilier à la première échéance annuelle (le premier anniversaire du contrat). Pour l'assurance habitation, l'assureur doit vous envoyer un avis d'information qui rappelle ce droit, la date d'échéance et la date limite pour demander la résiliation, au moins 15 jours avant cette date limite. Vous pouvez aussi demander la résiliation sans attendre cet avis.</p>
<h3>Après la première année : à tout moment</h3>
<p>Une fois la première année passée, un particulier peut résilier son assurance auto ou habitation <b>à tout moment, sans pénalité et sans avoir à se justifier</b>. La résiliation prend effet 1 mois après sa réception par l'assureur, qui rembourse la part de cotisation de la période qui reste.</p>
<h3>Qui envoie la demande ?</h3>
{tableau(["Votre cas", "Qui s'en charge"], [
    ["Assurance auto", "Le nouvel assureur : vous souscrivez le nouveau contrat, il envoie lui-même la résiliation à l'ancien (le véhicule doit rester assuré sans interruption)"],
    ["Assurance habitation, vous êtes locataire", "Le nouvel assureur, pour la même raison : l'assurance est obligatoire pour le locataire"],
    ["Assurance habitation, vous êtes propriétaire", "Vous : en ligne (si le contrat a été souscrit en ligne ou si l'assureur propose la souscription en ligne), par lettre, sur place chez l'assureur ou son agent, ou par le même moyen à distance que celui de la souscription"],
])}
<p>Ces règles visent les particuliers : un contrat souscrit pour une activité professionnelle peut suivre d'autres conditions.</p>

<h2 id="mutuelle">Mutuelle (complémentaire santé)</h2>
<p>Depuis le 1<sup>er</sup> décembre 2020, une complémentaire santé individuelle se résilie aussi à tout moment après la première année d'adhésion, avec un effet 1 mois après la demande. Comme pour l'assurance auto, le plus simple est de souscrire la nouvelle complémentaire et de lui laisser faire la démarche, pour ne pas rester sans couverture.</p>

<h2 id="trois-clics">Abonnements : la résiliation « en 3 clics »</h2>
<p>Depuis le 1<sup>er</sup> juin 2023, les professionnels doivent proposer une <b>fonction de résiliation en ligne gratuite, permanente et facile d'accès</b> sur leur site ou leur application, signalée par une mention comme « résilier votre contrat ». Elle concerne notamment les assurances, les mutuelles, l'énergie, la téléphonie, internet ou la salle de sport, y compris pour un contrat signé en magasin ou par téléphone.</p>
<ol><li>Cliquer sur « résilier votre contrat ».</li><li>Remplir les informations demandées, vérifier le récapitulatif et valider.</li><li>Envoyer la demande avec le bouton de notification de la résiliation.</li></ol>
<p>L'entreprise doit accuser réception, puis vous indiquer la date et les effets de la résiliation. Attention : ce bouton change la <i>manière</i> de résilier, pas les conditions. Une période d'engagement, un préavis ou des frais prévus au contrat s'appliquent toujours.</p>

<h2 id="lettre">Lettre type de résiliation</h2>
<p>Pour un contrat sans bouton de résiliation, ou si vous préférez une trace papier, adaptez ce modèle et envoyez-le en recommandé avec avis de réception :</p>
<pre class="lettre">{html.escape(LETTRE)}</pre>
""",
    lucien="Lucien repère vos contrats et abonnements dans vos prélèvements bancaires, signale ceux qui augmentent en douce ou font doublon, rédige le courrier de résiliation et vérifie, relevé après relevé, que le prélèvement a bien disparu.",
    faq=[
        ("Peut-on résilier son assurance habitation à tout moment ?", "Oui, après la première année de contrat, sans pénalité ni justification. La résiliation prend effet 1 mois après sa réception par l'assureur. Locataire, c'est votre nouvel assureur qui envoie la demande."),
        ("Qui envoie la résiliation quand on change d'assurance auto ?", "Le nouvel assureur. Vous souscrivez le nouveau contrat et il se charge de résilier l'ancien, pour que le véhicule reste assuré sans interruption."),
        ("Qu'est-ce que la résiliation en 3 clics ?", "Depuis le 1er juin 2023, une fonction en ligne gratuite et facile d'accès permet de résilier un contrat ou un abonnement : un clic pour commencer, la validation du récapitulatif, puis l'envoi de la notification."),
        ("La résiliation en 3 clics supprime-t-elle l'engagement ou le préavis ?", "Non. Elle simplifie la démarche mais ne change pas les conditions du contrat : engagement, préavis ou frais éventuels restent valables."),
    ],
    sources=[
        ("Assurance habitation : résiliation du contrat — service-public.gouv.fr", SP + "F19083"),
        ("Assurance auto : résiliation du contrat — service-public.gouv.fr", SP + "F2659"),
        ("Modèle de lettre : résilier son contrat d'assurance en cours — service-public.gouv.fr", SP + "R21219"),
        ("Tout savoir sur la résiliation « en 3 clics » — Institut national de la consommation", "https://www.inc-conso.fr/node/15413"),
    ],
))

# ---------------------------------------------------------------------------------------------------------------
GUIDES.append(dict(
    slug="dossier-de-location-pieces-justificatives",
    titre="Dossier de location : les pièces que le propriétaire peut demander",
    titre_court="Dossier de location : les pièces autorisées",
    description="Identité, domicile, activité, ressources : la liste fixée par décret des justificatifs qu'un bailleur peut exiger du locataire et de sa caution, et ce qu'il n'a pas le droit de demander.",
    resume="La liste officielle des justificatifs pour le locataire et sa caution, et ce qui est interdit.",
    chapo="Pour louer un logement vide ou meublé, le propriétaire (ou l'agence) ne peut pas demander n'importe quoi : la liste des justificatifs autorisés est fixée par un décret. Tout le reste est interdit.",
    corps=lambda: f"""
<div class="note">Aucune somme d'argent ne peut être demandée pour réserver le logement avant la signature du bail.</div>

<h2 id="locataire">Ce que le propriétaire peut demander au futur locataire</h2>
{tableau(["Catégorie", "Justificatifs possibles"], [
    ["Identité <b>(1 seul)</b>", "Carte d'identité, passeport, permis de conduire, ou titre de séjour (carte de séjour temporaire, carte de résident, carte de ressortissant de l'Union européenne ou de l'EEE)"],
    ["Domicile actuel <b>(1 seul)</b>", "3 dernières quittances de loyer, attestation sur l'honneur de l'hébergeant, attestation d'élection de domicile, ou dernier avis de taxe foncière"],
    ["Activité professionnelle <b>(1 ou plusieurs)</b>", "Contrat de travail ou de stage, extrait K ou K bis, fiche d'immatriculation au registre national des entreprises, certificat INSEE, carte professionnelle, tout document récent attestant l'activité, carte d'étudiant ou certificat de scolarité de l'année"],
    ["Ressources <b>(1 ou plusieurs)</b>", "Dernier ou avant-dernier avis d'imposition ou de non-imposition, 3 derniers bulletins de salaire, 2 derniers bilans, justificatifs de pensions, retraites, prestations ou allocations des 3 derniers mois, titre de propriété ou dernier avis de taxe foncière, justificatif de revenus fonciers ou de capitaux, simulation des aides au logement, indemnités de stage, avis de bourse"],
])}

<h2 id="caution">Ce qui peut être demandé à la caution</h2>
<p>Pour une <b>caution personne physique</b> : une pièce d'identité, un justificatif de domicile (dernière quittance, facture d'eau, de gaz ou d'électricité, attestation d'assurance logement ou dernier avis de taxe foncière), et des justificatifs d'activité et de ressources du même type que pour le locataire.</p>
<p>Pour une <b>société</b> qui se porte caution : un extrait K bis ou les statuts, et l'identité de son représentant. Avec la garantie <b>Visale</b> d'Action Logement, le propriétaire reçoit seulement le visa remis au locataire.</p>

<h2 id="interdit">Ce qui est interdit</h2>
<p>Le propriétaire ne peut exiger que les pièces de ces listes. Il ne peut donc pas demander, par exemple, un extrait de casier judiciaire ou un relevé de compte bancaire. Ces règles viennent du décret n° 2015-1437 du 5 novembre 2015. Demander une pièce non autorisée expose à une amende pouvant aller jusqu'à 3 000 € pour un particulier et 15 000 € pour une société.</p>
""",
    lucien="Lucien prépare votre dossier de location : il rassemble les pièces de la liste, signale celles qui sont trop anciennes ou manquantes, dit où les obtenir, et en fait un seul fichier avec un bordereau, prêt à envoyer.",
    faq=[
        ("Le propriétaire peut-il demander mes relevés de compte ?", "Non. Le relevé de compte bancaire ne fait pas partie des justificatifs autorisés par le décret du 5 novembre 2015."),
        ("Combien de bulletins de salaire faut-il fournir ?", "Le propriétaire peut demander les 3 derniers bulletins de salaire, parmi les justificatifs de ressources possibles."),
        ("Peut-on me demander de l'argent pour réserver le logement ?", "Non. Aucune somme ne peut être réclamée avant la signature du bail."),
        ("Que risque un bailleur qui demande une pièce interdite ?", "Une amende pouvant aller jusqu'à 3 000 € pour une personne physique et 15 000 € pour une personne morale."),
    ],
    sources=[
        ("Futur locataire d'un logement privé : justificatifs à donner au propriétaire — service-public.gouv.fr", SP + "F1169"),
        ("Je prépare mon dossier de location : quels justificatifs le propriétaire peut-il demander ? — ADIL de Loire-Atlantique (juin 2026)", "https://www.anil.org/adil-44/les-info-semaines-de-ladil/190626-je-prepare-mon-dossier-de-location-quels-justificatifs-le-proprietaire-peut-il-demander/"),
    ],
))

# ---------------------------------------------------------------------------------------------------------------
GUIDES.append(dict(
    slug="demenagement-demarches",
    titre="Déménagement : la liste des démarches, dans l'ordre",
    titre_court="Déménagement : la liste des démarches",
    description="Préavis, état des lieux, assurance, énergie, courrier, changement d'adresse en ligne, carte grise, listes électorales : toutes les démarches d'un déménagement, avant, pendant et après.",
    resume="Préavis, assurance, énergie, courrier, changement d'adresse, carte grise : la checklist avant, pendant et après.",
    chapo="Un déménagement, c'est une vingtaine de démarches à caser entre les cartons. Voici la liste, dans l'ordre où elles se posent.",
    corps=lambda: f"""
<h2 id="avant">Avant le départ</h2>
<ul>
<li><b>Donner congé</b> (si vous êtes locataire) au propriétaire ou à l'agence, en respectant le préavis : 1 ou 3 mois selon le logement et votre situation. <a href="{SP}F1168">Voir les règles du préavis</a>.</li>
<li><b>Prévoir l'état des lieux de sortie</b> avec le propriétaire ou l'agence (un commissaire de justice peut le faire en cas de désaccord).</li>
<li><b>Choisir le déménageur</b> : le devis est gratuit, le professionnel est responsable en cas de perte ou de casse et peut vous indemniser en cas de retard. Vérifiez qu'il est inscrit au registre des transporteurs.</li>
<li><b>Demander vos jours de congé</b> si votre convention collective ou votre statut en prévoit pour un déménagement.</li>
<li><b>Enfants</b> : inscrire les enfants dans leur nouvel établissement, ou voir s'ils peuvent rester dans l'ancien ; prévoir la garde et les transports.</li>
<li>Regarder les <b>aides au paiement des frais de déménagement</b> auxquelles vous pourriez avoir droit.</li>
</ul>

<h2 id="contrats">Les contrats à transférer ou à résilier</h2>
<ul>
<li><b>Assurance habitation</b> : le nouveau logement doit être assuré dès votre entrée. Le déménagement permet aussi de résilier l'ancien contrat. <a href="../resilier-assurance-abonnement/">Comment résilier une assurance</a>.</li>
<li><b>Électricité, gaz, eau, téléphone, internet</b> : résilier ou transférer chaque contrat, relever les compteurs le jour du départ et le jour de l'arrivée.</li>
<li><b>Courrier</b> : La Poste propose un service payant de réexpédition vers la nouvelle adresse.</li>
</ul>

<h2 id="adresse">Prévenir de votre nouvelle adresse</h2>
<ul>
<li><b>Une déclaration en ligne unique</b> permet de prévenir en une fois plusieurs organismes : Assurance maladie, impôts, Caf, France Travail, fournisseurs d'énergie… (service « Déclaration de changement de coordonnées » sur service-public.gouv.fr).</li>
<li><b>Banque, assurances, mutuelle, employeur, syndic</b> de copropriété : à prévenir directement.</li>
<li><b>Carte grise</b> : la nouvelle adresse doit y être inscrite. En leasing ou location longue durée, c'est l'organisme loueur qui fait la démarche.</li>
<li><b>Listes électorales</b> : l'inscription dans la nouvelle commune est possible toute l'année, en ligne, mais il y a une date limite pour voter à une élection donnée.</li>
</ul>
<p>Gardez le contrat de déménagement au moins 1 an, et le bail, l'état des lieux et les quittances de l'ancien logement 3 ans après votre départ. <a href="../combien-de-temps-garder-ses-papiers/">Toutes les durées de conservation</a>.</p>
""",
    lucien="Dans Lucien, choisissez « Déménagement » dans les Situations de vie avec la date : chaque démarche arrive dans votre agenda au bon moment, reliée à vos contrats, avec les courriers prêts (congé au bailleur, changement d'adresse).",
    faq=[
        ("Quel préavis pour quitter un logement loué ?", "1 ou 3 mois selon le logement et votre situation. Le congé se donne au propriétaire ou à l'agence ; service-public.gouv.fr détaille les cas."),
        ("Peut-on prévenir tous les organismes en une fois ?", "Oui, en partie : la déclaration de changement de coordonnées en ligne prévient notamment l'Assurance maladie, les impôts, la Caf, France Travail et des fournisseurs d'énergie. La banque, l'employeur ou le syndic se préviennent à part."),
        ("Faut-il changer l'adresse de sa carte grise ?", "Oui, c'est obligatoire. Pour un véhicule en leasing ou en location longue durée, c'est l'organisme loueur qui s'en charge."),
    ],
    sources=[
        ("Je déménage — service-public.gouv.fr", SP + "F14128"),
        ("Préavis et formalités du congé donné par le locataire — service-public.gouv.fr", SP + "F1168"),
    ],
))


# --------------------------------------------------------------------------------------------------------------- vérifiés le 6/11/2026
NOV6 = dict(verifie="2026-11-06", verifie_fr="6 novembre 2026")

GUIDES.append(dict(**NOV6,
    slug="trouver-ses-abonnements-oublies",
    titre="Abonnements oubliés : comment les retrouver et les arrêter",
    titre_court="Retrouver ses abonnements oubliés",
    description="Streaming, applis, box, salle de sport, assurances en double : la méthode pour repérer les prélèvements qui ne servent plus sur vos relevés, et les arrêter sans frais inutiles.",
    resume="La méthode pour repérer sur vos relevés les prélèvements qui ne servent plus, et les arrêter.",
    chapo="Un abonnement à quelques euros passe inaperçu sur un relevé. Cinq ou six, oubliés depuis des mois, pèsent vite plusieurs centaines d'euros par an. Voici comment les débusquer, en une demi-heure.",
    corps=lambda: f"""
<h2 id="ou-chercher">Où chercher</h2>
<ul>
<li><b>Vos relevés bancaires des 12 derniers mois</b>, pas seulement du dernier : les abonnements annuels (antivirus, stockage en ligne, assurance d'un téléphone) ne passent qu'une fois par an.</li>
<li><b>Les libellés « PRLV SEPA »</b> : ce sont les prélèvements. Le nom du créancier suit souvent juste après, avant des références techniques.</li>
<li><b>Les paiements par carte qui reviennent chaque mois au même montant</b> : beaucoup d'applis et de plateformes passent par la carte, pas par un prélèvement.</li>
<li><b>Les achats intégrés de votre téléphone</b> : sur iPhone et Android, la liste des abonnements actifs se trouve dans les réglages du compte (App Store ou Google Play).</li>
<li><b>Votre boîte mail</b> : cherchez « abonnement », « renouvellement », « votre facture » ou « période d'essai ».</li>
</ul>

<h2 id="trier">Faire le tri</h2>
{tableau(["Signal", "Ce qu'il faut se demander"], [
    ["Un service que personne n'a utilisé depuis trois mois", "On l'arrête. On pourra toujours se réabonner le jour où on en a besoin."],
    ["Deux services qui font la même chose (deux plateformes vidéo, deux stockages en ligne)", "On garde le plus utilisé."],
    ["Une garantie déjà couverte ailleurs (assurance du téléphone, protection juridique, assistance)", "La carte bancaire ou l'assurance habitation la couvre parfois déjà : on vérifie avant de payer deux fois."],
    ["Un prix qui a augmenté depuis la souscription", "On compare avec l'offre actuelle du même fournisseur ou d'un concurrent."],
    ["Une période d'essai gratuite qui se transforme en abonnement", "On l'arrête avant la date de fin de l'essai."],
])}

<h2 id="arreter">Arrêter proprement</h2>
<ul>
<li>Utilisez la <b>fonction de résiliation en ligne</b> que les professionnels doivent proposer depuis juin 2023, ou la lettre type de notre guide. <a href="../resilier-assurance-abonnement/">Résilier une assurance ou un abonnement</a>.</li>
<li>Gardez la <b>confirmation de résiliation</b>, et vérifiez sur les relevés suivants que le prélèvement a bien disparu.</li>
<li>Pour une box ou un décodeur, gardez la <b>preuve de restitution du matériel</b> 5 ans.</li>
</ul>
<div class="note">Arrêter un abonnement chez le fournisseur ne suffit pas toujours : si un prélèvement continue après la résiliation, contactez d'abord le fournisseur avec votre confirmation, puis votre banque.</div>
""",
    lucien="Lucien lit vos relevés pour vous : il repère chaque abonnement, prélèvement ou paiement par carte qui revient, signale ceux qui augmentent, font doublon ou ne servent plus, prépare la résiliation et vérifie chaque mois que le prélèvement a bien disparu.",
    faq=[
        ("Comment savoir quels abonnements je paie ?", "Parcourez vos relevés des 12 derniers mois : les prélèvements (libellés « PRLV SEPA »), les paiements par carte qui reviennent au même montant, et la liste des abonnements de votre téléphone dans l'App Store ou Google Play."),
        ("Combien de temps garder la preuve d'une résiliation ?", "Gardez la confirmation au moins jusqu'à ce que les prélèvements aient cessé. Pour une box ou un décodeur, la preuve de restitution du matériel se garde 5 ans."),
        ("Que faire si un prélèvement continue après la résiliation ?", "Contactez le fournisseur avec votre confirmation de résiliation, puis votre banque si le prélèvement continue."),
    ],
    sources=[
        ("Durée de conservation des papiers — service-public.gouv.fr", SP + "F19134"),
        ("Tout savoir sur la résiliation « en 3 clics » — Institut national de la consommation", "https://www.inc-conso.fr/node/15413"),
    ],
))

GUIDES.append(dict(**NOV6,
    slug="changer-de-banque",
    titre="Changer de banque : la mobilité bancaire, gratuite, étape par étape",
    titre_court="Changer de banque",
    description="Le service d'aide à la mobilité bancaire est gratuit : la nouvelle banque s'occupe de prévenir ceux qui vous prélèvent ou vous versent de l'argent. Comment il fonctionne, quels comptes sont concernés, les délais.",
    resume="Le service gratuit de mobilité bancaire : qui fait quoi, quels comptes, quels délais.",
    chapo="Frais de tenue de compte, carte trop chère, conseiller injoignable : changer de banque fait moins peur quand on sait que c'est la nouvelle banque qui fait l'essentiel des démarches, gratuitement.",
    corps=lambda: f"""
<h2 id="principe">Le principe</h2>
<p>Le <b>service d'aide à la mobilité bancaire</b> est gratuit. C'est la <b>nouvelle banque</b> qui le propose et s'en charge : elle prévient les organismes qui prélèvent de l'argent sur votre compte ou qui vous en versent par virement (employeur, Caf, impôts, fournisseurs…) de votre nouveau compte.</p>
<p>Il concerne les comptes de dépôt et de paiement des particuliers, utilisés pour des besoins non professionnels. Les livrets et les comptes à terme n'en font pas partie.</p>

<h2 id="etapes">Les étapes</h2>
<ol>
<li><b>Choisir la nouvelle banque</b> et y ouvrir le compte.</li>
<li><b>Signer l'accord de mobilité</b> : vous donnez votre accord écrit à la nouvelle banque pour qu'elle fasse les démarches. Dans cet accord, vous demandez l'annulation des virements permanents de l'ancien compte et la date de leur dernier envoi.</li>
<li><b>Choisir de fermer ou non l'ancien compte</b>. Si vous le fermez, vous indiquez à partir de quelle date le solde est transféré sur le nouveau compte.</li>
<li><b>Laisser les organismes s'adapter</b> : ceux qui vous prélèvent ou vous versent de l'argent ont 10 jours ouvrés pour enregistrer le changement, et vous en informent.</li>
</ol>

<h2 id="apres">Après la fermeture de l'ancien compte</h2>
<p>Pendant 13 mois, l'ancienne banque doit vous prévenir gratuitement, dans les 3 jours ouvrés, si un prélèvement, un virement ou un chèque se présente sur le compte fermé. Pensez donc à <b>vérifier vos chèques non encaissés</b> avant la fermeture.</p>
<div class="note">Les banques doivent publier une brochure d'information sur la mobilité bancaire sur leur site. En cas de problème, vous pouvez saisir le service réclamations de la banque, puis son médiateur.</div>
""",
    lucien="Lucien range vos frais bancaires parmi vos dépenses et liste tous les prélèvements et virements réguliers de vos comptes : pratique pour choisir sa banque, puis pour vérifier après le changement que rien n'est resté sur l'ancien compte.",
    faq=[
        ("Changer de banque est-il payant ?", "Non. Le service d'aide à la mobilité bancaire est gratuit ; c'est la nouvelle banque qui le propose."),
        ("Qui prévient l'employeur, la Caf ou les fournisseurs ?", "La nouvelle banque, avec votre accord écrit. Les organismes ont ensuite 10 jours ouvrés pour enregistrer le changement de compte."),
        ("Mon livret A est-il transféré aussi ?", "Non : les livrets et les comptes à terme ne sont pas concernés par le service de mobilité bancaire."),
        ("Que se passe-t-il si un chèque arrive sur l'ancien compte fermé ?", "Pendant 13 mois, l'ancienne banque doit vous prévenir gratuitement dans les 3 jours ouvrés, avec les conséquences du rejet et les moyens de régulariser."),
    ],
    sources=[("Changer de banque : qu'est-ce que la mobilité bancaire ? — service-public.gouv.fr (vérifié le 21 septembre 2026)", SP + "F33881")],
))

GUIDES.append(dict(**NOV6,
    slug="changer-assurance-emprunteur",
    titre="Assurance de prêt immobilier : en changer à tout moment, sans frais",
    titre_court="Changer d'assurance emprunteur",
    description="Depuis la loi Lemoine, l'assurance d'un prêt immobilier se change à tout moment et sans frais, à garanties équivalentes. La marche à suivre et le délai de réponse de la banque.",
    resume="Depuis la loi Lemoine : à tout moment, sans frais, à garanties équivalentes. La marche à suivre.",
    chapo="L'assurance emprunteur pèse souvent lourd dans le coût total d'un crédit immobilier. Depuis 2022, on peut en changer quand on veut : c'est l'une des économies les plus importantes à portée d'une famille propriétaire.",
    corps=lambda: f"""
<h2 id="regle">La règle</h2>
<p>Depuis la loi n° 2022-270 du 28 février 2022 (dite loi Lemoine), l'assurance d'un prêt immobilier peut être <b>résiliée à tout moment et sans frais</b> : depuis le 1<sup>er</sup> juin 2022 pour les nouveaux prêts, et depuis le 1<sup>er</sup> septembre 2022 pour tous les contrats en cours, y compris les plus anciens.</p>
<p>Une seule condition : le nouveau contrat doit offrir des <b>garanties équivalentes</b> à celles exigées par la banque.</p>

<h2 id="etapes">Les étapes</h2>
<ol>
<li><b>Récupérer la liste des garanties exigées</b> par votre banque (décès, invalidité, incapacité…) et votre contrat actuel.</li>
<li><b>Comparer</b> des offres à garanties équivalentes, et faire établir le nouveau contrat.</li>
<li><b>Demander la substitution à la banque</b> en lui envoyant le nouveau contrat. Elle a <b>10 jours</b> pour répondre. Si elle refuse, elle doit motiver son refus (par exemple des garanties non équivalentes).</li>
<li><b>Si elle accepte</b>, elle modifie le contrat de prêt par un avenant dans les 10 jours ouvrés, avec le nouveau taux annuel effectif global.</li>
<li><b>Résilier l'ancien contrat</b> en transmettant l'accord de la banque à l'ancien assureur. Une lettre recommandée n'est pas obligatoire.</li>
</ol>
<div class="note">Chaque année, votre assureur doit vous rappeler votre droit de résilier et les modalités pour le faire. C'est le bon moment pour comparer.</div>
""",
    lucien="Dans Lucien, la situation de vie « Obtenir un prêt immobilier » prévoit de comparer l'assurance avant la signature, puis vous rappelle chaque année de la revoir : la concurrence joue tant que le prêt court.",
    faq=[
        ("Peut-on changer d'assurance emprunteur à tout moment ?", "Oui, depuis le 1er septembre 2022 pour tous les contrats, sans frais, à condition que le nouveau contrat offre des garanties équivalentes."),
        ("Combien de temps la banque a-t-elle pour répondre ?", "10 jours. En cas de refus, elle doit en donner les motifs. En cas d'accord, elle établit un avenant au prêt dans les 10 jours ouvrés."),
        ("La banque peut-elle facturer le changement ?", "Non, la résiliation se fait sans frais pour l'assuré."),
    ],
    sources=[("Assurance emprunteur : la résiliation infra-annuelle ouverte à tous les contrats à compter du 1er septembre 2022 — Previssima", "https://www.previssima.fr/actualite/assurance-emprunteur-la-resiliation-infra-annuelle-ouverte-a-tous-les-contrats-a-compter-du-1er-septembre-2022.html")],
))

GUIDES.append(dict(**NOV6,
    slug="renouveler-carte-identite",
    titre="Renouveler sa carte d'identité : quand, où, quels documents",
    titre_court="Renouveler sa carte d'identité",
    description="Renouvellement de la carte d'identité d'un majeur : dès l'année qui précède l'expiration, dans n'importe quelle mairie équipée, gratuit avec l'ancienne carte. Documents à apporter et délais.",
    resume="Dès l'année avant l'expiration, dans n'importe quelle mairie équipée, gratuit avec l'ancienne carte.",
    chapo="Une carte d'identité expirée, on s'en aperçoit souvent la veille d'un voyage. Les délais de rendez-vous et de fabrication se comptent en semaines : mieux vaut s'y prendre tôt.",
    corps=lambda: f"""
<h2 id="quand">Quand faire la demande</h2>
<p>Vous pouvez demander le renouvellement <b>dans l'année qui précède la date d'expiration</b> de votre carte. Si vous avez une carte ancien modèle, vous pouvez aussi demander un renouvellement anticipé pour obtenir le nouveau format.</p>
<p>La demande est <b>gratuite</b> si vous présentez l'ancienne carte.</p>

<h2 id="ou">Où et comment</h2>
<ol>
<li><b>Choisir la mairie</b> : n'importe quelle mairie équipée d'une station d'enregistrement, pas forcément celle de votre domicile. Beaucoup ne reçoivent que sur rendez-vous.</li>
<li><b>Faire la pré-demande en ligne</b> (conseillée pour gagner du temps, obligatoire pour passer d'une carte ancien modèle au nouveau format), et noter son numéro ou garder son QR code.</li>
<li><b>Déposer le dossier en personne</b> avec les documents originaux.</li>
<li><b>Suivre la fabrication</b> : comptez plusieurs semaines, davantage à l'approche de l'été. Un SMS prévient quand la carte est prête si vous avez donné un numéro de portable.</li>
<li><b>Retirer la carte vous-même</b> à l'endroit du dépôt, dans les 3 mois, en rendant l'ancienne. Passé ce délai, elle est détruite.</li>
</ol>

<h2 id="documents">Les documents à apporter</h2>
{tableau(["Votre situation", "Documents"], [
    ["Carte en cours de validité, ou périmée depuis moins de 5 ans", "La carte actuelle, 1 photo d'identité de moins de 6 mois aux normes, 1 justificatif de domicile de moins de 1 an, le numéro de pré-demande"],
    ["Carte périmée depuis plus de 5 ans, avec un passeport valide", "Le passeport et la carte, 1 photo de moins de 6 mois, 1 justificatif de domicile de moins de 1 an, le numéro de pré-demande"],
])}
<p>La nouvelle carte, au format carte bancaire, est <b>valable 10 ans</b>.</p>
""",
    lucien="Rangez vos cartes d'identité et passeports dans Lucien : il relève leur date de fin de validité et vous prévient six mois avant, pour toute la famille, en rappelant la pré-demande en ligne.",
    faq=[
        ("Quand peut-on renouveler sa carte d'identité ?", "Dans l'année qui précède sa date d'expiration. Une carte ancien modèle peut aussi être renouvelée par anticipation pour obtenir le nouveau format."),
        ("Le renouvellement est-il payant ?", "Non, il est gratuit si vous présentez l'ancienne carte."),
        ("Faut-il aller à la mairie de son domicile ?", "Non, n'importe quelle mairie équipée d'une station d'enregistrement convient, souvent sur rendez-vous."),
        ("Combien de temps la nouvelle carte est-elle valable ?", "10 ans."),
    ],
    sources=[("Renouvellement de la carte d'identité d'un majeur — service-public.gouv.fr (vérifié le 13 mai 2026)", SP + "F21089")],
))

GUIDES.append(dict(**NOV6,
    slug="demarches-apres-un-deces",
    titre="Décès d'un proche : les démarches, dans l'ordre",
    titre_court="Démarches après un décès",
    description="Déclaration en mairie dans les 24 heures, obsèques, banques, organismes sociaux, papiers, impôts, succession : les démarches après le décès d'un proche, dans l'ordre où elles se présentent.",
    resume="Mairie, obsèques, banques, organismes, impôts, succession : ce qu'il faut faire, et quand.",
    chapo="Dans les jours qui suivent un décès, les démarches s'enchaînent alors qu'on a la tête ailleurs. Voici l'essentiel, dans l'ordre, pour ne rien oublier et pouvoir déléguer.",
    corps=lambda: f"""
<h2 id="premiers-jours">Les premiers jours</h2>
<ol>
<li><b>Faire constater le décès</b> par un médecin, qui établit le certificat de décès.</li>
<li><b>Prévenir les proches</b> et sécuriser le logement de la personne.</li>
<li><b>Déclarer le décès à la mairie</b> du lieu du décès, <b>dans les 24 heures</b>. C'est gratuit et sans rendez-vous ; les pompes funèbres s'en chargent souvent.</li>
<li><b>Prévenir l'employeur</b> de la personne si elle travaillait, et demander à votre propre employeur le congé prévu pour un décès.</li>
<li><b>Vérifier les dernières volontés</b> (obsèques, don du corps…) et l'existence d'un contrat obsèques.</li>
<li><b>Organiser les obsèques.</b> Le devis des pompes funèbres est gratuit et sans engagement.</li>
</ol>

<h2 id="banques">Les banques</h2>
<p>Un héritier, un proche ou le notaire prévient chaque banque où la personne avait un compte, puis confirme par lettre recommandée. Pour connaître tous ses comptes en France, les héritiers peuvent interroger gratuitement le fichier national des comptes bancaires (<b>Ficoba</b>).</p>
<p>Les frais facturés par la banque pour la succession sont <b>plafonnés à 1 % du total des comptes et de l'épargne, sans dépasser 857 €</b>.</p>

<h2 id="obseques">Les frais d'obsèques</h2>
<p>S'ils n'ont pas été réglés par un contrat obsèques, ils reviennent aux héritiers, même s'ils renoncent à la succession, à proportion de ce que chacun reçoit. Si la famille n'a pas les ressources suffisantes, la commune peut les prendre en charge. Renseignez-vous aussi auprès de la caisse de retraite, de la mutuelle, des assurances ou de l'employeur.</p>

<h2 id="ensuite">Les semaines et les mois suivants</h2>
<ul>
<li><b>Organismes sociaux</b> : retraite, Assurance maladie, Caf. Le conjoint survivant peut avoir droit à une <b>pension de réversion</b> (à partir de 55 ans) ou à l'allocation veuvage.</li>
<li><b>Particulier employeur</b> : s'occuper du contrat du salarié à domicile.</li>
<li><b>Logement, contrats et abonnements</b> : bail, énergie, box, assurances, véhicules.</li>
<li><b>Impôts</b> : les règles dépendent de la situation (marié, pacsé, enfant rattaché au foyer).</li>
<li><b>Succession</b> : rassembler les documents (actes, relevés, titres de propriété, contrats d'assurance-vie) pour le notaire.</li>
</ul>
<p>Les papiers de la personne décédée se conservent selon des durées propres : <a href="../combien-de-temps-garder-ses-papiers/">voir les durées de conservation</a>.</p>
""",
    lucien="Dans Lucien, la situation de vie « Décès d'un proche » place chaque démarche dans votre agenda à la bonne date, de la première semaine aux premiers mois, et relie les contrats à résilier ou à transférer.",
    faq=[
        ("Dans quel délai faut-il déclarer un décès ?", "Dans les 24 heures, à la mairie du lieu du décès. La déclaration est gratuite et se fait sans rendez-vous ; les pompes funèbres s'en chargent souvent."),
        ("Comment connaître tous les comptes bancaires d'un proche décédé ?", "Les héritiers peuvent interroger gratuitement le fichier Ficoba, par courrier, avec l'acte de décès, un justificatif d'identité et un document prouvant leur qualité d'héritier."),
        ("Combien la banque peut-elle facturer pour la succession ?", "Au plus 1 % du solde total des comptes et de l'épargne du défunt, sans dépasser 857 €."),
        ("Qui paie les obsèques ?", "Les héritiers, à proportion de ce que chacun reçoit, même s'ils renoncent à la succession, sauf si un contrat obsèques les a déjà réglées."),
    ],
    sources=[("Un proche est décédé — service-public.gouv.fr (vérifié le 1er octobre 2026)", SP + "F16507")],
))


# ---------------------------------------------------------------------------------------------------------------
def entete(chemin_racine: str) -> str:
    return f"""<header class="nav">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Lucien, accueil">{LOGO}Lucien</a>
    <nav>
      <a class="nav-g" href="/guides/">Guides</a>
      <a class="nav-g" href="/#economies">Économies</a>
      <a class="btn" href="/#inscription">Découvrir Lucien</a>
    </nav>
  </div>
</header>"""

PIED = """<footer>
  <div class="wrap">
    <span>© 2026 Lucien · Fait en Occitanie</span>
    <span><a href="/guides/">Guides</a> · <a href="/mentions-legales.html">Mentions légales</a> · <a href="/cgu.html">CGU</a> · <a href="/confidentialite.html">Confidentialité</a> · bonjour@monlucien.fr</span>
  </div>
</footer>"""

def page(titre, description, url, corps, ld, og_type="article"):
    t = html.escape(titre, quote=True); d = html.escape(description, quote=True)
    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{t} | Lucien</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{url}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{url}">
<meta property="og:type" content="{og_type}">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="Lucien">
<meta property="og:image" content="{BASE}img/partage.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{BASE}img/partage.png">
<meta name="theme-color" content="#FBF4F0">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/fonts.css">
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="/guides.css">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")}</script>
</head>
<body>
{entete("/")}
<main class="guide">
  <div class="wrap">
{corps}
  </div>
</main>
{PIED}
</body>
</html>
"""

def texte(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()

def generer(dossier: Path):
    racine = dossier / "guides"
    racine.mkdir(exist_ok=True)
    organisation = {"@type": "Organization", "@id": BASE + "#organisation", "name": "Lucien", "url": BASE, "logo": BASE + "apple-touch-icon.png"}
    for g in GUIDES:
        url = f"{BASE}guides/{g['slug']}/"
        autres = [x for x in GUIDES if x is not g]
        faq = "".join(f"<details><summary>{html.escape(q)}</summary><p>{html.escape(r)}</p></details>" for q, r in g["faq"])
        sources = "".join(f'<li><a href="{u}" rel="noopener">{html.escape(n)}</a></li>' for n, u in g["sources"])
        lire = "".join(f'<li><a href="../{x["slug"]}/"><b>{html.escape(x["titre_court"])}</b><span>{html.escape(x["resume"])}</span></a></li>' for x in autres)
        corps = f"""<nav class="fil" aria-label="Fil d'Ariane"><a href="/">Lucien</a> › <a href="/guides/">Guides</a> › {html.escape(g['titre_court'])}</nav>
<h1>{html.escape(g['titre'])}</h1>
<p class="chapo">{html.escape(g['chapo'])}</p>
<p class="verif">Vérifié le {g.get('verifie_fr', VERIFIE_FR)} d'après les sources officielles citées en bas de page.</p>
{g['corps']()}
<aside class="encart">
  <h2>Lucien le fait pour vous</h2>
  <p>{html.escape(g['lucien'])}</p>
  <a class="btn" href="/#inscription">Découvrir Lucien</a>
</aside>
<h2 id="questions">Questions fréquentes</h2>
{faq}
<h2 id="sources">Sources</h2>
<ul class="sources">{sources}</ul>
<h2>À lire aussi</h2>
<ul class="cartes">{lire}</ul>"""
        ld = {"@context": "https://schema.org", "@graph": [
            organisation,
            {"@type": "Article", "headline": g["titre"], "description": g["description"], "inLanguage": "fr", "url": url, "mainEntityOfPage": url,
             "datePublished": g.get("verifie", VERIFIE), "dateModified": g.get("verifie", VERIFIE), "image": BASE + "img/partage.png",
             "author": {"@id": BASE + "#organisation"}, "publisher": {"@id": BASE + "#organisation"}},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Lucien", "item": BASE},
                {"@type": "ListItem", "position": 2, "name": "Guides", "item": BASE + "guides/"},
                {"@type": "ListItem", "position": 3, "name": g["titre_court"], "item": url}]},
            {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": r}} for q, r in g["faq"]]},
        ]}
        (racine / g["slug"]).mkdir(exist_ok=True)
        (racine / g["slug"] / "index.html").write_text(page(g["titre"], g["description"], url, corps, ld))
    # the guides' home
    url = BASE + "guides/"
    cartes = "".join(f'<li><a href="{g["slug"]}/"><b>{html.escape(g["titre_court"])}</b><span>{html.escape(g["resume"])}</span></a></li>' for g in GUIDES)
    corps = f"""<nav class="fil" aria-label="Fil d'Ariane"><a href="/">Lucien</a> › Guides</nav>
<h1>Guides pratiques pour les papiers de la famille</h1>
<p class="chapo">Conservation des papiers, résiliations, location, déménagement : les règles utiles, vérifiées sur les sources officielles et expliquées simplement.</p>
<ul class="cartes">{cartes}</ul>
<aside class="encart">
  <h2>Et si quelqu'un s'en occupait ?</h2>
  <p>Lucien range les papiers de votre famille, vous prévient avant chaque échéance et trouve les économies faciles dans vos dépenses.</p>
  <a class="btn" href="/#inscription">Découvrir Lucien</a>
</aside>"""
    ld = {"@context": "https://schema.org", "@graph": [organisation,
        {"@type": "CollectionPage", "name": "Guides pratiques Lucien", "url": url, "inLanguage": "fr",
         "hasPart": [{"@type": "Article", "headline": g["titre"], "url": f"{url}{g['slug']}/"} for g in GUIDES]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Lucien", "item": BASE},
            {"@type": "ListItem", "position": 2, "name": "Guides", "item": url}]}]}
    (racine / "index.html").write_text(page("Guides pratiques pour les papiers de la famille", "Combien de temps garder ses papiers, résilier une assurance ou un abonnement, dossier de location, déménagement : des guides clairs, vérifiés sur les sources officielles.", url, corps, ld, "website"))
    print(f"{racine} : {len(GUIDES)} guides + sommaire")

for d in sys.argv[1:] or ["site"]:
    generer(Path(d))
