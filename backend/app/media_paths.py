"""Human-readable storage keys for inventory / vision captures.

Photos land under Project/Area/Axx/Rxx/RUnn at the capture depth — missing
levels are omitted rather than filled with placeholders.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    AisleRow,
    Area,
    Device,
    Incident,
    Inspection,
    Project,
    Rack,
    VisionSession,
    WorkOrder,
)
from app.storage import StorageBackend, get_storage

MAX_KEY_LEN = 512
UNSORTED = "unsorted"

_DISALLOWED = re.compile(r"[^A-Za-z0-9 ._ -]")
_DIGITS = re.compile(r"(\d+)")


def now_in_app_tz(now: datetime | None = None) -> datetime:
    try:
        tz = ZoneInfo(get_settings().tz or "UTC")
    except (ZoneInfoNotFoundError, Exception):
        tz = timezone.utc
    if now is None:
        return datetime.now(tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(tz)


def sanitize_segment(name: str, *, fallback: str = "") -> str:
    text = _DISALLOWED.sub("_", name or "")
    while ".." in text:
        text = text.replace("..", "_")
    text = re.sub(r"_+", "_", text)
    text = text.strip(" ._")
    if not text or text in {".", ".."}:
        return fallback
    return text[:120]


def _first_digits(name: str) -> str | None:
    match = _DIGITS.search(name or "")
    return match.group(1) if match else None


def format_row_segment(name: str) -> str:
    digits = _first_digits(name)
    if digits is not None:
        return f"A{int(digits):02d}"
    return sanitize_segment(name, fallback="")


def format_rack_segment(name: str) -> str:
    digits = _first_digits(name)
    if digits is not None:
        return f"R{int(digits):02d}"
    return sanitize_segment(name, fallback="")


def format_ru_segment(ru: int) -> str:
    return f"RU{int(ru)}"


def file_extension(filename: str) -> str:
    name = (filename or "").replace("\\", "/").split("/")[-1]
    if "." not in name or name.startswith("."):
        return ""
    ext = "".join(c for c in name.rsplit(".", 1)[-1] if c.isalnum())[:16]
    return f".{ext.lower()}" if ext else ""


def timestamp_filename(filename: str, now: datetime | None = None) -> str:
    stem = now_in_app_tz(now).strftime("%Y-%m-%d-%H-%M-%S")
    return f"{stem}{file_extension(filename)}"


def _unique_key(storage: StorageBackend, directory: str, filename: str) -> str:
    def join(name: str) -> str:
        return f"{directory}/{name}" if directory else name

    candidate = join(filename)
    if not storage.exists(candidate):
        return _clamp(candidate)
    stem, ext = filename, ""
    if "." in filename:
        stem, ext = filename.rsplit(".", 1)
        ext = f".{ext}"
    n = 2
    while n < 10_000:
        candidate = join(f"{stem}-{n}{ext}")
        if not storage.exists(candidate):
            return _clamp(candidate)
        n += 1
    raise RuntimeError("too many capture-key collisions")


def _clamp(key: str, limit: int = MAX_KEY_LEN) -> str:
    if len(key) <= limit:
        return key
    if "/" not in key:
        return key[:limit]
    directory, filename = key.rsplit("/", 1)
    room = limit - len(filename) - 1
    if room < 1:
        return filename[:limit]
    return f"{directory[:room].rstrip('/')}/{filename}"


def _fill_from_row(db: Session, row: AisleRow) -> tuple[Project | None, Area | None, AisleRow]:
    project = db.get(Project, row.project_id)
    area = db.get(Area, row.area_id) if row.area_id else None
    return project, area, row


def _fill_from_rack(db: Session, rack: Rack) -> tuple[Project | None, Area | None, AisleRow | None, Rack]:
    project = db.get(Project, rack.project_id)
    row = db.get(AisleRow, rack.row_id) if rack.row_id else None
    area = db.get(Area, rack.area_id) if rack.area_id else None
    if area is None and row is not None and row.area_id:
        area = db.get(Area, row.area_id)
    return project, area, row, rack


def resolve_hierarchy(
    db: Session,
    entity_type: str,
    entity_id: int,
    ru: int | None = None,
) -> tuple[str | None, str | None, str | None, str | None, int | None]:
    """Return (project, area, row, rack, ru) names/values; missing levels are None."""
    kind = (entity_type or "").strip().lower()
    project: Project | None = None
    area: Area | None = None
    row: AisleRow | None = None
    rack: Rack | None = None
    ru_value: int | None = ru

    if kind == "project":
        project = db.get(Project, entity_id)
    elif kind == "area":
        area = db.get(Area, entity_id)
        if area:
            project = db.get(Project, area.project_id)
    elif kind in ("aisle_row", "row"):
        row = db.get(AisleRow, entity_id)
        if row:
            project, area, row = _fill_from_row(db, row)
    elif kind == "rack":
        rack = db.get(Rack, entity_id)
        if rack:
            project, area, row, rack = _fill_from_rack(db, rack)
    elif kind == "device":
        device = db.get(Device, entity_id)
        if device:
            project = db.get(Project, device.project_id)
            if ru_value is None:
                ru_value = device.ru_start
            if device.rack_id:
                found = db.get(Rack, device.rack_id)
                if found:
                    p2, area, row, rack = _fill_from_rack(db, found)
                    project = project or p2
    elif kind == "vision_session":
        session = db.get(VisionSession, entity_id)
        if session:
            project = db.get(Project, session.project_id)
            if session.rack_id:
                found = db.get(Rack, session.rack_id)
                if found:
                    p2, area, row, rack = _fill_from_rack(db, found)
                    project = project or p2
            if row is None and session.row_id:
                found_row = db.get(AisleRow, session.row_id)
                if found_row:
                    p2, area_from_row, row = _fill_from_row(db, found_row)
                    project = project or p2
                    area = area or area_from_row
            if area is None and session.area_id:
                area = db.get(Area, session.area_id)
            # Vision clips stay at session depth (no RU) unless ru was passed in.
    else:
        ops = {"incident": Incident, "inspection": Inspection, "work_order": WorkOrder}
        model = ops.get(kind)
        if model is not None:
            entity = db.get(model, entity_id)
            if entity is not None and getattr(entity, "project_id", None):
                project = db.get(Project, entity.project_id)

    return (
        project.name if project else None,
        area.name if area else None,
        row.name if row else None,
        rack.name if rack else None,
        ru_value,
    )


def hierarchy_prefix(
    db: Session,
    entity_type: str,
    entity_id: int,
    ru: int | None = None,
) -> str:
    project, area, row, rack, ru_value = resolve_hierarchy(db, entity_type, entity_id, ru=ru)
    parts: list[str] = []
    if project is not None:
        parts.append(sanitize_segment(project, fallback="unnamed"))
    if area is not None:
        seg = sanitize_segment(area, fallback="unnamed")
        if seg:
            parts.append(seg)
    if row is not None:
        seg = format_row_segment(row)
        if seg:
            parts.append(seg)
    if rack is not None:
        seg = format_rack_segment(rack)
        if seg:
            parts.append(seg)
    if ru_value:
        parts.append(format_ru_segment(ru_value))
    return "/".join(p for p in parts if p) or UNSORTED


def hierarchy_key(
    db: Session,
    entity_type: str,
    entity_id: int,
    filename: str,
    *,
    now: datetime | None = None,
    ru: int | None = None,
    storage: StorageBackend | None = None,
) -> str:
    prefix = hierarchy_prefix(db, entity_type, entity_id, ru=ru)
    name = timestamp_filename(filename, now=now)
    return _unique_key(storage or get_storage(), prefix, name)
