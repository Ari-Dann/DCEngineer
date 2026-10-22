"""Record every API-key call after the response status is known."""

from __future__ import annotations

import logging

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.database import SessionLocal
from app.models import AuditLog

log = logging.getLogger("dcengineer.audit")


def _header(scope: Scope, name: str) -> str:
    target = name.lower().encode()
    for key, value in scope.get("headers") or []:
        if key.lower() == target:
            return value.decode("latin1")
    return ""


class ApiKeyAuditMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        auth = _header(scope, "authorization")
        token = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else ""
        track = token.startswith("dce_") and path.startswith("/api/") and path != "/api/health"
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            if track:
                _write(scope, token, status_code)


def _write(scope: Scope, token: str, status_code: int) -> None:
    state = scope.get("state") or {}
    prefix = (state.get("api_key_prefix") or token[:16])[:32]
    method = str(scope.get("method") or "")[:16]
    path = str(scope.get("path") or "")[:512]
    db = SessionLocal()
    try:
        db.add(
            AuditLog(
                user_id=state.get("actor_user_id"),
                api_key_id=state.get("api_key_id"),
                action="api",
                entity_type="http",
                detail=f"{method} {path} key={prefix} status={status_code}",
                http_method=method,
                http_path=path,
                http_status=status_code,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        log.exception("API key audit failed")
    finally:
        db.close()
