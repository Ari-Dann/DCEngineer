#!/bin/bash
# Danncloud helper: clone/update DCEngineer, host-mount Tleilax NFS, drop Traefik
# dynamic config, and start the stack on traefik-net for Dockhand.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/docker/Files/dcengineer}"
TRAEFIK_DYN="${TRAEFIK_DYN:-/opt/docker/Files/AppData/Config/traefik/dynamic}"
NFS_HOST="${NFS_HOST:-10.20.30.3}"
NFS_EXPORT="${NFS_EXPORT:-/mnt/VDEV1/dce-backups}"
NFS_MOUNT="${NFS_MOUNT:-/mnt/dce-backups}"
REPO="${REPO:-https://github.com/Ari-Dann/DCEngineer.git}"
BRANCH="${BRANCH:-main}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo) so NFS and Traefik files can be written."
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$NFS_MOUNT" "$TRAEFIK_DYN"

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
fi

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env.danncloud.example" "$INSTALL_DIR/.env"
  echo "Wrote $INSTALL_DIR/.env — edit JWT_SECRET and BOOTSTRAP_ADMIN_PASSWORD before first login."
fi

if ! grep -q "$NFS_MOUNT" /etc/fstab; then
  echo "${NFS_HOST}:${NFS_EXPORT} ${NFS_MOUNT} nfs defaults,_netdev,nofail,nfsvers=4 0 0" >> /etc/fstab
fi
mount "$NFS_MOUNT" || true

# Point compose backup bind mount at the NFS host path
if grep -q '^DCE_BACKUP_HOST_PATH=' "$INSTALL_DIR/.env"; then
  sed -i "s|^DCE_BACKUP_HOST_PATH=.*|DCE_BACKUP_HOST_PATH=${NFS_MOUNT}|" "$INSTALL_DIR/.env"
else
  echo "DCE_BACKUP_HOST_PATH=${NFS_MOUNT}" >> "$INSTALL_DIR/.env"
fi

install -m 0644 "$INSTALL_DIR/deploy/traefik/dynamic/dcengineer.yml" \
  "$TRAEFIK_DYN/dcengineer.yml"

docker network inspect traefik-net >/dev/null

cd "$INSTALL_DIR"
docker compose build
docker compose up -d

echo
echo "DCEngineer is up. Traefik dynamic file: $TRAEFIK_DYN/dcengineer.yml"
echo "App: https://dce.rootpcs.cloud"
echo "Change the bootstrap password immediately after first login."
