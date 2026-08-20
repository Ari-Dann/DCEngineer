# DCEngineer

Self-hosted assistant for datacenter engineers. Browser-first PWA (desktop, tablet, GrapheneOS / Vanadium), JWTAuth API, and a single Docker image you can publish on Traefik, Nginx, or Caddy.

It covers day-to-day operations **and** the four-phase Reliable Baseline Inventory (RBI) engagement:

| Phase | What DCEngineer tracks |
| --- | --- |
| 1 Initiation | Kickoff notes, escort/badging, restricted (government/EMSS) list, photography rules, discovery feasibility (port access, CDP/LLDP, SaaS trial), workbook shell + checklists |
| 2 Onsite capture | Rack-by-rack device name/vendor/model/RU/serial, PDU bank/port maps, fan orientation vs hot/cold aisle, cabling/breakout, photos, **daily hand-off** to the remote engineer, offline queue when the floor has no signal |
| 3 Documentation | Elevations, breakout, PDU connectivity, device-to-function, EOL/EOS flags, undocumented-vs-discovery, SVG rack layouts, remediation summary, Excel RBI export |
| 4 Delivery | Phase-4 checklist, findings review, formal acceptance |

Standing duties live under **Work** and **More**: inspections / PM, incidents with vendor tickets, install-upgrade work orders, backup process catalogue, DR drills, and capacity snapshots.

---

## Architecture

```
Browser / PWA / Capacitor APK
        │  HTTPS + JWTAuth (Bearer access + refresh)
        ▼
Traefik (or Nginx / Caddy)  →  dcengineer:8080
        │
        ├─ SQLite (default) or Postgres via DATABASE_URL
        ├─ Attachments: local | nfs bind-mount | SFTP
        └─ App backups: tar.gz into BACKUP_PATH (NFS to TrueNAS)
```

One container serves the API and the built SPA. No inline Traefik labels — routing is a **dynamic YAML file**, which matches Dockhand + a shared `traefik-net`.

---

## Quick start (any host)

```bash
git clone https://github.com/Ari-Dann/DCEngineer.git
cd DCEngineer
cp .env.example .env
# set JWT_SECRET, BOOTSTRAP_ADMIN_PASSWORD, DCE_HOSTNAME, CORS_ORIGINS
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# without an existing reverse proxy:
docker compose -f docker-compose.dev.yml up -d --build
# open http://localhost:8080  (bootstrap user from .env)
```

Generate a real `JWT_SECRET` before anything is public. Change the bootstrap password on first login.

---

## Danncloud (Traefik + Dockhand) — `dce.rootpcs.cloud`

Target host: Debian 13, Docker 29, Traefik (`entryPoint=websecure`, `certResolver=letsencrypt`), overlay network `traefik-net`, Dockhand already on that network. Public name `dce.rootpcs.cloud`. Backups to TrueNAS **Tleilax** `10.20.30.3:/mnt/VDEV1/dce-backups` over Zerotier.

### 1. NFS mount on Danncloud (recommended)

Docker bind-mounting a **host** NFS mount is more reliable than the NFS volume driver across reboots.

```bash
sudo mkdir -p /mnt/dce-backups /opt/docker/Files/dcengineer
echo '10.20.30.3:/mnt/VDEV1/dce-backups /mnt/dce-backups nfs defaults,_netdev,nofail,nfsvers=4 0 0' | sudo tee -a /etc/fstab
sudo mount -a
```

On Tleilax, export `/mnt/VDEV1/dce-backups` to `10.20.30.254` (or the Zerotier net) with maproot/anonuid matching `PUID`/`PGID` if you do not squash to root.

### 2. Install from GitHub

```bash
sudo git clone https://github.com/Ari-Dann/DCEngineer.git /opt/docker/Files/dcengineer
cd /opt/docker/Files/dcengineer
sudo cp .env.danncloud.example .env
sudo nano .env          # JWT_SECRET + bootstrap password
```

Or run the helper (as root):

```bash
sudo bash scripts/install-danncloud.sh
```

### 3. Traefik dynamic file (no container labels)

```bash
sudo cp deploy/traefik/dynamic/dcengineer.yml \
  /opt/docker/Files/AppData/Config/traefik/dynamic/dcengineer.yml
```

That file routes `Host(dce.rootpcs.cloud)` on `websecure` with `certResolver: letsencrypt` to `http://dcengineer:8080`. Traefik must be able to resolve the container name `dcengineer` on `traefik-net`.

If Traefik does not watch that directory yet, add a file provider pointing at `/opt/docker/Files/AppData/Config/traefik/dynamic`.

### 4. DNS

Create an A (or CNAME) record: `dce.rootpcs.cloud` → Danncloud public IP `187.124.90.153`. Let's Encrypt needs 80/443 reachable for HTTP-01 (or already configured DNS-01).

