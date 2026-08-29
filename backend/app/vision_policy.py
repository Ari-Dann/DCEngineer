"""Rules for when floor media may be sent to an external vision model."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AisleRow, Area, Attachment, Rack, VisionClip, VisionSession

RESTRICTED_REFUSAL = "Restricted equipment — photos were not sent to the vision model."


def _area_reasons(area: Area | None) -> list[str]:
    if not area:
        return []
    reasons: list[str] = []
    if area.restricted:
        label = area.restriction_type or "restricted"
        reasons.append(f"Area {area.name} is flagged {label}")
    if not area.photography_allowed:
        reasons.append(f"Photography is forbidden in area {area.name}")
    return reasons


def resolve_session_area(db: Session, session: VisionSession) -> Area | None:
    if session.area_id:
        area = db.get(Area, session.area_id)
        if area:
            return area
    if session.rack_id:
        rack = db.get(Rack, session.rack_id)
        if rack:
            if rack.area_id:
                area = db.get(Area, rack.area_id)
                if area:
                    return area
            if rack.row_id:
                row = db.get(AisleRow, rack.row_id)
                if row and row.area_id:
                    return db.get(Area, row.area_id)
    if session.row_id:
        row = db.get(AisleRow, session.row_id)
        if row and row.area_id:
            return db.get(Area, row.area_id)
    return None


def restriction_reasons(db: Session, session: VisionSession) -> list[str]:
    reasons = _area_reasons(resolve_session_area(db, session))
    clips = db.query(VisionClip).filter(VisionClip.session_id == session.id).all()
    attachment_ids = [c.attachment_id for c in clips]
    if attachment_ids:
        restricted = (
            db.query(Attachment)
            .filter(Attachment.id.in_(attachment_ids), Attachment.photography_restricted.is_(True))
            .count()
        )
        if restricted:
            reasons.append("One or more clips are marked photography-restricted")
    extras = (
        db.query(Attachment)
        .filter(Attachment.entity_type == "vision_session", Attachment.entity_id == session.id)
        .filter(Attachment.photography_restricted.is_(True))
        .count()
    )
    if extras and "One or more clips are marked photography-restricted" not in reasons:
        reasons.append("One or more clips are marked photography-restricted")
    return reasons


def is_restricted(db: Session, session: VisionSession) -> bool:
    return bool(restriction_reasons(db, session))


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
BLANKABLE_INTS = ("ru_start", "ru_end", "rack_id")


def normalize_unreadable_key(value: str) -> str:
    return (value or "").strip().lower().replace(" ", "_").replace("-", "_")


def blank_unreadable(data: dict, unreadable_fields: list[str]) -> dict:
    """Leave unreadables empty. Never keep a guessed value for a flagged field."""
    flagged = {normalize_unreadable_key(f) for f in unreadable_fields if f}
    aliases = {
        "sn": "serial",
        "serial_number": "serial",
        "serial_no": "serial",
        "asset": "asset_tag",
        "tag": "asset_tag",
        "ru": "ru_start",
        "ru_position": "ru_start",
        "type": "device_type",
        "rack": "rack_name",
        "row": "row_name",
        "aisle": "row_name",
        "area": "area_name",
    }
    resolved = {aliases.get(k, k) for k in flagged}
    for key in resolved:
        if key in BLANKABLE_STRINGS:
            data[key] = ""
        elif key in BLANKABLE_INTS:
            data[key] = None
    return data
