# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS frontend
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        tar \
        openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin dce \
    && mkdir -p /data /data/files /backups /app/static \
    && chown -R dce:dce /data /backups /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY scripts/entrypoint.sh /app/scripts/entrypoint.sh
COPY --from=frontend /ui/dist /app/static
RUN chmod +x /app/scripts/entrypoint.sh && chown -R dce:dce /app

ENV PYTHONPATH=/app/backend \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DCE_PORT=8080 \
    STATIC_DIR=/app/static \
    STORAGE_LOCAL_PATH=/data/files \
    BACKUP_PATH=/backups

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

USER dce
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
