"""JSON schema sent to Claude for floor-photo inventory extraction."""

EXTRACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["devices"],
    "properties": {
        "layout": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "notes": {"type": "string"},
                "areas": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "name": {"type": "string"},
                            "notes": {"type": "string"},
                        },
                    },
                },
                "rows": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "name": {"type": "string"},
                            "area_name": {"type": "string"},
                            "notes": {"type": "string"},
                        },
                    },
                },
                "racks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "name": {"type": "string"},
                            "row_name": {"type": "string"},
                            "area_name": {"type": "string"},
                            "ru_height": {"type": "integer"},
                            "notes": {"type": "string"},
                        },
                    },
                },
            },
        },
        "devices": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string", "description": "Empty if the label cannot be read."},
                    "hostname": {"type": "string"},
                    "vendor": {"type": "string"},
                    "model": {"type": "string"},
                    "serial": {"type": "string"},
                    "asset_tag": {"type": "string"},
                    "owner": {"type": "string"},
                    "device_type": {"type": "string"},
                    "function": {"type": "string"},
                    "ru_start": {"type": "integer"},
                    "ru_end": {"type": "integer"},
                    "area_name": {"type": "string"},
                    "row_name": {"type": "string"},
                    "rack_name": {"type": "string"},
                    "notes": {"type": "string"},
                    "unreadable_fields": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Field names that were not clearly readable.",
                    },
                    "evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "clip_index": {"type": "integer"},
                                "reason": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
        "unreadable": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Session-level notes about what could not be read.",
        },
        "notes": {"type": "string"},
    },
}

SYSTEM_PROMPT = """You extract datacenter inventory from stills and video frames taken on the floor.

Rules:
- Never guess. If a serial, model, vendor, name, owner, asset tag, hostname, or RU position is not clearly readable, leave that field as an empty string (or omit numbers) and list it in unreadable_fields.
- Do not invent plausible Cisco/Dell/HPE models or serial formats.
- Wide aisle shots describe row/rack layout only. Close shots may populate device fields.
- clip_index is the 0-based index of the image you were given, in the order listed.
- Prefer the closest frame that shows a serial or asset tag as evidence.
- Output only structured data through the submit_inventory_extraction tool.
"""


def extraction_prompt(shot_kind: str, clip_labels: list[str], context: str = "") -> str:
    labels = "\n".join(f"- index {i}: {label}" for i, label in enumerate(clip_labels)) or "- (no stills)"
    extra = f"\nEngineer notes: {context}\n" if context else ""
    return (
        f"Shot kind for this session: {shot_kind or 'mixed'}.\n"
        f"{extra}"
        "Images in order:\n"
        f"{labels}\n\n"
        "Extract visible layout and devices. Leave unreadables blank."
    )


BLANKABLE_STRINGS = (
    "name",
    "hostname",
    "vendor",
    "model",
    "serial",
    "asset_tag",
    "owner",
    "device_type",
    "function",
    "area_name",
    "row_name",
    "rack_name",
    "notes",
)
BLANKABLE_INTS = ("ru_start", "ru_end")
ALIASES = {
    "sn": "serial",
    "serial_number": "serial",
    "serial_no": "serial",
    "asset": "asset_tag",
    "tag": "asset_tag",
    "ru": "ru_start",
    "type": "device_type",
    "rack": "rack_name",
    "row": "row_name",
    "aisle": "row_name",
    "area": "area_name",
}


def blank_unreadable(device: dict, extra_fields: list[str] | None = None) -> dict:
    flagged = {str(f).strip().lower().replace(" ", "_").replace("-", "_") for f in (device.get("unreadable_fields") or [])}
    if extra_fields:
        flagged.update(str(f).strip().lower().replace(" ", "_") for f in extra_fields)
    resolved = {ALIASES.get(k, k) for k in flagged if k}
    out = dict(device)
    for key in resolved:
        if key in BLANKABLE_STRINGS:
            out[key] = ""
        elif key in BLANKABLE_INTS:
            out[key] = None
    for key in BLANKABLE_STRINGS:
        if out.get(key) is None:
            out[key] = ""
    return out
