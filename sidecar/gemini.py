from __future__ import annotations

import logging
from typing import Any

import httpx

from images import b64
from jsonutil import parse_json_object, without_additional_properties
from schema import EXTRACTION_SCHEMA, JSON_SYSTEM_PROMPT, extraction_prompt

log = logging.getLogger("dce-sidecar")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def parse_gemini_response(body: dict) -> dict:
    errors = body.get("error") or {}
    if errors:
        raise RuntimeError(errors.get("message") or str(errors))
    for cand in body.get("candidates") or []:
        parts = ((cand.get("content") or {}).get("parts")) or []
        chunks = [p.get("text") for p in parts if isinstance(p, dict) and p.get("text")]
        if chunks:
            return parse_json_object("\n".join(chunks))
    raise RuntimeError("Gemini response did not include a JSON extraction")


def gemini_payload(images: list[tuple[bytes, str, str]], prompt: str) -> dict[str, Any]:
    parts: list[dict[str, Any]] = []
    for data, media_type, _label in images:
        parts.append({"inlineData": {"mimeType": media_type, "data": b64(data)}})
    parts.append({"text": prompt})
    return {
        "systemInstruction": {"parts": [{"text": JSON_SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": without_additional_properties(EXTRACTION_SCHEMA),
        },
    }


def extract(
    api_key: str,
    model: str,
    images: list[tuple[bytes, str, str]],
    shot_kind: str,
    notes: str = "",
    timeout: float = 120.0,
    base_url: str = "",
) -> tuple[dict, str, str]:
    labels = [label for _data, _media, label in images]
    prompt = extraction_prompt(shot_kind, labels, notes)
    payload = gemini_payload(images, prompt)
    root = (base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    url = f"{root}/models/{model}:generateContent"
    headers = {"x-goog-api-key": api_key, "content-type": "application/json"}
    res = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    if res.status_code == 400 and "responseSchema" in payload.get("generationConfig", {}):
        log.warning("Gemini rejected responseSchema; retrying JSON-mime only")
        payload["generationConfig"].pop("responseSchema", None)
        res = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    if not res.is_success:
        log.error("Gemini HTTP %s: %s", res.status_code, res.text[:500])
        res.raise_for_status()
    return parse_gemini_response(res.json()), prompt, model
