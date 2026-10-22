"""Idempotent device and rack writes for integrators.

Empty strings do not blank an existing value unless overwrite_empty is set.
A device that already occupies a different rack is left there.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.layout import resolve_or_create_row
from app.models import Device, Rack
from app.restriction import apply_flags

_DEVICE_FIELDS = {
    "name",
    "rack_id",
    "hostname",
    "vendor",
    "model",
    "serial",
    "external_id",
    "source",
    "asset_tag",
    "owner",
    "device_type",
    "function",
    "ru_start",
    "ru_end",
    "parent_device_id",
    "restricted",
    "restricted_reason",
    "fan_orientation",
    "indicator_type",
    "indicator_color",
    "power_draw_watts",
    "power_draw_unit",
    "dc_power_draw_amps",
    "pdu_a_id",
    "pdu_b_id",
    "management_ip",
    "discovered_via",
    "undocumented",
    "eol_date",
    "eos_date",
    "eol_notes",
    "notes",
}

_RACK_FIELDS = {
    "name",
    "area_id",
    "row_id",
    "row_label",
    "position",
    "ru_height",
    "width_inches",
    "notes",
    "external_id",
    "source",
    "restricted",
    "restriction_type",
    "photography_allowed",
}


def ensure_external(
    db: Session,
    model,
    project_id: int,
    source: str,
    external_id: str,
    ignore_id: Optional[int] = None,
) -> None:
    source = (source or "").strip()
    external_id = (external_id or "").strip()
    if not source and not external_id:
        return
    if not source or not external_id:
        raise HTTPException(400, "external_id and source are required together")
    query = db.query(model).filter(
        model.project_id == project_id,
        model.source == source,
        model.external_id == external_id,
    )
    if ignore_id is not None:
        query = query.filter(model.id != ignore_id)
    if query.first():
        raise HTTPException(409, "external_id already exists for this source in the project")


def _merge(entity, data: dict[str, Any], overwrite_empty: bool) -> None:
    for key, value in data.items():
        if value is None:
            continue
        if isinstance(value, str) and value == "" and not overwrite_empty:
            continue
        setattr(entity, key, value)


def _pair(data: dict[str, Any]) -> tuple[str, str]:
    external_id = (data.get("external_id") or "").strip()
    source = (data.get("source") or "").strip()
    if "external_id" in data:
        data["external_id"] = external_id
    if "source" in data:
        data["source"] = source
    if bool(external_id) != bool(source):
        raise HTTPException(400, "external_id and source are required together")
    return external_id, source


def upsert_device(db: Session, project_id: int, raw: dict[str, Any], user_id: Optional[int]) -> tuple[Device, str]:
    data = {key: value for key, value in raw.items() if key in _DEVICE_FIELDS}
    match = raw.get("match") or "auto"
    overwrite_empty = bool(raw.get("overwrite_empty") or False)
    external_id, source = _pair(data)
    serial = (data.get("serial") or "").strip()
    if "serial" in data:
        data["serial"] = serial

    if match == "auto":
        mode = "external_id" if external_id else "serial" if serial else ""
    elif match in ("external_id", "serial"):
        mode = match
    else:
        raise HTTPException(400, "match must be auto, serial, or external_id")
    if mode == "external_id" and not external_id:
        raise HTTPException(400, "external_id and source are required when match is external_id")
    if mode == "serial" and not serial:
        raise HTTPException(400, "serial is required when match is serial")
    if not mode:
        raise HTTPException(400, "Provide serial, or external_id and source")

    existing: Optional[Device] = None
    if mode == "external_id":
        existing = (
            db.query(Device)
            .filter(Device.project_id == project_id, Device.source == source, Device.external_id == external_id)
            .one_or_none()
        )
    else:
        matches = db.query(Device).filter(Device.project_id == project_id, Device.serial == serial).all()
        if len(matches) > 1:
            raise HTTPException(409, f"Serial {serial} matches more than one device")
        existing = matches[0] if matches else None

    if existing:
        new_rack = data.get("rack_id", existing.rack_id) if "rack_id" in data else existing.rack_id
        if existing.rack_id and new_rack and new_rack != existing.rack_id:
            raise HTTPException(409, f"Device {existing.id} already lives in another rack and was not moved")
        if serial and serial != (existing.serial or ""):
            other = (
                db.query(Device)
                .filter(Device.project_id == project_id, Device.serial == serial, Device.id != existing.id)
                .first()
            )
            if other:
                raise HTTPException(409, f"Serial {serial} is already on device {other.id}")
        ensure_external(db, Device, project_id, source or existing.source, external_id or existing.external_id, existing.id)
        _merge(existing, data, overwrite_empty)
        if not existing.rack_id or existing.ru_start is None:
            existing.parent_device_id = None
        return existing, "updated"

    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required to create a device")
    data["name"] = name
    ensure_external(db, Device, project_id, source, external_id)
    device = Device(project_id=project_id, captured_by=user_id, **{k: v for k, v in data.items() if v is not None})
    return device, "created"


def upsert_rack(db: Session, project_id: int, raw: dict[str, Any]) -> tuple[Rack, str]:
    data = apply_flags({key: value for key, value in raw.items() if key in _RACK_FIELDS})
    match = raw.get("match") or "auto"
    overwrite_empty = bool(raw.get("overwrite_empty") or False)
    external_id, source = _pair(data)
    name = (data.get("name") or "").strip()
    if "name" in data:
        data["name"] = name

    if match == "auto":
        mode = "external_id" if external_id else "name" if name else ""
    elif match in ("external_id", "name"):
        mode = match
    else:
        raise HTTPException(400, "match must be auto, external_id, or name")
    if mode == "external_id" and not external_id:
        raise HTTPException(400, "external_id and source are required when match is external_id")
    if mode == "name" and not name:
        raise HTTPException(400, "name is required when match is name")
    if not mode:
        raise HTTPException(400, "Provide a rack name, or external_id and source")

    existing: Optional[Rack] = None
    if mode == "external_id":
        existing = (
            db.query(Rack)
            .filter(Rack.project_id == project_id, Rack.source == source, Rack.external_id == external_id)
            .one_or_none()
        )
    else:
        matches = db.query(Rack).filter(Rack.project_id == project_id, Rack.name == name).all()
        if len(matches) > 1:
            raise HTTPException(409, f"Rack name {name} matches more than one rack")
        existing = matches[0] if matches else None

    row = resolve_or_create_row(
        db,
        project_id,
        row_id=data.get("row_id"),
        row_label=data.get("row_label") or "",
        area_id=data.get("area_id"),
    )
    if row:
        data["row_id"] = row.id
        data["row_label"] = row.name
        if row.area_id is not None:
            data["area_id"] = row.area_id

    if existing:
        ensure_external(db, Rack, project_id, source or existing.source, external_id or existing.external_id, existing.id)
        _merge(existing, data, overwrite_empty)
        return existing, "updated"

    if not name:
        raise HTTPException(400, "name is required to create a rack")
    data["name"] = name
    ensure_external(db, Rack, project_id, source, external_id)
    rack = Rack(project_id=project_id, **{k: v for k, v in data.items() if v is not None})
    return rack, "created"
