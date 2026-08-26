from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import (
    ROLES,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    refresh_is_valid,
    revoke_refresh,
    verify_password,
)
from app.database import get_db
from app.deps import AdminUser, get_current_user
from app.models import AuditLog, User
from app.schemas import LoginIn, RefreshIn, TokenPair, UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/api/auth", tags=["auth"])
users_router = APIRouter(prefix="/api/users", tags=["users"])


def audit(db: Session, user_id: Optional[int], action: str, entity_type: str = "", entity_id: Optional[int] = None, detail: str = "") -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=detail,
        )
    )


@router.post("/login", response_model=TokenPair)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not verify_password(body.password, user.hashed_password) or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    access = create_access_token(user)
    refresh = create_refresh_token(db, user)
    audit(db, user.id, "login", "user", user.id)
    db.commit()
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        role=user.role,
        username=user.username,
        user_id=user.id,
    )


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    payload = decode_token(body.refresh_token, "refresh")
    row = refresh_is_valid(db, body.refresh_token)
    if not row:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token revoked")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive")
    row.revoked = True
    db.commit()
    return TokenPair(
        access_token=create_access_token(user),
        refresh_token=create_refresh_token(db, user),
        role=user.role,
        username=user.username,
        user_id=user.id,
    )


@router.post("/logout")
def logout(body: RefreshIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    revoke_refresh(db, body.refresh_token)
    audit(db, user.id, "logout", "user", user.id)
    db.commit()
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@users_router.get("", response_model=list[UserOut])
def list_users(_: User = Depends(AdminUser), db: Session = Depends(get_db)):
    return db.query(User).order_by(User.username).all()


@users_router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, admin: User = Depends(AdminUser), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(400, f"role must be one of {ROLES}")
    if db.query(User).filter((User.username == body.username) | (User.email == body.email)).first():
        raise HTTPException(409, "Username or email already exists")
    user = User(
        username=body.username,
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.flush()
    audit(db, admin.id, "create", "user", user.id, user.username)
    db.commit()
    db.refresh(user)
    return user


@users_router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, admin: User = Depends(AdminUser), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    data = body.model_dump(exclude_unset=True)
    password = data.pop("password", None)
    if password:
        if len(password) < 8:
            raise HTTPException(400, "Password must be at least 8 characters")
        user.hashed_password = hash_password(password)
    if data.get("role") and data["role"] not in ROLES:
        raise HTTPException(400, f"role must be one of {ROLES}")
    if data.get("username"):
        clash = db.query(User).filter(User.username == data["username"], User.id != user_id).first()
        if clash:
            raise HTTPException(409, "Username already exists")
    if data.get("email"):
        clash = db.query(User).filter(User.email == data["email"], User.id != user_id).first()
        if clash:
            raise HTTPException(409, "Email already exists")
    for key, value in data.items():
        setattr(user, key, value)
    audit(db, admin.id, "update", "user", user.id)
    db.commit()
    db.refresh(user)
    return user
