# Lucien — le majordome de votre famille

> Anciennement « Nidou » (renommé le 30/10/2026). Les anciens réglages restent compris : variables `NIDOU_*` (lues comme `LUCIEN_*`), base `nidou.sqlite` (reprise sous `lucien.sqlite` au démarrage), cookie `nidou_session`, en-tête `x-nidou-secret` et adresses `nid-<code>@`.

Prototype fonctionnel : papiers et échéances, charges fixes, analyse des dépenses réelles (import de relevés bancaires) avec économies faciles, notifications, courriers, connecteur MCP en lecture, PWA mobile.

## Lancer en local

Prérequis : Node 22 ou plus récent.

```bash
npm install
cp server/.env.example server/.env   # puis renseigner ANTHROPIC_API_KEY
npm run build --workspace=web        # construit la PWA
LUCIEN_SEED=1 npm start --workspace=server
```

Ouvrir http://localhost:3000. Sans `ANTHROPIC_API_KEY`, l'extraction tourne en mode heuristique (champs à vérifier) ; avec la clé, Claude lit photos, PDF et textes.

En développement : `npm run dev` lance le serveur (port 3000) et Vite (port 5173, avec proxy vers l'API).

## Comptes et foyer partagé

- Connexion **sans mot de passe** : `POST /api/auth/demander {email}` envoie un lien (valable 30 min, usage unique) ; `GET /api/auth/lien?token=…` ouvre une session (cookie `lucien_session`, 90 jours, HttpOnly). Première connexion = création du compte et du nid, avec l'essai de 15 jours.
- **Invitation** du conjoint ou d'un proche : `POST /api/invitations {email, prenom}` envoie un lien de 7 jours qui rattache le compte au même foyer (rôle `membre` ; l'inviteur est `proprietaire`). `GET /api/foyer/comptes`, `DELETE /api/foyer/comptes/:user_id` (propriétaire), `DELETE /api/invitations/:token`. Gratuit : 2 comptes ; Famille : 6.
- Emails via Brevo (`BREVO_API_KEY`, `LUCIEN_EMAIL_FROM`) ; sans clé, le lien est affiché dans la console et renvoyé dans la réponse (`lien`) pour le développement.
- Sans `STRIPE_SECRET_KEY`, les abonnements sont indisponibles (« bientôt disponible »). `LUCIEN_PAIEMENT_SIMULE=1` active un paiement simulé, sans encaissement, réservé au titulaire du foyer : uniquement sur une instance de test, jamais en production.
- Offre (server/src/offre.ts) : socle Solo/Duo/Tribu + modules (Budget expert, Vie pro Salarié/Indépendant, Patrimoine locatif, Demander à Lucien, Veille) + packs. Pendant l'essai, tous les modules sont ouverts ; la souscription des modules n'est pas encore branchée sur Stripe (simulée seulement avec `LUCIEN_PAIEMENT_SIMULE=1`).
- `LUCIEN_AUTH=0` conserve le prototype mono-foyer sans connexion (tests, démo locale). Avec `LUCIEN_SEED=1`, le compte `demo@monlucien.fr` possède la famille de démonstration.
- Le connecteur MCP s'authentifie avec le **jeton du foyer** (`households.mcp_token`, affiché et régénérable dans les réglages) ; refusé hors plan Famille (`402`).

## Formules et paiement (Stripe)

