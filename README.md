# DCEngineer

Self-hosted assistant for datacenter engineers. Browser-first PWA (desktop, tablet, GrapheneOS / Vanadium), JWTAuth API, and a single container image published on GitHub Container Registry as **`ghcr.io/ari-dann/dcengineer:latest`**.

This repository is meant to be used as a **GitHub template** (Settings → General → Template repository) and/or cloned as-is. Put site-specific names, IPs, and overlay-VPN details only in your private `.env` — never in git.

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
Caddy, Traefik, or Nginx  →  dcengineer:8080
        │
        ├─ SQLite (default) or Postgres via DATABASE_URL
        ├─ Attachments: local | nfs bind-mount | SFTP
        ├─ App backups: tar.gz into BACKUP_PATH
        └─ optional vision sidecar → JWT API → Claude (staging proposals only)
```

One container serves the API and the built SPA. Traefik routing uses a **dynamic YAML file** (no container labels) so compose UIs stay clean.

---

## Image (`:latest`)

Every push to `main` publishes:

```text
ghcr.io/ari-dann/dcengineer:latest
```

plus a short SHA tag. Pull it instead of building when you only want to run the app:

```bash
docker pull ghcr.io/ari-dann/dcengineer:latest
```

Override the image in `.env`:

```bash
DCE_IMAGE=ghcr.io/ari-dann/dcengineer:latest
```

Forks and template copies should change `DCE_IMAGE` to their own GHCR repo, or keep building locally with `docker-compose.dev.yml`.

The GHCR package must be **public** (GitHub → Packages → `dcengineer` → Package settings → Change visibility) so unauthenticated `docker pull` works.

---

## Quick start

```bash
git clone https://github.com/Ari-Dann/DCEngineer.git
cd DCEngineer
cp .env.example .env
# set JWT_SECRET, BOOTSTRAP_ADMIN_PASSWORD, DCE_HOSTNAME, DCE_PUBLIC_URL, CORS_ORIGINS
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# lab / no reverse proxy (builds locally):
docker compose -f docker-compose.dev.yml up -d --build
# open http://localhost:8080  (bootstrap user from .env)

# production (pull :latest, Caddy with automatic HTTPS):
docker compose pull
docker compose up -d
```

Generate a real `JWT_SECRET` before anything is public. Change the bootstrap password on first login.

---

## Production host (generic VPS)

Recommended shape: a public-facing Docker host, Traefik or Caddy for TLS, data on local disk, backups on a NAS over an overlay VPN (ZeroTier, Tailscale, Twingate, or WireGuard). All of the names below are **examples** — replace them in `.env`.

| Setting | Example | Your `.env` variable |
| --- | --- | --- |
| Public hostname | `dce.example.com` | `DCE_HOSTNAME`, `DCE_PUBLIC_URL`, `CORS_ORIGINS` |
| Container image | `ghcr.io/ari-dann/dcengineer:latest` | `DCE_IMAGE` |
| App data on the VPS | `./data` or `/opt/dcengineer/data` | `DCE_DATA_PATH` |
| Backup NAS | `nas.example.net` | `NFS_HOST`, `BACKUP_NFS_HOST` |
| NFS export | `/mnt/pool/dce-backups` | `NFS_EXPORT`, `BACKUP_NFS_EXPORT` |
| Host mount for backups | `/mnt/dce-backups` | `DCE_BACKUP_HOST_PATH` |
| Overlay VPN | your mesh IPs / hostnames | used only in fstab / firewall, not in git |
| Traefik network | `traefik-net` | `TRAEFIK_NETWORK` |
| Traefik entrypoint / resolver | `websecure` / `letsencrypt` | `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERT_RESOLVER` |
| ACME email | `admin@example.com` | `ACME_EMAIL` |

### 1. NFS backup mount (recommended)

Bind-mounting a **host** NFS mount is more reliable than the NFS volume driver across reboots.

```bash
sudo mkdir -p /mnt/dce-backups /opt/dcengineer
# replace nas.example.net and the export path with your NAS
echo 'nas.example.net:/mnt/pool/dce-backups /mnt/dce-backups nfs defaults,_netdev,nofail,nfsvers=4 0 0' | sudo tee -a /etc/fstab
sudo mount -a
```

On the NAS, export that path to the Docker host (or the overlay-VPN prefix) with maproot/anonuid matching `PUID`/`PGID` if you do not squash to root.

### 2. Install

```bash
sudo git clone https://github.com/Ari-Dann/DCEngineer.git /opt/dcengineer
cd /opt/dcengineer
sudo cp .env.example .env
sudo nano .env          # JWT_SECRET, hostname, backup paths
```

Or run the helper (as root; all paths are variables):

```bash
sudo \
  DCE_HOSTNAME=dce.example.com \
  NFS_HOST=nas.example.net \
  NFS_EXPORT=/mnt/pool/dce-backups \
  bash scripts/install-host.sh
