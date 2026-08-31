from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.catalog import learn_values
from app.config import get_settings
from app.database import get_db
from app.deps import VisionWorker, WriteUser, get_current_user
from app.layout import bulk_create_rows, names_from_layout, racks_from_layout, resolve_or_create_rack, unique_labels
from app.models import (
    AisleRow,
    Attachment,
    Device,
    Rack,
    User,
    VisionClip,
    VisionProposal,
    VisionSession,
)
from app.routers.inventory import _ensure_rack_fits, _get_area, _get_project, device_out
from app.schemas import (
    CLIP_KINDS,
    CLIP_SOURCES,
    DeviceOut,
    VisionClipOut,
    VisionJobOut,
    VisionLayoutAcceptIn,
    VisionLayoutAcceptOut,
    VisionProposalBatchIn,
    VisionProposalOut,
    VisionProposalPatch,
    VisionSessionIn,
    VisionSessionOut,
    VisionSessionStatusIn,
)
from app.storage import get_storage, new_key
from app.vision_policy import (
    RESTRICTED_REFUSAL,
    blank_unreadable,
    restriction_reasons,
)

router = APIRouter(prefix="/api/vision", tags=["vision"])

PROPOSAL_FIELDS = (
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


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _json_load(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _json_dump(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str)


def _clip_out(clip: VisionClip, attachment: Attachment | None) -> VisionClipOut:
    data = {
        "id": clip.id,
        "session_id": clip.session_id,
        "attachment_id": clip.attachment_id,
        "kind": clip.kind,
        "source": clip.source,
        "source_attachment_id": clip.source_attachment_id,
        "timestamp_ms": clip.timestamp_ms,
        "notes": clip.notes,
        "created_at": clip.created_at,
        "filename": attachment.filename if attachment else "",
        "content_type": attachment.content_type if attachment else "",
        "size": attachment.size if attachment else 0,
        "photography_restricted": bool(attachment.photography_restricted) if attachment else False,
    }
    return VisionClipOut.model_validate(data)


def _proposal_out(row: VisionProposal) -> VisionProposalOut:
    return VisionProposalOut.model_validate(
        {
            "id": row.id,
            "session_id": row.session_id,
            "status": row.status,
            "name": row.name,
            "hostname": row.hostname,
            "vendor": row.vendor,
            "model": row.model,
            "serial": row.serial,
            "asset_tag": row.asset_tag,
            "owner": row.owner,
            "device_type": row.device_type,
            "function": row.function,
            "ru_start": row.ru_start,
            "ru_end": row.ru_end,
            "area_name": row.area_name,
            "row_name": row.row_name,
            "rack_name": row.rack_name,
            "rack_id": row.rack_id,
            "notes": row.notes,
            "unreadable_fields": _json_load(row.unreadable_fields_json, []),
            "evidence_attachment_ids": _json_load(row.evidence_attachment_ids_json, []),
            "prompt_text": row.prompt_text,
            "extractor_model": row.extractor_model,
            "raw_extraction": _json_load(row.raw_extraction, row.raw_extraction or None),
            "accepted_device_id": row.accepted_device_id,
            "reviewed_by": row.reviewed_by,
            "reviewed_at": row.reviewed_at,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
    )


def _session_counts(db: Session, session: VisionSession) -> tuple[int, int, int]:
    clips = db.query(VisionClip).filter(VisionClip.session_id == session.id).count()
    proposals = db.query(VisionProposal).filter(VisionProposal.session_id == session.id).count()
    pending = (
        db.query(VisionProposal)
        .filter(VisionProposal.session_id == session.id, VisionProposal.status.in_(("pending", "edited")))
        .count()
    )
    return clips, proposals, pending


def _session_out(db: Session, session: VisionSession, include_children: bool = True) -> VisionSessionOut:
    clip_count, proposal_count, pending_count = _session_counts(db, session)
    clips: list[VisionClipOut] = []
    proposals: list[VisionProposalOut] = []
    if include_children:
        clip_rows = (
            db.query(VisionClip).filter(VisionClip.session_id == session.id).order_by(VisionClip.id.asc()).all()
        )
        att_ids = [c.attachment_id for c in clip_rows]
        attachments = {a.id: a for a in db.query(Attachment).filter(Attachment.id.in_(att_ids)).all()} if att_ids else {}
        clips = [_clip_out(c, attachments.get(c.attachment_id)) for c in clip_rows]
        proposals = [
            _proposal_out(p)
            for p in db.query(VisionProposal)
            .filter(VisionProposal.session_id == session.id)
            .order_by(VisionProposal.id.asc())
            .all()
        ]
    return VisionSessionOut.model_validate(
        {
            "id": session.id,
            "project_id": session.project_id,
            "area_id": session.area_id,
            "row_id": session.row_id,
            "rack_id": session.rack_id,
            "status": session.status,
            "shot_kind": session.shot_kind,
            "notes": session.notes,
            "restricted_blocked": session.restricted_blocked,
            "error_detail": session.error_detail,
            "layout": _json_load(session.layout_json, None),
            "restriction_reasons": restriction_reasons(db, session),
            "created_by": session.created_by,
            "claimed_by": session.claimed_by,
            "claimed_at": session.claimed_at,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "clip_count": clip_count,
            "proposal_count": proposal_count,
            "pending_count": pending_count,
            "clips": clips,
            "proposals": proposals,
        }
    )


def _get_session(db: Session, session_id: int) -> VisionSession:
    session = db.get(VisionSession, session_id)
    if not session:
        raise HTTPException(404, "Vision session not found")
    return session


def _maybe_complete(db: Session, session: VisionSession) -> None:
    db.flush()
    pending = (
        db.query(VisionProposal)
        .filter(VisionProposal.session_id == session.id, VisionProposal.status.in_(("pending", "edited")))
        .count()
    )
    total = db.query(VisionProposal).filter(VisionProposal.session_id == session.id).count()
    if total and pending == 0 and session.status == "needs_review":
        session.status = "done"
        session.updated_at = _now()


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


def _apply_proposal_payload(row: VisionProposal, data: dict[str, Any], unreadable: list[str]) -> None:
    cleaned = blank_unreadable({k: data.get(k) for k in PROPOSAL_FIELDS}, unreadable)
    for key in PROPOSAL_FIELDS:
        if key in cleaned:
            setattr(row, key, cleaned[key] if cleaned[key] is not None else (None if key in ("ru_start", "ru_end", "rack_id") else ""))
    row.unreadable_fields_json = _json_dump(unreadable or [])


@router.post("/sessions", response_model=VisionSessionOut, status_code=201)
def create_session(body: VisionSessionIn, db: Session = Depends(get_db), user: User = Depends(WriteUser)):
    _get_project(db, body.project_id)
    session = VisionSession(
        project_id=body.project_id,
        area_id=body.area_id,
        row_id=body.row_id,
        rack_id=body.rack_id,
        shot_kind=body.shot_kind,
        notes=body.notes,
        created_by=user.id,
        status="open",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(db, session)


@router.get("/sessions", response_model=list[VisionSessionOut])
def list_sessions(
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(VisionSession)
    if project_id:
        q = q.filter(VisionSession.project_id == project_id)
    if status:
        q = q.filter(VisionSession.status == status)
    rows = q.order_by(VisionSession.created_at.desc()).limit(200).all()
    return [_session_out(db, row, include_children=False) for row in rows]


@router.get("/jobs", response_model=list[VisionJobOut])
def list_jobs(db: Session = Depends(get_db), _: User = Depends(VisionWorker)):
    rows = (
        db.query(VisionSession)
        .filter(VisionSession.status == "queued", VisionSession.restricted_blocked.is_(False))
        .order_by(VisionSession.created_at.asc())
        .limit(20)
        .all()
    )
    out: list[VisionJobOut] = []
    for session in rows:
        clip_count = db.query(VisionClip).filter(VisionClip.session_id == session.id).count()
        out.append(
            VisionJobOut(
                id=session.id,
                project_id=session.project_id,
                status=session.status,
                shot_kind=session.shot_kind,
                restricted_blocked=session.restricted_blocked,
                area_id=session.area_id,
                row_id=session.row_id,
                rack_id=session.rack_id,
                clip_count=clip_count,
                created_at=session.created_at,
            )
        )
    return out


@router.get("/sessions/{session_id}", response_model=VisionSessionOut)
def get_session(session_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _session_out(db, _get_session(db, session_id))


@router.post("/sessions/{session_id}/layout/accept", response_model=VisionLayoutAcceptOut)
def accept_layout(
    session_id: int,
    body: VisionLayoutAcceptIn,
    db: Session = Depends(get_db),
    _: User = Depends(WriteUser),
):
    session = _get_session(db, session_id)
    area_id = body.area_id or session.area_id
    if not area_id:
        raise HTTPException(400, "Select an area before creating rows")
    _get_area(db, session.project_id, area_id)
    if session.area_id is None:
        session.area_id = area_id
    layout = _json_load(session.layout_json, {}) or {}
    labels = unique_labels(body.names) if body.names is not None else names_from_layout(layout)
    if not labels:
        raise HTTPException(400, "No row names to create — type them or capture an aisle shot first")
    created, existing = bulk_create_rows(db, session.project_id, area_id, labels)
    row_by_name = {row.name.casefold(): row for row in existing + created}
    racks_created = []
    racks_existing = []
    if body.create_racks:
        for item in racks_from_layout(layout):
            row_name = str(item.get("row_name") or "").strip()
            row = row_by_name.get(row_name.casefold()) if row_name else None
            if row is None and session.row_id:
                row = db.get(AisleRow, session.row_id)
            ru = item.get("ru_height")
            try:
                ru_height = int(ru) if ru is not None else None
            except (TypeError, ValueError):
                ru_height = None
            rack, was_created = resolve_or_create_rack(
                db,
                session.project_id,
                str(item.get("name") or ""),
                row=row,
                area_id=area_id,
                ru_height=ru_height,
            )
            if was_created:
                racks_created.append(rack)
            else:
                racks_existing.append(rack)
    session.updated_at = _now()
    db.commit()
    for row in created + existing:
        db.refresh(row)
    for rack in racks_created + racks_existing:
        db.refresh(rack)
    return VisionLayoutAcceptOut(
        created=created,
        existing=existing,
        racks_created=racks_created,
        racks_existing=racks_existing,
    )


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    session = _get_session(db, session_id)
    accepted = (
        db.query(VisionProposal)
        .filter(VisionProposal.session_id == session.id, VisionProposal.status == "accepted")
        .count()
    )
    if accepted:
        raise HTTPException(400, "Cannot delete a session that already accepted devices")
    clips = db.query(VisionClip).filter(VisionClip.session_id == session.id).all()
    att_ids = [c.attachment_id for c in clips]
    db.query(VisionProposal).filter(VisionProposal.session_id == session.id).delete()
    db.query(VisionClip).filter(VisionClip.session_id == session.id).delete()
    if att_ids:
        for att in db.query(Attachment).filter(Attachment.id.in_(att_ids)).all():
            others = (
                db.query(Attachment)
                .filter(Attachment.storage_key == att.storage_key, Attachment.id != att.id)
                .count()
            )
            if others == 0:
                get_storage().delete(att.storage_key)
            db.delete(att)
    db.delete(session)
    db.commit()
    return {"ok": True}


@router.post("/sessions/{session_id}/clips", response_model=VisionClipOut, status_code=201)
async def add_clip(
    session_id: int,
    kind: str = Form("other"),
    source: str = Form("upload"),
    source_attachment_id: Optional[int] = Form(None),
    timestamp_ms: Optional[int] = Form(None),
    notes: str = Form(""),
    photography_restricted: bool = Form(False),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(VisionWorker),
):
    session = _get_session(db, session_id)
    if kind not in CLIP_KINDS:
        raise HTTPException(400, f"kind must be one of {CLIP_KINDS}")
    if source not in CLIP_SOURCES:
        raise HTTPException(400, f"source must be one of {CLIP_SOURCES}")
    settings = get_settings()
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB")
    key = new_key(file.filename or "clip.bin")
    get_storage().put(key, data)
    attachment = Attachment(
        entity_type="vision_session",
        entity_id=session.id,
        filename=file.filename or "clip.bin",
        content_type=file.content_type or "application/octet-stream",
        size=len(data),
        storage_key=key,
        photography_restricted=photography_restricted,
        uploaded_by=user.id,
    )
    db.add(attachment)
    db.flush()
    clip = VisionClip(
        session_id=session.id,
        attachment_id=attachment.id,
        kind=kind,
        source=source,
        source_attachment_id=source_attachment_id,
        timestamp_ms=timestamp_ms,
        notes=notes or "",
    )
    db.add(clip)
    session.updated_at = _now()
    db.commit()
    db.refresh(clip)
    db.refresh(attachment)
    return _clip_out(clip, attachment)


@router.delete("/sessions/{session_id}/clips/{clip_id}")
def delete_clip(session_id: int, clip_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    session = _get_session(db, session_id)
    clip = db.get(VisionClip, clip_id)
    if not clip or clip.session_id != session.id:
        raise HTTPException(404, "Clip not found")
    attachment = db.get(Attachment, clip.attachment_id)
    db.delete(clip)
    if attachment:
        others = (
            db.query(Attachment)
            .filter(Attachment.storage_key == attachment.storage_key, Attachment.id != attachment.id)
            .count()
        )
        still_clipped = (
            db.query(VisionClip)
            .filter(VisionClip.attachment_id == attachment.id, VisionClip.id != clip_id)
            .count()
        )
        if others == 0 and still_clipped == 0:
            get_storage().delete(attachment.storage_key)
        db.delete(attachment)
    db.commit()
    return {"ok": True}


@router.post("/sessions/{session_id}/analyze", response_model=VisionSessionOut)
def analyze_session(session_id: int, db: Session = Depends(get_db), _: User = Depends(WriteUser)):
    session = _get_session(db, session_id)
    reasons = restriction_reasons(db, session)
    if reasons:
        session.status = "refused"
        session.restricted_blocked = True
        session.error_detail = f"{RESTRICTED_REFUSAL} {'; '.join(reasons)}"
        session.updated_at = _now()
        db.commit()
        db.refresh(session)
        return _session_out(db, session)
    clip_count = db.query(VisionClip).filter(VisionClip.session_id == session.id).count()
    if clip_count == 0:
        raise HTTPException(400, "Add photos or video before analyzing")
    session.status = "queued"
    session.restricted_blocked = False
    session.error_detail = ""
    session.claimed_by = None
    session.claimed_at = None
    session.updated_at = _now()
    db.commit()
    db.refresh(session)
    return _session_out(db, session)


@router.post("/sessions/{session_id}/claim", response_model=VisionSessionOut)
def claim_session(session_id: int, db: Session = Depends(get_db), user: User = Depends(VisionWorker)):
    session = _get_session(db, session_id)
    if session.restricted_blocked or restriction_reasons(db, session):
        reasons = restriction_reasons(db, session)
        session.status = "refused"
        session.restricted_blocked = True
        session.error_detail = f"{RESTRICTED_REFUSAL} {'; '.join(reasons)}"
        session.updated_at = _now()
        db.commit()
        db.refresh(session)
        raise HTTPException(403, session.error_detail)
    if session.status not in ("queued", "running"):
        raise HTTPException(400, f"Session is {session.status}, not queued")
    session.status = "running"
    session.claimed_by = user.id
    session.claimed_at = _now()
    session.updated_at = _now()
    db.commit()
    db.refresh(session)
    return _session_out(db, session)


@router.patch("/sessions/{session_id}/status", response_model=VisionSessionOut)
def patch_status(
    session_id: int,
    body: VisionSessionStatusIn,
    db: Session = Depends(get_db),
    user: User = Depends(VisionWorker),
):
    session = _get_session(db, session_id)
    if user.role == "sidecar" and body.status not in ("running", "needs_review", "error", "refused"):
        raise HTTPException(403, "Sidecar cannot set that status")
    session.status = body.status
    if body.error_detail:
        session.error_detail = body.error_detail
    if body.restricted_blocked is not None:
        session.restricted_blocked = body.restricted_blocked
    if body.layout is not None:
        session.layout_json = _json_dump(body.layout)
    session.updated_at = _now()
    db.commit()
    db.refresh(session)
    return _session_out(db, session)


@router.post("/sessions/{session_id}/proposals", response_model=list[VisionProposalOut], status_code=201)
def add_proposals(
    session_id: int,
    body: VisionProposalBatchIn,
    db: Session = Depends(get_db),
    _: User = Depends(VisionWorker),
):
    session = _get_session(db, session_id)
    if session.restricted_blocked:
        raise HTTPException(403, session.error_detail or RESTRICTED_REFUSAL)
    if restriction_reasons(db, session):
        reasons = restriction_reasons(db, session)
        session.status = "refused"
        session.restricted_blocked = True
        session.error_detail = f"{RESTRICTED_REFUSAL} {'; '.join(reasons)}"
        session.updated_at = _now()
        db.commit()
        raise HTTPException(403, session.error_detail)
    if body.layout is not None:
        session.layout_json = _json_dump(body.layout)
    created: list[VisionProposal] = []
    raw = _json_dump(body.raw_extraction)
    for item in body.proposals:
        payload = item.model_dump()
        unreadable = list(item.unreadable_fields or [])
        cleaned = blank_unreadable({k: payload.get(k) for k in PROPOSAL_FIELDS}, unreadable)
        if session.rack_id and not cleaned.get("rack_id"):
            cleaned["rack_id"] = session.rack_id
        evidence = item.evidence_attachment_ids or body.media_sent_attachment_ids
        row = VisionProposal(
            session_id=session.id,
            status="pending",
            name=cleaned.get("name") or "",
            hostname=cleaned.get("hostname") or "",
            vendor=cleaned.get("vendor") or "",
            model=cleaned.get("model") or "",
            serial=cleaned.get("serial") or "",
            asset_tag=cleaned.get("asset_tag") or "",
            owner=cleaned.get("owner") or "",
            device_type=cleaned.get("device_type") or "",
            function=cleaned.get("function") or "",
            ru_start=cleaned.get("ru_start"),
            ru_end=cleaned.get("ru_end"),
            area_name=cleaned.get("area_name") or "",
            row_name=cleaned.get("row_name") or "",
            rack_name=cleaned.get("rack_name") or "",
            rack_id=cleaned.get("rack_id"),
            notes=cleaned.get("notes") or "",
            unreadable_fields_json=_json_dump(unreadable),
            evidence_attachment_ids_json=_json_dump(evidence),
            prompt_text=item.prompt_text or body.prompt_text,
            extractor_model=item.extractor_model or body.extractor_model or body.model,
            raw_extraction=raw if item.raw_extraction is None else _json_dump(item.raw_extraction),
        )
        db.add(row)
        created.append(row)
    session.status = "needs_review"
    session.updated_at = _now()
    db.commit()
    for row in created:
        db.refresh(row)
    return [_proposal_out(row) for row in created]


@router.patch("/sessions/{session_id}/proposals/{proposal_id}", response_model=VisionProposalOut)
def edit_proposal(
    session_id: int,
    proposal_id: int,
    body: VisionProposalPatch,
    db: Session = Depends(get_db),
    user: User = Depends(WriteUser),
):
    session = _get_session(db, session_id)
    row = db.get(VisionProposal, proposal_id)
    if not row or row.session_id != session.id:
        raise HTTPException(404, "Proposal not found")
    if row.status == "accepted":
        raise HTTPException(400, "Accepted proposals cannot be edited")
    data = body.model_dump(exclude_unset=True)
    unreadable = data.pop("unreadable_fields", None)
    evidence = data.pop("evidence_attachment_ids", None)
    current = {k: getattr(row, k) for k in PROPOSAL_FIELDS}
    current.update(data)
    flags = unreadable if unreadable is not None else _json_load(row.unreadable_fields_json, [])
    _apply_proposal_payload(row, current, flags)
    if evidence is not None:
        row.evidence_attachment_ids_json = _json_dump(evidence)
    if row.status == "pending":
        row.status = "edited"
    row.reviewed_by = user.id
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return _proposal_out(row)


@router.post("/sessions/{session_id}/proposals/{proposal_id}/accept", response_model=DeviceOut)
def accept_proposal(
    session_id: int,
    proposal_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(WriteUser),
):
    session = _get_session(db, session_id)
    row = db.get(VisionProposal, proposal_id)
    if not row or row.session_id != session.id:
        raise HTTPException(404, "Proposal not found")
    if row.status == "accepted" and row.accepted_device_id:
        device = db.get(Device, row.accepted_device_id)
        if device:
            return device_out(device)
    if row.status == "rejected":
        raise HTTPException(400, "Rejected proposals cannot be accepted")
    name = (row.name or "").strip()
    if not name:
        raise HTTPException(400, "Device name is required — fill the blank before accepting")
    device = Device(
        project_id=session.project_id,
        captured_by=user.id,
        name=name,
        rack_id=row.rack_id or session.rack_id,
        hostname=row.hostname or "",
        vendor=row.vendor or "",
        model=row.model or "",
        serial=row.serial or "",
        asset_tag=row.asset_tag or "",
        owner=row.owner or "",
        device_type=row.device_type or "server",
        function=row.function or "",
        ru_start=row.ru_start,
        ru_end=row.ru_end,
        notes=row.notes or "",
        discovered_via="vision",
    )
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
    evidence = _json_load(row.evidence_attachment_ids_json, [])
    if not evidence:
        evidence = [
            c.attachment_id
            for c in db.query(VisionClip).filter(VisionClip.session_id == session.id).all()
        ]
    _copy_evidence(db, [int(i) for i in evidence if i], device.id, user.id)
    row.status = "accepted"
    row.accepted_device_id = device.id
    row.reviewed_by = user.id
    row.reviewed_at = _now()
    row.updated_at = _now()
    _maybe_complete(db, session)
    db.commit()
    db.refresh(device)
    return device_out(device)


@router.post("/sessions/{session_id}/proposals/{proposal_id}/reject", response_model=VisionProposalOut)
def reject_proposal(
    session_id: int,
    proposal_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(WriteUser),
):
    session = _get_session(db, session_id)
    row = db.get(VisionProposal, proposal_id)
    if not row or row.session_id != session.id:
        raise HTTPException(404, "Proposal not found")
    if row.status == "accepted":
        raise HTTPException(400, "Accepted proposals cannot be rejected")
    row.status = "rejected"
    row.reviewed_by = user.id
    row.reviewed_at = _now()
    row.updated_at = _now()
    _maybe_complete(db, session)
    db.commit()
    db.refresh(row)
    return _proposal_out(row)
