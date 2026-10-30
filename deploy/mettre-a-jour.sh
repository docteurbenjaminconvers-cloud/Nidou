#!/usr/bin/env bash
# Met Nidou à jour sur le serveur, sans risque :
#   1. sauvegarde de la base avant de toucher à quoi que ce soit ;
#   2. récupère la dernière version de main et reconstruit ;
#   3. vérifie que l'appli répond (/health) pendant 2 minutes au plus ;
#   4. si elle ne répond pas, revient automatiquement à la version précédente et sort en erreur.
# Lancé par GitHub Actions (workflow « Mise en ligne ») ou à la main : bash deploy/mettre-a-jour.sh
set -euo pipefail

# Tout est dans une fonction : bash lit le script en entier avant de l'exécuter,
# car `git reset` ci-dessous remplace ce fichier pendant qu'il tourne.
principal() {
  cd "$(dirname "$0")/.."
  DEPOT="$(pwd)"
  cd deploy

  compose() { docker compose "$@"; }
  repond() { compose exec -T nidou node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; }
  attendre() {
    for _ in $(seq 1 24); do
      if repond; then return 0; fi
      sleep 5
    done
    return 1
  }

  AVANT="$(git -C "$DEPOT" rev-parse HEAD)"
  echo "Version en ligne : ${AVANT:0:7}"

  if compose ps --status running --services 2>/dev/null | grep -qx nidou; then
    echo "Sauvegarde de la base avant mise à jour…"
    compose exec -T nidou node scripts/sauvegarde.mjs
  fi

  git -C "$DEPOT" fetch --quiet origin main
  APRES="$(git -C "$DEPOT" rev-parse origin/main)"
  if [ "$AVANT" = "$APRES" ] && repond; then
    echo "Déjà à jour (${APRES:0:7}), rien à faire."
    exit 0
  fi

  echo "Mise à jour ${AVANT:0:7} → ${APRES:0:7}…"
  git -C "$DEPOT" reset --quiet --hard "$APRES"
  compose up -d --build --remove-orphans

  if attendre; then
    echo "En ligne : ${APRES:0:7}"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi

  echo "L'appli ne répond pas après la mise à jour : retour à ${AVANT:0:7}." >&2
  compose logs --tail=80 nidou >&2 || true
  git -C "$DEPOT" reset --quiet --hard "$AVANT"
  compose up -d --build --remove-orphans
  if attendre; then echo "Version précédente rétablie (${AVANT:0:7})." >&2; else echo "ATTENTION : la version précédente ne répond pas non plus." >&2; fi
  exit 1
}

principal "$@"
