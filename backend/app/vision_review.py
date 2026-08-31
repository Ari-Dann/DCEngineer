"""Per-field confirm/skip for sidecar suggestions. Staging until a field is confirmed."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.catalog import learn_values
from app.layout import layout_items, resolve_or_create_area, resolve_or_create_rack, resolve_or_create_row
from app.models import AisleRow, Attachment, Device, User, VisionClip, VisionProposal, VisionSession
from app.routers.inventory import _ensure_rack_fits

DEVICE_FIELDS = (
    "name",
    "hostname",
    "vendor",
    "model",
    "serial",
    "asset_tag",
    "owner",
    "device_type",
    "function",
    "ru_start",
    "ru_end",
    "area_name",
    "row_name",
    "rack_name",
    "rack_id",
    "notes",
)
INT_FIELDS = {"ru_start", "ru_end", "rack_id"}
LAYOUT_FIELDS = {
    "area": ("name", "notes"),
    "row": ("name", "notes", "area_name"),
    "rack": ("name", "notes", "row_name", "area_name", "ru_height"),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _json_load(raw: str | None, default: Any) -> Any:
    import json

    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _json_dump(value: Any) -> str:
    import json

    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str)


def _list(raw: str | None) -> list[str]:
    value = _json_load(raw, [])
    if not isinstance(value, list):
        return []
    return [str(v) for v in value if v]


def _norm(field: str) -> str:
    return (field or "").strip().lower().replace(" ", "_")


def _coerce(field: str, value: Any):
    if field in INT_FIELDS:
        if value in (None, ""):
            return None
        return int(value)
    if field == "ru_height":
        try:
            n = int(value)
        except (TypeError, ValueError):
            return 42
        return min(70, max(1, n))
    if isinstance(value, bool):
        return value
    return "" if value is None else str(value)


def _proposal_value(row: VisionProposal, field: str) -> Any:
    if not hasattr(row, field):
        raise HTTPException(400, f"Unknown field {field}")
    return getattr(row, field)


def _copy_evidence(db: Session, attachment_ids: list[int], device_id: int, user_id: int | None) -> None:
    if not attachment_ids:
        return
    rows = db.query(Attachment).filter(Attachment.id.in_(attachment_ids)).all()
    existing_keys = {
        a.storage_key
        for a in db.query(Attachment)
        .filter(Attachment.entity_type == "device", Attachment.entity_id == device_id)
        .all()
    }
    for src in rows:
        if src.storage_key in existing_keys:
            continue
        db.add(
            Attachment(
                entity_type="device",
                entity_id=device_id,
                filename=src.filename,
                content_type=src.content_type,
                size=src.size,
                storage_key=src.storage_key,
                photography_restricted=src.photography_restricted,
                uploaded_by=user_id,
            )
        )
        existing_keys.add(src.storage_key)


def _ensure_device(db: Session, session: VisionSession, row: VisionProposal, user: User) -> Device:
    if row.accepted_device_id:
        device = db.get(Device, row.accepted_device_id)
        if device:
            return device
    name = (row.name or "").strip()
    if not name:
        raise HTTPException(400, "Confirm the device name before writing other fields")
    device = Device(
        project_id=session.project_id,
        captured_by=user.id,
        name=name,
        rack_id=row.rack_id or session.rack_id,
        discovered_via="vision",
    )
    db.add(device)
    db.flush()
    evidence = _json_load(row.evidence_attachment_ids_json, [])
    if not evidence:
        evidence = [c.attachment_id for c in db.query(VisionClip).filter(VisionClip.session_id == session.id).all()]
    _copy_evidence(db, [int(i) for i in evidence if i], device.id, user.id)
    row.accepted_device_id = device.id
    return device


def _apply_device_field(db: Session, session: VisionSession, row: VisionProposal, device: Device, field: str, value: Any) -> None:
    if field == "rack_id":
        device.rack_id = int(value) if value not in (None, "") else (session.rack_id)
        row.rack_id = device.rack_id
        return
    if field == "rack_name":
        label = str(value or "").strip()
        row.rack_name = label
        if not label:
            return
        aisle = db.get(AisleRow, session.row_id) if session.row_id else None
        if not aisle and row.row_name:
            aisle = resolve_or_create_row(db, session.project_id, row_label=row.row_name, area_id=session.area_id)
        rack, _ = resolve_or_create_rack(db, session.project_id, label, row=aisle, area_id=session.area_id)
        device.rack_id = rack.id
        row.rack_id = rack.id
        return
    if field == "row_name":
        label = str(value or "").strip()
        row.row_name = label
        if label:
            resolve_or_create_row(db, session.project_id, row_label=label, area_id=session.area_id)
        return
    if field == "area_name":
        label = str(value or "").strip()
        row.area_name = label
        if label:
            area, _ = resolve_or_create_area(db, session.project_id, label)
            if session.area_id is None:
                session.area_id = area.id
        return
    if field in INT_FIELDS:
        setattr(device, field, _coerce(field, value))
        setattr(row, field, _coerce(field, value))
        if field == "ru_end":
            _ensure_rack_fits(db, device.rack_id, device.ru_end)
        return
    if hasattr(device, field):
        setattr(device, field, _coerce(field, value))
        setattr(row, field, _coerce(field, value))


def _sync_confirmed_device(db: Session, session: VisionSession, row: VisionProposal, user: User) -> None:
    confirmed = {_norm(f) for f in _list(row.confirmed_fields_json)}
    if "name" not in confirmed or not (row.name or "").strip():
        return
    device = _ensure_device(db, session, row, user)
    for field in DEVICE_FIELDS:
        if field not in confirmed:
            continue
        _apply_device_field(db, session, row, device, field, _proposal_value(row, field))
    learn_values(db, vendor=device.vendor, model=device.model, device_type=device.device_type, function=device.function)


def _finish_proposal_if_done(db: Session, session: VisionSession, row: VisionProposal) -> None:
    unread = {_norm(f) for f in _list(row.unreadable_fields_json)}
    confirmed = {_norm(f) for f in _list(row.confirmed_fields_json)}
    skipped = {_norm(f) for f in _list(row.skipped_fields_json)}
    remaining = []
    for field in DEVICE_FIELDS:
        if field in unread or field in confirmed or field in skipped:
            continue
        value = _proposal_value(row, field)
        if value in (None, ""):
            continue
        remaining.append(field)
    if remaining:
        return
    if row.accepted_device_id:
        row.status = "accepted"
        row.reviewed_at = _now()


def confirm_proposal_field(
    db: Session,
    session: VisionSession,
    row: VisionProposal,
    field: str,
    value: Any,
    user: User,
) -> VisionProposal:
    if row.status == "rejected":
        raise HTTPException(400, "Rejected proposals cannot be confirmed")
    if row.status == "accepted":
        raise HTTPException(400, "Accepted proposals cannot be confirmed")
    key = _norm(field)
    if key not in DEVICE_FIELDS:
        raise HTTPException(400, f"Field {field} cannot be confirmed")
    next_value = _proposal_value(row, key) if value is None else _coerce(key, value)
    if key in INT_FIELDS:
        setattr(row, key, next_value)
    else:
        setattr(row, key, next_value if next_value is not None else "")
    confirmed = [f for f in _list(row.confirmed_fields_json) if _norm(f) != key]
    confirmed.append(key)
    skipped = [f for f in _list(row.skipped_fields_json) if _norm(f) != key]
    row.confirmed_fields_json = _json_dump(confirmed)
    row.skipped_fields_json = _json_dump(skipped)
    if row.status == "pending":
        row.status = "edited"
    row.reviewed_by = user.id
    row.updated_at = _now()
    _sync_confirmed_device(db, session, row, user)
    _finish_proposal_if_done(db, session, row)
    return row


def skip_proposal_field(db: Session, session: VisionSession, row: VisionProposal, field: str, user: User) -> VisionProposal:
    if row.status in ("accepted", "rejected"):
        raise HTTPException(400, "This proposal is closed")
    key = _norm(field)
    if key not in DEVICE_FIELDS:
        raise HTTPException(400, f"Field {field} cannot be skipped")
    skipped = [f for f in _list(row.skipped_fields_json) if _norm(f) != key]
    skipped.append(key)
    confirmed = [f for f in _list(row.confirmed_fields_json) if _norm(f) != key]
    row.skipped_fields_json = _json_dump(skipped)
    row.confirmed_fields_json = _json_dump(confirmed)
    if row.status == "pending":
        row.status = "edited"
    row.reviewed_by = user.id
    row.updated_at = _now()
    _finish_proposal_if_done(db, session, row)
    return row


def _review_bucket(review: dict, kind: str, index: int) -> dict:
    kind_map = review.setdefault(kind, {})
    key = str(index)
    bucket = kind_map.get(key)
    if not isinstance(bucket, dict):
        bucket = {"fields": {}}
        kind_map[key] = bucket
    bucket.setdefault("fields", {})
    return bucket


def confirm_layout_field(
    db: Session,
    session: VisionSession,
    kind: str,
    index: int,
    field: str,
    value: Any,
) -> dict:
    key = _norm(field)
    allowed = LAYOUT_FIELDS.get(kind)
    if not allowed or key not in allowed:
        raise HTTPException(400, f"Cannot confirm {kind}.{field}")
    layout = _json_load(session.layout_json, {}) or {}
    items = layout_items(layout, kind)
    if index >= len(items):
        raise HTTPException(404, "Suggested item not found")
    item = items[index]
    suggested = item.get(key) if key != "notes" else (item.get("notes") or item.get("description") or "")
    next_value = suggested if value is None else value
    next_value = _coerce(key, next_value)
    item[key] = next_value
    items[index] = item
    plural = {"area": "areas", "row": "rows", "rack": "racks"}[kind]
    if isinstance(layout, dict):
        layout[plural] = items
        session.layout_json = _json_dump(layout)
    review = _json_load(session.layout_review_json, {}) or {}
    if not isinstance(review, dict):
        review = {}
    bucket = _review_bucket(review, kind, index)
    fields = bucket.setdefault("fields", {})
    fields[key] = "confirmed"
    entity_id = bucket.get("id")

    if kind == "area" and fields.get("name") == "confirmed":
        name = str(item.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "Confirm the area name first")
        area, _ = resolve_or_create_area(db, session.project_id, name)
        if fields.get("notes") == "confirmed":
            area.description = str(item.get("notes") or "")
        bucket["id"] = area.id
        if session.area_id is None:
            session.area_id = area.id
        entity_id = area.id
    elif kind == "row" and fields.get("name") == "confirmed":
        name = str(item.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "Confirm the row name first")
        area_id = session.area_id
        area_name = str(item.get("area_name") or "").strip()
        if fields.get("area_name") == "confirmed" and area_name:
            area, _ = resolve_or_create_area(db, session.project_id, area_name)
            area_id = area.id
        if not area_id:
            raise HTTPException(400, "Select an area before confirming a row")
        aisle = resolve_or_create_row(db, session.project_id, row_label=name, area_id=area_id)
        if aisle and fields.get("notes") == "confirmed":
            aisle.notes = str(item.get("notes") or "")
        if aisle:
            bucket["id"] = aisle.id
            entity_id = aisle.id
    elif kind == "rack" and fields.get("name") == "confirmed":
        name = str(item.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "Confirm the rack name first")
        row_name = str(item.get("row_name") or "").strip()
        aisle = db.get(AisleRow, session.row_id) if session.row_id else None
        if fields.get("row_name") == "confirmed" and row_name:
            aisle = resolve_or_create_row(db, session.project_id, row_label=row_name, area_id=session.area_id)
        ru = item.get("ru_height") if fields.get("ru_height") == "confirmed" else None
        rack, _ = resolve_or_create_rack(
            db,
            session.project_id,
            name,
            row=aisle,
            area_id=session.area_id,
            ru_height=int(ru) if ru not in (None, "") else None,
        )
        if fields.get("notes") == "confirmed":
            rack.notes = str(item.get("notes") or "")
        bucket["id"] = rack.id
        entity_id = rack.id

    session.layout_review_json = _json_dump(review)
    session.updated_at = _now()
    return {"kind": kind, "index": index, "field": key, "status": "confirmed", "entity_id": entity_id, "review": review}


def skip_layout_field(session: VisionSession, kind: str, index: int, field: str) -> dict:
    key = _norm(field)
    allowed = LAYOUT_FIELDS.get(kind)
    if not allowed or key not in allowed:
        raise HTTPException(400, f"Cannot skip {kind}.{field}")
    review = _json_load(session.layout_review_json, {}) or {}
    if not isinstance(review, dict):
        review = {}
    bucket = _review_bucket(review, kind, index)
    bucket.setdefault("fields", {})[key] = "skipped"
    session.layout_review_json = _json_dump(review)
    session.updated_at = _now()
    return {"kind": kind, "index": index, "field": key, "status": "skipped", "review": review}
