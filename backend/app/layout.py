"""Area → row → rack layout helpers: resolve, backfill, copy, and move."""

from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import AisleRow, Area, Device, Rack
from app.nesting import descendants, nest_devices_in_racks
from app.schemas import RelocateIn

_SKIP_CLONE = {"id"}


def unique_labels(values: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in values or []:
        label = (raw or "").strip()
        if not label:
            continue
        key = label.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(label)
    return out


def names_from_layout(layout: Any) -> list[str]:
    if not isinstance(layout, dict):
        return []
    names: list[str] = []
    for item in layout.get("rows") or []:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, dict):
            names.append(str(item.get("name") or ""))
    for item in layout.get("racks") or []:
        if isinstance(item, dict):
            names.append(str(item.get("row_name") or ""))
    return unique_labels(names)


def racks_from_layout(layout: Any) -> list[dict[str, Any]]:
    if not isinstance(layout, dict):
        return []
    out: list[dict[str, Any]] = []
    for item in layout.get("racks") or []:
        if isinstance(item, str) and item.strip():
            out.append({"name": item.strip()})
        elif isinstance(item, dict) and str(item.get("name") or "").strip():
            out.append(item)
    return out


def bulk_create_rows(
    db: Session,
    project_id: int,
    area_id: int,
    names: list[str],
    *,
    restricted: bool = False,
    restriction_type: str = "",
    photography_allowed: bool = True,
) -> tuple[list[AisleRow], list[AisleRow]]:
    created: list[AisleRow] = []
    existing: list[AisleRow] = []
    flags = {
        "restricted": restricted,
        "restriction_type": restriction_type,
        "photography_allowed": photography_allowed,
    }
    for label in unique_labels(names):
        row = (
            db.query(AisleRow)
            .filter(AisleRow.project_id == project_id, AisleRow.name == label, AisleRow.area_id == area_id)
            .order_by(AisleRow.id)
            .first()
        )
        if row:
            existing.append(row)
            continue
        unassigned = (
            db.query(AisleRow)
            .filter(AisleRow.project_id == project_id, AisleRow.name == label, AisleRow.area_id.is_(None))
            .order_by(AisleRow.id)
            .first()
        )
        if unassigned:
            unassigned.area_id = area_id
            existing.append(unassigned)
            continue
        row = AisleRow(project_id=project_id, area_id=area_id, name=label, **flags)
        db.add(row)
        db.flush()
        created.append(row)
    return created, existing


def resolve_or_create_rack(
    db: Session,
    project_id: int,
    name: str,
    row: AisleRow | None = None,
    area_id: int | None = None,
    ru_height: int | None = None,
) -> tuple[Rack, bool]:
    label = (name or "").strip()
    if not label:
        raise HTTPException(400, "Rack name is required")
    q = db.query(Rack).filter(Rack.project_id == project_id, Rack.name == label)
    if row:
        q = q.filter((Rack.row_id == row.id) | (Rack.row_id.is_(None)))
    rack = q.order_by(Rack.id).first()
    if rack:
        if row:
            apply_row_to_rack(rack, row, area_id)
        return rack, False
    height = ru_height if ru_height and 1 <= int(ru_height) <= 70 else 42
    rack = Rack(
        project_id=project_id,
        name=label,
        area_id=row.area_id if row and row.area_id is not None else area_id,
        row_id=row.id if row else None,
        row_label=row.name if row else "",
        ru_height=height,
    )
    db.add(rack)
    db.flush()
    return rack, True


def resolve_or_create_row(
    db: Session,
    project_id: int,
    row_id: int | None = None,
    row_label: str = "",
    area_id: int | None = None,
) -> AisleRow | None:
    if row_id:
        row = db.get(AisleRow, row_id)
        if not row or row.project_id != project_id:
            raise HTTPException(404, "Row not found")
        if area_id and row.area_id is None:
            row.area_id = area_id
        return row
    label = (row_label or "").strip()
    if not label:
        return None
    q = db.query(AisleRow).filter(AisleRow.project_id == project_id, AisleRow.name == label)
    if area_id:
        q = q.filter((AisleRow.area_id == area_id) | (AisleRow.area_id.is_(None)))
    row = q.order_by(AisleRow.id).first()
    if row:
        if area_id and row.area_id is None:
            row.area_id = area_id
        return row
    row = AisleRow(project_id=project_id, area_id=area_id, name=label)
    db.add(row)
    db.flush()
    return row


def resolve_or_create_area(db: Session, project_id: int, name: str) -> tuple[Area, bool]:
    label = (name or "").strip()
    if not label:
        raise HTTPException(400, "Area name is required")
    area = (
        db.query(Area)
        .filter(Area.project_id == project_id, Area.name == label)
        .order_by(Area.id)
        .first()
    )
    if area:
        return area, False
    area = Area(project_id=project_id, name=label)
    db.add(area)
    db.flush()
    return area, True


