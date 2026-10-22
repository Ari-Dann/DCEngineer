from __future__ import annotations

from typing import Any

import httpx


class DCEError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


class DCEClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.http = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self.http.close()

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        headers.update(kwargs.pop("headers", {}) or {})
        response = self.http.request(method, f"{self.base_url}{path}", headers=headers, **kwargs)
        if response.status_code >= 400:
            detail: Any = response.text
            try:
                body = response.json()
                detail = body.get("detail", detail)
            except Exception:
                pass
            if isinstance(detail, list):
                detail = "; ".join(str(item) for item in detail)
            raise DCEError(response.status_code, str(detail))
        if not response.content:
            return None
        return response.json()

    def get(self, path: str, params: dict | None = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, payload: dict) -> Any:
        return self.request("POST", path, json=payload)
