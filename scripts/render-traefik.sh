#!/bin/sh
# Render deploy/traefik/dynamic/dcengineer.yml.template using values from
# the environment and optional .env. Usage:
#   bash scripts/render-traefik.sh [output-path]
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TEMPLATE="$ROOT/deploy/traefik/dynamic/dcengineer.yml.template"
OUT="${1:-$ROOT/deploy/traefik/dynamic/dcengineer.yml}"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

DCE_HOSTNAME="${DCE_HOSTNAME:-dce.example.com}"
TRAEFIK_ENTRYPOINT="${TRAEFIK_ENTRYPOINT:-websecure}"
TRAEFIK_CERT_RESOLVER="${TRAEFIK_CERT_RESOLVER:-letsencrypt}"
DCE_CONTAINER_NAME="${DCE_CONTAINER_NAME:-dcengineer}"

sed \
  -e "s/__DCE_HOSTNAME__/${DCE_HOSTNAME}/g" \
  -e "s/__TRAEFIK_ENTRYPOINT__/${TRAEFIK_ENTRYPOINT}/g" \
  -e "s/__TRAEFIK_CERT_RESOLVER__/${TRAEFIK_CERT_RESOLVER}/g" \
  -e "s/__DCE_CONTAINER_NAME__/${DCE_CONTAINER_NAME}/g" \
  "$TEMPLATE" > "$OUT"

echo "Wrote $OUT (Host=${DCE_HOSTNAME}, entryPoint=${TRAEFIK_ENTRYPOINT}, certResolver=${TRAEFIK_CERT_RESOLVER})"
