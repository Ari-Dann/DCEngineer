#!/bin/bash
# Generic host install: clone DCEngineer, optionally mount NFS backups,
# render Traefik dynamic config, pull ghcr.io ... :latest, and start compose.
#
# All site-specific values are environment variables (see .env.example).
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/dcengineer}"
TRAEFIK_DYN="${TRAEFIK_DYN:-/opt/traefik/dynamic}"
NFS_HOST="${NFS_HOST:-}"
NFS_EXPORT="${NFS_EXPORT:-}"
NFS_MOUNT="${NFS_MOUNT:-/mnt/dce-backups}"
REPO="${REPO:-https://github.com/Ari-Dann/DCEngineer.git}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DCE_HOSTNAME="${DCE_HOSTNAME:-dce.example.com}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo) so NFS mounts and Traefik files can be written."
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$TRAEFIK_DYN"

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
fi

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  echo "Wrote $INSTALL_DIR/.env — edit JWT_SECRET, DCE_HOSTNAME, and BOOTSTRAP_ADMIN_PASSWORD before first login."
fi

if [[ -n "$NFS_HOST" && -n "$NFS_EXPORT" ]]; then
  mkdir -p "$NFS_MOUNT"
  if ! grep -q "$NFS_MOUNT" /etc/fstab; then
    echo "${NFS_HOST}:${NFS_EXPORT} ${NFS_MOUNT} nfs defaults,_netdev,nofail,nfsvers=4 0 0" >> /etc/fstab
  fi
  mount "$NFS_MOUNT" || true
  if grep -q '^DCE_BACKUP_HOST_PATH=' "$INSTALL_DIR/.env"; then
    sed -i "s|^DCE_BACKUP_HOST_PATH=.*|DCE_BACKUP_HOST_PATH=${NFS_MOUNT}|" "$INSTALL_DIR/.env"
  else
    echo "DCE_BACKUP_HOST_PATH=${NFS_MOUNT}" >> "$INSTALL_DIR/.env"
  fi
fi

if grep -q '^DCE_HOSTNAME=' "$INSTALL_DIR/.env"; then
  sed -i "s|^DCE_HOSTNAME=.*|DCE_HOSTNAME=${DCE_HOSTNAME}|" "$INSTALL_DIR/.env"
fi

bash "$INSTALL_DIR/scripts/render-traefik.sh" "$TRAEFIK_DYN/dcengineer.yml"

cd "$INSTALL_DIR"
if docker compose -f "$COMPOSE_FILE" pull; then
  docker compose -f "$COMPOSE_FILE" up -d
else
  echo "GHCR pull failed; building locally."
  docker compose -f "$COMPOSE_FILE" up -d --build
fi

echo
echo "DCEngineer is up."
echo "Traefik dynamic file (if used): $TRAEFIK_DYN/dcengineer.yml"
echo "App hostname: ${DCE_HOSTNAME}"
echo "Change the bootstrap password immediately after first login."
