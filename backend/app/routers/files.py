from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import WriteUser, get_current_user
from app.models import (
    AppBackup,
    Area,
    Attachment,
    Cable,
    Device,
    Incident,
    Inspection,
    Project,
    Rack,
    User,
    WorkOrder,
)
from app.office_export import build_office_zip
from app.rbi_export import build_rbi_workbook, eol_status, rack_svg
from app.schemas import AttachmentOut, CatalogLearnIn
from app.storage import get_storage, new_key
from app.backup import run_backup

files_router = APIRouter(prefix="/api", tags=["files"])
meta_router = APIRouter(prefix="/api", tags=["meta"])


@files_router.post("/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    entity_type: str = Form(...),
    entity_id: int = Form(...),
    photography_restricted: bool = Form(False),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(WriteUser),
):
    settings = get_settings()
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB")
    key = new_key(file.filename or "upload.bin")
    get_storage().put(key, data)
    row = Attachment(
        entity_type=entity_type,
        entity_id=entity_id,
        filename=file.filename or "upload.bin",
        content_type=file.content_type or "application/octet-stream",
        size=len(data),
        storage_key=key,
        photography_restricted=photography_restricted,
        uploaded_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@files_router.get("/attachments", response_model=list[AttachmentOut])
def list_attachments(
    entity_type: str,
    entity_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        db.query(Attachment)
        .filter(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id)
        .order_by(Attachment.created_at.desc())
        .all()
    )


@files_router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    row = db.get(Attachment, attachment_id)
    if not row:
        raise HTTPException(404, "Attachment not found")
    data = get_storage().get(row.storage_key)
    return Response(
        content=data,
        media_type=row.content_type,
        headers={"Content-Disposition": f'attachment; filename="{row.filename}"'},
    )


@files_router.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    row = db.get(Attachment, attachment_id)
    if not row:
        raise HTTPException(404, "Attachment not found")
    get_storage().delete(row.storage_key)
    db.delete(row)
    db.commit()
    return {"ok": True}


@meta_router.get("/projects/{project_id}/export.xlsx")
def export_rbi(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    data = build_rbi_workbook(db, project)
    filename = f"RBI-{project.customer or project.name}-{project.revision}.xlsx".replace(" ", "_")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@meta_router.get("/projects/{project_id}/export-visio.zip")
def export_visio_office(project_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    data = build_office_zip(db, project)
    stem = (project.site_name or project.customer or project.name or "DCEngineer").replace(" ", "_")
    filename = f"{stem}-Visio-Office.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@meta_router.get("/projects/{project_id}/racks/{rack_id}/elevation.svg")
def export_rack_svg(project_id: int, rack_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rack = db.get(Rack, rack_id)
    if not rack or rack.project_id != project_id:
        raise HTTPException(404, "Rack not found")
    devices = db.query(Device).filter(Device.rack_id == rack_id).all()
    svg = rack_svg(rack, devices)
    return Response(content=svg, media_type="image/svg+xml")


@meta_router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    near_days = get_settings().near_eol_days
    devices = db.query(Device).all()
    eol = sum(1 for d in devices if eol_status(d.eol_date, near_days) == "eol")
    near = sum(1 for d in devices if eol_status(d.eol_date, near_days) == "near")
    open_incidents = db.query(Incident).filter(Incident.status.in_(("open", "investigating"))).count()
    open_inspections = db.query(Inspection).filter(Inspection.status != "complete").count()
    open_wo = db.query(WorkOrder).filter(WorkOrder.status.notin_(("complete", "cancelled"))).count()
    last_backup = db.query(AppBackup).order_by(AppBackup.created_at.desc()).first()
    return {
        "projects": db.query(Project).count(),
        "racks": db.query(Rack).count(),
        "devices": len(devices),
        "restricted_devices": sum(1 for d in devices if d.restricted),
        "undocumented_devices": sum(1 for d in devices if d.undocumented),
        "fan_issues": sum(1 for d in devices if "incorrect" in (d.fan_orientation or "")),
        "eol_devices": eol,
        "near_eol_devices": near,
        "open_incidents": open_incidents,
        "open_inspections": open_inspections,
        "open_work_orders": open_wo,
        "cables": db.query(Cable).count(),
        "areas": db.query(Area).count(),
        "last_app_backup": last_backup.created_at.isoformat() if last_backup else None,
        "last_app_backup_status": last_backup.status if last_backup else None,
        "storage_backend": get_settings().storage_backend,
    }


@meta_router.get("/app-backups")
def list_app_backups(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(AppBackup).order_by(AppBackup.created_at.desc()).limit(50).all()
    return [
        {
            "id": r.id,
            "filename": r.filename,
            "size": r.size,
            "backend": r.backend,
            "status": r.status,
            "detail": r.detail,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@meta_router.post("/app-backups")
def trigger_backup(db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    record = run_backup(db)
    return {
        "id": record.id,
        "filename": record.filename,
        "size": record.size,
        "status": record.status,
        "detail": record.detail,
        "created_at": record.created_at,
    }


@meta_router.get("/catalog")
def catalog(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from app.catalog import catalog_payload

    return catalog_payload(db)


@meta_router.post("/catalog/learn")
def learn_catalog(body: CatalogLearnIn, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    from app.catalog import catalog_payload, learn_values

    learn_values(
        db,
        vendor=body.vendor or "",
        model=body.model or "",
        device_type=body.device_type or "",
        function=body.function or "",
    )
    db.commit()
    return catalog_payload(db)


@meta_router.get("/health")
def health():
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.dce_app_name,
        "storage": settings.storage_backend,
        "proxy": settings.reverse_proxy,
    }


@meta_router.get("/templates")
def templates(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from app.models import ChecklistTemplate
    import json

    return [
        {
            "key": t.key,
            "name": t.name,
            "phase": t.phase,
            "items": json.loads(t.items_json),
        }
        for t in db.query(ChecklistTemplate).all()
    ]
