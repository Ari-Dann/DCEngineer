import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import WriteUser, get_current_user
from app.models import (
    Area,
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
def update_project(project_id: int, body: ProjectIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    project = _get_project(db, project_id)
    _apply(project, body.model_dump())
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project


@projects_router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    project = _get_project(db, project_id)
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
    db.delete(area)
    db.commit()
    return {"ok": True}


@projects_router.get("/{project_id}/racks", response_model=list[RackOut])
def list_racks(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    _get_project(db, project_id)
    return db.query(Rack).filter(Rack.project_id == project_id).order_by(Rack.name).all()


@projects_router.post("/{project_id}/racks", response_model=RackOut, status_code=201)
def create_rack(project_id: int, body: RackIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    _get_project(db, project_id)
    rack = Rack(project_id=project_id, **body.model_dump())
    db.add(rack)
    db.commit()
    db.refresh(rack)
    return rack


@projects_router.patch("/{project_id}/racks/{rack_id}", response_model=RackOut)
def update_rack(project_id: int, rack_id: int, body: RackIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    _apply(rack, body.model_dump())
    db.commit()
    db.refresh(rack)
    return rack


@projects_router.delete("/{project_id}/racks/{rack_id}")
def delete_rack(project_id: int, rack_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    db.delete(rack)
    db.commit()
    return {"ok": True}


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
    eol: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    _get_project(db, project_id)
    query = db.query(Device).filter(Device.project_id == project_id)
    if rack_id:
        query = query.filter(Device.rack_id == rack_id)
    if q:
        like = f"%{q}%"
        query = query.filter(
            Device.name.ilike(like)
            | Device.serial.ilike(like)
            | Device.vendor.ilike(like)
            | Device.model.ilike(like)
            | Device.hostname.ilike(like)
        )
    devices = query.order_by(Device.name).all()
    out = [device_out(d) for d in devices]
    if eol:
        out = [d for d in out if d.eol_status == eol]
    return out


@projects_router.post("/{project_id}/devices", response_model=DeviceOut, status_code=201)
def create_device(project_id: int, body: DeviceIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)):
    _get_project(db, project_id)
    device = Device(project_id=project_id, captured_by=user.id, **body.model_dump())
    db.add(device)
    db.commit()
    db.refresh(device)
    return device_out(device)


@projects_router.patch("/{project_id}/devices/{device_id}", response_model=DeviceOut)
def update_device(
    project_id: int, device_id: int, body: DeviceIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)
):
    device = db.get(Device, device_id)
    if not device or device.project_id != project_id:
        raise HTTPException(404, "Device not found")
    _apply(device, body.model_dump())
    db.commit()
    db.refresh(device)
    return device_out(device)


@projects_router.delete("/{project_id}/devices/{device_id}")
def delete_device(project_id: int, device_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    device = db.get(Device, device_id)
    if not device or device.project_id != project_id:
        raise HTTPException(404, "Device not found")
    db.delete(device)
    db.commit()
    return {"ok": True}


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