### 5. Dockhand

Create a stack named `dcengineer` from `/opt/docker/Files/dcengineer/docker-compose.yml` with the `.env` in the same directory. Confirm:

- network **traefik-net** is external
- container name is **dcengineer**
- volumes: data on SSD, backups on `/mnt/dce-backups`

Then deploy. Health: `https://dce.rootpcs.cloud/api/health`.

### 6. Overlay VPN for others

Zerotier is already on `10.20.30.254/24`. Tailscale / Twingate users should:

1. Join the same overlay.
2. Either keep public HTTPS (Traefik) or set `DCE_PUBLIC_URL` / `CORS_ORIGINS` to the overlay URL and firewall 443 to overlay-only.

Storage knobs they change in `.env`:

| Variable | Purpose |
| --- | --- |
| `STORAGE_BACKEND` | `local` (default), `nfs` (same as local — host mounts NFS), or `sftp` |
| `STORAGE_LOCAL_PATH` | Container path for attachments (`/data/files`) |
| `DCE_DATA_PATH` | Host path bind-mounted to `/data` |
| `DCE_BACKUP_HOST_PATH` | Host path bind-mounted to `/backups` |
| `SFTP_*` | Used when `STORAGE_BACKEND=sftp` |
| `BACKUP_NFS_HOST` / `BACKUP_NFS_EXPORT` | For `docker-compose.nfs.yml` instead of a host mount |

Optional NFS volume driver (if you prefer not to fstab):

```bash
docker compose -f docker-compose.yml -f docker-compose.nfs.yml up -d
```

---

## Reverse proxies

Default **git branch / compose file is Nginx**. Traefik and Caddy remain first-class overlays.

| Proxy | Compose file | Extra config |
| --- | --- | --- |
| Nginx (this branch) | `docker-compose.yml` | `deploy/nginx/nginx.conf` + `deploy/nginx/certs/{fullchain,privkey}.pem` |
| Traefik | `docker-compose.traefik.yml` | `deploy/traefik/dynamic/dcengineer.yml` |
| Caddy | `docker-compose.caddy.yml` | `deploy/caddy/Caddyfile`, `ACME_EMAIL`, `DCE_HOSTNAME` |
| None (lab) | `docker-compose.dev.yml` | publishes `8080` |

```bash
# nginx
docker compose up -d --build

# traefik (existing proxy network)
docker compose -f docker-compose.traefik.yml up -d --build

# caddy (automatic HTTPS)
docker compose -f docker-compose.caddy.yml up -d --build
```

ENV used by those files: `DCE_HOSTNAME`, `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERT_RESOLVER`, `NGINX_HTTP_PORT`, `NGINX_HTTPS_PORT`, `CADDY_HTTP_PORT`, `CADDY_HTTPS_PORT`, `ACME_EMAIL`.

---

## JWTAuth

- `POST /api/auth/login` → `{ access_token, refresh_token, role, username, user_id }`
- Send `Authorization: Bearer <access_token>`
- `POST /api/auth/refresh` with `{ refresh_token }`
- Roles: `admin`, `engineer`, `remote`, `viewer`

Bootstrap admin is created **only when the user table is empty** (`BOOTSTRAP_ADMIN_*`). Additional users: Settings → (admin) or `POST /api/users`.

---

## Browser, tablet, GrapheneOS

1. Open `https://dce.rootpcs.cloud` and sign in.
2. **Install app** / Add to Home screen (Vanadium, Firefox, Chrome, Edge).
3. Use **Capture** on the floor: large controls, rear camera, optional barcode scan (`BarcodeDetector`), photo upload, offline queue if Zerotier drops.

Android APK (no Google Play Services): see [`android/README.md`](android/README.md).

API docs while signed in to the network: `https://dce.rootpcs.cloud/docs`.

---

## RBI Excel export

Project page → **Export RBI workbook**. Sheets: Cover, Revision Control, Racks, Elevations, Devices, PDU Connectivity, Cabling, Lifecycle, Remediation, Handoffs. Near-EOL window is `NEAR_EOL_DAYS` (default 365). Rack SVG: project → rack → **Download SVG layout**.

---

## Development

```bash
# API tests
cd backend && pip install -r requirements.txt && pytest -q

# UI (proxies /api to :8080)
cd frontend && npm install && npm run build
# npm run dev
```

CI (GitHub Actions) runs pytest and `npm run build` on every push.

---

## Repository layout

```
backend/app/          FastAPI + SQLAlchemy + JWTAuth
frontend/             React + Vite PWA
deploy/traefik|nginx|caddy
docker-compose*.yml
.env.example
.env.danncloud.example
scripts/install-danncloud.sh
android/README.md
```
