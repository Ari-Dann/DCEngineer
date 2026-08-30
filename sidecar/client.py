from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

log = logging.getLogger("dce-sidecar")


class DCEClient:
    def __init__(self, base_url: str, username: str, password: str, timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout
        self.access_token = ""
        self.refresh_token = ""
        self.http = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self.http.close()

    def _headers(self) -> dict[str, str]:
        if not self.access_token:
            return {}
        return {"Authorization": f"Bearer {self.access_token}"}

    def login(self) -> None:
        res = self.http.post(
            f"{self.base_url}/api/auth/login",
            json={"username": self.username, "password": self.password},
        )
        res.raise_for_status()
        body = res.json()
        self.access_token = body["access_token"]
        self.refresh_token = body.get("refresh_token") or ""
        log.info("Logged in to DCEngineer as %s", self.username)

    def _refresh(self) -> bool:
        if not self.refresh_token:
            return False
        res = self.http.post(
            f"{self.base_url}/api/auth/refresh",
            json={"refresh_token": self.refresh_token},
        )
        if not res.is_success:
            return False
        body = res.json()
        self.access_token = body["access_token"]
        self.refresh_token = body.get("refresh_token") or self.refresh_token
        return True

    def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        kwargs.setdefault("headers", {})
        kwargs["headers"] = {**self._headers(), **kwargs["headers"]}
        res = self.http.request(method, url, **kwargs)
        if res.status_code == 401:
            if self._refresh() or (self.login() or True):
                kwargs["headers"] = {**self._headers(), **{k: v for k, v in kwargs.get("headers", {}).items() if k != "Authorization"}}
                kwargs["headers"]["Authorization"] = f"Bearer {self.access_token}"
                res = self.http.request(method, url, **kwargs)
        return res

    def json(self, method: str, path: str, **kwargs: Any) -> Any:
        res = self.request(method, path, **kwargs)
        res.raise_for_status()
        if res.status_code == 204 or not res.content:
            return None
        return res.json()

    def jobs(self) -> list[dict]:
        return self.json("GET", "/api/vision/jobs") or []

    def session(self, session_id: int) -> dict:
        return self.json("GET", f"/api/vision/sessions/{session_id}")

    def claim(self, session_id: int) -> dict:
        return self.json("POST", f"/api/vision/sessions/{session_id}/claim")

    def set_status(
        self,
        session_id: int,
        status: str,
        error_detail: str = "",
        restricted_blocked: Optional[bool] = None,
        layout: Any = None,
    ) -> dict:
        body: dict[str, Any] = {"status": status, "error_detail": error_detail}
        if restricted_blocked is not None:
            body["restricted_blocked"] = restricted_blocked
        if layout is not None:
            body["layout"] = layout
        return self.json("PATCH", f"/api/vision/sessions/{session_id}/status", json=body)

    def download(self, attachment_id: int) -> tuple[bytes, str, str]:
        res = self.request("GET", f"/api/attachments/{attachment_id}/download")
        res.raise_for_status()
        content_type = res.headers.get("content-type") or "application/octet-stream"
        disposition = res.headers.get("content-disposition") or ""
        filename = f"attachment-{attachment_id}"
        if "filename=" in disposition:
            filename = disposition.split("filename=", 1)[1].strip().strip('"')
        return res.content, content_type, filename

    def upload_clip(
        self,
        session_id: int,
        data: bytes,
        filename: str,
        content_type: str,
        kind: str = "serial_frame",
        source: str = "video_frame",
        source_attachment_id: Optional[int] = None,
        timestamp_ms: Optional[int] = None,
        notes: str = "",
    ) -> dict:
        files = {"file": (filename, data, content_type)}
        form: dict[str, Any] = {"kind": kind, "source": source, "notes": notes}
        if source_attachment_id is not None:
            form["source_attachment_id"] = str(source_attachment_id)
        if timestamp_ms is not None:
            form["timestamp_ms"] = str(timestamp_ms)
        res = self.request("POST", f"/api/vision/sessions/{session_id}/clips", files=files, data=form)
        res.raise_for_status()
        return res.json()

    def post_proposals(self, session_id: int, payload: dict) -> list[dict]:
        return self.json("POST", f"/api/vision/sessions/{session_id}/proposals", json=payload) or []