```

### 3. Traefik dynamic file (no container labels)

Render `Host($DCE_HOSTNAME)` from `.env` and copy it into your Traefik file-provider directory:

```bash
bash scripts/render-traefik.sh /opt/traefik/dynamic/dcengineer.yml
```

The example file `deploy/traefik/dynamic/dcengineer.yml` uses `dce.example.com`. Traefik must resolve the container name `dcengineer` (or `DCE_CONTAINER_NAME`) on `${TRAEFIK_NETWORK}`.

If Traefik does not watch that directory yet, add a file provider pointing at it.

### 4. DNS

Create an A or CNAME record: `${DCE_HOSTNAME}` → the Docker host's public (or overlay) address. Let's Encrypt needs 80/443 reachable for HTTP-01 (or already configured DNS-01).

### 5. Compose UI (Portainer, Dockge, Dockhand, …)

Create a stack named `dcengineer` from this directory's compose file with `.env` beside it. Confirm:

- the reverse-proxy network is attached (Traefik: external `${TRAEFIK_NETWORK}`)
- container name is `${DCE_CONTAINER_NAME}` (default `dcengineer`)
- volumes: app data on the VPS SSD, backups on the NAS mount

Health: `https://${DCE_HOSTNAME}/api/health`.

### 6. Overlay VPN (ZeroTier / Tailscale / Twingate)

Join the Docker host and the NAS to the same overlay. Either keep public HTTPS or set `DCE_PUBLIC_URL` / `CORS_ORIGINS` to the overlay URL and firewall 443 to overlay-only.

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

Default `docker-compose.yml` is **Caddy** (automatic HTTPS). Traefik and Nginx are overlays.

| Proxy | Compose file | Extra config |
| --- | --- | --- |
| Caddy | `docker-compose.yml` | `deploy/caddy/Caddyfile`, `ACME_EMAIL`, `DCE_HOSTNAME` |
| Traefik | `docker-compose.traefik.yml` | `scripts/render-traefik.sh` → dynamic YAML |
| Nginx | `docker-compose.nginx.yml` | `deploy/nginx/nginx.conf` + `deploy/nginx/certs/{fullchain,privkey}.pem` |
| None (lab) | `docker-compose.dev.yml` | publishes `8080` |

```bash
# caddy (automatic HTTPS), using GHCR :latest
docker compose pull && docker compose up -d

# traefik (existing proxy network)
docker compose -f docker-compose.traefik.yml pull
docker compose -f docker-compose.traefik.yml up -d

# nginx
docker compose -f docker-compose.nginx.yml up -d --build
```

