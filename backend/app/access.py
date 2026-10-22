"""API-key principals and scope checks.

Human roles keep their existing access through implicit scopes. Machine
clients authenticate with a `dce_live_…` bearer key and only the scopes
stored on that key.
"""

from __future__ import annotations

import secrets
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from threading import Lock
from typing import Optional

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import decode_token
from app.config import get_settings
from app.models import ApiKey, User

KEY_PREFIX = "dce_live_"
KEY_SCOPES = (
    "inventory:read",
    "inventory:write",
    "ops:read",
    "ops:write",
    "export",
)
DEFAULT_KEY_SCOPES = ("inventory:read", "ops:read")

ROLE_SCOPES: dict[str, frozenset[str]] = {
    "admin": frozenset((*KEY_SCOPES, "import", "vision", "users", "backup")),
    "engineer": frozenset(
        {"inventory:read", "inventory:write", "ops:read", "ops:write", "export", "import", "vision"}
    ),
    "remote": frozenset({"inventory:read", "inventory:write", "ops:read", "ops:write", "export", "vision"}),
    "viewer": frozenset({"inventory:read", "ops:read", "export"}),
    "sidecar": frozenset({"vision"}),
}

_HITS: dict[int, deque[float]] = {}
_HITS_LOCK = Lock()


@dataclass
class Actor:
    kind: str  # user | api_key
    scopes: frozenset[str]
    user: Optional[User] = None
    api_key: Optional[ApiKey] = None

    @property
    def id(self) -> Optional[int]:
        if self.kind == "user" and self.user is not None:
            return self.user.id
        if self.api_key is not None:
            return self.api_key.created_by
        return None

    @property
    def role(self) -> str:
        if self.kind == "user" and self.user is not None:
            return self.user.role
        return "integration"

    @property
    def username(self) -> str:
        if self.kind == "user" and self.user is not None:
            return self.user.username
        if self.api_key is not None:
            return self.api_key.name
        return "api-key"

    def allows(self, *scopes: str) -> bool:
        return all(scope in self.scopes for scope in scopes)


def normalize_scopes(scopes: list[str]) -> list[str]:
    cleaned = []
    for scope in scopes:
        item = (scope or "").strip()
        if not item:
            continue
        if item not in KEY_SCOPES:
            allowed = ", ".join(KEY_SCOPES)
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown scope {item}. Keys may use: {allowed}")
        if item not in cleaned:
            cleaned.append(item)
    if not cleaned:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Select at least one scope")
    return cleaned


def issue_api_key(db: Session, *, name: str, scopes: list[str], created_by: Optional[int], expires_at: Optional[datetime]) -> tuple[ApiKey, str]:
    token = KEY_PREFIX + secrets.token_urlsafe(32)
    row = ApiKey(
        name=name.strip(),
        prefix=token[:16],
        key_hash=sha256(token.encode()).hexdigest(),
        scopes=" ".join(normalize_scopes(scopes)),
        created_by=created_by,
        expires_at=expires_at,
        revoked=False,
    )
    db.add(row)
    db.flush()
    return row, token


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _rate_limit(key_id: int) -> None:
    rpm = max(1, int(get_settings().api_key_rpm))
    now = datetime.now(timezone.utc).timestamp()
    with _HITS_LOCK:
        bucket = _HITS.setdefault(key_id, deque())
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= rpm:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "API key rate limit exceeded")
        bucket.append(now)


def _touch_last_used(db: Session, key: ApiKey) -> None:
    now = datetime.now(timezone.utc)
    last = key.last_used_at
    if last is not None and (_aware(last) + timedelta(seconds=60)) > now:
        return
    key.last_used_at = now
    db.commit()


def _key_actor(db: Session, request: Request, token: str) -> Actor:
    digest = sha256(token.encode()).hexdigest()
    key = db.query(ApiKey).filter(ApiKey.key_hash == digest).first()
    if not key or key.revoked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid API key")
    if key.expires_at is not None and _aware(key.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API key expired")
    request.state.api_key_id = key.id
    request.state.actor_user_id = key.created_by
    request.state.api_key_prefix = key.prefix
    _rate_limit(key.id)
    _touch_last_used(db, key)
    scopes = frozenset(part for part in (key.scopes or "").split() if part)
    return Actor(kind="api_key", scopes=scopes, api_key=key)


def _user_actor(db: Session, request: Request, token: str) -> Actor:
    payload = decode_token(token, "access")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive or missing")
    request.state.actor_user_id = user.id
    scopes = ROLE_SCOPES.get(user.role, frozenset())
    return Actor(kind="user", scopes=scopes, user=user)


def authenticate(db: Session, request: Request, token: str) -> Actor:
    if token.startswith("dce_"):
        return _key_actor(db, request, token)
    return _user_actor(db, request, token)
