from __future__ import annotations

import logging
from typing import Any

import httpx

from images import data_url
from jsonutil import parse_json_object
from schema import EXTRACTION_SCHEMA, JSON_SYSTEM_PROMPT, extraction_prompt

log = logging.getLogger("dce-sidecar")


def openai_messages(
    images: list[tuple[bytes, str, str]],
    prompt: str,
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for data, media_type, _label in images:
        content.append({"type": "image_url", "image_url": {"url": data_url(data, media_type)}})
    return [
        {"role": "system", "content": JSON_SYSTEM_PROMPT},
        {"role": "user", "content": content},
    ]


def parse_openai_response(body: dict) -> dict:
    err = body.get("error")
    if err:
        raise RuntimeError(err.get("message") or str(err))
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("Chat-completions response had no choices")
    message = choices[0].get("message") or {}
    for call in message.get("tool_calls") or []:
        fn = call.get("function") or {}
        args = fn.get("arguments")
        if args:
            return parse_json_object(args if isinstance(args, str) else str(args))
    content = message.get("content")
    if isinstance(content, list):
        text = "\n".join(part.get("text") or "" for part in content if isinstance(part, dict))
        return parse_json_object(text)
    if isinstance(content, str) and content.strip():
        return parse_json_object(content)
    raise RuntimeError("Chat-completions response did not include a JSON extraction")


def ollama_payload(model: str, images: list[tuple[bytes, str, str]], prompt: str) -> dict[str, Any]:
    from images import b64

    return {
        "model": model,
        "stream": False,
        "format": EXTRACTION_SCHEMA,
        "messages": [
            {"role": "system", "content": JSON_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": prompt,
                "images": [b64(data) for data, _media, _label in images],
            },
        ],
    }


def parse_ollama_response(body: dict) -> dict:
    if body.get("error"):
        raise RuntimeError(str(body["error"]))
    message = body.get("message") or {}
    content = message.get("content") or body.get("response") or ""
    if isinstance(content, dict):
        if "devices" in content:
            return content
        return parse_json_object(str(content))
    return parse_json_object(str(content))


def extract(
    api_key: str,
    model: str,
    images: list[tuple[bytes, str, str]],
    shot_kind: str,
    notes: str = "",
    timeout: float = 120.0,
    base_url: str = "",
    native_ollama: bool = False,
    extra_headers: dict[str, str] | None = None,
) -> tuple[dict, str, str]:
    labels = [label for _data, _media, label in images]
    prompt = extraction_prompt(shot_kind, labels, notes)
    root = (base_url or "https://api.openai.com/v1").rstrip("/")
    headers = {"content-type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if extra_headers:
        headers.update(extra_headers)

    if native_ollama:
        url = f"{root}/api/chat" if not root.endswith("/api/chat") else root
        res = httpx.post(url, headers=headers, json=ollama_payload(model, images, prompt), timeout=timeout)
        if not res.is_success:
            log.error("Ollama HTTP %s: %s", res.status_code, res.text[:500])
            res.raise_for_status()
        return parse_ollama_response(res.json()), prompt, model

    url = f"{root}/chat/completions" if not root.endswith("/chat/completions") else root
    payload: dict[str, Any] = {
        "model": model,
        "messages": openai_messages(images, prompt),
        "temperature": 0,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"},
    }
    res = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    if res.status_code == 400:
        log.warning("Provider rejected json_object mode; retrying without response_format")
        payload.pop("response_format", None)
        res = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    if not res.is_success:
        log.error("Chat-completions HTTP %s: %s", res.status_code, res.text[:500])
        res.raise_for_status()
    return parse_openai_response(res.json()), prompt, model