- **Gratuit** : 1 personne connectée. **Solo** 6,90 € / mois ou 69 € / an (1 personne), **Duo** 9,90 € ou 99 € (2 personnes), **Tribu** 13,90 € ou 139 € (jusqu'à 6). L'annuel vaut 10 mois. On compte les personnes qui se connectent ; les fiches sans connexion (enfants, parents âgés) sont illimitées partout. L'essai de 15 jours donne Tribu.
- `server/src/abonnement.ts` : `FORMULES`, `capaciteComptes()`. Les invitations au-delà de la capacité sont refusées (`402 limite_comptes`) ; si un foyer passe à une formule plus petite (fin d'essai, changement dans le portail Stripe), les comptes en trop sont mis en pause (`402 compte_en_pause`), le propriétaire puis les plus anciens gardent l'accès. Le checkout refuse une formule plus petite que le nombre de personnes déjà connectées.
- Le webhook déduit la formule du prix réellement facturé (variables `STRIPE_PRICE_<FORMULE>_<PERIODE>`), ce qui suit aussi les changements faits dans le portail Stripe.

- `POST /api/abonnement/checkout {formule: solo|duo|tribu, periode: mensuel|annuel}` crée une session Stripe Checkout (abonnement, codes promo autorisés, retour sur `/#/settings?paiement=ok|annule`). `POST /api/abonnement/portail` ouvre le portail de facturation (carte, factures, résiliation).
- `POST /api/stripe/webhook` (signature vérifiée) applique `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed` : le plan passe à Famille tant que l'abonnement est `active`, `trialing` ou `past_due` (Stripe relance le paiement), revient en Gratuit à la résiliation. Statut, période et date de fin sont visibles dans les réglages.
- À créer dans le dashboard Stripe : six prix (trois formules × mensuel/annuel) et le webhook. Sans `STRIPE_SECRET_KEY`, mode simulé : le bouton active le plan directement (prototype, démo).

## Plans, essai inversé et coûts d'IA

- Chaque foyer commence par **15 jours de plan Famille complet** (`LUCIEN_ESSAI_JOURS`), sans carte, puis passe en **Gratuit nu** en gardant ses papiers, ses échéances et les opérations déjà importées. `db.effectivePlan()` donne le plan en vigueur.
- **Gratuit nu** (`FREE_LIMITS`) : 50 documents, 2 membres, lecture locale des documents sans aucun appel IA, pas d'import de relevés (`402 limite_plan`), pas de connexion bancaire, courriers sur modèle, notifications push seulement. Coût direct par compte : stockage et push, ≈ 1 centime par mois.
- **Effet « whaou » de l'essai** : carte « Votre foyer en 3 gestes » sur l'accueil (papier, banque, conjoint) et écran de révélation (`web/src/screens/Reveal.tsx`) à la première connexion bancaire ou au premier import : compteur animé jusqu'aux économies annuelles, les trois plus grosses pistes, bouton de partage (Web Share). Affiché une fois (`lucien.revelation.vue`), à chaque fois en démo.
- **Organisation familiale** (`server/src/famille.ts`) : situation (seul/couple), membres typés (adulte, enfant, parent ou personne à charge) avec date de naissance, établissement, classe, cantine (jours, coût), activités (jour, heures, lieu, coût mensuel, fin de saison). Calculés à la volée : agenda de la semaine, coût mensuel par enfant, échéances familiales fusionnées dans `/api/deadlines` (anniversaires, ARS, bourses, Parcoursup, dossier CROUS, réinscriptions de juin, fin de saison, déclaration de revenus ; `PATCH /api/deadlines/f:<cle>` pour les cocher) et conseils dérivés de la composition (aides, impôts, budget, organisation, cadre légal pour les personnes à charge), chacun avec sa source officielle. Routes : `GET/PATCH /api/famille`, `POST/PATCH/DELETE /api/members/:id`, `/api/activites/:id`. Outil MCP `famille` (sans dates de naissance).
- **Papiers par email** (`server/src/inbox.ts`) : chaque foyer a une adresse de transfert `foyer-<code>@LUCIEN_INBOX_DOMAIN` (réglages). Le fournisseur de réception poste les emails sur `POST /api/inbox?secret=LUCIEN_INBOX_SECRET` (format générique ou webhook Brevo « inbound parsing ») ; pièces jointes PDF/images lues d'abord, sinon le corps nettoyé des citations ; un document par pièce, échéances dérivées, `source = email`, chaque message traité une seule fois. Réservé à l'essai et au plan Famille. Pas d'OAuth : Lucien ne lit jamais la boîte, seulement ce qui lui est transféré.
- **Rappels** (`server/src/rappels.ts`) : fin d'essai (J-2, dernier jour, lendemain avec les économies en attente) et échéances (au début de la fenêtre `rappel_jours` et le jour même, papiers et dates familiales) ; une passe toutes les 6 h, chaque rappel envoyé une seule fois par foyer (`rappels_envoyes`). Transport : push sur tous les appareils du foyer, plus email pour le plan Famille. `GET /api/rappels` liste les rappels envoyés et dus.
- **Push** (`server/src/push.ts`, `web/src/sw.ts`, `web/src/push.tsx`) : Web Push standard avec clés VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). `GET /api/push/cle`, `POST/DELETE /api/push/abonner`, `POST /api/push/test`. Le service worker (workbox `injectManifest`) affiche la notification et ouvre la bonne page au clic ; les abonnements morts (404/410) sont supprimés. Sur iPhone, l'appli doit être ajoutée à l'écran d'accueil (iOS 16.4+). Sans clés : rappels dans la console.
- `LUCIEN_IA_LECTURES_GRATUIT` (0 par défaut) permet de rouvrir plus tard quelques lectures IA par mois sur le gratuit, toujours sous le plafond global `LUCIEN_IA_PLAFOND_GRATUIT_EUR`.
- **IA** (`server/src/ia.ts`) : fournisseur Anthropic ou Mistral ; modèle rapide d'abord (Haiku), modèle précis (Sonnet) seulement si la confiance est sous `LUCIEN_SEUIL_CONFIANCE`. Chaque lecture est comptée avec son coût estimé ; `GET /api/ia/depense` donne la dépense du mois.
- Le prévisionnel `docs/Lucien-previsionnel.xlsx` (onglets Scénarios, Hypothèses, Lancement 3 mois, Prévisionnel) se régénère avec `python3 docs/build_previsionnel.py && python3 docs/build_lancement.py && python3 docs/build_scenarios.py`.

## Veille bancaire d'un proche (fermée par défaut)

Pour un parent âgé ou une personne aidée : Lucien lit son compte **en lecture seule** et prévient l'aidant et les témoins en cas de virement vers un inconnu, d'achat de coupon prépayé, de cryptomonnaie, de retraits en série ou de nouveaux prélèvements. Le module est dans `server/src/veille.ts`, les écrans dans `web/src/screens/Veille.tsx`.

Le cadre, pensé pour protéger la personne d'abord et la famille ensuite contre les litiges :

- **Consentement selon la situation juridique** : sans mesure, la personne donne son accord elle-même (si elle ne le peut plus, Lucien refuse et renvoie vers le juge des contentieux de la protection) ; en curatelle, elle et son curateur ; en tutelle, habilitation familiale ou mandat de protection future, le représentant, avec le jugement ou le mandat joint.
- **Page personnelle de la personne** (`/#/consentement/<jeton>`, sans compte) : ce que voit Lucien, qui reçoit les alertes, les dernières consultations, l'accord, la connexion de **sa** banque par elle-même, et le **retrait seule, à tout moment**.
- **Témoins** : d'autres proches reçoivent exactement les mêmes alertes ; personne ne surveille seul.
- **Journal infalsifiable** : chaque demande, accord, consultation, alerte et fin est chaînée par SHA-256 à la précédente ; toute modification casse la chaîne. Export CSV pour un notaire ou un juge.
- **Accord valable un an**, puis suspension automatique ; fin au décès (le compte relève alors du notaire), à la fin de la mesure ou au retrait ; opérations effacées après `LUCIEN_VEILLE_CONSERVATION_JOURS`.
- **Engagement de loyauté** de l'aidant à la création.
- **Facturation** : une veille comprise dans Tribu, les suivantes (et en Solo ou Duo) à 3,90 € / mois ou 39 € / an (`STRIPE_PRICE_VEILLE_*`, ligne ajoutée à l'abonnement avec prorata).

`LUCIEN_VEILLE=1` ouvre la fonction. **À ne faire qu'après validation par un avocat** (consentement, mesures de protection, RGPD : données financières d'un tiers vulnérable, analyse d'impact). Sans fournisseur bancaire configuré, la banque est simulée avec un relevé fictif contenant des schémas d'arnaque.

## La semaine de Lucien (point du dimanche)

Un point hebdomadaire dans la voix du majordome : échéances de la semaine (et celles en retard), agenda des enfants jour par jour (la cantine est seulement comptée), le geste d'économie qui rapporte le plus, les papiers à vérifier et un conseil différent chaque semaine.

- `server/src/semaine.ts` : fonction pure `pointSemaine()`, sans dépendance au serveur. L'appli l'importe telle quelle (`web/src/screens/Semaine.tsx`, y compris en démo), le serveur s'en sert pour l'envoi. Une seule règle des deux côtés.
- Dans l'appli : carte « Votre semaine avec Lucien » sous la barre de l'accueil, écran `#/semaine`. Le dimanche après midi, la semaine affichée est celle qui commence le lendemain.
- Envoi : le dimanche à partir de 17 h (heure de Paris), rattrapage le lundi matin, une fois par semaine ISO (`rappels_envoyes`, clé `hebdo:AAAA-Www`). Notification pour tous, email HTML en plus pour le plan Famille (`server/src/hebdo.ts`). Rien n'est envoyé si la semaine est vide.
- Désactivable : Réglages, « Le point du dimanche » (`PATCH /api/household {hebdo}`, colonne `households.hebdo`). `GET /api/semaine` renvoie le point calculé par le serveur.
- Connecteur : outil `semaine` (« qu'est-ce qui nous attend cette semaine ? »), sans le volet budget quand la banque est exclue.

## Dossiers prêts

`server/src/dossiers.ts` (fonction pure, partagée avec l'appli) : pour six démarches (location, CAF, école et cantine, prêt immobilier, passeport ou carte d'identité, sinistre), chaque pièce demandée est « prête », « trop ancienne », « expirée » ou « à ajouter », avec où l'obtenir. Listes indicatives d'après service-public.fr (source citée). `GET /api/dossiers`, `GET /api/dossiers/:cle/zip` (bordereau + originaux, `server/src/zip.ts` sans dépendance), `GET /api/documents/:id/fichier` (original d'un papier, réservé au foyer). Outil `dossier` dans le connecteur.

## Combien de temps garder un papier

`server/src/conservation.ts` : durée de conservation par type de papier (service-public.fr, F19134), affichée sur chaque papier ; « Grand ménage » liste ce qui peut partir. Un contrat en cours, une garantie, un titre d'identité ne sont jamais proposés : seules les factures, relevés et avis datés le sont.

## Agenda du téléphone

`server/src/ics.ts` : fichier iCalendar (échéances en journée entière avec rappel, activités des enfants récurrentes à l'heure de Paris, la cantine exclue). Abonnement par lien secret `GET /api/agenda/<jeton>.ics` (sans session, pour Google, Apple, Outlook), `GET /api/agenda-lien` pour l'obtenir, `POST /api/agenda-lien` pour le changer (l'ancien cesse de marcher). En démo, l'appli fabrique le même fichier dans le navigateur.

## Connecteur MCP

Point d'entrée : `http://localhost:3000/mcp` (transport HTTP « streamable », sans état).

- Protégé par le jeton du foyer (en-tête `Authorization: Bearer …`, réglages de l'appli) ; `LUCIEN_MCP_TOKEN` reste accepté pour le premier foyer.
- Lecture seule : `lister_documents`, `detail_document`, `echeances`, `charges_fixes`, `rechercher`, `analyse_depenses` (ce dernier nécessite d'ôter `banque` de `LUCIEN_MCP_EXCLUDE`).
- Catégories exclues par défaut : `sante,banque` (`LUCIEN_MCP_EXCLUDE`).
- Chaque appel est journalisé (`GET /api/mcp/log`, visible dans les réglages de l'appli).

Test : `LUCIEN_URL=http://localhost:3000/mcp LUCIEN_MCP_TOKEN=… node server/mcp-smoke.mjs`


### Brancher le connecteur dans Claude

Chaque foyer a une **adresse personnelle** : `https://<serveur>/mcp/<jeton>` (Réglages → Connecteur IA → Copier). Dans claude.ai : Réglages → Connecteurs → Ajouter un connecteur personnalisé, coller l'adresse. Les outils qui acceptent un en-tête (Claude Desktop, Cursor) peuvent aussi utiliser `https://<serveur>/mcp` avec `Authorization: Bearer <jeton>`. « Régénérer l'adresse » révoque l'ancienne.

### Démo publique en un clic (Render)

`render.yaml` décrit un serveur de démonstration gratuit (famille fictive, données effacées à chaque redémarrage) : https://render.com/deploy?repo=https://github.com/docteurbenjaminconvers-cloud/Nidou

## Structure

```
server/src/db.ts         schéma SQLite (node:sqlite), foyers, membres, documents, échéances, journal MCP
server/src/ia.ts         couche IA : fournisseurs (Anthropic, Mistral), modèles rapide/précis, coût par appel
server/src/extract.ts    extraction des champs (rapide puis précis si peu sûr) + repli heuristique
server/src/deadlines.ts  règles de création des rappels (résiliation, renouvellement, expiration, garantie…)
server/src/charges.ts    charges fixes mensualisées + alertes (doublons, hausses, non renégocié, poids)
server/src/letters.ts    courriers (résiliation, réclamation, remboursement)
server/src/transactions.ts  import de relevés (CSV, texte, PDF via Claude), normalisation des marchands, catégorisation règles + IA
server/src/budget.ts     analyse des dépenses : récurrences, abonnements fantômes, hausses, doublons, frais, dérives, rapprochement contrats
server/src/seed-statement.ts  relevé bancaire fictif de 4 mois pour la démo
server/src/push.ts       Web Push (VAPID) vers les appareils du foyer
server/src/abonnement.ts Stripe Checkout, portail, webhooks ; mode simulé sans clé
server/src/auth.ts       comptes sans mot de passe (lien magique), invitations, sessions ; mail.ts : envoi Brevo ou console
server/src/famille.ts    organisation familiale : niveaux scolaires, agenda, coûts, échéances et conseils dérivés
server/src/inbox.ts      adresse de transfert : emails entrants → documents (webhook générique ou Brevo)
server/src/rappels.ts    rappels de fin d'essai (J-2, dernier jour, lendemain), passe quotidienne idempotente
server/src/bridge.ts     client Bridge (utilisateur, jeton, Connect, comptes, transactions, webhook signé) + banque simulée
web/src/notifications.tsx   cloche, badge et fil de notifications (échéances, économies, documents à vérifier)
server/src/mcp.ts        serveur MCP
server/src/api.ts        API REST (Hono)
server/src/seed.ts       famille de démonstration (fictive)
web/src                  PWA React : Aujourd'hui, Agenda, Papiers, Ajout, Budget, Famille (membres, activités), Réglages
demo/                    page de démo autonome (données d'exemple, sans serveur)
site/                    site vitrine monlucien.fr : accueil (promesse, fonctionnement, connecteur IA, tarifs, FAQ, liste d'attente), mentions légales, confidentialité
```

## Style visuel « Cocon »

Palette et composants définis dans `web/src/styles.css` (variables `:root` puis bloc de surcharges « Cocon ») : crème rosé `#FBF4F0`, corail `#D95F45` (action), lilas `#B89BD9`, pêche `#F6D5C8`, menthe `#CDEBDD` (argent gagné), soleil `#E9B23A`, prune `#3B2A3A` (texte, barre d'onglets). Titres et grands chiffres en Fraunces italique, corps en Nunito. Boutons et étiquettes en pilules, cartes blanches à ombre douce, barre d'onglets en capsule flottante. La maquette de référence est le canevas Claude Design « Lucien — refonte visuelle » (style B).

## Site vitrine

`site/` est un site statique (HTML + CSS, sans framework) à déposer tel quel chez n'importe quel hébergeur (Netlify, Vercel, OVH…) sous monlucien.fr. Le formulaire de liste d'attente appelle `POST /api/waitlist` du serveur Lucien : en production, servir le site et l'API sur le même domaine, ou autoriser `monlucien.fr` dans le CORS de l'API. Les mentions légales contiennent des crochets `[…]` à compléter (société, siège, hébergeur).

Le site est en français ; `site/i18n.js` contient les versions anglaise, espagnole, italienne et arabe (sens droite-à-gauche géré). La langue est détectée depuis le navigateur et modifiable par le sélecteur du menu.

En local, le site est visible sur http://localhost:3000/site/.

## Tests

`npm test` : règles d'échéances, charges et alertes, extracteur heuristique, journal MCP, parseur de relevés, récurrences et actions d'économies (34 tests, dont les clients Enable Banking et Bridge contre de fausses API, les rappels de fin d'essai et l'adresse de transfert).

## Connexion bancaire (Enable Banking, Bridge en secours)

Le fournisseur se choisit tout seul (`server/src/banques.ts`) : **Enable Banking** si ses clés sont présentes, sinon Bridge, sinon une banque simulée.

### Enable Banking (par défaut)

Facturé par compte bancaire connecté et par mois : les appels, le volume et les renouvellements d'autorisation sont compris, donc les synchronisations ne coûtent rien de plus. `server/src/enablebanking.ts` :

1. `GET /api/bank/banques` donne la liste des banques françaises (`GET /aspsps`, en cache un jour) ; la famille choisit la sienne dans Lucien.
2. `POST /api/bank/connect {aspsp}` appelle `POST /auth` (autorisation de 180 jours au plus, `state` = `h.<aléa>` pour un foyer, `v.<aléa>` pour la veille d'un proche) ; la personne se connecte sur la page de **sa** banque.
3. La banque revient sur `GET /api/bank/eb/callback?code&state` : `POST /sessions` ouvre la session et liste les comptes ; première synchronisation (soldes, opérations comptabilisées des 90 derniers jours, pagination `continuation_key`, référence de la banque comme empreinte, donc jamais de doublon).
4. Pas de webhook pour la lecture des comptes : Lucien relit toutes les **6 heures** (`demarrerSynchroBanques`), soit le maximum de 4 lectures par jour sans la personne prévue par la DSP2, avec 3 jours de recouvrement.
5. Fin d'autorisation : l'appli prévient 14 jours avant et propose « Renouveler ». `DELETE /api/bank`, l'arrêt d'une veille ou le retrait d'accord ferment aussi la session chez la banque (`DELETE /sessions/{id}`).

Chaque requête porte un JWT RS256 signé avec la clé privée de l'application (`kid` = identifiant de l'application). À déclarer dans le Control Panel Enable Banking : la redirect URL `LUCIEN_PUBLIC_URL/api/bank/eb/callback`.

### Bridge (secours)

`server/src/bridge.ts` implémente l'agrégation Bridge, version `2025-01-15` :

1. `POST /api/bank/connect` crée l'utilisateur Bridge du foyer, obtient un jeton (2 h) et une session Connect ; l'appli redirige vers l'URL renvoyée, où la famille choisit sa banque.
2. Bridge revient sur `GET /api/bank/callback` (`user_uuid`, `item_id`, `success`) : première synchronisation, puis retour dans l'appli.
3. `GET /v3/aggregation/accounts` et `/transactions` (pagination `next_uri`, reprise par `since` avec 24 h de recouvrement) alimentent la table `transactions`. Les opérations `future` ou `deleted` sont ignorées ; l'identifiant Bridge sert d'empreinte, donc jamais de doublon.
4. Le webhook `POST /api/bank/webhook` (signature `BridgeApi-Signature`, HMAC-SHA256, rotation de secret gérée) relance la synchronisation à chaque `item.refreshed`.

À configurer dans le dashboard Bridge : l'application (Client-Id / Client-Secret), un webhook vers `LUCIEN_PUBLIC_URL/api/bank/webhook`, et le domaine de redirection. Sans clés, le serveur bascule sur une banque simulée (même parcours, données fictives).

Réservé au plan Famille (`402 limite_plan` sinon). `DELETE /api/bank` supprime la connexion et les comptes.

## Production

`Dockerfile` (image unique : appli, API, MCP, site), `deploy/docker-compose.yml` (Caddy en HTTPS automatique devant l'application, sauvegarde quotidienne), `deploy/Caddyfile` (site sur `monlucien.fr`, appli sur `app.monlucien.fr`, en-têtes de sécurité), `server/scripts/sauvegarde.mjs` (copie cohérente de la base à chaud et des fichiers, 14 jours gardés). Guide pas à pas pour un VPS OVH : `deploy/DEPLOIEMENT.md`. Les tests et la construction de l'image tournent sur GitHub Actions à chaque envoi (`.github/workflows/ci.yml`).

## Avant une mise en production

- Hébergement européen, chiffrement au repos, sauvegardes.
- Stockage des fichiers hors du serveur applicatif (S3 compatible).
- Audit de sécurité ; HDS avant toute donnée de santé.
