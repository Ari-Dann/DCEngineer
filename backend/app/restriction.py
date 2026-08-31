"""Government / EMSS tagging and photography rules for the layout hierarchy."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AisleRow, Area, Device, Project, Rack, VisionSession

RESTRICTION_TYPES = ("government", "EMSS", "other")


def sync_flags(
    restricted: bool = False,
    restriction_type: str = "",
    photography_allowed: bool = True,
) -> dict[str, Any]:
    kind = (restriction_type or "").strip()
    if kind:
        return {"restricted": True, "restriction_type": kind, "photography_allowed": False}
    if restricted:
        return {"restricted": True, "restriction_type": "", "photography_allowed": False}
    return {
        "restricted": False,
        "restriction_type": "",
        "photography_allowed": bool(photography_allowed),
    }


def apply_flags(data: dict[str, Any]) -> dict[str, Any]:
    if not {"restricted", "restriction_type", "photography_allowed"} & set(data):
        return data
    data.update(
        sync_flags(
            restricted=bool(data.get("restricted")),
            restriction_type=str(data.get("restriction_type") or ""),
            photography_allowed=data.get("photography_allowed", True),
        )
    )
    return data


def flag_reasons(
    kind: str,
    name: str,
    *,
    restricted: bool = False,
    restriction_type: str = "",
    photography_allowed: bool = True,
    restricted_reason: str = "",
) -> list[str]:
    reasons: list[str] = []
    label = restriction_type or restricted_reason or "restricted"
    if restricted:
        reasons.append(f"{kind} {name} is flagged {label}")
    if photography_allowed is False:
        msg = f"Photography is forbidden on {kind} {name}"
        if msg not in reasons:
            reasons.append(msg)
    return reasons


def entity_reasons(kind: str, entity: Any | None) -> list[str]:
    if entity is None:
        return []
    name = getattr(entity, "name", "") or kind.lower()
    restricted = bool(getattr(entity, "restricted", False))
    restriction_type = str(getattr(entity, "restriction_type", "") or getattr(entity, "restricted_reason", "") or "")
    photography_allowed = getattr(entity, "photography_allowed", not restricted)
    if restricted and getattr(entity, "photography_allowed", None) is None:
        photography_allowed = False
    return flag_reasons(
        kind,
        name,
        restricted=restricted,
        restriction_type=restriction_type,
        photography_allowed=bool(photography_allowed),
        restricted_reason=str(getattr(entity, "restricted_reason", "") or ""),
    )


def resolve_session_location(
    db: Session, session: VisionSession
) -> tuple[Project | None, Area | None, AisleRow | None, Rack | None]:
    project = db.get(Project, session.project_id)
    rack = db.get(Rack, session.rack_id) if session.rack_id else None
    row = db.get(AisleRow, session.row_id) if session.row_id else None
    if not row and rack and rack.row_id:
        row = db.get(AisleRow, rack.row_id)
    area = db.get(Area, session.area_id) if session.area_id else None
    if not area and rack and rack.area_id:
        area = db.get(Area, rack.area_id)
    if not area and row and row.area_id:
        area = db.get(Area, row.area_id)
    return project, area, row, rack


def hierarchy_reasons(db: Session, session: VisionSession) -> list[str]:
    project, area, row, rack = resolve_session_location(db, session)
    reasons: list[str] = []
    reasons.extend(entity_reasons("Project", project))
    if rack:
        reasons.extend(entity_reasons("Rack", rack))
        reasons.extend(entity_reasons("Row", row))
    elif row:
        reasons.extend(entity_reasons("Row", row))
    elif area:
        reasons.extend(entity_reasons("Area", area))
    return reasons
