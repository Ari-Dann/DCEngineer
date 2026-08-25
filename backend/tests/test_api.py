from io import BytesIO


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_login_rejects_bad_password(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401


def test_rbi_flow_and_export(client, auth):
    project = client.post(
        "/api/projects",
        headers=auth,
        json={
            "name": "Site A RBI",
            "customer": "Acme",
            "site_name": "DC1",
            "revision": "A",
            "status": "phase2",
            "photography_rules": "No photos in cage 7",
            "restricted_equipment_notes": "EMSS rack R12",
        },
    )
    assert project.status_code == 201, project.text
    pid = project.json()["id"]

    area = client.post(
        f"/api/projects/{pid}/areas",
        headers=auth,
        json={"name": "Hall A", "in_scope": True, "restricted": False},
    )
    assert area.status_code == 201
    aid = area.json()["id"]

    rack = client.post(
        f"/api/projects/{pid}/racks",
        headers=auth,
        json={"name": "A01", "area_id": aid, "row_label": "A", "position": "01", "ru_height": 42},
    )
    assert rack.status_code == 201
    rid = rack.json()["id"]

    device = client.post(
        f"/api/projects/{pid}/devices",
        headers=auth,
        json={
            "name": "sw-a01",
            "rack_id": rid,
            "vendor": "Cisco",
            "model": "C9300-48P",
            "serial": "FCW1234",
            "device_type": "switch",
            "ru_start": 41,
            "ru_end": 42,
            "fan_orientation": "incorrect-hot-aisle",
            "eol_date": "2020-01-01",
        },
    )
    assert device.status_code == 201, device.text
    did = device.json()["id"]
    assert device.json()["eol_status"] == "eol"

    pdu = client.post(
        f"/api/projects/{pid}/racks/{rid}/pdus",
        headers=auth,
        json={"name": "PDU-A", "bank": "A", "outlet_count": 8, "amperage": 30, "voltage": 208},
    )
    assert pdu.status_code == 201, pdu.text
    pdu_id = pdu.json()["id"]
    port_id = pdu.json()["ports"][0]["id"]
    mapped = client.patch(
        f"/api/projects/{pid}/pdus/{pdu_id}/ports/{port_id}",
        headers=auth,
        json={"port_label": "1", "device_id": did, "notes": "C14"},
    )
    assert mapped.status_code == 200
    assert mapped.json()["ports"][0]["device_id"] == did

    cab = client.post(
        f"/api/projects/{pid}/cables",
        headers=auth,
        json={
            "rack_id": rid,
            "from_label": "sw-a01",
            "from_port": "Gi1/0/1",
            "to_label": "patch-A",
            "to_port": "01",
            "media": "Cat6",
            "traced": True,
        },
    )
    assert cab.status_code == 201

    hand = client.post(
        f"/api/projects/{pid}/handoffs",
        headers=auth,
        json={
            "handoff_date": "2026-08-20",
            "from_name": "Onsite",
            "to_name": "Remote",
            "summary": "Captured A01",
            "devices_captured": 1,
        },
    )
    assert hand.status_code == 201

    lists = client.get(f"/api/projects/{pid}/checklists", headers=auth)
    assert lists.status_code == 200
    assert len(lists.json()) >= 4

    elevation = client.get(f"/api/projects/{pid}/racks/{rid}/elevation", headers=auth)
    assert elevation.status_code == 200
    assert any(s["device_id"] == did for s in elevation.json()["slots"])

    xlsx = client.get(f"/api/projects/{pid}/export.xlsx", headers=auth)
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"

    svg = client.get(f"/api/projects/{pid}/racks/{rid}/elevation.svg", headers=auth)
    assert svg.status_code == 200
    assert b"<svg" in svg.content

    dash = client.get("/api/dashboard", headers=auth)
    assert dash.status_code == 200
    body = dash.json()
    assert body["devices"] >= 1
    assert body["eol_devices"] >= 1
    assert body["fan_issues"] >= 1


def test_ops_and_upload(client, auth):
    inc = client.post(
        "/api/incidents",
        headers=auth,
        json={"title": "PDU A breaker trip", "severity": "high", "category": "power", "status": "open"},
    )
    assert inc.status_code == 201
    insp = client.post(
        "/api/inspections",
        headers=auth,
        json={"title": "Daily walkthrough", "itype": "routine", "status": "open", "location": "Hall A"},
    )
    assert insp.status_code == 201
    wo = client.post(
        "/api/work-orders",
        headers=auth,
        json={"title": "Install fiber tray", "wtype": "cabling", "status": "planned"},
    )
    assert wo.status_code == 201
    bp = client.post(
        "/api/backup-processes",
        headers=auth,
        json={"name": "VMware Veeam", "method": "nfs", "schedule": "nightly", "rpo_hours": 24},
    )
    assert bp.status_code == 201

    files = {"file": ("photo.jpg", BytesIO(b"\xff\xd8fakejpeg"), "image/jpeg")}
    up = client.post(
        "/api/attachments",
        headers=auth,
        data={"entity_type": "incident", "entity_id": str(inc.json()["id"])},
        files=files,
    )
    assert up.status_code == 201, up.text
    aid = up.json()["id"]
    dl = client.get(f"/api/attachments/{aid}/download", headers=auth)
    assert dl.status_code == 200
    assert dl.content.startswith(b"\xff\xd8")

    backup = client.post("/api/app-backups", headers=auth)
    assert backup.status_code == 200
    assert backup.json()["status"] in ("ok", "error")


def test_catalog_edit_import_search_photos(client, auth):
    catalog = client.get("/api/catalog", headers=auth)
    assert catalog.status_code == 200, catalog.text
    body = catalog.json()
    assert "router" in body["device_types"]
    names = [v["name"] for v in body["vendors"]]
    for vendor in ("Cisco", "Juniper", "Arista", "MikroTik", "TRENDnet", "Dell", "HPE Aruba", "Fortinet", "Ubiquiti", "Netgear"):
        assert vendor in names
    assert 52 in body["rack_height_presets"]

    project = client.post("/api/projects", headers=auth, json={"name": "Import Site", "customer": "Acme"})
    assert project.status_code == 201, project.text
    pid = project.json()["id"]

    rack = client.post(
        f"/api/projects/{pid}/racks",
        headers=auth,
        json={"name": "A01", "row_label": "A", "ru_height": 42},
    )
    assert rack.status_code == 201
    rid = rack.json()["id"]

    device = client.post(
        f"/api/projects/{pid}/devices",
        headers=auth,
        json={
            "name": "sw-typo",
            "rack_id": rid,
            "vendor": "Csico",
            "model": "C9300",
            "serial": "FCW-EDIT",
            "device_type": "switch",
            "ru_start": 47,
            "ru_end": 48,
        },
    )
    assert device.status_code == 201, device.text
    did = device.json()["id"]
    grown = client.get(f"/api/projects/{pid}/racks", headers=auth).json()
    assert any(r["id"] == rid and r["ru_height"] >= 48 for r in grown)

    tall = client.patch(
        f"/api/projects/{pid}/racks/{rid}",
        headers=auth,
        json={"name": "A01", "row_label": "A", "position": "01", "ru_height": 52, "width_inches": 19, "notes": ""},
    )
    assert tall.status_code == 200
    assert tall.json()["ru_height"] == 52

    patched = client.patch(
        f"/api/projects/{pid}/devices/{did}",
        headers=auth,
        json={"vendor": "Cisco", "model": "Catalyst 9300", "device_type": "router", "name": "sw-typo-fixed"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["vendor"] == "Cisco"
    assert patched.json()["serial"] == "FCW-EDIT"
    assert patched.json()["device_type"] == "router"
    assert patched.json()["name"] == "sw-typo-fixed"

    csv_body = (
        "name,hostname,vendor,model,serial,rack,ru start,height,type,function,management ip\n"
        "core-rtr,core-rtr.site,Cisco,ASR 1001-X,SN-RTR,B12,47,2,router,WAN edge,10.0.0.1\n"
        "logical-fw,fw1,Fortinet,FortiGate 200F,SN-UNLOCATED,,,,firewall,edge,\n"
        "sw-typo-fixed,core-sw,Cisco,Catalyst 9300,FCW-EDIT,A01,50,2,switch,access,\n"
    )
    imported = client.post(
        f"/api/projects/{pid}/import",
        headers=auth,
        files={"file": ("gear.csv", csv_body.encode(), "text/csv")},
    )
    assert imported.status_code == 200, imported.text
    summary = imported.json()
    assert summary["created"] >= 2
    assert summary["updated"] >= 1
    assert summary["racks_created"] >= 1

    racks = {r["name"]: r for r in client.get(f"/api/projects/{pid}/racks", headers=auth).json()}
    assert "B12" in racks
    assert racks["B12"]["ru_height"] >= 48

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Name", "Serial", "Vendor", "Model", "Rack", "RU start", "Type"])
    ws.append(["leaf-sw", "SN-XLSX", "Arista", "DCS-7050SX3-48YC8", "B12", 1, "switch"])
    buf = BytesIO()
    wb.save(buf)
    xlsx = client.post(
        f"/api/projects/{pid}/import",
        headers=auth,
        files={
            "file": (
                "gear.xlsx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert xlsx.status_code == 200, xlsx.text
    assert xlsx.json()["created"] >= 1

    bad = client.post(
        f"/api/projects/{pid}/import",
        headers=auth,
        files={"file": ("legacy.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")},
    )
    assert bad.status_code == 400

    search = client.get(f"/api/projects/{pid}/search", headers=auth, params={"q": "FortiGate", "unlocated": True})
    assert search.status_code == 200, search.text
    hits = search.json()["devices"]
    assert any(h["serial"] == "SN-UNLOCATED" for h in hits)
    unlocated_id = next(h["id"] for h in hits if h["serial"] == "SN-UNLOCATED")

    located = client.patch(
        f"/api/projects/{pid}/devices/{unlocated_id}",
        headers=auth,
        json={"rack_id": racks["B12"]["id"], "ru_start": 10, "ru_end": 10},
    )
    assert located.status_code == 200
    assert located.json()["rack_id"] == racks["B12"]["id"]
    assert located.json()["vendor"] == "Fortinet"

    files = {"file": ("faceplate.jpg", BytesIO(b"\xff\xd8one"), "image/jpeg")}
    a1 = client.post(
        "/api/attachments",
        headers=auth,
        data={"entity_type": "device", "entity_id": str(did)},
        files=files,
    )
    assert a1.status_code == 201, a1.text
    files2 = {"file": ("rear.jpg", BytesIO(b"\xff\xd8two"), "image/jpeg")}
    a2 = client.post(
        "/api/attachments",
        headers=auth,
        data={"entity_type": "device", "entity_id": str(did)},
        files=files2,
    )
    assert a2.status_code == 201
    listed = client.get("/api/attachments", headers=auth, params={"entity_type": "device", "entity_id": did})
    assert listed.status_code == 200
    assert len(listed.json()) >= 2

    got = client.get(f"/api/projects/{pid}/devices/{did}", headers=auth)
    assert got.status_code == 200
    assert got.json()["serial"] == "FCW-EDIT"


def test_auth_required(client):
    res = client.get("/api/projects")
    assert res.status_code == 401
