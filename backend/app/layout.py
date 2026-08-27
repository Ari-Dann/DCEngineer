"""Area → row → rack layout helpers: resolve, backfill, copy, and move."""

from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import AisleRow, Area, Device, Rack
from app.schemas import RelocateIn

_SKIP_CLONE = {"id"}


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
            for device in db.query(Device).filter(Device.rack_id == rack.id).all():
                db.add(_clone(device, project_id=project_id, rack_id=dest.id, pdu_a_id=None, pdu_b_id=None))


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
                for device in db.query(Device).filter(Device.rack_id == entity.id).all():
                    db.add(_clone(device, project_id=target_project_id, rack_id=clone.id, pdu_a_id=None, pdu_b_id=None))
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
            clone = _clone(entity, project_id=target_project_id, rack_id=dest_rack_id, pdu_a_id=None, pdu_b_id=None)
            db.add(clone)
            db.flush()
            return clone
        old_rack_id = entity.rack_id
        entity.project_id = target_project_id
        entity.rack_id = dest_rack_id
        if old_rack_id != dest_rack_id:
            entity.pdu_a_id = None
            entity.pdu_b_id = None
        return entity

    raise HTTPException(400, "Unknown relocate kind")