ENV used by those files: `DCE_IMAGE`, `DCE_HOSTNAME`, `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, `TRAEFIK_CERT_RESOLVER`, `NGINX_HTTP_PORT`, `NGINX_HTTPS_PORT`, `CADDY_HTTP_PORT`, `CADDY_HTTPS_PORT`, `ACME_EMAIL`.

---

## JWTAuth

- `POST /api/auth/login` → `{ access_token, refresh_token, role, username, user_id }`
- Send `Authorization: Bearer <access_token>`
- `POST /api/auth/refresh` with `{ refresh_token }`
- Roles: `admin`, `engineer`, `remote`, `viewer`, `sidecar`

Bootstrap admin is created **only when the user table is empty** (`BOOTSTRAP_ADMIN_*`). Additional users: Settings → (admin) or `POST /api/users`. Set `BOOTSTRAP_SIDECAR_USER` and `BOOTSTRAP_SIDECAR_PASSWORD` to create a `sidecar` worker account that can pull attachments and write **staging proposals only** — it cannot create devices.

---

## Browser, tablet, GrapheneOS

1. Open `https://${DCE_HOSTNAME}` (for example `https://dce.example.com`) and sign in.
2. **Install app** / Add to Home screen (Vanadium, Firefox, Chrome, Edge).
3. Use **Capture** on the floor: large controls, a visible camera window for serial scan, in-app photos (not saved to the phone/tablet gallery), vendor/model dropdowns with an editable **Other**, and a locate search that maps logical identity onto a rack + RU. Offline queue still stores device fields if the overlay VPN drops.

### Edit after capture

Every device field can be corrected later: click a device in Capture, the project Devices table, Lifecycle, or a filled RU on the rack elevation. Rack height is not limited to 42U — presets include 45, 47, 48, 52, and 58U, and any value from 1–70U is allowed. Placing a device above the current rack height grows the rack automatically.

### Import CSV / XLSX / ODS

Admin and Engineer can import from Project → **Devices** (or **Areas**). Choose a `.csv`, `.xlsx`, or `.ods` file. Headers are matched flexibly, for example:

```text
area,aisle,rack,name,hostname,vendor,model,serial,ru start,height,type
Hall A,Row 1,A01,core-rtr,core-rtr.site,Cisco,ASR 1001-X,FCW1234,47,2,router
Hall A,Row 2,,,
Hall A,Row 3,A03,,,
```

If the sheet contains **Area** and **Row/Aisle** columns, the import creates that layout and fills the area even when some lines have no device. Matching follows **Area → Row → Rack → Device**: a row is matched only inside its area, a rack only inside that row (or an unassigned rack in the same area), and a device serial that already lives in a different rack is left in place rather than moved. Empty or “unknown” cells do not blank fields that are already filled. Missing rack names are created (default 42U, grown if the RU is higher). Devices with no rack stay **unlocated** until you assign them under **Locate** or Capture. New devices default to a **blank type** (not `server`); choose a type when you know it.

Workbooks with several sheets import **one sheet by default** (the Devices sheet in an RBI export). Check **Import every sheet** to load the entire file. A sheet named Hall A or Row 1 is used as the area (or as the row when a default area is set) unless the name is generic (`Devices`, `Cover`, `Inventory`, `Sheet1`, …).

**NetBox:** a devices CSV that uses NetBox import headers (`site`, `role`, `manufacturer`, `device_type`, `position`, …) is detected automatically. `role` maps to type, `manufacturer` to vendor, `device_type` to model, `location` to area (nested `Area / Row` names also fill the row), `position` to RU start, and `tenant` to owner. You can also import the `devices.csv` from a DCEngineer NetBox ZIP.

Only an **Admin** can rename or delete an entire project.

### Photos

**Capture photo** uses `getUserMedia` and a canvas JPEG. Files are uploaded as attachments on the current entity (device, rack, row, area, project, inspection, incident, or work order). Multiple photos per device are supported. Restricted (government / EMSS) equipment blocks photography.

On the files volume (`STORAGE_LOCAL_PATH`, default `/data/files`) captures are stored as `Project/Area/Axx/Rxx/RUnn/{timestamp}.ext` at the depth you photographed (project, area, row, rack, or device). Unknown levels are omitted — no `Unlocated` or `A00` placeholders.

### Vision sidecar (optional)

On the **Areas**, **Rows**, **Racks**, and **Devices** tabs (and Capture / a rack elevation), choose **AI image parse** to photograph or record video in place. The sidecar returns suggestions; **each field is Confirm / Skip on its own**. Confirming a name writes that area, row, rack, or device; later field confirms patch the same record. Unreadable fields stay blank. Restricted media is never sent to the model.

