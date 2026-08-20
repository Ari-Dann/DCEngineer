from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any, Optional
from uuid import uuid4

import bcrypt
import jwt
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import RefreshToken, User

ROLES = ("admin", "engineer", "remote", "viewer")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user: User) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user.id),
        "usr": user.username,
        "role": user.role,
        "typ": "access",
        "exp": _now() + timedelta(minutes=settings.jwt_access_minutes),
        "iat": _now(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(db: Session, user: User) -> str:
    settings = get_settings()
    exp = _now() + timedelta(days=settings.jwt_refresh_days)
    payload = {
        "sub": str(user.id),
        "typ": "refresh",
        "jti": uuid4().hex,
        "exp": exp,
        "iat": _now(),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=sha256(token.encode()).hexdigest(),
            expires_at=exp,
        )
    )
    db.commit()
    return token


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    if payload.get("typ") != expected_type:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return payload


def revoke_refresh(db: Session, token: str) -> None:
    digest = sha256(token.encode()).hexdigest()
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == digest).first()
    if row:
        row.revoked = True
        db.commit()


def refresh_is_valid(db: Session, token: str) -> Optional[RefreshToken]:
    digest = sha256(token.encode()).hexdigest()
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == digest).first()
    if not row or row.revoked:
        return None
    exp = row.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < _now():
        return None
    return row
