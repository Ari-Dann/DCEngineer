from __future__ import annotations

import json
import re
from typing import Any

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def parse_json_object(text: str) -> dict[str, Any]:
    """Pull a JSON object out of model text (fences, leading prose, trailing notes)."""
    raw = (text or "").strip()
    if not raw:
        raise RuntimeError("Model returned empty text")
    raw = _FENCE.sub("", raw).strip()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            raise RuntimeError("Model response did not include a JSON object") from None
        value = json.loads(raw[start : end + 1])
    if not isinstance(value, dict):
        raise RuntimeError("Model JSON was not an object")
    if "devices" not in value:
        value = {"devices": [value] if value else [], "notes": ""}
    if not isinstance(value.get("devices"), list):
        value["devices"] = []
    return value


def without_additional_properties(schema: Any) -> Any:
    if isinstance(schema, dict):
        return {k: without_additional_properties(v) for k, v in schema.items() if k != "additionalProperties"}
    if isinstance(schema, list):
        return [without_additional_properties(v) for v in schema]
    return schema
