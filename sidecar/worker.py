from __future__ import annotations

import logging
import os
import time
from typing import Any

from client import DCEClient
from images import media_type_for
from providers import load_backend
from frames import extract_frames, is_video
from schema import SYSTEM_PROMPT, blank_unreadable

log = logging.getLogger("dce-sidecar")

KIND_RANK = {
    "serial_frame": 0,
    "device_close": 1,
    "rack_face": 2,
    "aisle_wide": 3,
    "other": 4,
}
MAX_IMAGES = 20


def as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def session_is_restricted(session: dict) -> str | None:
    if session.get("restricted_blocked"):
        return session.get("error_detail") or "Restricted equipment — photos were not sent to the vision model."
    reasons = session.get("restriction_reasons") or []
    if reasons:
        return "Restricted equipment — photos were not sent to the vision model. " + "; ".join(reasons)
    for clip in session.get("clips") or []:
        if clip.get("photography_restricted"):
            return "Restricted equipment — photos were not sent to the vision model. A clip is marked photography-restricted."
    return None


def proposals_from_extraction(
    extraction: dict,
    clips: list[dict],
    prompt: str,
    model: str,
    sent_attachment_ids: list[int],
) -> dict:
    devices = extraction.get("devices") or []
    session_unread = extraction.get("unreadable") or []
    proposals: list[dict[str, Any]] = []
    for device in devices:
        cleaned = blank_unreadable(device, session_unread)
        evidence_ids: list[int] = []
        for ev in cleaned.get("evidence") or []:
            idx = ev.get("clip_index") if isinstance(ev, dict) else None
            if isinstance(idx, int) and 0 <= idx < len(clips):
                evidence_ids.append(int(clips[idx]["attachment_id"]))
        if not evidence_ids:
            evidence_ids = list(sent_attachment_ids)
        unread = list(cleaned.get("unreadable_fields") or [])
        unread.extend(f for f in session_unread if f not in unread)
        proposals.append(
            {
                "name": cleaned.get("name") or "",
                "hostname": cleaned.get("hostname") or "",
                "vendor": cleaned.get("vendor") or "",
                "model": cleaned.get("model") or "",
                "serial": cleaned.get("serial") or "",
                "asset_tag": cleaned.get("asset_tag") or "",
                "owner": cleaned.get("owner") or "",
                "device_type": cleaned.get("device_type") or "",
                "function": cleaned.get("function") or "",
                "ru_start": as_int(cleaned.get("ru_start")),
                "ru_end": as_int(cleaned.get("ru_end")),
                "area_name": cleaned.get("area_name") or "",
                "row_name": cleaned.get("row_name") or "",
                "rack_name": cleaned.get("rack_name") or "",
                "notes": cleaned.get("notes") or "",
                "unreadable_fields": unread,
                "evidence_attachment_ids": evidence_ids,
            }
        )
    return {
        "model": model,
        "extractor_model": model,
        "prompt_text": f"{SYSTEM_PROMPT}\n\n{prompt}",
        "raw_extraction": extraction,
        "layout": extraction.get("layout"),
        "media_sent_attachment_ids": sent_attachment_ids,
        "proposals": proposals,
    }


