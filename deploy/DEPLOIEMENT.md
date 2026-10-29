# Mettre Nidou en ligne (VPS OVH)

Résultat : `nidou.fr` (site vitrine) et `app.nidou.fr` (appli, API, connecteur MCP), en HTTPS, avec une sauvegarde par jour.

## 1. Ce qu'il faut acheter ou ouvrir

| Quoi | Où | Coût indicatif |
|---|---|---|
| Domaine `nidou.fr` | OVH | ≈ 10 € / an |
| Serveur VPS (2 vCPU, 4 Go, Gravelines ou Strasbourg) | OVH, gamme VPS | ≈ 6 à 12 € / mois |
| Envoi d'emails et réception `in.nidou.fr` | Brevo | gratuit jusqu'à 300 emails / jour |
| Paiement | Stripe, au nom de la SASU | 1,5 % + 0,25 € par paiement |
| Lecture des documents | Anthropic (ou Mistral) | à l'usage |
| Banque | Enable Banking (Bridge en secours) | sur devis, par compte connecté et par mois |

## 2. DNS (zone OVH de nidou.fr)

| Nom | Type | Valeur |
|---|---|---|
| `@` | A | adresse IP du VPS |
| `www` | A | adresse IP du VPS |
| `app` | A | adresse IP du VPS |
| `in` | MX | serveur de réception Brevo (indiqué par Brevo) |

Brevo demande aussi des enregistrements SPF, DKIM et DMARC pour `nidou.fr` : les copier tels quels.

## 3. Installer sur le VPS (une seule fois)

```bash
# Ubuntu 24.04 fraîchement installé, connecté en SSH
curl -fsSL https://get.docker.com | sh
git clone https://github.com/docteurbenjaminconvers-cloud/Nidou.git nidou
cd nidou/deploy
cp ../server/.env.example .env
nano .env            # remplir (voir 4.)
docker compose up -d --build
```

Caddy obtient seul les certificats HTTPS dès que le DNS pointe vers le serveur (quelques minutes).

## 4. Le fichier `.env`, au minimum

```
NIDOU_PUBLIC_URL=https://app.nidou.fr
NIDOU_AUTH=1
NIDOU_EMAIL_FROM=Nidou <bonjour@nidou.fr>
BREVO_API_KEY=…
ANTHROPIC_API_KEY=…
NIDOU_INBOX_SECRET=<une longue chaîne aléatoire>
VAPID_PUBLIC_KEY=…   VAPID_PRIVATE_KEY=…   VAPID_SUBJECT=mailto:bonjour@nidou.fr
STRIPE_SECRET_KEY=…  STRIPE_WEBHOOK_SECRET=…
STRIPE_PRICE_SOLO_MENSUEL=…  STRIPE_PRICE_SOLO_ANNUEL=…  (et de même pour DUO et TRIBU)
```

Clés VAPID : `docker compose run --rm nidou npx web-push generate-vapid-keys`.
Enable Banking : créer l'application dans le Control Panel (production après signature du contrat), télécharger la clé privée `.pem`, la copier dans le volume (`docker compose cp enablebanking.pem nidou:/data/`) et remplir `ENABLEBANKING_APP_ID`. Redirect URL à déclarer : `https://app.nidou.fr/api/bank/eb/callback`. Sans clés, la banque reste simulée.

Ne jamais mettre ce fichier sur GitHub (il est exclu par `.gitignore`).

## 5. Brancher les services

- **Stripe** : créer un produit par formule et six prix TTC (Solo 6,90 € / mois et 69 € / an, Duo 9,90 € et 99 €, Tribu 13,90 € et 139 €), autoriser le changement de formule dans le portail client, un webhook vers `https://app.nidou.fr/api/stripe/webhook` (événements `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`), activer le portail client.
- **Stripe, veille d'un proche** : un produit « Veille d'un proche » avec deux prix (3,90 € / mois et 39 € / an) dans `STRIPE_PRICE_VEILLE_MENSUEL` et `STRIPE_PRICE_VEILLE_ANNUEL`.
- **Brevo** : domaine `nidou.fr` vérifié, expéditeur `bonjour@nidou.fr`, réception « inbound parsing » sur `in.nidou.fr` vers `https://app.nidou.fr/api/inbox?secret=<NIDOU_INBOX_SECRET>`.
- **Connecteur IA** : chaque famille trouve l'adresse `https://app.nidou.fr/mcp` et son jeton dans ses réglages.

## 6. Mettre à jour

```bash
cd ~/nidou && git pull && cd deploy && docker compose up -d --build
```

## 7. Sauvegardes

Une sauvegarde par jour dans le volume (`/data/sauvegardes`, 14 jours gardés), faite à chaud sans couper le service. À copier hors du serveur, par exemple vers un stockage objet OVH :

```bash
docker compose exec nidou node scripts/sauvegarde.mjs          # sauvegarde immédiate
docker compose cp nidou:/data/sauvegardes ./sauvegardes         # récupérer les copies
```

Restaurer : arrêter (`docker compose stop nidou`), remplacer `/data/nidou.sqlite` et `/data/uploads` par ceux d'une sauvegarde, relancer.

## 8. Avant d'accueillir de vraies familles

- Audit de sécurité (tests d'intrusion) et revue RGPD : registre des traitements, contrats de sous-traitance (OVH, Brevo, Anthropic, Stripe, Enable Banking).
- Données de santé : la catégorie « santé » impose un hébergeur certifié HDS (OVH propose une offre HDS) ; d'ici là, la désactiver ou prévenir que rien de médical ne doit y être rangé.
- Mentions légales et CGV complétées avec les informations de la SASU.
- **Veille bancaire d'un proche** : laisser `NIDOU_VEILLE=0` tant qu'un avocat n'a pas validé le parcours de consentement, les textes de la page personnelle, l'engagement de l'aidant et l'analyse d'impact RGPD. Enable Banking doit aussi accepter ce cas d'usage (un compte connecté par une personne autre que l'abonné).
