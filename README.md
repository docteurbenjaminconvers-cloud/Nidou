# Nidou — l'assistant de votre famille

Prototype fonctionnel : papiers et échéances, charges fixes, analyse des dépenses réelles (import de relevés bancaires) avec économies faciles, notifications, courriers, connecteur MCP en lecture, PWA mobile.

## Lancer en local

Prérequis : Node 22 ou plus récent.

```bash
npm install
cp server/.env.example server/.env   # puis renseigner ANTHROPIC_API_KEY
npm run build --workspace=web        # construit la PWA
NIDOU_SEED=1 npm start --workspace=server
```

Ouvrir http://localhost:3000. Sans `ANTHROPIC_API_KEY`, l'extraction tourne en mode heuristique (champs à vérifier) ; avec la clé, Claude lit photos, PDF et textes.

En développement : `npm run dev` lance le serveur (port 3000) et Vite (port 5173, avec proxy vers l'API).

## Comptes et foyer partagé

- Connexion **sans mot de passe** : `POST /api/auth/demander {email}` envoie un lien (valable 30 min, usage unique) ; `GET /api/auth/lien?token=…` ouvre une session (cookie `nidou_session`, 90 jours, HttpOnly). Première connexion = création du compte et du nid, avec l'essai de 15 jours.
- **Invitation** du conjoint ou d'un proche : `POST /api/invitations {email, prenom}` envoie un lien de 7 jours qui rattache le compte au même foyer (rôle `membre` ; l'inviteur est `proprietaire`). `GET /api/foyer/comptes`, `DELETE /api/foyer/comptes/:user_id` (propriétaire), `DELETE /api/invitations/:token`. Gratuit : 2 comptes ; Famille : 6.
- Emails via Brevo (`BREVO_API_KEY`, `NIDOU_EMAIL_FROM`) ; sans clé, le lien est affiché dans la console et renvoyé dans la réponse (`lien`) pour le développement.
- `NIDOU_AUTH=0` conserve le prototype mono-foyer sans connexion (tests, démo locale). Avec `NIDOU_SEED=1`, le compte `demo@nidou.fr` possède la famille de démonstration.
- Le connecteur MCP s'authentifie avec le **jeton du foyer** (`households.mcp_token`, affiché et régénérable dans les réglages) ; refusé hors plan Famille (`402`).

## Paiement (Stripe)

- `POST /api/abonnement/checkout {periode: mensuel|annuel}` crée une session Stripe Checkout (abonnement, codes promo autorisés, retour sur `/#/settings?paiement=ok|annule`). `POST /api/abonnement/portail` ouvre le portail de facturation (carte, factures, résiliation).
- `POST /api/stripe/webhook` (signature vérifiée) applique `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_failed` : le plan passe à Famille tant que l'abonnement est `active`, `trialing` ou `past_due` (Stripe relance le paiement), revient en Gratuit à la résiliation. Statut, période et date de fin sont visibles dans les réglages.
- À créer dans le dashboard Stripe : deux prix (9,90 € TTC/mois, 99 € TTC/an) et le webhook. Sans `STRIPE_SECRET_KEY`, mode simulé : le bouton active le plan directement (prototype, démo).

## Plans, essai inversé et coûts d'IA

