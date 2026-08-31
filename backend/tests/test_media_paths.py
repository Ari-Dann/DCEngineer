from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from app.config import get_settings
from app.database import SessionLocal
from app.media_paths import (
    file_extension,
    format_rack_segment,
    format_row_segment,
    hierarchy_key,
    sanitize_segment,
    timestamp_filename,
)
from app.models import Attachment
from app.storage import LocalStorage, get_storage, new_key

JPEG = b"\xff\xd8fakejpeg"
FIXED = datetime(2026, 8, 31, 9, 24, 0, tzinfo=timezone.utc)
STAMP = "2026-08-31-09-24-00"


def _files_root() -> Path:
    return Path(get_settings().storage_local_path)


def _key(attachment_id: int) -> str:
    with SessionLocal() as db:
        row = db.get(Attachment, attachment_id)
        assert row is not None
        return row.storage_key


def _upload(client, auth, entity_type, entity_id, filename="photo.jpg", body=JPEG):
    res = client.post(
        "/api/attachments",
        headers=auth,
        data={"entity_type": entity_type, "entity_id": str(entity_id)},
        files={"file": (filename, BytesIO(body), "image/jpeg")},
    )
    assert res.status_code == 201, res.text
    return res.json()


def _project(client, auth, name):
    res = client.post("/api/projects", headers=auth, json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def _area(client, auth, pid, name="Staging"):
    res = client.post(f"/api/projects/{pid}/areas", headers=auth, json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def _row(client, auth, pid, name, area_id=None):
    body = {"name": name}
    if area_id is not None:
        body["area_id"] = area_id
    res = client.post(f"/api/projects/{pid}/rows", headers=auth, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _rack(client, auth, pid, name, area_id=None, row_id=None):
    body = {"name": name, "ru_height": 42}
    if area_id is not None:
        body["area_id"] = area_id
    if row_id is not None:
        body["row_id"] = row_id
    res = client.post(f"/api/projects/{pid}/racks", headers=auth, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _device(client, auth, pid, name="leaf", rack_id=None, ru_start=None):
    body = {"name": name}
    if rack_id is not None:
        body["rack_id"] = rack_id
    if ru_start is not None:
        body["ru_start"] = ru_start
        body["ru_end"] = ru_start
    res = client.post(f"/api/projects/{pid}/devices", headers=auth, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def test_row_and_rack_folder_names():
    assert format_row_segment("3") == "A03"
    assert format_row_segment("Row 3") == "A03"
    assert format_row_segment("A3") == "A03"
    assert format_row_segment("A03") == "A03"
    assert format_row_segment("A12") == "A12"
    assert format_row_segment("Cold Aisle") == "Cold Aisle"
    assert format_rack_segment("5") == "R05"
    assert format_rack_segment("Rack 5") == "R05"
    assert format_rack_segment("R05") == "R05"
    assert format_rack_segment("A01") == "R01"
    assert format_rack_segment("CAB") == "CAB"


def test_sanitize_and_extension():
    assert ".." not in sanitize_segment("../etc/passwd")
    assert ".." not in sanitize_segment("..")
    assert sanitize_segment("Test1") == "Test1"
    assert sanitize_segment("Hall A") == "Hall A"
    assert "/" not in sanitize_segment("Test1/../evil")
    assert file_extension("faceplate.JPG") == ".jpg"
    assert file_extension("clip.webm") == ".webm"
    assert file_extension("../../etc/passwd.jpg") == ".jpg"


def test_timestamp_filename_format_and_tz(monkeypatch):
    name = timestamp_filename("shot.PNG", now=FIXED)
    assert name == f"{STAMP}.png"
    monkeypatch.setattr("app.media_paths.get_settings", lambda: type("S", (), {"tz": "America/New_York"})())
    eastern = timestamp_filename("x.jpg", now=FIXED)
    assert eastern == "2026-08-31-05-24-00.jpg"


def test_storage_still_rejects_path_escape(tmp_path):
    storage = LocalStorage(str(tmp_path))
    try:
        storage.put("ok/../../secret", b"x")
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_device_capture_uses_full_hierarchy(client, auth):
    project = _project(client, auth, "Test1")
    area = _area(client, auth, project["id"], "Staging")
    row = _row(client, auth, project["id"], "3", area["id"])
    rack = _rack(client, auth, project["id"], "5", area["id"], row["id"])
    device = _device(client, auth, project["id"], "leaf", rack["id"], ru_start=42)
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        att = _upload(client, auth, "device", device["id"])
    key = _key(att["id"])
    assert key == f"Test1/Staging/A03/R05/RU42/{STAMP}.jpg"
    assert (_files_root() / key).read_bytes() == JPEG
    dl = client.get(f"/api/attachments/{att['id']}/download", headers=auth)
    assert dl.status_code == 200
    assert dl.content == JPEG


def test_area_row_rack_and_project_depths(client, auth):
    project = _project(client, auth, "DepthSite")
    area = _area(client, auth, project["id"], "Staging")
    row = _row(client, auth, project["id"], "Row 3", area["id"])
    rack = _rack(client, auth, project["id"], "Rack 5", area["id"], row["id"])
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        project_att = _upload(client, auth, "project", project["id"])
        area_att = _upload(client, auth, "area", area["id"])
        row_att = _upload(client, auth, "row", row["id"])
        aisle_att = _upload(client, auth, "aisle_row", row["id"], filename="aisle.png")
        rack_att = _upload(client, auth, "rack", rack["id"])
    assert _key(project_att["id"]) == f"DepthSite/{STAMP}.jpg"
    assert _key(area_att["id"]) == f"DepthSite/Staging/{STAMP}.jpg"
    assert _key(row_att["id"]) == f"DepthSite/Staging/A03/{STAMP}.jpg"
    assert _key(aisle_att["id"]) == f"DepthSite/Staging/A03/{STAMP}.png"
    assert _key(rack_att["id"]) == f"DepthSite/Staging/A03/R05/{STAMP}.jpg"
    assert "RU" not in _key(area_att["id"])
    assert "R05" not in _key(row_att["id"])
    assert "RU" not in _key(rack_att["id"])
    for att in (project_att, area_att, row_att, rack_att):
        assert (_files_root() / _key(att["id"])).is_file()


def test_device_without_ru_stops_at_rack(client, auth):
    project = _project(client, auth, "NoRuSite")
    area = _area(client, auth, project["id"])
    row = _row(client, auth, project["id"], "A12", area["id"])
    rack = _rack(client, auth, project["id"], "A01", area["id"], row["id"])
    device = _device(client, auth, project["id"], "spare", rack["id"])
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        att = _upload(client, auth, "device", device["id"])
    key = _key(att["id"])
    assert key == f"NoRuSite/Staging/A12/R01/{STAMP}.jpg"
    assert "RU" not in key


def test_unlocated_device_stays_under_project(client, auth):
    project = _project(client, auth, "LooseGear")
    device = _device(client, auth, project["id"], "floor-spare")
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        att = _upload(client, auth, "device", device["id"])
    key = _key(att["id"])
    assert key == f"LooseGear/{STAMP}.jpg"
    assert "Unlocated" not in key
    assert "A00" not in key


def test_collision_suffix(client, auth):
    project = _project(client, auth, "Collide")
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        first = _upload(client, auth, "project", project["id"])
        second = _upload(client, auth, "project", project["id"])
        third = _upload(client, auth, "project", project["id"])
    assert _key(first["id"]) == f"Collide/{STAMP}.jpg"
    assert _key(second["id"]) == f"Collide/{STAMP}-2.jpg"
    assert _key(third["id"]) == f"Collide/{STAMP}-3.jpg"


def test_nasty_project_name_does_not_escape(client, auth):
    project = _project(client, auth, "Test1/../evil")
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        att = _upload(client, auth, "project", project["id"])
    key = _key(att["id"])
    assert ".." not in key.split("/")
    assert (_files_root() / key).is_file()
    storage = get_storage()
    assert storage.exists(key)


def test_vision_clip_uses_session_rack_depth(client, auth):
    project = _project(client, auth, "VisionPath")
    area = _area(client, auth, project["id"], "Staging")
    row = _row(client, auth, project["id"], "3", area["id"])
    rack = _rack(client, auth, project["id"], "5", area["id"], row["id"])
    session = client.post(
        "/api/vision/sessions",
        headers=auth,
        json={
            "project_id": project["id"],
            "area_id": area["id"],
            "row_id": row["id"],
            "rack_id": rack["id"],
            "shot_kind": "rack_face",
        },
    )
    assert session.status_code == 201, session.text
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        clip = client.post(
            f"/api/vision/sessions/{session.json()['id']}/clips",
            headers=auth,
            data={"kind": "rack_face", "source": "upload"},
            files={"file": ("clip.jpg", BytesIO(JPEG), "image/jpeg")},
        )
    assert clip.status_code == 201, clip.text
    key = _key(clip.json()["attachment_id"])
    assert key == f"VisionPath/Staging/A03/R05/{STAMP}.jpg"
    assert "RU" not in key
    assert (_files_root() / key).read_bytes() == JPEG
    dl = client.get(f"/api/attachments/{clip.json()['attachment_id']}/download", headers=auth)
    assert dl.status_code == 200
    assert dl.content == JPEG


def test_vision_area_only_clip_omits_row_rack(client, auth):
    project = _project(client, auth, "VisionArea")
    area = _area(client, auth, project["id"], "Staging")
    session = client.post(
        "/api/vision/sessions",
        headers=auth,
        json={"project_id": project["id"], "area_id": area["id"], "shot_kind": "aisle_wide"},
    ).json()
    with patch("app.media_paths.now_in_app_tz", return_value=FIXED):
        clip = client.post(
            f"/api/vision/sessions/{session['id']}/clips",
            headers=auth,
            data={"kind": "aisle_wide", "source": "upload"},
            files={"file": ("aisle.jpg", BytesIO(JPEG), "image/jpeg")},
        )
    assert clip.status_code == 201, clip.text
    key = _key(clip.json()["attachment_id"])
    assert key == f"VisionArea/Staging/{STAMP}.jpg"
    assert "A03" not in key
    assert "R05" not in key


def test_legacy_uuid_key_still_downloads(client, auth):
    key = new_key("legacy.jpg")
    get_storage().put(key, b"\xff\xd8legacy")
    with SessionLocal() as db:
        row = Attachment(
            entity_type="project",
            entity_id=1,
            filename="legacy.jpg",
            content_type="image/jpeg",
            size=9,
            storage_key=key,
        )
        db.add(row)
        db.commit()
        aid = row.id
    dl = client.get(f"/api/attachments/{aid}/download", headers=auth)
    assert dl.status_code == 200
    assert dl.content == b"\xff\xd8legacy"
    assert "/" in key
    assert key.split("/")[0] != "Test1"


def test_hierarchy_key_direct_with_frozen_now(client, auth):
    project = _project(client, auth, "DirectKey")
    area = _area(client, auth, project["id"], "Staging")
    row = _row(client, auth, project["id"], "3", area["id"])
    rack = _rack(client, auth, project["id"], "5", area["id"], row["id"])
    device = _device(client, auth, project["id"], "leaf", rack["id"], ru_start=42)
    with SessionLocal() as db:
        key = hierarchy_key(db, "device", device["id"], "face.jpg", now=FIXED)
    assert key == f"DirectKey/Staging/A03/R05/RU42/{STAMP}.jpg"
