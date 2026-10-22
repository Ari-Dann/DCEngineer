from datetime import datetime, timedelta, timezone
from io import BytesIO

from app.config import get_settings
from app.database import SessionLocal
from app.models import ApiKey


def _project(client, auth, name="API hall", **extra):
    res = client.post("/api/projects", headers=auth, json={"name": name, **extra})
    assert res.status_code == 201, res.text
    return res.json()


def _key(client, auth, scopes, name="integrator", days=30):
    res = client.post(
        "/api/api-keys",
        headers=auth,
        json={"name": name, "scopes": scopes, "expires_in_days": days},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body, {"Authorization": f"Bearer {body['token']}"}


def test_api_key_is_shown_once_and_lists_without_the_secret(client, auth):
    created, headers = _key(client, auth, ["inventory:read"], name="once")
    assert created["token"].startswith("dce_live_")
    assert created["prefix"] == created["token"][:16]
    listed = client.get("/api/api-keys", headers=auth)
    assert listed.status_code == 200
    row = next(item for item in listed.json() if item["id"] == created["id"])
    assert "token" not in row
    assert row["scopes"] == ["inventory:read"]
    assert row["revoked"] is False
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["role"] == "integration"
    assert me.json()["api_key_id"] == created["id"]
    assert "inventory:read" in me.json()["scopes"]


def test_read_key_cannot_write_delete_or_download(client, auth):
    project = _project(client, auth, "Read only")
    pid = project["id"]
    device = client.post(
        f"/api/projects/{pid}/devices",
        headers=auth,
        json={"name": "edge", "serial": "SN-READ", "management_ip": "10.0.0.5"},
    ).json()
    photo = client.post(
        "/api/attachments",
        headers=auth,
        data={"entity_type": "device", "entity_id": str(device["id"])},
        files={"file": ("face.jpg", BytesIO(b"jpeg-bytes"), "image/jpeg")},
    )
    assert photo.status_code == 201, photo.text
    _, headers = _key(client, auth, ["inventory:read", "ops:read"], name="reader")
    listed = client.get("/api/projects", headers=headers)
    assert listed.status_code == 200
    assert any(item["id"] == pid for item in listed.json())
    assert "X-Total-Count" in listed.headers
    blocked = client.post(f"/api/projects/{pid}/devices", headers=headers, json={"name": "nope"})
    assert blocked.status_code == 403
    deleted = client.delete(f"/api/projects/{pid}/devices/{device['id']}", headers=headers)
    assert deleted.status_code == 403
    download = client.get(f"/api/attachments/{photo.json()['id']}/download", headers=headers)
    assert download.status_code == 403
    users = client.get("/api/users", headers=headers)
    assert users.status_code == 403
    exported = client.get(f"/api/projects/{pid}/export.xlsx", headers=headers)
    assert exported.status_code == 403


def test_upsert_matches_serial_and_refuses_to_move_racks(client, auth):
    project = _project(client, auth, "Upsert")
    pid = project["id"]
    rack_a = client.post(f"/api/projects/{pid}/racks", headers=auth, json={"name": "A01"}).json()
    rack_b = client.post(f"/api/projects/{pid}/racks", headers=auth, json={"name": "A02"}).json()
    _, headers = _key(client, auth, ["inventory:read", "inventory:write"], name="writer")
    first = client.post(
        f"/api/projects/{pid}/devices/upsert",
        headers=headers,
        json={"name": "core", "serial": "SN-UP", "rack_id": rack_a["id"], "vendor": "Cisco", "notes": "keep"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["action"] == "created"
    device_id = first.json()["device"]["id"]
    second = client.post(
        f"/api/projects/{pid}/devices/upsert",
        headers=headers,
        json={"name": "core-renamed", "serial": "SN-UP", "notes": ""},
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["action"] == "updated"
    assert body["device"]["id"] == device_id
    assert body["device"]["name"] == "core-renamed"
    assert body["device"]["notes"] == "keep"
    assert body["device"]["vendor"] == "Cisco"
    moved = client.post(
        f"/api/projects/{pid}/devices/upsert",
        headers=headers,
        json={"serial": "SN-UP", "rack_id": rack_b["id"]},
    )
    assert moved.status_code == 409
    still = client.get(f"/api/projects/{pid}/devices/{device_id}", headers=headers).json()
    assert still["rack_id"] == rack_a["id"]


def test_external_id_upsert_and_conflict(client, auth):
    project = _project(client, auth, "External")
    pid = project["id"]
    _, headers = _key(client, auth, ["inventory:write", "inventory:read"], name="cmdb")
    created = client.post(
        f"/api/projects/{pid}/devices/upsert",
        headers=headers,
        json={"name": "pdu-a", "external_id": "nb-9", "source": "netbox"},
    )
    assert created.status_code == 200, created.text
    again = client.post(
        f"/api/projects/{pid}/devices/upsert",
        headers=headers,
        json={"external_id": "nb-9", "source": "netbox", "model": "AP7900"},
    )
    assert again.json()["action"] == "updated"
    assert again.json()["device"]["id"] == created.json()["device"]["id"]
    assert again.json()["device"]["model"] == "AP7900"
    clash = client.post(
        f"/api/projects/{pid}/devices",
        headers=headers,
        json={"name": "other", "external_id": "nb-9", "source": "netbox"},
    )
    assert clash.status_code == 409
    missing = client.post(
        f"/api/projects/{pid}/devices/upsert",
        headers=headers,
        json={"name": "no-match"},
    )
    assert missing.status_code == 400


def test_rack_upsert_by_external_id(client, auth):
    project = _project(client, auth, "Racks")
    pid = project["id"]
    _, headers = _key(client, auth, ["inventory:write"], name="racks")
    first = client.post(
        f"/api/projects/{pid}/racks/upsert",
        headers=headers,
        json={"name": "B01", "external_id": "rack-1", "source": "netbox", "ru_height": 48},
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/projects/{pid}/racks/upsert",
        headers=headers,
        json={"external_id": "rack-1", "source": "netbox", "notes": "cold aisle"},
    )
    assert second.json()["action"] == "updated"
    assert second.json()["rack"]["id"] == first.json()["rack"]["id"]
    assert second.json()["rack"]["notes"] == "cold aisle"
    assert second.json()["rack"]["ru_height"] == 48


def test_unknown_scope_rejected_and_revoked_key_stops_working(client, auth):
    bad = client.post("/api/api-keys", headers=auth, json={"name": "bad", "scopes": ["users"]})
    assert bad.status_code == 400
    created, headers = _key(client, auth, ["inventory:read"], name="temp")
    assert client.get("/api/projects", headers=headers).status_code == 200
    revoked = client.delete(f"/api/api-keys/{created['id']}", headers=auth)
    assert revoked.status_code == 200
    assert client.get("/api/projects", headers=headers).status_code == 401


def test_expired_key_is_rejected(client, auth):
    created, headers = _key(client, auth, ["inventory:read"], name="old", days=1)
    db = SessionLocal()
    try:
        row = db.get(ApiKey, created["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        db.commit()
    finally:
        db.close()
    assert client.get("/api/projects", headers=headers).status_code == 401


def test_device_page_headers(client, auth):
    project = _project(client, auth, "Pages")
    pid = project["id"]
    for name in ("a", "b", "c"):
        assert client.post(f"/api/projects/{pid}/devices", headers=auth, json={"name": name}).status_code == 201
    page = client.get(f"/api/projects/{pid}/devices", headers=auth, params={"limit": 1, "offset": 1})
    assert page.status_code == 200
    assert len(page.json()) == 1
    assert page.headers["X-Total-Count"] == "3"
    assert page.headers["X-Limit"] == "1"
    assert page.headers["X-Offset"] == "1"


def test_api_key_calls_are_audited(client, auth):
    _, headers = _key(client, auth, ["inventory:read"], name="audited")
    assert client.get("/api/projects", headers=headers).status_code == 200
    denied = client.get("/api/projects", headers={"Authorization": "Bearer dce_live_not-a-real-key"})
    assert denied.status_code == 401
    audit = client.get("/api/audit", headers=auth, params={"limit": 50})
    assert audit.status_code == 200
    paths = [(row["http_method"], row["http_path"], row["http_status"]) for row in audit.json()]
    assert ("GET", "/api/projects", 200) in paths
    assert ("GET", "/api/projects", 401) in paths
    assert client.get("/api/audit", headers=headers).status_code == 403


def test_capture_restricted_follows_the_project(client, auth):
    project = _project(client, auth, "Restricted hall", restricted=True, restriction_type="EMSS")
    pid = project["id"]
    device = client.post(f"/api/projects/{pid}/devices", headers=auth, json={"name": "secret"}).json()
    assert device["restricted"] is False
    assert device["capture_restricted"] is True


def test_api_key_rate_limit(client, auth):
    _, headers = _key(client, auth, ["inventory:read"], name="busy")
    settings = get_settings()
    previous = settings.api_key_rpm
    settings.api_key_rpm = 2
    try:
        assert client.get("/api/projects", headers=headers).status_code == 200
        assert client.get("/api/projects", headers=headers).status_code == 200
        blocked = client.get("/api/projects", headers=headers)
        assert blocked.status_code == 429
    finally:
        settings.api_key_rpm = previous


def test_open_work_filter(client, auth):
    project = _project(client, auth, "Work")
    pid = project["id"]
    open_row = client.post("/api/incidents", headers=auth, json={"title": "open fan", "project_id": pid, "status": "open"}).json()
    client.post("/api/incidents", headers=auth, json={"title": "done", "project_id": pid, "status": "resolved"})
    _, headers = _key(client, auth, ["ops:read"], name="ops")
    rows = client.get("/api/incidents", headers=headers, params={"project_id": pid, "open_only": "true"})
    assert rows.status_code == 200
    titles = {row["title"] for row in rows.json()}
    assert open_row["title"] in titles
    assert "done" not in titles
    orders = client.post(
        "/api/work-orders",
        headers=auth,
        json={"title": "swap psu", "project_id": pid, "status": "scheduled"},
    )
    assert orders.status_code == 201
    client.post("/api/work-orders", headers=auth, json={"title": "old", "project_id": pid, "status": "complete"})
    open_orders = client.get("/api/work-orders", headers=headers, params={"project_id": pid, "open_only": "true"})
    order_titles = {row["title"] for row in open_orders.json()}
    assert "swap psu" in order_titles
    assert "old" not in order_titles