- Chaque foyer commence par **15 jours de plan Famille complet** (`NIDOU_ESSAI_JOURS`), sans carte, puis passe en **Gratuit nu** en gardant ses papiers, ses échéances et les opérations déjà importées. `db.effectivePlan()` donne le plan en vigueur.
- **Gratuit nu** (`FREE_LIMITS`) : 50 documents, 2 membres, lecture locale des documents sans aucun appel IA, pas d'import de relevés (`402 limite_plan`), pas de connexion bancaire, courriers sur modèle, notifications push seulement. Coût direct par compte : stockage et push, ≈ 1 centime par mois.
- **Effet « whaou » de l'essai** : carte « Votre nid en 3 gestes » sur l'accueil (papier, banque, conjoint) et écran de révélation (`web/src/screens/Reveal.tsx`) à la première connexion bancaire ou au premier import : compteur animé jusqu'aux économies annuelles, les trois plus grosses pistes, bouton de partage (Web Share). Affiché une fois (`nidou.revelation.vue`), à chaque fois en démo.
- **Organisation familiale** (`server/src/famille.ts`) : situation (seul/couple), membres typés (adulte, enfant, parent ou personne à charge) avec date de naissance, établissement, classe, cantine (jours, coût), activités (jour, heures, lieu, coût mensuel, fin de saison). Calculés à la volée : agenda de la semaine, coût mensuel par enfant, échéances familiales fusionnées dans `/api/deadlines` (anniversaires, ARS, bourses, Parcoursup, dossier CROUS, réinscriptions de juin, fin de saison, déclaration de revenus ; `PATCH /api/deadlines/f:<cle>` pour les cocher) et conseils dérivés de la composition (aides, impôts, budget, organisation, cadre légal pour les personnes à charge), chacun avec sa source officielle. Routes : `GET/PATCH /api/famille`, `POST/PATCH/DELETE /api/members/:id`, `/api/activites/:id`. Outil MCP `famille` (sans dates de naissance).
- **Papiers par email** (`server/src/inbox.ts`) : chaque foyer a une adresse de transfert `nid-<code>@NIDOU_INBOX_DOMAIN` (réglages). Le fournisseur de réception poste les emails sur `POST /api/inbox?secret=NIDOU_INBOX_SECRET` (format générique ou webhook Brevo « inbound parsing ») ; pièces jointes PDF/images lues d'abord, sinon le corps nettoyé des citations ; un document par pièce, échéances dérivées, `source = email`, chaque message traité une seule fois. Réservé à l'essai et au plan Famille. Pas d'OAuth : Nidou ne lit jamais la boîte, seulement ce qui lui est transféré.
- **Rappels** (`server/src/rappels.ts`) : fin d'essai (J-2, dernier jour, lendemain avec les économies en attente) et échéances (au début de la fenêtre `rappel_jours` et le jour même, papiers et dates familiales) ; une passe toutes les 6 h, chaque rappel envoyé une seule fois par foyer (`rappels_envoyes`). Transport : push sur tous les appareils du foyer, plus email pour le plan Famille. `GET /api/rappels` liste les rappels envoyés et dus.
- **Push** (`server/src/push.ts`, `web/src/sw.ts`, `web/src/push.tsx`) : Web Push standard avec clés VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). `GET /api/push/cle`, `POST/DELETE /api/push/abonner`, `POST /api/push/test`. Le service worker (workbox `injectManifest`) affiche la notification et ouvre la bonne page au clic ; les abonnements morts (404/410) sont supprimés. Sur iPhone, l'appli doit être ajoutée à l'écran d'accueil (iOS 16.4+). Sans clés : rappels dans la console.
- `NIDOU_IA_LECTURES_GRATUIT` (0 par défaut) permet de rouvrir plus tard quelques lectures IA par mois sur le gratuit, toujours sous le plafond global `NIDOU_IA_PLAFOND_GRATUIT_EUR`.
- **IA** (`server/src/ia.ts`) : fournisseur Anthropic ou Mistral ; modèle rapide d'abord (Haiku), modèle précis (Sonnet) seulement si la confiance est sous `NIDOU_SEUIL_CONFIANCE`. Chaque lecture est comptée avec son coût estimé ; `GET /api/ia/depense` donne la dépense du mois.
- Le prévisionnel `docs/Nidou-previsionnel.xlsx` (onglets Scénarios, Hypothèses, Lancement 3 mois, Prévisionnel) se régénère avec `python3 docs/build_previsionnel.py && python3 docs/build_lancement.py && python3 docs/build_scenarios.py`.

## Connecteur MCP

Point d'entrée : `http://localhost:3000/mcp` (transport HTTP « streamable », sans état).

