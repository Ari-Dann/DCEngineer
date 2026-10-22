from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.access import issue_api_key
from app.database import get_db
from app.deps import AdminUser
from app.models import ApiKey, AuditLog, User
from app.routers.auth import audit
from app.schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyOut, AuditOut

router = APIRouter(prefix="/api/api-keys", tags=["integration"])
audit_router = APIRouter(prefix="/api", tags=["integration"])


def _out(row: ApiKey) -> ApiKeyOut:
    return ApiKeyOut.model_validate(row)


@router.get("", response_model=list[ApiKeyOut])
def list_api_keys(_: User = Depends(AdminUser), db: Session = Depends(get_db)):
    rows = db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()
    return [_out(row) for row in rows]


@router.post("", response_model=ApiKeyCreated, status_code=201)
def create_api_key(body: ApiKeyCreate, admin: User = Depends(AdminUser), db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    expires_at = None
    if body.expires_in_days is not None:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)
    row, token = issue_api_key(db, name=name, scopes=body.scopes, created_by=admin.id, expires_at=expires_at)
    audit(db, admin.id, "create", "api_key", row.id, row.prefix)
    db.commit()
    db.refresh(row)
    payload = _out(row).model_dump()
    payload["token"] = token
    return ApiKeyCreated(**payload)


@router.delete("/{key_id}")
def revoke_api_key(key_id: int, admin: User = Depends(AdminUser), db: Session = Depends(get_db)):
    row = db.get(ApiKey, key_id)
    if not row:
        raise HTTPException(404, "API key not found")
    row.revoked = True
    audit(db, admin.id, "revoke", "api_key", row.id, row.prefix)
    db.commit()
    return {"ok": True}


@audit_router.get("/audit", response_model=list[AuditOut])
def list_audit(
    limit: int = 100,
    _: User = Depends(AdminUser),
    db: Session = Depends(get_db),
):
    capped = min(max(limit, 1), 500)
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(capped).all()
    return rows
