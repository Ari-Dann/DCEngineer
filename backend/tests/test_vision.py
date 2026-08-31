from io import BytesIO

from app.vision_policy import blank_unreadable, restriction_reasons
from app.database import SessionLocal
from app.models import Area, VisionSession


JPEG = (b"\xff\xd8fakejpeg", "photo.jpg", "image/jpeg")


def _login(client, username, password):
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _project(client, auth, name="Vision Site"):
    project = client.post(
        "/api/projects",
        headers=auth,
        json={"name": name, "customer": "Acme", "site_name": "DC1", "revision": "A"},
    )
    assert project.status_code == 201, project.text
    return project.json()


def _area(client, auth, pid, name="Hall A", restricted=False, photography_allowed=True):
    area = client.post(
        f"/api/projects/{pid}/areas",
        headers=auth,
        json={"name": name, "in_scope": True, "restricted": restricted, "photography_allowed": photography_allowed},
    )
    assert area.status_code == 201, area.text
    return area.json()


def _rack(client, auth, pid, aid, name="A01"):
    rack = client.post(
        f"/api/projects/{pid}/racks",
        headers=auth,
        json={"name": name, "area_id": aid, "row_label": "A", "position": "01", "ru_height": 42},
    )
    assert rack.status_code == 201, rack.text
    return rack.json()


def _sidecar(client, auth, username="vision-sidecar"):
    created = client.post(
        "/api/users",
        headers=auth,
        json={
            "username": username,
            "email": f"{username}@example.test",
            "password": "sidecarpass1",
            "full_name": "Vision worker",
            "role": "sidecar",
        },
    )
    if created.status_code == 409:
        return _login(client, username, "sidecarpass1")
    assert created.status_code == 201, created.text
    return _login(client, username, "sidecarpass1")