- Protégé par le jeton du foyer (en-tête `Authorization: Bearer …`, réglages de l'appli) ; `NIDOU_MCP_TOKEN` reste accepté pour le premier foyer.
- Lecture seule : `lister_documents`, `detail_document`, `echeances`, `charges_fixes`, `rechercher`, `analyse_depenses` (ce dernier nécessite d'ôter `banque` de `NIDOU_MCP_EXCLUDE`).
- Catégories exclues par défaut : `sante,banque` (`NIDOU_MCP_EXCLUDE`).
- Chaque appel est journalisé (`GET /api/mcp/log`, visible dans les réglages de l'appli).

Test : `NIDOU_URL=http://localhost:3000/mcp NIDOU_MCP_TOKEN=… node server/mcp-smoke.mjs`

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
site/                    site vitrine nidou.fr : accueil (promesse, fonctionnement, connecteur IA, tarifs, FAQ, liste d'attente), mentions légales, confidentialité
```

## Style visuel « Cocon »

Palette et composants définis dans `web/src/styles.css` (variables `:root` puis bloc de surcharges « Cocon ») : crème rosé `#FBF4F0`, corail `#D95F45` (action), lilas `#B89BD9`, pêche `#F6D5C8`, menthe `#CDEBDD` (argent gagné), soleil `#E9B23A`, prune `#3B2A3A` (texte, barre d'onglets). Titres et grands chiffres en Fraunces italique, corps en Nunito. Boutons et étiquettes en pilules, cartes blanches à ombre douce, barre d'onglets en capsule flottante. La maquette de référence est le canevas Claude Design « Nidou — refonte visuelle » (style B).

## Site vitrine

`site/` est un site statique (HTML + CSS, sans framework) à déposer tel quel chez n'importe quel hébergeur (Netlify, Vercel, OVH…) sous nidou.fr. Le formulaire de liste d'attente appelle `POST /api/waitlist` du serveur Nidou : en production, servir le site et l'API sur le même domaine, ou autoriser `nidou.fr` dans le CORS de l'API. Les mentions légales contiennent des crochets `[…]` à compléter (société, siège, hébergeur).

Le site est en français ; `site/i18n.js` contient les versions anglaise, espagnole, italienne et arabe (sens droite-à-gauche géré). La langue est détectée depuis le navigateur et modifiable par le sélecteur du menu.

En local, le site est visible sur http://localhost:3000/site/.

## Tests

`npm test` : règles d'échéances, charges et alertes, extracteur heuristique, journal MCP, parseur de relevés, récurrences et actions d'économies (25 tests, dont le client Bridge contre une fausse API, les rappels de fin d'essai et l'adresse de transfert).

## Connexion bancaire (Bridge)

`server/src/bridge.ts` implémente l'agrégation Bridge, version `2025-01-15` :

1. `POST /api/bank/connect` crée l'utilisateur Bridge du foyer, obtient un jeton (2 h) et une session Connect ; l'appli redirige vers l'URL renvoyée, où la famille choisit sa banque.
2. Bridge revient sur `GET /api/bank/callback` (`user_uuid`, `item_id`, `success`) : première synchronisation, puis retour dans l'appli.
3. `GET /v3/aggregation/accounts` et `/transactions` (pagination `next_uri`, reprise par `since` avec 24 h de recouvrement) alimentent la table `transactions`. Les opérations `future` ou `deleted` sont ignorées ; l'identifiant Bridge sert d'empreinte, donc jamais de doublon.
4. Le webhook `POST /api/bank/webhook` (signature `BridgeApi-Signature`, HMAC-SHA256, rotation de secret gérée) relance la synchronisation à chaque `item.refreshed`.

À configurer dans le dashboard Bridge : l'application (Client-Id / Client-Secret), un webhook vers `NIDOU_PUBLIC_URL/api/bank/webhook`, et le domaine de redirection. Sans clés, le serveur bascule sur une banque simulée (même parcours, données fictives).

Réservé au plan Famille (`402 limite_plan` sinon). `DELETE /api/bank` supprime la connexion et les comptes.

## Production

`Dockerfile` (image unique : appli, API, MCP, site), `deploy/docker-compose.yml` (Caddy en HTTPS automatique devant l'application, sauvegarde quotidienne), `deploy/Caddyfile` (site sur `nidou.fr`, appli sur `app.nidou.fr`, en-têtes de sécurité), `server/scripts/sauvegarde.mjs` (copie cohérente de la base à chaud et des fichiers, 14 jours gardés). Guide pas à pas pour un VPS OVH : `deploy/DEPLOIEMENT.md`. Les tests et la construction de l'image tournent sur GitHub Actions à chaque envoi (`.github/workflows/ci.yml`).

## Avant une mise en production

- Hébergement européen, chiffrement au repos, sauvegardes.
- Stockage des fichiers hors du serveur applicatif (S3 compatible).
- Audit de sécurité ; HDS avant toute donnée de santé.
