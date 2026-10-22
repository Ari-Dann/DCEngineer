from typing import Optional

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.access import Actor, authenticate
from app.database import get_db
from app.models import User

bearer = HTTPBearer(auto_error=False)


def get_actor(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Actor:
    token = None
    if creds:
        token = creds.credentials
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return authenticate(db, request, token)


def get_current_user(actor: Actor = Depends(get_actor)) -> User:
    """Authenticated human user. API keys are rejected."""
    if actor.kind != "user" or actor.user is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "API keys cannot use this endpoint")
    return actor.user


def require_roles(*roles: str):
    def _inner(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user

    return _inner


def require_scope(*scopes: str):
    def _inner(actor: Actor = Depends(get_actor)) -> Actor:
        if not actor.allows(*scopes):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient scope")
        return actor

    return _inner


AdminUser = require_roles("admin")
WriteUser = require_roles("admin", "engineer", "remote")
ImportUser = require_roles("admin", "engineer")
SidecarUser = require_roles("sidecar")
VisionWorker = require_roles("admin", "engineer", "remote", "sidecar")

InventoryRead = require_scope("inventory:read")
InventoryWrite = require_scope("inventory:write")
OpsRead = require_scope("ops:read")
OpsWrite = require_scope("ops:write")
ExportUser = require_scope("export")