def layout_items(layout: Any, kind: str) -> list[dict[str, Any]]:
    if not isinstance(layout, dict):
        return []
    key = {"area": "areas", "row": "rows", "rack": "racks"}.get(kind, "")
    raw = layout.get(key) or []
    out: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            out.append({"name": item.strip()})
        elif isinstance(item, dict):
            out.append(item)
    return out


def apply_row_to_rack(rack: Rack, row: AisleRow | None, area_id: int | None = None) -> None:
    if row:
        rack.row_id = row.id
        rack.row_label = row.name
        if row.area_id is not None:
            rack.area_id = row.area_id
        elif area_id:
            rack.area_id = area_id
    elif area_id:
        rack.area_id = area_id


def backfill_rows(db: Session, project_id: int) -> None:
    changed = False
    racks = db.query(Rack).filter(Rack.project_id == project_id, Rack.row_id.is_(None)).all()
    for rack in racks:
        if not (rack.row_label or "").strip():
            continue
        row = resolve_or_create_row(db, project_id, row_label=rack.row_label, area_id=rack.area_id)
        if row:
            rack.row_id = row.id
            rack.row_label = row.name
            changed = True
    if changed:
        db.commit()


def _clone(source, **overrides):
    data = {}
    for column in source.__table__.columns:
        if column.name in _SKIP_CLONE:
            continue
        data[column.name] = getattr(source, column.name)
    data.update(overrides)
    return source.__class__(**data)


def _move_devices(db: Session, rack_ids: list[int], project_id: int) -> None:
    if not rack_ids:
        return
    db.query(Device).filter(Device.rack_id.in_(rack_ids)).update(
        {Device.project_id: project_id}, synchronize_session=False
    )


def _copy_devices(db: Session, devices: list[Device], project_id: int, rack_id: int | None) -> None:
    clones: list[tuple[Device, Device]] = []
    id_map: dict[int, int] = {}
    for device in devices:
        clone = _clone(
            device,
            project_id=project_id,
            rack_id=rack_id,
            pdu_a_id=None,
            pdu_b_id=None,
            parent_device_id=None,
        )
        db.add(clone)
        db.flush()
        id_map[device.id] = clone.id
        clones.append((device, clone))
    for device, clone in clones:
        parent_id = device.parent_device_id
        if parent_id and parent_id in id_map:
            clone.parent_device_id = id_map[parent_id]


def _copy_racks(
    db: Session,
    racks: list[Rack],
    project_id: int,
    area_id: int | None,
    row_id: int | None,
    include_devices: bool,
) -> None:
    row = db.get(AisleRow, row_id) if row_id else None
    for rack in racks:
        dest = _clone(
            rack,
            project_id=project_id,
            area_id=area_id if area_id is not None else rack.area_id,
            row_id=row.id if row else None,
            row_label=row.name if row else rack.row_label,
        )
        db.add(dest)
        db.flush()
        if include_devices:
            devices = db.query(Device).filter(Device.rack_id == rack.id).all()
            _copy_devices(db, devices, project_id, dest.id)


def _target_area(db: Session, project_id: int, area_id: Optional[int]) -> Area | None:
    if not area_id:
        return None
    area = db.get(Area, area_id)
    if not area or area.project_id != project_id:
        raise HTTPException(404, "Area not found")
    return area


def _target_row(db: Session, project_id: int, row_id: Optional[int]) -> AisleRow | None:
    if not row_id:
        return None
    row = db.get(AisleRow, row_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "Row not found")
    return row


def _target_rack(db: Session, project_id: int, rack_id: Optional[int]) -> Rack | None:
    if not rack_id:
        return None
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    return rack


def _device_ru_span(device: Device) -> int:
    if device.ru_start is None:
        return 1
    end = device.ru_end if device.ru_end is not None else device.ru_start
    return max(1, abs(int(end) - int(device.ru_start)) + 1)


def _shift_device_ru(device: Device, delta: int) -> None:
    if not delta or device.ru_start is None:
        return
    device.ru_start = int(device.ru_start) + delta
    if device.ru_end is not None:
        device.ru_end = int(device.ru_end) + delta


def _place_device_at_ru(device: Device, ru_start: int | None, rack: Rack | None) -> int | None:
    """Set ru_start/ru_end, preserving height. Returns the delta applied to ru_start."""
    if ru_start is None:
        return None
    if rack is None:
        raise HTTPException(400, "Choose a target rack to place at a U elevation.")
    span = _device_ru_span(device)
    ru_end = ru_start + span - 1
    if ru_end > rack.ru_height:
        raise HTTPException(400, f"U{ru_start}–{ru_end} does not fit in {rack.name} ({rack.ru_height}U).")
    old = device.ru_start
    device.ru_start = ru_start
    device.ru_end = ru_end
    if old is None:
        return 0
    return ru_start - int(old)