def _session(client, auth, pid, **kwargs):
    body = {"project_id": pid, "shot_kind": "rack_face", **kwargs}
    res = client.post("/api/vision/sessions", headers=auth, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _clip(client, headers, sid, kind="rack_face", filename="photo.jpg", restricted=False):
    res = client.post(
        f"/api/vision/sessions/{sid}/clips",
        headers=headers,
        data={"kind": kind, "source": "upload", "photography_restricted": "true" if restricted else "false"},
        files={"file": (filename, BytesIO(JPEG[0]), "image/jpeg")},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_blank_unreadable_never_keeps_guess():
    cleaned = blank_unreadable(
        {"name": "sw-1", "serial": "FCW-GUESSED", "model": "C9300", "vendor": "Cisco", "ru_start": 40},
        ["serial", "model"],
    )
    assert cleaned["serial"] == ""
    assert cleaned["model"] == ""
    assert cleaned["name"] == "sw-1"
    assert cleaned["ru_start"] == 40


def test_vision_sidecar_cannot_write_devices(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-nodev")
    project = _project(client, auth, "No Device Write")
    denied = client.post(
        f"/api/projects/{project['id']}/devices",
        headers=sidecar,
        json={"name": "should-fail"},
    )
    assert denied.status_code == 403


def test_restricted_area_refuses_analyze_and_jobs(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-restrict")
    project = _project(client, auth, "Restricted Hall")
    area = _area(client, auth, project["id"], name="Cage 7", restricted=True, photography_allowed=False)
    session = _session(client, auth, project["id"], area_id=area["id"], shot_kind="aisle_wide")
    _clip(client, auth, session["id"], kind="aisle_wide")
    analyzed = client.post(f"/api/vision/sessions/{session['id']}/analyze", headers=auth)
    assert analyzed.status_code == 200, analyzed.text
    body = analyzed.json()
    assert body["status"] == "refused"
    assert body["restricted_blocked"] is True
    assert "not sent" in body["error_detail"].lower()
    jobs = client.get("/api/vision/jobs", headers=sidecar)
    assert jobs.status_code == 200
    assert all(j["id"] != session["id"] for j in jobs.json())
    proposals = client.post(
        f"/api/vision/sessions/{session['id']}/proposals",
        headers=sidecar,
        json={
            "model": "claude-test",
            "prompt_text": "should not store",
            "raw_extraction": {"devices": [{"name": "guess"}]},
            "proposals": [{"name": "guess", "serial": "NOPE"}],
        },
    )
    assert proposals.status_code == 403


def test_restricted_photo_flag_blocks_even_in_open_area(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-photoflag")
    project = _project(client, auth, "Open Hall")
    area = _area(client, auth, project["id"], restricted=False)
    session = _session(client, auth, project["id"], area_id=area["id"])
    _clip(client, auth, session["id"], restricted=True)
    analyzed = client.post(f"/api/vision/sessions/{session['id']}/analyze", headers=auth)
    assert analyzed.json()["status"] == "refused"
    jobs = client.get("/api/vision/jobs", headers=sidecar).json()
    assert all(j["id"] != session["id"] for j in jobs)


def test_vision_proposal_staging_accept_reject_and_audit(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-happy")
    project = _project(client, auth, "Aisle Capture")
    area = _area(client, auth, project["id"])
    rack = _rack(client, auth, project["id"], area["id"])
    session = _session(
        client,
        auth,
        project["id"],
        area_id=area["id"],
        rack_id=rack["id"],
        shot_kind="device_close",
        notes="rear serials",
    )
    clip = _clip(client, auth, session["id"], kind="device_close", filename="serial.jpg")
    frame = client.post(
        f"/api/vision/sessions/{session['id']}/clips",
        headers=sidecar,
        data={
            "kind": "serial_frame",
            "source": "video_frame",
            "source_attachment_id": str(clip["attachment_id"]),
            "timestamp_ms": "1200",
            "notes": "serial frame",
        },
        files={"file": ("serial-frame.jpg", BytesIO(JPEG[0]), "image/jpeg")},
    )
    assert frame.status_code == 201, frame.text
    frame_id = frame.json()["attachment_id"]

    analyzed = client.post(f"/api/vision/sessions/{session['id']}/analyze", headers=auth)
    assert analyzed.json()["status"] == "queued"
    jobs = client.get("/api/vision/jobs", headers=sidecar).json()
    assert any(j["id"] == session["id"] for j in jobs)

    claimed = client.post(f"/api/vision/sessions/{session['id']}/claim", headers=sidecar)
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["status"] == "running"
    downloaded = client.get(f"/api/attachments/{clip['attachment_id']}/download", headers=sidecar)
    assert downloaded.status_code == 200
    assert downloaded.content.startswith(b"\xff\xd8")

    raw = {
        "devices": [
            {
                "name": "sw-a01",
                "vendor": "Cisco",
                "model": "C9300",
                "serial": "FCW-SHOULD-BLANK",
                "unreadable_fields": ["serial"],
            },
            {"name": "", "vendor": "", "unreadable_fields": ["name", "vendor", "serial"]},
        ]
    }
    prompt = "Never guess. Leave unreadables blank."
    created = client.post(
        f"/api/vision/sessions/{session['id']}/proposals",
        headers=sidecar,
        json={
            "model": "claude-test-1",
            "prompt_text": prompt,
            "raw_extraction": raw,
            "layout": {"rows": [{"name": "A12"}]},
            "media_sent_attachment_ids": [clip["attachment_id"], frame_id],
            "proposals": [
                {
                    "name": "sw-a01",
                    "vendor": "Cisco",
                    "model": "C9300",
                    "serial": "FCW-SHOULD-BLANK",
                    "unreadable_fields": ["serial"],
                    "evidence_attachment_ids": [frame_id],
                    "ru_start": 41,
                    "ru_end": 42,
                },
                {
                    "name": "",
                    "unreadable_fields": ["name", "serial"],
                    "evidence_attachment_ids": [clip["attachment_id"]],
                },
            ],
        },
    )
    assert created.status_code == 201, created.text
    proposals = created.json()
    assert proposals[0]["serial"] == ""
    assert proposals[0]["name"] == "sw-a01"
    assert proposals[0]["prompt_text"] == prompt
    assert proposals[0]["extractor_model"] == "claude-test-1"
    assert proposals[0]["model"] == "C9300"
    assert proposals[0]["raw_extraction"]["devices"][0]["serial"] == "FCW-SHOULD-BLANK"
    assert proposals[0]["status"] == "pending"
    assert frame_id in proposals[0]["evidence_attachment_ids"]

    detail = client.get(f"/api/vision/sessions/{session['id']}", headers=auth).json()
    assert detail["status"] == "needs_review"
    assert detail["layout"]["rows"][0]["name"] == "A12"
    before = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert before == []

    accept_denied = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{proposals[0]['id']}/accept",
        headers=sidecar,
    )
    assert accept_denied.status_code == 403

    edited = client.patch(
        f"/api/vision/sessions/{session['id']}/proposals/{proposals[0]['id']}",
        headers=auth,
        json={"hostname": "sw-a01.site", "owner": "NetOps"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["status"] == "edited"
    assert edited.json()["hostname"] == "sw-a01.site"

    accepted = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{proposals[0]['id']}/accept",
        headers=auth,
    )
    assert accepted.status_code == 200, accepted.text
    device = accepted.json()
    assert device["name"] == "sw-a01"
    assert device["serial"] == ""
    assert device["hostname"] == "sw-a01.site"
    assert device["owner"] == "NetOps"
    assert device["discovered_via"] == "vision"
    assert device["rack_id"] == rack["id"]

    evidence = client.get(
        "/api/attachments",
        headers=auth,
        params={"entity_type": "device", "entity_id": str(device["id"])},
    ).json()
    assert any(a["id"] != clip["attachment_id"] for a in evidence) or evidence
    assert any(a["filename"] == "serial-frame.jpg" for a in evidence)
    originals = client.get(
        "/api/attachments",
        headers=auth,
        params={"entity_type": "vision_session", "entity_id": str(session["id"])},
    ).json()
    assert any(a["filename"] == "serial.jpg" for a in originals)
    assert any(a["filename"] == "serial-frame.jpg" for a in originals)

    rejected = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{proposals[1]['id']}/reject",
        headers=auth,
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert len(devices) == 1
    done = client.get(f"/api/vision/sessions/{session['id']}", headers=auth).json()
    assert done["status"] == "done"


def test_accept_requires_name(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-blankname")
    project = _project(client, auth, "Blank Name")
    session = _session(client, auth, project["id"])
    _clip(client, auth, session["id"])
    client.post(f"/api/vision/sessions/{session['id']}/analyze", headers=auth)
    created = client.post(
        f"/api/vision/sessions/{session['id']}/proposals",
        headers=sidecar,
        json={
            "model": "claude-test",
            "prompt_text": "blank",
            "raw_extraction": {"devices": [{"name": ""}]},
            "proposals": [{"name": "", "unreadable_fields": ["name"]}],
        },
    )
    pid = created.json()[0]["id"]
    res = client.post(f"/api/vision/sessions/{session['id']}/proposals/{pid}/accept", headers=auth)
    assert res.status_code == 400
    assert "name" in res.json()["detail"].lower()


def test_vision_layout_accept_creates_rows_not_devices(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-rows")
    project = _project(client, auth, "Aisle Rows")
    area = _area(client, auth, project["id"])
    session = _session(client, auth, project["id"], area_id=area["id"], shot_kind="aisle_wide")
    _clip(client, auth, session["id"], kind="aisle_wide")
    client.post(f"/api/vision/sessions/{session['id']}/analyze", headers=auth)
    posted = client.post(
        f"/api/vision/sessions/{session['id']}/proposals",
        headers=sidecar,
        json={
            "model": "claude-test",
            "prompt_text": "layout only",
            "raw_extraction": {"devices": []},
            "layout": {
                "rows": [{"name": "A12"}, {"name": "A13"}, {"name": ""}],
                "racks": [{"name": "A12-01", "row_name": "A12", "ru_height": 42}],
            },
            "proposals": [],
        },
    )
    assert posted.status_code == 201, posted.text
    denied = client.post(f"/api/vision/sessions/{session['id']}/layout/accept", headers=sidecar, json={})
    assert denied.status_code == 403
    before_devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert before_devices == []
    accepted = client.post(
        f"/api/vision/sessions/{session['id']}/layout/accept",
        headers=auth,
        json={"create_racks": True},
    )
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert [r["name"] for r in body["created"]] == ["A12", "A13"]
    assert [r["area_id"] for r in body["created"]] == [area["id"], area["id"]]
    assert [r["name"] for r in body["racks_created"]] == ["A12-01"]
    rows = client.get(f"/api/projects/{project['id']}/rows", headers=auth).json()
    assert {r["name"] for r in rows} == {"A12", "A13"}
    racks = client.get(f"/api/projects/{project['id']}/racks", headers=auth).json()
    assert any(r["name"] == "A12-01" and r["row_label"] == "A12" for r in racks)
    devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert devices == []
    again = client.post(
        f"/api/vision/sessions/{session['id']}/layout/accept",
        headers=auth,
        json={"names": ["A12", "A14"]},
    )
    assert [r["name"] for r in again.json()["created"]] == ["A14"]
    assert [r["name"] for r in again.json()["existing"]] == ["A12"]


def test_vision_layout_accept_requires_area_and_names(client, auth):
    project = _project(client, auth, "No Area Layout")
    session = _session(client, auth, project["id"], shot_kind="aisle_wide")
    missing_area = client.post(f"/api/vision/sessions/{session['id']}/layout/accept", headers=auth, json={"names": ["A01"]})
    assert missing_area.status_code == 400
    area = _area(client, auth, project["id"])
    missing_names = client.post(
        f"/api/vision/sessions/{session['id']}/layout/accept",
        headers=auth,
        json={"area_id": area["id"]},
    )
    assert missing_names.status_code == 400
    created = client.post(
        f"/api/vision/sessions/{session['id']}/layout/accept",
        headers=auth,
        json={"area_id": area["id"], "names": ["B01", "B02"]},
    )
    assert created.status_code == 200, created.text
    assert [r["name"] for r in created.json()["created"]] == ["B01", "B02"]


def test_proposal_fields_confirm_independently(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-fields")
    project = _project(client, auth, "Field Confirm")
    area = _area(client, auth, project["id"])
    session = _session(client, auth, project["id"], area_id=area["id"], shot_kind="device_close")
    _clip(client, auth, session["id"])
    client.post(f"/api/vision/sessions/{session['id']}/analyze", headers=auth)
    created = client.post(
        f"/api/vision/sessions/{session['id']}/proposals",
        headers=sidecar,
        json={
            "model": "claude-test",
            "prompt_text": "fields",
            "raw_extraction": {"devices": [{"name": "sw-1", "vendor": "Cisco", "serial": "ABC"}]},
            "proposals": [{"name": "sw-1", "vendor": "Cisco", "serial": "ABC", "model": "C9300"}],
        },
    )
    pid = created.json()[0]["id"]
    serial = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{pid}/fields/serial/confirm",
        headers=auth,
        json={"value": "ABC"},
    )
    assert serial.status_code == 200, serial.text
    assert "serial" in serial.json()["confirmed_fields"]
    devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert devices == []
    name = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{pid}/fields/name/confirm",
        headers=auth,
        json={"value": "sw-1"},
    )
    assert name.status_code == 200, name.text
    devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert len(devices) == 1
    assert devices[0]["name"] == "sw-1"
    assert devices[0]["serial"] == "ABC"
    assert devices[0]["vendor"] == ""
    vendor = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{pid}/fields/vendor/confirm",
        headers=auth,
        json={},
    )
    assert vendor.status_code == 200
    devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert devices[0]["vendor"] == "Cisco"
    skipped = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{pid}/fields/model/skip",
        headers=auth,
    )
    assert skipped.status_code == 200
    assert "model" in skipped.json()["skipped_fields"]
    devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert devices[0]["model"] == ""
    sidecar_denied = client.post(
        f"/api/vision/sessions/{session['id']}/proposals/{pid}/fields/owner/confirm",
        headers=sidecar,
        json={"value": "nope"},
    )
    assert sidecar_denied.status_code == 403


def test_layout_fields_confirm_independently(client, auth):
    sidecar = _sidecar(client, auth, "vision-sidecar-layout-fields")
    project = _project(client, auth, "Layout Fields")
    session = _session(client, auth, project["id"], shot_kind="aisle_wide")
    _clip(client, auth, session["id"], kind="aisle_wide")
    client.post(f"/api/vision/sessions/{session['id']}/analyze", headers=auth)
    client.post(
        f"/api/vision/sessions/{session['id']}/proposals",
        headers=sidecar,
        json={
            "model": "claude-test",
            "prompt_text": "layout",
            "raw_extraction": {},
            "layout": {
                "areas": [{"name": "Hall B", "notes": "west"}],
                "rows": [{"name": "B01", "area_name": "Hall B"}],
                "racks": [{"name": "B01-01", "row_name": "B01"}],
            },
            "proposals": [],
        },
    )
    notes = client.post(
        f"/api/vision/sessions/{session['id']}/layout/fields/confirm",
        headers=auth,
        json={"kind": "area", "index": 0, "field": "notes"},
    )
    assert notes.status_code == 200, notes.text
    areas = client.get(f"/api/projects/{project['id']}/areas", headers=auth).json()
    assert areas == []
    area = client.post(
        f"/api/vision/sessions/{session['id']}/layout/fields/confirm",
        headers=auth,
        json={"kind": "area", "index": 0, "field": "name"},
    )
    assert area.status_code == 200, area.text
    areas = client.get(f"/api/projects/{project['id']}/areas", headers=auth).json()
    assert [a["name"] for a in areas] == ["Hall B"]
    assert areas[0]["description"] == "west"
    row = client.post(
        f"/api/vision/sessions/{session['id']}/layout/fields/confirm",
        headers=auth,
        json={"kind": "row", "index": 0, "field": "name"},
    )
    assert row.status_code == 200, row.text
    rows = client.get(f"/api/projects/{project['id']}/rows", headers=auth).json()
    assert [r["name"] for r in rows] == ["B01"]
    skip_rack = client.post(
        f"/api/vision/sessions/{session['id']}/layout/fields/skip",
        headers=auth,
        json={"kind": "rack", "index": 0, "field": "name"},
    )
    assert skip_rack.status_code == 200
    racks = client.get(f"/api/projects/{project['id']}/racks", headers=auth).json()
    assert racks == []
    devices = client.get(f"/api/projects/{project['id']}/devices", headers=auth).json()
    assert devices == []


def test_restriction_reasons_from_area(client, auth):
    project = _project(client, auth, "Policy")
    area = _area(client, auth, project["id"], name="EMSS", restricted=True)
    session = _session(client, auth, project["id"], area_id=area["id"])
    db = SessionLocal()
    try:
        row = db.get(VisionSession, session["id"])
        reasons = restriction_reasons(db, row)
        assert any("restricted" in r.lower() or "EMSS" in r for r in reasons)
        area_row = db.get(Area, area["id"])
        assert area_row.restricted
    finally:
        db.close()
