import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AdminUser, ImportUser, WriteUser, get_current_user
from app.models import (
    AisleRow,
    Area,
    Attachment,
    BackupProcess,
    Cable,
    CapacityNote,
    Checklist,
    ChecklistTemplate,
    DRDrill,
    Device,
    Handoff,
    Incident,
    Inspection,
    PDU,
    PDUPort,
    Project,
    Rack,
    User,
    WorkOrder,
)
from app.catalog import learn_values
from app.importer import import_devices, preview_import
from app.layout import apply_relocate, apply_row_to_rack, backfill_rows, bulk_create_rows, resolve_or_create_row, unique_labels
from app.rbi_export import eol_status
from app.schemas import (
    AreaIn,
    AreaOut,
    BackupProcessIn,
    BackupProcessOut,
    CableIn,
    CableOut,
    CapacityIn,
    CapacityOut,
    ChecklistIn,
    ChecklistOut,
    DRDrillIn,
    DRDrillOut,
    DeviceIn,
    DeviceOut,
    DevicePatch,
    HandoffIn,
    HandoffOut,
    IncidentIn,
    IncidentOut,
    InspectionIn,
    InspectionOut,
    PDUIn,
    PDUOut,
    PDUPortIn,
    ProjectIn,
    ProjectOut,
    RackIn,
    RackOut,
    RelocateIn,
    RowBulkIn,
    RowBulkOut,
    RowIn,
    RowOut,
    WorkOrderIn,
    WorkOrderOut,
)

projects_router = APIRouter(prefix="/api/projects", tags=["projects"])
ops_router = APIRouter(prefix="/api", tags=["ops"])


def _get_project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def _apply(model, data: dict[str, Any]):
    for key, value in data.items():
        setattr(model, key, value)
    return model


def device_out(dev: Device) -> DeviceOut:
    out = DeviceOut.model_validate(dev)
    out.eol_status = eol_status(dev.eol_date)
    return out


def _ensure_rack_fits(db: Session, rack_id: int | None, ru_end: int | None) -> None:
    if not rack_id or ru_end is None:
        return
    rack = db.get(Rack, rack_id)
    if not rack:
        return
    end = int(ru_end)
    if end > rack.ru_height:
        rack.ru_height = min(70, end)


def _pdu_in_project(db: Session, project_id: int, pdu_id: int | None) -> int | None:
    if not pdu_id:
        return None
    pdu = db.get(PDU, pdu_id)
    if not pdu:
        raise HTTPException(400, "PDU not found")
    rack = db.get(Rack, pdu.rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(400, "PDU is not in this project")
    return pdu.id


def _get_area(db: Session, project_id: int, area_id: int) -> Area:
    area = db.get(Area, area_id)
    if not area or area.project_id != project_id:
        raise HTTPException(404, "Area not found")
    return area


def _get_row(db: Session, project_id: int, row_id: int) -> AisleRow:
    row = db.get(AisleRow, row_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "Row not found")
    return row


def _get_rack(db: Session, project_id: int, rack_id: int) -> Rack:
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    return rack


def _form_flag(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _get_device(db: Session, project_id: int, device_id: int) -> Device:
    device = db.get(Device, device_id)
    if not device or device.project_id != project_id:
        raise HTTPException(404, "Device not found")
    return device


def _relocate(db: Session, kind: str, entity, body: RelocateIn, copy: bool):
    _get_project(db, body.target_project_id)
    result = apply_relocate(db, kind=kind, entity=entity, body=body, copy=copy)
    db.commit()
    db.refresh(result)
    return result


@projects_router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Project).order_by(Project.updated_at.desc()).all()


@projects_router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)):
    project = Project(**body.model_dump(), created_by=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    for tmpl in db.query(ChecklistTemplate).all():
        items = [{"text": t, "done": False} for t in json.loads(tmpl.items_json)]
        db.add(
            Checklist(
                project_id=project.id,
                template_key=tmpl.key,
                title=tmpl.name,
                items_json=json.dumps(items),
            )
        )
    db.commit()
    db.refresh(project)
    return project


@projects_router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _get_project(db, project_id)


@projects_router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int, body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)
):
    project = _get_project(db, project_id)
    data = body.model_dump()
    if data.get("name") != project.name and user.role != "admin":
        raise HTTPException(403, "Only an admin can rename a project")
    _apply(project, data)
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project


