from __future__ import annotations

import logging
from typing import Any

import httpx

from images import b64, media_type_for
from schema import EXTRACTION_SCHEMA, SYSTEM_PROMPT, extraction_prompt

log = logging.getLogger("dce-sidecar")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def image_block(data: bytes, media_type: str) -> dict:
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": b64(data),
        },
    }


def parse_tool_payload(body: dict) -> dict:
    for block in body.get("content") or []:
        if block.get("type") == "tool_use" and isinstance(block.get("input"), dict):
            return block["input"]
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            text = block["text"].strip()
            if text.startswith("{"):
                from jsonutil import parse_json_object

                return parse_json_object(text)
    raise RuntimeError("Claude response did not include a JSON extraction")


def extract(
    api_key: str,
    model: str,
    images: list[tuple[bytes, str, str]],
    shot_kind: str,
    notes: str = "",
    timeout: float = 120.0,
    base_url: str = "",
) -> tuple[dict, str, str]:
    """Call Claude with a JSON schema. Returns (extraction, prompt, model)."""
    content: list[dict[str, Any]] = []
    labels: list[str] = []
    for data, media_type, label in images:
        content.append(image_block(data, media_type))
        labels.append(label)
    prompt = extraction_prompt(shot_kind, labels, notes)
    content.append({"type": "text", "text": prompt})
    payload = {
        "model": model,
        "max_tokens": 8192,
        "system": SYSTEM_PROMPT,
        "tools": [
            {
                "name": "submit_inventory_extraction",
                "description": "Submit readable inventory fields. Leave unreadables blank.",
                "input_schema": EXTRACTION_SCHEMA,
            }
        ],
        "tool_choice": {"type": "tool", "name": "submit_inventory_extraction"},
        "messages": [{"role": "user", "content": content}],
    }
    res = httpx.post(
        ANTHROPIC_URL if not base_url else f"{base_url.rstrip('/')}/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )
    if not res.is_success:
        log.error("Claude HTTP %s: %s", res.status_code, res.text[:500])
        res.raise_for_status()
    extraction = parse_tool_payload(res.json())
    return extraction, prompt, model


__all__ = ["extract", "parse_tool_payload", "media_type_for", "ANTHROPIC_URL"]