If an area is restricted, photography is forbidden, or a clip is marked photography-restricted, Analyze **refuses** and the sidecar never sends image bytes to the model.

Set `BOOTSTRAP_SIDECAR_PASSWORD` / `DCE_SIDECAR_PASSWORD` and a provider key in `.env`. Keys stay in the sidecar container, not the main API.

| `VISION_PROVIDER` | Key | Example `VISION_MODEL` |
| --- | --- | --- |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.0-flash` (default) or `gemini-flash` |
| `huggingface` | `HF_TOKEN` | `qwen-vl` → Qwen2.5-VL-7B, `qwen2-vl`, `llama-3.2-vision` (gated; Llama 3.1 has no vision weights and aliases to 3.2) |
| `ollama` | none | `llama3.2-vision` or `qwen2.5vl` at `VISION_BASE_URL` (default `http://ollama:11434`) |
| `openai` | `OPENAI_API_KEY` | `gpt-4o`, or any OpenAI-compatible server via `VISION_BASE_URL` |
| `claude` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |

```bash
# Gemini
VISION_PROVIDER=gemini GEMINI_API_KEY=... VISION_MODEL=gemini-2.0-flash

# Hugging Face Inference Providers (good for Qwen-VL testing; Llama 3.2 Vision needs a HF license accept)
VISION_PROVIDER=huggingface HF_TOKEN=hf_... VISION_MODEL=qwen-vl

# Local Ollama (Llama 3.2 Vision / Qwen-VL)
VISION_PROVIDER=ollama VISION_MODEL=llama3.2-vision VISION_BASE_URL=http://host.docker.internal:11434

docker compose -f docker-compose.dev.yml -f docker-compose.vision.yml up -d --build
```

If `VISION_PROVIDER` is empty, the sidecar uses the first configured key (Anthropic, Gemini, Hugging Face, OpenAI). Without a key, jobs stay `queued`.

Android APK (no Google Play Services): see [`android/README.md`](android/README.md).

API docs: `https://${DCE_HOSTNAME}/docs`.

---

## RBI Excel export

Project page → **Export RBI workbook**. Sheets: Cover, Revision Control, Racks, Elevations, Devices, PDU Connectivity, Cabling, Lifecycle, Remediation, Handoffs. Near-EOL window is `NEAR_EOL_DAYS` (default 365). Rack SVG: project → rack → **Download SVG layout**.

## NetBox import / export

Project page → **Export for NetBox** downloads a ZIP of lowercase-header CSVs plus `device-types.yaml`, shaped for NetBox DCIM import (not a live API client).

Import order in NetBox: **Sites → Locations → Manufacturers → Device Types (YAML) → Device Roles → Racks → Devices**. Areas export as locations; rows export as child locations named `Area / Row`. Device type in DCEngineer is NetBox **role**; vendor/model are manufacturer/device type; owner is tenant; RU start is position. Devices with no type export the role `unspecified`.

To load a NetBox devices CSV back into DCEngineer, use Project → Devices → Import (or drop the whole ZIP). Header detection maps NetBox columns onto DCEngineer fields.

---

## Development

```bash
# API tests
cd backend && pip install -r requirements.txt && pytest -q

# Sidecar unit tests (mocked; no live model calls)
cd sidecar && pip install -r requirements.txt && pytest -q

# UI (proxies /api to :8080)
cd frontend && npm install && npm run build
# npm run dev
```

CI runs pytest and `npm run build` on every push. The image workflow publishes `:latest` from `main`.

---

## Repository layout

```
backend/app/          FastAPI + SQLAlchemy + JWTAuth
frontend/             React + Vite PWA
sidecar/              Optional vision worker (JWT API + Claude)
deploy/traefik|nginx|caddy
docker-compose*.yml
.env.example
scripts/install-host.sh
scripts/render-traefik.sh
android/README.md
```