@projects_router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(AdminUser)):
    project = _get_project(db, project_id)
    area_ids = [row[0] for row in db.query(Area.id).filter(Area.project_id == project_id).all()]
    row_ids = [row[0] for row in db.query(AisleRow.id).filter(AisleRow.project_id == project_id).all()]
    rack_ids = [row[0] for row in db.query(Rack.id).filter(Rack.project_id == project_id).all()]
    device_ids = [row[0] for row in db.query(Device.id).filter(Device.project_id == project_id).all()]
    entity_ids = {
        "project": [project_id],
        "area": area_ids,
        "row": row_ids,
        "aisle_row": row_ids,
        "rack": rack_ids,
        "device": device_ids,
    }
    for entity_type, ids in entity_ids.items():
        if not ids:
            continue
        db.query(Attachment).filter(Attachment.entity_type == entity_type, Attachment.entity_id.in_(ids)).delete(
            synchronize_session=False
        )
    db.query(Device).filter(Device.project_id == project_id).delete(synchronize_session=False)
    db.query(Cable).filter(Cable.project_id == project_id).delete(synchronize_session=False)
    db.query(Handoff).filter(Handoff.project_id == project_id).delete(synchronize_session=False)
    db.query(Checklist).filter(Checklist.project_id == project_id).delete(synchronize_session=False)
    db.delete(project)
    db.commit()
    return {"ok": True}


