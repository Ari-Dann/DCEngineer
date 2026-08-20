from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="dce-test-"))
(TMP / "files").mkdir()
(TMP / "backups").mkdir()
(TMP / "static").mkdir()

os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{TMP}/test.db",
        "JWT_SECRET": "test-secret-test-secret-test-secret-test",
        "STORAGE_BACKEND": "local",
        "STORAGE_LOCAL_PATH": str(TMP / "files"),
        "BACKUP_PATH": str(TMP / "backups"),
        "BACKUP_ENABLED": "false",
        "STATIC_DIR": str(TMP / "static"),
        "BOOTSTRAP_ADMIN_USER": "admin",
        "BOOTSTRAP_ADMIN_PASSWORD": "adminpass1",
        "BOOTSTRAP_ADMIN_EMAIL": "admin@example.test",
        "CORS_ORIGINS": "*",
        "DCE_PUBLIC_URL": "http://test",
    }
)

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

get_settings.cache_clear()

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth(client: TestClient) -> dict[str, str]:
    res = client.post("/api/auth/login", json={"username": "admin", "password": "adminpass1"})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
