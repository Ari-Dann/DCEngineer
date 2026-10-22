"""Drop identifiers a model should not see for capture-restricted gear."""

from __future__ import annotations

_SECRET_FIELDS = ("serial", "asset_tag", "management_ip", "notes", "eol_notes")


def is_restricted(row: dict | None) -> bool:
    if not row:
        return False
    if row.get("capture_restricted") or row.get("restricted"):
        return True
    return row.get("photography_allowed") is False


def redact_device(row: dict, *, restricted: bool | None = None) -> dict:
    out = dict(row)
    hide = is_restricted(out) if restricted is None else restricted
    if not hide:
        out["redacted"] = False
        return out
    for field in _SECRET_FIELDS:
        if field in out:
            out[field] = ""
    out["redacted"] = True
    return out


def redact_devices(rows: list[dict], *, restricted: bool | None = None) -> list[dict]:
    return [redact_device(row, restricted=restricted) for row in rows]
