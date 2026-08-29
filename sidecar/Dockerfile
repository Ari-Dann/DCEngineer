# syntax=docker/dockerfile:1.7

FROM python:3.12-slim
WORKDIR /sidecar

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin sidecar

COPY requirements.txt /sidecar/requirements.txt
RUN pip install --no-cache-dir -r /sidecar/requirements.txt

COPY . /sidecar/
RUN chown -R sidecar:sidecar /sidecar

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER sidecar
CMD ["python", "-m", "worker"]