def apply_relocate(db: Session, kind: str, entity, body: RelocateIn, copy: bool):
    target_project_id = body.target_project_id
    include_children = body.include_children
    include_devices = body.include_devices

    if kind == "area":
        if copy:
            clone = _clone(entity, project_id=target_project_id)
            db.add(clone)
            db.flush()
            if include_children:
                row_map: dict[int, AisleRow] = {}
                for row in db.query(AisleRow).filter(AisleRow.area_id == entity.id).all():
                    row_clone = _clone(row, project_id=target_project_id, area_id=clone.id)
                    db.add(row_clone)
                    db.flush()
                    row_map[row.id] = row_clone
                racks = db.query(Rack).filter(Rack.area_id == entity.id).all()
                for rack in racks:
                    dest_row = row_map.get(rack.row_id) if rack.row_id else None
                    _copy_racks(
                        db,
                        [rack],
                        target_project_id,
                        clone.id,
                        dest_row.id if dest_row else None,
                        include_devices,
                    )
            return clone
        entity.project_id = target_project_id
        rows = db.query(AisleRow).filter(AisleRow.area_id == entity.id).all()
        racks = db.query(Rack).filter(Rack.area_id == entity.id).all()
        if include_children:
            for row in rows:
                row.project_id = target_project_id
            for rack in racks:
                rack.project_id = target_project_id
            if include_devices:
                _move_devices(db, [r.id for r in racks], target_project_id)
        else:
            for row in rows:
                row.area_id = None
            for rack in racks:
                rack.area_id = None
        return entity

    if kind == "row":
        dest_area = _target_area(db, target_project_id, body.target_area_id)
        dest_area_id = dest_area.id if dest_area else None
        if copy:
            clone = _clone(entity, project_id=target_project_id, area_id=dest_area_id)
            db.add(clone)
            db.flush()
            if include_children:
                racks = db.query(Rack).filter(Rack.row_id == entity.id).all()
                _copy_racks(db, racks, target_project_id, dest_area_id, clone.id, include_devices)
            return clone
        entity.project_id = target_project_id
        entity.area_id = dest_area_id
        racks = db.query(Rack).filter(Rack.row_id == entity.id).all()
        if include_children:
            for rack in racks:
                rack.project_id = target_project_id
                rack.area_id = dest_area_id
                rack.row_label = entity.name
            if include_devices:
                _move_devices(db, [r.id for r in racks], target_project_id)
        else:
            for rack in racks:
                rack.row_id = None
        return entity

    if kind == "rack":
        dest_row = _target_row(db, target_project_id, body.target_row_id)
        dest_area = _target_area(db, target_project_id, body.target_area_id)
        dest_area_id = (dest_row.area_id if dest_row and dest_row.area_id is not None else None) or (
            dest_area.id if dest_area else None
        )
        if copy:
            clone = _clone(
                entity,
                project_id=target_project_id,
                area_id=dest_area_id,
                row_id=dest_row.id if dest_row else None,
                row_label=dest_row.name if dest_row else entity.row_label,
            )
            db.add(clone)
            db.flush()
            if include_devices:
                devices = db.query(Device).filter(Device.rack_id == entity.id).all()
                _copy_devices(db, devices, target_project_id, clone.id)
            return clone
        orig_row_id = entity.row_id
        entity.project_id = target_project_id
        entity.area_id = dest_area_id
        if dest_row:
            entity.row_id = dest_row.id
            entity.row_label = dest_row.name
        else:
            current_row = db.get(AisleRow, orig_row_id) if orig_row_id else None
            if not current_row or current_row.project_id != target_project_id:
                entity.row_id = None
        if include_devices:
            _move_devices(db, [entity.id], target_project_id)
        return entity

    if kind == "device":
        dest_rack = _target_rack(db, target_project_id, body.target_rack_id)
        dest_rack_id = dest_rack.id if dest_rack else None
        if copy:
            clone = _clone(
                entity,
                project_id=target_project_id,
                rack_id=dest_rack_id,
                pdu_a_id=None,
                pdu_b_id=None,
                parent_device_id=None,
            )
            _place_device_at_ru(clone, body.target_ru_start, dest_rack)
            db.add(clone)
            db.flush()
            if dest_rack_id:
                nest_devices_in_racks(db, [dest_rack_id])
            return clone
        old_rack_id = entity.rack_id
        entity.project_id = target_project_id
        entity.rack_id = dest_rack_id
        if old_rack_id != dest_rack_id:
            entity.pdu_a_id = None
            entity.pdu_b_id = None
        delta = _place_device_at_ru(entity, body.target_ru_start, dest_rack)
        for child in descendants(db, entity.id):
            child.project_id = target_project_id
            if old_rack_id != dest_rack_id:
                child.rack_id = dest_rack_id
                child.pdu_a_id = None
                child.pdu_b_id = None
            if delta:
                _shift_device_ru(child, delta)
        nest_devices_in_racks(db, [rid for rid in (old_rack_id, dest_rack_id) if rid])
        return entity

    raise HTTPException(400, "Unknown relocate kind")