def process_session(client: DCEClient, session_id: int, backend, max_frames: int) -> None:
    try:
        claimed = client.claim(session_id)
    except Exception as exc:
        log.warning("Could not claim session %s: %s", session_id, exc)
        return
    session = client.session(session_id)
    blocked = session_is_restricted(session) or session_is_restricted(claimed)
    if blocked:
        log.warning("Refusing session %s: %s", session_id, blocked)
        try:
            client.set_status(session_id, "refused", error_detail=blocked, restricted_blocked=True)
        except Exception:
            log.exception("Failed to mark session %s refused", session_id)
        return

    stills: list[dict[str, Any]] = []
    for clip in session.get("clips") or []:
        if clip.get("photography_restricted"):
            continue
        data, content_type, filename = client.download(clip["attachment_id"])
        if is_video(filename or clip.get("filename") or "", content_type or clip.get("content_type") or ""):
            frames = extract_frames(data, filename, max_frames=max_frames)
            for i, (jpeg, ts) in enumerate(frames):
                uploaded = client.upload_clip(
                    session_id,
                    jpeg,
                    f"{PathStem(filename)}-t{ts}ms.jpg",
                    "image/jpeg",
                    kind="serial_frame" if "serial" in (clip.get("kind") or "") or clip.get("kind") == "device_close" else clip.get("kind") or "other",
                    source="video_frame",
                    source_attachment_id=clip["attachment_id"],
                    timestamp_ms=ts,
                    notes=f"frame {i} from {filename}",
                )
                stills.append(
                    {
                        "attachment_id": uploaded["attachment_id"],
                        "kind": uploaded.get("kind") or "serial_frame",
                        "bytes": jpeg,
                        "media_type": "image/jpeg",
                        "label": f"{uploaded.get('kind')} frame {i} ({filename} @ {ts}ms)",
                    }
                )
        else:
            media = media_type_for(content_type, filename)
            if not media:
                log.info("Skipping non-image clip %s (%s)", filename, content_type)
                continue
            stills.append(
                {
                    "attachment_id": clip["attachment_id"],
                    "kind": clip.get("kind") or "other",
                    "bytes": data,
                    "media_type": media,
                    "label": f"{clip.get('kind')} {filename}",
                }
            )

    stills.sort(key=lambda s: KIND_RANK.get(s.get("kind") or "other", 9))
    stills = stills[:MAX_IMAGES]
    if not stills:
        client.set_status(session_id, "error", error_detail="No still images available after frame extraction")
        return

    images = [(s["bytes"], s["media_type"], s["label"]) for s in stills]
    sent_ids = [int(s["attachment_id"]) for s in stills]
    try:
        extraction, prompt, used_model = backend.extract(
            images,
            session.get("shot_kind") or "mixed",
            session.get("notes") or "",
        )
    except Exception as exc:
        log.exception("%s failed for session %s", backend.provider, session_id)
        client.set_status(session_id, "error", error_detail=str(exc)[:1000])
        return

    payload = proposals_from_extraction(extraction, stills, prompt, used_model, sent_ids)
    if not payload["proposals"]:
        payload["proposals"] = [
            {
                "name": "",
                "notes": "No devices were readable in the submitted media.",
                "unreadable_fields": ["name", "vendor", "model", "serial"],
                "evidence_attachment_ids": sent_ids,
            }
        ]
    client.post_proposals(session_id, payload)
    log.info("Wrote %s proposals for session %s", len(payload["proposals"]), session_id)


def PathStem(filename: str) -> str:
    name = (filename or "clip").rsplit("/", 1)[-1]
    if "." in name:
        return name.rsplit(".", 1)[0]
    return name


def loop() -> None:
    configure_logging()
    api_url = env("DCE_API_URL", "http://dcengineer:8080")
    username = env("DCE_SIDECAR_USER") or env("BOOTSTRAP_SIDECAR_USER")
    password = env("DCE_SIDECAR_PASSWORD") or env("BOOTSTRAP_SIDECAR_PASSWORD")
    poll = float(env("VISION_POLL_SECONDS", "8") or "8")
    max_frames = int(env("VISION_MAX_FRAMES", "24") or "24")
    if not username or not password:
        raise SystemExit("DCE_SIDECAR_USER and DCE_SIDECAR_PASSWORD are required")
    backend = load_backend()
    client = DCEClient(api_url, username, password)
    client.login()
    log.info("Vision sidecar polling %s (provider=%s model=%s)", api_url, backend.provider, backend.model)
    while True:
        try:
            if not backend.ready:
                log.warning("%s is not set; queued jobs will wait", backend.missing)
                time.sleep(poll)
                continue
            jobs = client.jobs()
            for job in jobs:
                process_session(client, int(job["id"]), backend, max_frames)
        except Exception:
            log.exception("Sidecar loop error")
            try:
                client.login()
            except Exception:
                log.exception("Re-login failed")
        time.sleep(poll)


if __name__ == "__main__":
    loop()