@projects_router.get("/{project_id}/areas", response_model=list[AreaOut])
def list_areas(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_project(db, project_id)
    return db.query(Area).filter(Area.project_id == project_id).order_by(Area.name).all()


@projects_router.post("/{project_id}/areas", response_model=AreaOut, status_code=201)
def create_area(project_id: int, body: AreaIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    area = Area(project_id=project_id, **body.model_dump())
    db.add(area)
    db.commit()
    db.refresh(area)
    return area


@projects_router.patch("/{project_id}/areas/{area_id}", response_model=AreaOut)
def update_area(project_id: int, area_id: int, body: AreaIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    area = db.get(Area, area_id)
    if not area or area.project_id != project_id:
        raise HTTPException(404, "Area not found")
    _apply(area, body.model_dump())
    db.commit()
    db.refresh(area)
    return area


@projects_router.delete("/{project_id}/areas/{area_id}")
def delete_area(project_id: int, area_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    area = db.get(Area, area_id)
    if not area or area.project_id != project_id:
        raise HTTPException(404, "Area not found")
    for row in db.query(AisleRow).filter(AisleRow.area_id == area_id).all():
        row.area_id = None
    for rack in db.query(Rack).filter(Rack.area_id == area_id).all():
        rack.area_id = None
    db.delete(area)
    db.commit()
    return {"ok": True}


@projects_router.get("/{project_id}/rows", response_model=list[RowOut])
def list_rows(
    project_id: int,
    area_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    _get_project(db, project_id)
    backfill_rows(db, project_id)
    q = db.query(AisleRow).filter(AisleRow.project_id == project_id)
    if area_id:
        q = q.filter(AisleRow.area_id == area_id)
    return q.order_by(AisleRow.name).all()


@projects_router.post("/{project_id}/rows", response_model=RowOut, status_code=201)
def create_row(project_id: int, body: RowIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    if body.area_id:
        _get_area(db, project_id, body.area_id)
    row = AisleRow(project_id=project_id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@projects_router.post("/{project_id}/rows/bulk", response_model=RowBulkOut, status_code=201)
def create_rows_bulk(project_id: int, body: RowBulkIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    _get_area(db, project_id, body.area_id)
    labels = unique_labels(body.names)
    if not labels:
        raise HTTPException(400, "Enter at least one row name")
    created, existing = bulk_create_rows(db, project_id, body.area_id, labels)
    db.commit()
    for row in created + existing:
        db.refresh(row)
    return RowBulkOut(created=created, existing=existing)


@projects_router.patch("/{project_id}/rows/{row_id}", response_model=RowOut)
def update_row(project_id: int, row_id: int, body: RowIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = _get_row(db, project_id, row_id)
    if body.area_id:
        _get_area(db, project_id, body.area_id)
    _apply(row, body.model_dump())
    for rack in db.query(Rack).filter(Rack.row_id == row.id).all():
        rack.row_label = row.name
        rack.area_id = row.area_id
    db.commit()
    db.refresh(row)
    return row


@projects_router.delete("/{project_id}/rows/{row_id}")
def delete_row(project_id: int, row_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = _get_row(db, project_id, row_id)
    for rack in db.query(Rack).filter(Rack.row_id == row_id).all():
        rack.row_id = None
        rack.row_label = ""
    db.delete(row)
    db.commit()
    return {"ok": True}


@projects_router.get("/{project_id}/racks", response_model=list[RackOut])
def list_racks(
    project_id: int,
    area_id: Optional[int] = None,
    row_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    _get_project(db, project_id)
    backfill_rows(db, project_id)
    q = db.query(Rack).filter(Rack.project_id == project_id)
    if area_id:
        q = q.filter(Rack.area_id == area_id)
    if row_id:
        q = q.filter(Rack.row_id == row_id)
    return q.order_by(Rack.name).all()


@projects_router.post("/{project_id}/racks", response_model=RackOut, status_code=201)
def create_rack(project_id: int, body: RackIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    data = body.model_dump()
    row = resolve_or_create_row(
        db, project_id, row_id=data.get("row_id"), row_label=data.get("row_label") or "", area_id=data.get("area_id")
    )
    if row:
        data["row_id"] = row.id
        data["row_label"] = row.name
        if row.area_id is not None:
            data["area_id"] = row.area_id
    rack = Rack(project_id=project_id, **data)
    db.add(rack)
    db.commit()
    db.refresh(rack)
    return rack


@projects_router.patch("/{project_id}/racks/{rack_id}", response_model=RackOut)
def update_rack(project_id: int, rack_id: int, body: RackIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    rack = _get_rack(db, project_id, rack_id)
    data = body.model_dump()
    row = resolve_or_create_row(
        db, project_id, row_id=data.get("row_id"), row_label=data.get("row_label") or "", area_id=data.get("area_id")
    )
    _apply(rack, data)
    apply_row_to_rack(rack, row, data.get("area_id"))
    db.commit()
    db.refresh(rack)
    return rack


@projects_router.delete("/{project_id}/racks/{rack_id}")
def delete_rack(project_id: int, rack_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    for device in db.query(Device).filter(Device.rack_id == rack_id).all():
        device.rack_id = None
    db.delete(rack)
    db.commit()
    return {"ok": True}


@projects_router.post("/{project_id}/areas/{area_id}/copy", response_model=AreaOut)
def copy_area(
    project_id: int, area_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return _relocate(db, "area", _get_area(db, project_id, area_id), body, True)


@projects_router.post("/{project_id}/areas/{area_id}/move", response_model=AreaOut)
def move_area(
    project_id: int, area_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return _relocate(db, "area", _get_area(db, project_id, area_id), body, False)


@projects_router.post("/{project_id}/rows/{row_id}/copy", response_model=RowOut)
def copy_row(
    project_id: int, row_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return _relocate(db, "row", _get_row(db, project_id, row_id), body, True)


@projects_router.post("/{project_id}/rows/{row_id}/move", response_model=RowOut)
def move_row(
    project_id: int, row_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return _relocate(db, "row", _get_row(db, project_id, row_id), body, False)


@projects_router.post("/{project_id}/racks/{rack_id}/copy", response_model=RackOut)
def copy_rack(
    project_id: int, rack_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return _relocate(db, "rack", _get_rack(db, project_id, rack_id), body, True)


@projects_router.post("/{project_id}/racks/{rack_id}/move", response_model=RackOut)
def move_rack(
    project_id: int, rack_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return _relocate(db, "rack", _get_rack(db, project_id, rack_id), body, False)


@projects_router.get("/{project_id}/racks/{rack_id}/elevation")
def rack_elevation(project_id: int, rack_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    devices = db.query(Device).filter(Device.rack_id == rack_id).all()
    slots = []
    occupied = {}
    for dev in devices:
        if dev.ru_start is None:
            continue
        start, end = int(dev.ru_start), int(dev.ru_end or dev.ru_start)
        for u in range(min(start, end), max(start, end) + 1):
            occupied[u] = dev.id
    for u in range(rack.ru_height, 0, -1):
        slots.append({"u": u, "device_id": occupied.get(u)})
    return {
        "rack": RackOut.model_validate(rack),
        "devices": [device_out(d) for d in devices],
        "slots": slots,
    }


@projects_router.get("/{project_id}/devices", response_model=list[DeviceOut])
def list_devices(
    project_id: int,
    q: Optional[str] = None,
    rack_id: Optional[int] = None,
    row_id: Optional[int] = None,
    area_id: Optional[int] = None,
    eol: Optional[str] = None,
    unlocated: Optional[bool] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    _get_project(db, project_id)
    query = db.query(Device).filter(Device.project_id == project_id)
    if rack_id:
        query = query.filter(Device.rack_id == rack_id)
    if row_id or area_id:
        query = query.join(Rack, Device.rack_id == Rack.id, isouter=True)
        if row_id:
            query = query.filter(Rack.row_id == row_id)
        if area_id:
            query = query.filter(Rack.area_id == area_id)
    if unlocated:
        query = query.filter(Device.rack_id.is_(None) | Device.ru_start.is_(None))
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Device.name.ilike(like),
                Device.serial.ilike(like),
                Device.vendor.ilike(like),
                Device.model.ilike(like),
                Device.hostname.ilike(like),
                Device.asset_tag.ilike(like),
                Device.owner.ilike(like),
                Device.management_ip.ilike(like),
                Device.function.ilike(like),
                Device.notes.ilike(like),
                Device.indicator_type.ilike(like),
                Device.indicator_color.ilike(like),
            )
        )
    devices = query.order_by(Device.name).all()
    out = [device_out(d) for d in devices]
    if eol:
        out = [d for d in out if d.eol_status == eol]
    return out


@projects_router.get("/{project_id}/devices/{device_id}", response_model=DeviceOut)
def get_device(project_id: int, device_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    device = db.get(Device, device_id)
    if not device or device.project_id != project_id:
        raise HTTPException(404, "Device not found")
    return device_out(device)


@projects_router.get("/{project_id}/search")
def search_inventory(
    project_id: int,
    q: str = "",
    unlocated: bool = False,
    area_id: Optional[int] = None,
    row_id: Optional[int] = None,
    rack_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    _get_project(db, project_id)
    backfill_rows(db, project_id)
    query = db.query(Device).filter(Device.project_id == project_id)
    if rack_id:
        query = query.filter(Device.rack_id == rack_id)
    if unlocated:
        query = query.filter(Device.rack_id.is_(None) | Device.ru_start.is_(None))
    racks = {r.id: r for r in db.query(Rack).filter(Rack.project_id == project_id).all()}
    rows = {r.id: r for r in db.query(AisleRow).filter(AisleRow.project_id == project_id).all()}
    areas = {a.id: a for a in db.query(Area).filter(Area.project_id == project_id).all()}
    if row_id or area_id:
        allowed = {
            rid
            for rid, rack in racks.items()
            if (not row_id or rack.row_id == row_id) and (not area_id or rack.area_id == area_id)
        }
        query = query.filter(Device.rack_id.in_(allowed) if allowed else Device.rack_id == -1)
    if q.strip():
        like = f"%{q.strip()}%"
        rack_ids = [
            rid
            for rid, rack in racks.items()
            if like[1:-1].lower() in (rack.name or "").lower()
            or like[1:-1].lower() in (rack.row_label or "").lower()
            or (rows.get(rack.row_id) and like[1:-1].lower() in rows[rack.row_id].name.lower())
            or (areas.get(rack.area_id) and like[1:-1].lower() in areas[rack.area_id].name.lower())
        ]
        query = query.filter(
            or_(
                Device.name.ilike(like),
                Device.serial.ilike(like),
                Device.vendor.ilike(like),
                Device.model.ilike(like),
                Device.hostname.ilike(like),
                Device.asset_tag.ilike(like),
                Device.owner.ilike(like),
                Device.management_ip.ilike(like),
                Device.function.ilike(like),
                Device.notes.ilike(like),
                Device.indicator_type.ilike(like),
                Device.indicator_color.ilike(like),
                Device.rack_id.in_(rack_ids) if rack_ids else False,
            )
        )
    hits = []
    for dev in query.order_by(Device.name).limit(200).all():
        item = device_out(dev).model_dump()
        rack = racks.get(dev.rack_id) if dev.rack_id else None
        row = rows.get(rack.row_id) if rack and rack.row_id else None
        area = areas.get(rack.area_id) if rack and rack.area_id else None
        item["rack_name"] = rack.name if rack else None
        item["rack_row"] = (row.name if row else None) or (rack.row_label if rack else None)
        item["area_name"] = area.name if area else None
        hits.append(item)
    return {"query": q, "count": len(hits), "devices": hits}


@ops_router.post("/imports/preview")
async def preview_inventory_import(
    file: UploadFile = File(...),
    sheet: Optional[str] = Form(None),
    orientation: Optional[str] = Form(None),
    header_index: Optional[int] = Form(None),
    _: User = Depends(ImportUser),
):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    try:
        return preview_import(
            file.filename or "upload.csv",
            data,
            sheet=sheet or None,
            orientation=orientation or None,
            header_index=header_index,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@projects_router.post("/{project_id}/import")
async def import_inventory(
    project_id: int,
    file: UploadFile = File(...),
    sheet: Optional[str] = Form(None),
    orientation: Optional[str] = Form(None),
    header_index: Optional[int] = Form(None),
    mapping: Optional[str] = Form(None),
    default_area_id: Optional[int] = Form(None),
    all_sheets: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(ImportUser),
):
    _get_project(db, project_id)
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    try:
        result = import_devices(
            db,
            project_id,
            file.filename or "upload.csv",
            data,
            user.id,
            sheet=sheet or None,
            orientation=orientation or None,
            header_index=header_index,
            mapping=mapping,
            default_area_id=default_area_id,
            all_sheets=_form_flag(all_sheets),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return result


@projects_router.post("/{project_id}/devices", response_model=DeviceOut, status_code=201)
def create_device(project_id: int, body: DeviceIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)):
    _get_project(db, project_id)
    data = body.model_dump()
    data["pdu_a_id"] = _pdu_in_project(db, project_id, data.get("pdu_a_id"))
    data["pdu_b_id"] = _pdu_in_project(db, project_id, data.get("pdu_b_id"))
    device = Device(project_id=project_id, captured_by=user.id, **data)
    db.add(device)
    db.flush()
    _ensure_rack_fits(db, device.rack_id, device.ru_end)
    learn_values(
        db,
        vendor=device.vendor,
        model=device.model,
        device_type=device.device_type,
        function=device.function,
    )
    db.commit()
    db.refresh(device)
    return device_out(device)


@projects_router.patch("/{project_id}/devices/{device_id}", response_model=DeviceOut)
def update_device(
    project_id: int, device_id: int, body: DevicePatch, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    device = _get_device(db, project_id, device_id)
    data = body.model_dump(exclude_unset=True)
    if "pdu_a_id" in data:
        data["pdu_a_id"] = _pdu_in_project(db, project_id, data.get("pdu_a_id"))
    if "pdu_b_id" in data:
        data["pdu_b_id"] = _pdu_in_project(db, project_id, data.get("pdu_b_id"))
    _apply(device, data)
    _ensure_rack_fits(db, device.rack_id, device.ru_end)
    learn_values(
        db,
        vendor=device.vendor,
        model=device.model,
        device_type=device.device_type,
        function=device.function,
    )
    db.commit()
    db.refresh(device)
    return device_out(device)


@projects_router.post("/{project_id}/devices/{device_id}/copy", response_model=DeviceOut)
def copy_device(
    project_id: int, device_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return device_out(_relocate(db, "device", _get_device(db, project_id, device_id), body, True))


@projects_router.post("/{project_id}/devices/{device_id}/move", response_model=DeviceOut)
def move_device(
    project_id: int, device_id: int, body: RelocateIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    return device_out(_relocate(db, "device", _get_device(db, project_id, device_id), body, False))


@projects_router.delete("/{project_id}/devices/{device_id}")
def delete_device(project_id: int, device_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    device = _get_device(db, project_id, device_id)
    db.delete(device)
    db.commit()
    return {"ok": True}


@projects_router.get("/{project_id}/pdus", response_model=list[PDUOut])
def list_project_pdus(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_project(db, project_id)
    return (
        db.query(PDU)
        .join(Rack, PDU.rack_id == Rack.id)
        .filter(Rack.project_id == project_id)
        .order_by(PDU.name)
        .all()
    )


@projects_router.get("/{project_id}/racks/{rack_id}/pdus", response_model=list[PDUOut])
def list_pdus(project_id: int, rack_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    return db.query(PDU).filter(PDU.rack_id == rack_id).all()


@projects_router.post("/{project_id}/racks/{rack_id}/pdus", response_model=PDUOut, status_code=201)
def create_pdu(project_id: int, rack_id: int, body: PDUIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    pdu = PDU(rack_id=rack_id, **body.model_dump())
    db.add(pdu)
    db.flush()
    for i in range(1, (body.outlet_count or 0) + 1):
        db.add(PDUPort(pdu_id=pdu.id, port_label=str(i)))
    db.commit()
    db.refresh(pdu)
    return pdu


@projects_router.patch("/{project_id}/pdus/{pdu_id}/ports/{port_id}", response_model=PDUOut)
def map_pdu_port(
    project_id: int,
    pdu_id: int,
    port_id: int,
    body: PDUPortIn,
    db: Session = Depends(get_db),
    _: User = Depends(WriteUser),
):
    pdu = db.get(PDU, pdu_id)
    if not pdu:
        raise HTTPException(404, "PDU not found")
    rack = db.get(Rack, pdu.rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "PDU not found")
    port = db.get(PDUPort, port_id)
    if not port or port.pdu_id != pdu_id:
        raise HTTPException(404, "Port not found")
    port.port_label = body.port_label
    port.device_id = body.device_id
    port.notes = body.notes
    db.commit()
    db.refresh(pdu)
    return pdu


@projects_router.get("/{project_id}/cables", response_model=list[CableOut])
def list_cables(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_project(db, project_id)
    return db.query(Cable).filter(Cable.project_id == project_id).all()


@projects_router.post("/{project_id}/cables", response_model=CableOut, status_code=201)
def create_cable(project_id: int, body: CableIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    cable = Cable(project_id=project_id, **body.model_dump())
    db.add(cable)
    db.commit()
    db.refresh(cable)
    return cable


@projects_router.delete("/{project_id}/cables/{cable_id}")
def delete_cable(project_id: int, cable_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    cable = db.get(Cable, cable_id)
    if not cable or cable.project_id != project_id:
        raise HTTPException(404, "Cable not found")
    db.delete(cable)
    db.commit()
    return {"ok": True}


@projects_router.get("/{project_id}/handoffs", response_model=list[HandoffOut])
def list_handoffs(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_project(db, project_id)
    return db.query(Handoff).filter(Handoff.project_id == project_id).order_by(Handoff.handoff_date.desc()).all()


@projects_router.post("/{project_id}/handoffs", response_model=HandoffOut, status_code=201)
def create_handoff(project_id: int, body: HandoffIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    handoff = Handoff(project_id=project_id, **body.model_dump())
    db.add(handoff)
    db.commit()
    db.refresh(handoff)
    return handoff


def _checklist_out(row: Checklist) -> ChecklistOut:
    return ChecklistOut(
        id=row.id,
        project_id=row.project_id,
        template_key=row.template_key,
        title=row.title,
        items=json.loads(row.items_json or "[]"),
        completed_at=row.completed_at,
        created_at=row.created_at,
    )


@projects_router.get("/{project_id}/checklists", response_model=list[ChecklistOut])
def list_checklists(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_project(db, project_id)
    return [_checklist_out(c) for c in db.query(Checklist).filter(Checklist.project_id == project_id).all()]


@projects_router.post("/{project_id}/checklists", response_model=ChecklistOut, status_code=201)
def create_checklist(project_id: int, body: ChecklistIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    row = Checklist(
        project_id=project_id,
        template_key=body.template_key,
        title=body.title,
        items_json=json.dumps(body.items),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _checklist_out(row)


@projects_router.patch("/{project_id}/checklists/{checklist_id}", response_model=ChecklistOut)
def update_checklist(
    project_id: int, checklist_id: int, body: ChecklistIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    row = db.get(Checklist, checklist_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, "Checklist not found")
    row.title = body.title
    row.template_key = body.template_key
    row.items_json = json.dumps(body.items)
    if body.items and all(i.get("done") for i in body.items):
        row.completed_at = datetime.now(timezone.utc)
    else:
        row.completed_at = None
    db.commit()
    db.refresh(row)
    return _checklist_out(row)


@ops_router.get("/inspections", response_model=list[InspectionOut])
def list_inspections(
    project_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    q = db.query(Inspection)
    if project_id:
        q = q.filter(Inspection.project_id == project_id)
    return [_inspection_out(r) for r in q.order_by(Inspection.created_at.desc()).all()]


def _inspection_out(row: Inspection) -> InspectionOut:
    return InspectionOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        itype=row.itype,
        status=row.status,
        location=row.location,
        findings=row.findings,
        checklist=json.loads(row.checklist_json or "[]"),
        due_at=row.due_at,
        completed_at=row.completed_at,
        created_by=row.created_by,
        created_at=row.created_at,
    )


@ops_router.post("/inspections", response_model=InspectionOut, status_code=201)
def create_inspection(body: InspectionIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)):
    row = Inspection(
        project_id=body.project_id,
        title=body.title,
        itype=body.itype,
        status=body.status,
        location=body.location,
        findings=body.findings,
        checklist_json=json.dumps(body.checklist),
        due_at=body.due_at,
        created_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _inspection_out(row)


@ops_router.patch("/inspections/{inspection_id}", response_model=InspectionOut)
def update_inspection(
    inspection_id: int, body: InspectionIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    row = db.get(Inspection, inspection_id)
    if not row:
        raise HTTPException(404, "Inspection not found")
    row.project_id = body.project_id
    row.title = body.title
    row.itype = body.itype
    row.status = body.status
    row.location = body.location
    row.findings = body.findings
    row.checklist_json = json.dumps(body.checklist)
    row.due_at = body.due_at
    if body.status == "complete" and not row.completed_at:
        row.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return InspectionOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        itype=row.itype,
        status=row.status,
        location=row.location,
        findings=row.findings,
        checklist=json.loads(row.checklist_json or "[]"),
        due_at=row.due_at,
        completed_at=row.completed_at,
        created_by=row.created_by,
        created_at=row.created_at,
    )


def _incident_out(r: Incident) -> IncidentOut:
    return IncidentOut(
        id=r.id,
        project_id=r.project_id,
        title=r.title,
        severity=r.severity,
        status=r.status,
        category=r.category,
        vendor=r.vendor,
        vendor_ticket=r.vendor_ticket,
        affected_summary=r.affected_summary,
        timeline=json.loads(r.timeline_json or "[]"),
        resolution=r.resolution,
        opened_at=r.opened_at,
        resolved_at=r.resolved_at,
        created_by=r.created_by,
    )


@ops_router.get("/incidents", response_model=list[IncidentOut])
def list_incidents(project_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    q = db.query(Incident)
    if project_id:
        q = q.filter(Incident.project_id == project_id)
    return [_incident_out(r) for r in q.order_by(Incident.opened_at.desc()).all()]


@ops_router.post("/incidents", response_model=IncidentOut, status_code=201)
def create_incident(body: IncidentIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)):
    row = Incident(
        **{k: v for k, v in body.model_dump().items() if k not in ("timeline",)},
        timeline_json=json.dumps(body.timeline),
        created_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _incident_out(row)


@ops_router.patch("/incidents/{incident_id}", response_model=IncidentOut)
def update_incident(incident_id: int, body: IncidentIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = db.get(Incident, incident_id)
    if not row:
        raise HTTPException(404, "Incident not found")
    data = body.model_dump()
    timeline = data.pop("timeline")
    _apply(row, data)
    row.timeline_json = json.dumps(timeline)
    if body.status in ("resolved", "closed") and not row.resolved_at:
        row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _incident_out(row)


@ops_router.get("/work-orders", response_model=list[WorkOrderOut])
def list_work_orders(project_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    q = db.query(WorkOrder)
    if project_id:
        q = q.filter(WorkOrder.project_id == project_id)
    return q.order_by(WorkOrder.created_at.desc()).all()


@ops_router.post("/work-orders", response_model=WorkOrderOut, status_code=201)
def create_work_order(body: WorkOrderIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)):
    row = WorkOrder(**body.model_dump(), created_by=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@ops_router.patch("/work-orders/{wo_id}", response_model=WorkOrderOut)
def update_work_order(wo_id: int, body: WorkOrderIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = db.get(WorkOrder, wo_id)
    if not row:
        raise HTTPException(404, "Work order not found")
    _apply(row, body.model_dump())
    if body.status == "complete" and not row.completed_at:
        row.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@ops_router.get("/backup-processes", response_model=list[BackupProcessOut])
def list_backup_processes(project_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    q = db.query(BackupProcess)
    if project_id:
        q = q.filter(BackupProcess.project_id == project_id)
    return q.all()


@ops_router.post("/backup-processes", response_model=BackupProcessOut, status_code=201)
def create_backup_process(body: BackupProcessIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = BackupProcess(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@ops_router.patch("/backup-processes/{item_id}", response_model=BackupProcessOut)
def update_backup_process(item_id: int, body: BackupProcessIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = db.get(BackupProcess, item_id)
    if not row:
        raise HTTPException(404, "Not found")
    _apply(row, body.model_dump())
    db.commit()
    db.refresh(row)
    return row


@ops_router.get("/dr-drills", response_model=list[DRDrillOut])
def list_drills(project_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    q = db.query(DRDrill)
    if project_id:
        q = q.filter(DRDrill.project_id == project_id)
    return q.order_by(DRDrill.id.desc()).all()


@ops_router.post("/dr-drills", response_model=DRDrillOut, status_code=201)
def create_drill(body: DRDrillIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = DRDrill(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@ops_router.patch("/dr-drills/{item_id}", response_model=DRDrillOut)
def update_drill(item_id: int, body: DRDrillIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = db.get(DRDrill, item_id)
    if not row:
        raise HTTPException(404, "Not found")
    _apply(row, body.model_dump())
    if body.status == "complete" and not row.completed_at:
        row.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@ops_router.get("/capacity", response_model=list[CapacityOut])
def list_capacity(project_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    q = db.query(CapacityNote)
    if project_id:
        q = q.filter(CapacityNote.project_id == project_id)
    return q.order_by(CapacityNote.recorded_at.desc()).all()


@ops_router.post("/capacity", response_model=CapacityOut, status_code=201)
def create_capacity(body: CapacityIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = CapacityNote(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
