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
    assert any(t["id"] == "led" for t in body["indicator_types"])
    assert any(c["id"] == "green" for c in body["indicator_colors"])
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


def test_catalog_learns_other_values(client, auth):
    learned = client.post(
        "/api/catalog/learn",
        headers=auth,
        json={"vendor": "CustomOEM", "model": "Widget-9000", "device_type": "blade chassis", "function": "WAN edge"},
    )
    assert learned.status_code == 200, learned.text
    body = learned.json()
    names = [v["name"] for v in body["vendors"]]
    assert "CustomOEM" in names
    oem = next(v for v in body["vendors"] if v["name"] == "CustomOEM")
    assert "Widget-9000" in oem["models"]
    assert "blade chassis" in body["device_types"]
    assert "WAN edge" in body["functions"]

    project = client.post("/api/projects", headers=auth, json={"name": "Catalog persist"})
    pid = project.json()["id"]
    device = client.post(
        f"/api/projects/{pid}/devices",
        headers=auth,
        json={"name": "custom-box", "vendor": "SiteGear", "model": "SG-12", "device_type": "console", "function": "OOB"},
    )
    assert device.status_code == 201, device.text
    catalog = client.get("/api/catalog", headers=auth).json()
    names = [v["name"] for v in catalog["vendors"]]
    assert "SiteGear" in names
    site = next(v for v in catalog["vendors"] if v["name"] == "SiteGear")
    assert "SG-12" in site["models"]
    assert "console" in catalog["device_types"]
    assert "OOB" in catalog["functions"]


def test_admin_can_edit_user_email_and_password(client, auth):
    created = client.post(
        "/api/users",
        headers=auth,
        json={
            "username": "tech1",
            "email": "tech1@example.test",
            "password": "oldpass12",
            "full_name": "Tech One",
            "role": "engineer",
        },
    )
    assert created.status_code == 201, created.text
    uid = created.json()["id"]
    patched = client.patch(
        f"/api/users/{uid}",
        headers=auth,
        json={"email": "tech1.new@example.test", "password": "newpass12", "username": "tech1b", "full_name": "Tech 1"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["email"] == "tech1.new@example.test"
    assert patched.json()["username"] == "tech1b"
    assert patched.json()["full_name"] == "Tech 1"
    old = client.post("/api/auth/login", json={"username": "tech1b", "password": "oldpass12"})
    assert old.status_code == 401
    new = client.post("/api/auth/login", json={"username": "tech1b", "password": "newpass12"})
    assert new.status_code == 200, new.text


def test_import_preview_mapping_and_rbi_sheet(client, auth):
    from openpyxl import Workbook

    src = client.post("/api/projects", headers=auth, json={"name": "Export site", "customer": "Acme"})
    src_id = src.json()["id"]
    client.post(
        f"/api/projects/{src_id}/devices",
        headers=auth,
        json={"name": "core-sw", "vendor": "Cisco", "model": "Catalyst 9300", "serial": "SN-RBI", "device_type": "switch"},
    )
    exported = client.get(f"/api/projects/{src_id}/export.xlsx", headers=auth)
    assert exported.status_code == 200

    preview = client.post(
        "/api/imports/preview",
        headers=auth,
        files={
            "file": (
                "rbi.xlsx",
                exported.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    sheet_names = [s["name"] for s in body["sheets"]]
    assert "Cover" in sheet_names
    assert "Devices" in sheet_names
    assert body["suggested_sheet"] == "Devices"
    devices_sheet = next(s for s in body["sheets"] if s["name"] == "Devices")
    assert "name" in devices_sheet["mapped_fields"]
    assert devices_sheet["record_count"] >= 1

    dest = client.post("/api/projects", headers=auth, json={"name": "Import dest"})
    dest_id = dest.json()["id"]
    imported = client.post(
        f"/api/projects/{dest_id}/import",
        headers=auth,
        files={
            "file": (
                "rbi.xlsx",
                exported.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert imported.status_code == 200, imported.text
    summary = imported.json()
    assert summary["sheet"] == "Devices"
    assert summary["created"] >= 1
    listed = client.get(f"/api/projects/{dest_id}/devices", headers=auth).json()
    assert any(d["serial"] == "SN-RBI" for d in listed)

    wb = Workbook()
    ws = wb.active
    ws.title = "Gear"
    ws["A1"] = "Name"
    ws["B1"] = "sw-a"
    ws["C1"] = "sw-b"
    ws["A2"] = "Manufacturer"
    ws["B2"] = "Juniper"
    ws["C2"] = "Dell"
    ws["A3"] = "Model"
    ws["B3"] = "EX4400"
    ws["C3"] = "PowerEdge R750"
    ws["A4"] = "Serial"
    ws["B4"] = "SN-COL-A"
    ws["C4"] = "SN-COL-B"
    buf = BytesIO()
    wb.save(buf)
    xlsx_bytes = buf.getvalue()

    col_preview = client.post(
        "/api/imports/preview",
        headers=auth,
        files={
            "file": (
                "cols.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert col_preview.status_code == 200, col_preview.text
    col_body = col_preview.json()
    assert col_body["sheets"][0]["orientation"] == "columns"
    assert col_body["sheets"][0]["record_count"] == 2

    dest2 = client.post("/api/projects", headers=auth, json={"name": "Column dest"})
    dest2_id = dest2.json()["id"]
    mapped = client.post(
        f"/api/projects/{dest2_id}/import",
        headers=auth,
        data={
            "sheet": "Gear",
            "orientation": "columns",
            "mapping": '{"name": 0, "vendor": 1, "model": 2, "serial": 3}',
        },
        files={
            "file": (
                "cols.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert mapped.status_code == 200, mapped.text
    assert mapped.json()["created"] >= 2
    rows = client.get(f"/api/projects/{dest2_id}/devices", headers=auth).json()
    serials = {d["serial"] for d in rows}
    assert "SN-COL-A" in serials
    assert "SN-COL-B" in serials
    assert any(d["vendor"] == "Juniper" and d["model"] == "EX4400" for d in rows)


def test_rows_relocate_indicators_and_device_copy_move(client, auth):
    src = client.post("/api/projects", headers=auth, json={"name": "Layout src"}).json()
    dest = client.post("/api/projects", headers=auth, json={"name": "Layout dest"}).json()
    src_id, dest_id = src["id"], dest["id"]

    area = client.post(f"/api/projects/{src_id}/areas", headers=auth, json={"name": "Hall A"})
    assert area.status_code == 201
    aid = area.json()["id"]

    row = client.post(f"/api/projects/{src_id}/rows", headers=auth, json={"name": "Row 1", "area_id": aid})
    assert row.status_code == 201
    row_id = row.json()["id"]

    rack = client.post(
        f"/api/projects/{src_id}/racks",
        headers=auth,
        json={"name": "R1", "area_id": aid, "row_id": row_id, "ru_height": 42},
    )
    assert rack.status_code == 201
    rack_id = rack.json()["id"]
    assert rack.json()["row_id"] == row_id
    assert rack.json()["row_label"] == "Row 1"

    auto = client.post(
        f"/api/projects/{src_id}/racks",
        headers=auth,
        json={"name": "R-auto", "area_id": aid, "row_label": "Row Z", "ru_height": 42},
    )
    assert auto.status_code == 201, auto.text
    assert auto.json()["row_id"]
    rows = client.get(f"/api/projects/{src_id}/rows", headers=auth).json()
    assert any(r["name"] == "Row Z" for r in rows)

    hall_b = client.post(f"/api/projects/{src_id}/areas", headers=auth, json={"name": "Hall B"})
    assert hall_b.status_code == 201
    hall_b_id = hall_b.json()["id"]
    reassigned = client.patch(
        f"/api/projects/{src_id}/rows/{row_id}",
        headers=auth,
        json={"name": "Row 1", "area_id": hall_b_id},
    )
    assert reassigned.status_code == 200
    assert reassigned.json()["area_id"] == hall_b_id
    r1 = next(r for r in client.get(f"/api/projects/{src_id}/racks", headers=auth).json() if r["id"] == rack_id)
    assert r1["area_id"] == hall_b_id

    device = client.post(
        f"/api/projects/{src_id}/devices",
        headers=auth,
        json={
            "name": "sw-1",
            "rack_id": rack_id,
            "vendor": "Cisco",
            "serial": "SN-LED",
            "indicator_type": "led",
            "indicator_color": "green",
            "ru_start": 1,
            "ru_end": 1,
        },
    )
    assert device.status_code == 201, device.text
    did = device.json()["id"]
    assert device.json()["indicator_type"] == "led"
    assert device.json()["indicator_color"] == "green"

    patched = client.patch(
        f"/api/projects/{src_id}/devices/{did}",
        headers=auth,
        json={"indicator_type": "both", "indicator_color": "amber"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["indicator_type"] == "both"
    assert patched.json()["indicator_color"] == "amber"

    copied_area = client.post(
        f"/api/projects/{src_id}/areas/{hall_b_id}/copy",
        headers=auth,
        json={"target_project_id": dest_id, "include_children": True, "include_devices": True},
    )
    assert copied_area.status_code == 200, copied_area.text
    dest_devices = client.get(f"/api/projects/{dest_id}/devices", headers=auth).json()
    assert any(d["serial"] == "SN-LED" and d["id"] != did for d in dest_devices)
    assert any(d["id"] == did for d in client.get(f"/api/projects/{src_id}/devices", headers=auth).json())

    search = client.get(f"/api/projects/{src_id}/search", headers=auth, params={"q": "Row 1"})
    assert search.status_code == 200, search.text
    assert any(h["id"] == did for h in search.json()["devices"])

    dest_area = client.post(f"/api/projects/{dest_id}/areas", headers=auth, json={"name": "Dest Hall"}).json()
    dest_row = client.post(
        f"/api/projects/{dest_id}/rows",
        headers=auth,
        json={"name": "D1", "area_id": dest_area["id"]},
    ).json()
    dest_rack = client.post(
        f"/api/projects/{dest_id}/racks",
        headers=auth,
        json={"name": "DR1", "area_id": dest_area["id"], "row_id": dest_row["id"], "ru_height": 42},
    ).json()

    copied = client.post(
        f"/api/projects/{src_id}/devices/{did}/copy",
        headers=auth,
        json={"target_project_id": dest_id},
    )
    assert copied.status_code == 200, copied.text
    copy_id = copied.json()["id"]
    assert copy_id != did
    assert copied.json()["project_id"] == dest_id
    assert copied.json()["rack_id"] is None
    assert copied.json()["indicator_type"] == "both"
    assert client.get(f"/api/projects/{src_id}/devices/{did}", headers=auth).status_code == 200

    placed = client.post(
        f"/api/projects/{src_id}/devices/{did}/copy",
        headers=auth,
        json={"target_project_id": dest_id, "target_rack_id": dest_rack["id"]},
    )
    assert placed.status_code == 200, placed.text
    assert placed.json()["rack_id"] == dest_rack["id"]
    assert placed.json()["id"] != did
    assert client.get(f"/api/projects/{src_id}/devices/{did}", headers=auth).status_code == 200

    bad_rack = client.post(
        f"/api/projects/{src_id}/devices/{did}/copy",
        headers=auth,
        json={"target_project_id": dest_id, "target_rack_id": rack_id},
    )
    assert bad_rack.status_code == 404

    moved = client.post(
        f"/api/projects/{src_id}/devices/{did}/move",
        headers=auth,
        json={"target_project_id": dest_id, "target_rack_id": dest_rack["id"]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["project_id"] == dest_id
    assert moved.json()["rack_id"] == dest_rack["id"]
    assert client.get(f"/api/projects/{src_id}/devices/{did}", headers=auth).status_code == 404
    assert client.get(f"/api/projects/{dest_id}/devices/{did}", headers=auth).status_code == 200

    moved_rack = client.post(
        f"/api/projects/{src_id}/racks/{rack_id}/move",
        headers=auth,
        json={
            "target_project_id": dest_id,
            "target_area_id": dest_area["id"],
            "target_row_id": dest_row["id"],
            "include_devices": True,
        },
    )
    assert moved_rack.status_code == 200, moved_rack.text
    assert moved_rack.json()["project_id"] == dest_id
    assert moved_rack.json()["row_id"] == dest_row["id"]
    src_racks = client.get(f"/api/projects/{src_id}/racks", headers=auth).json()
    dest_racks = client.get(f"/api/projects/{dest_id}/racks", headers=auth).json()
    assert all(r["id"] != rack_id for r in src_racks)
    assert any(r["id"] == rack_id for r in dest_racks)



def test_area_row_rack_hierarchy_copy_move_search(client, auth):
    src = client.post("/api/projects", headers=auth, json={"name": "Layout src", "customer": "Acme"})
    assert src.status_code == 201, src.text
    pid = src.json()["id"]
    dest = client.post("/api/projects", headers=auth, json={"name": "Layout dest"})
    dest_id = dest.json()["id"]

    hall = client.post(
        f"/api/projects/{pid}/areas",
        headers=auth,
        json={"name": "Hall A", "in_scope": True},
    )
    assert hall.status_code == 201, hall.text
    hall_id = hall.json()["id"]
    hall_b = client.post(
        f"/api/projects/{pid}/areas",
        headers=auth,
        json={"name": "Hall B"},
    )
    hall_b_id = hall_b.json()["id"]

    row = client.post(
        f"/api/projects/{pid}/rows",
        headers=auth,
        json={"name": "Row 1", "area_id": hall_id},
    )
    assert row.status_code == 201, row.text
    row_id = row.json()["id"]
    assert row.json()["area_id"] == hall_id

    rack = client.post(
        f"/api/projects/{pid}/racks",
        headers=auth,
        json={"name": "A01", "row_id": row_id, "area_id": hall_id, "ru_height": 42},
    )
    assert rack.status_code == 201, rack.text
    rid = rack.json()["id"]
    assert rack.json()["row_id"] == row_id
    assert rack.json()["row_label"] == "Row 1"
    assert rack.json()["area_id"] == hall_id

    device = client.post(
        f"/api/projects/{pid}/devices",
        headers=auth,
        json={"name": "sw-a01", "rack_id": rid, "vendor": "Cisco", "serial": "SN-ROW", "device_type": "switch"},
    )
    assert device.status_code == 201, device.text

    reassigned = client.patch(
        f"/api/projects/{pid}/rows/{row_id}",
        headers=auth,
        json={"name": "Row 1", "area_id": hall_b_id},
    )
    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["area_id"] == hall_b_id
    moved_rack = client.get(f"/api/projects/{pid}/racks", headers=auth).json()
    assert any(r["id"] == rid and r["area_id"] == hall_b_id for r in moved_rack)

    copied = client.post(
        f"/api/projects/{pid}/areas/{hall_b_id}/copy",
        headers=auth,
        json={"target_project_id": dest_id, "include_children": True, "include_devices": False},
    )
    assert copied.status_code == 200, copied.text
    dest_areas = client.get(f"/api/projects/{dest_id}/areas", headers=auth).json()
    dest_rows = client.get(f"/api/projects/{dest_id}/rows", headers=auth).json()
    dest_racks = client.get(f"/api/projects/{dest_id}/racks", headers=auth).json()
    dest_devices = client.get(f"/api/projects/{dest_id}/devices", headers=auth).json()
    assert any(a["name"] == "Hall B" for a in dest_areas)
    assert any(r["name"] == "Row 1" for r in dest_rows)
    assert any(r["name"] == "A01" for r in dest_racks)
    assert dest_devices == []

    still_src = client.get(f"/api/projects/{pid}/racks", headers=auth).json()
    assert any(r["id"] == rid for r in still_src)

    dest_rows = client.get(f"/api/projects/{dest_id}/rows", headers=auth).json()
    dest_row_id = next(r["id"] for r in dest_rows if r["name"] == "Row 1")
    moved = client.post(
        f"/api/projects/{pid}/racks/{rid}/move",
        headers=auth,
        json={"target_project_id": dest_id, "target_row_id": dest_row_id, "include_devices": True},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["project_id"] == dest_id
    src_racks = client.get(f"/api/projects/{pid}/racks", headers=auth).json()
    assert all(r["id"] != rid for r in src_racks)
    dest_racks = client.get(f"/api/projects/{dest_id}/racks", headers=auth).json()
    assert any(r["id"] == rid for r in dest_racks)
    dest_devices = client.get(f"/api/projects/{dest_id}/devices", headers=auth).json()
    assert any(d["serial"] == "SN-ROW" for d in dest_devices)

    search = client.get(f"/api/projects/{dest_id}/search", headers=auth, params={"q": "Row 1"})
    assert search.status_code == 200, search.text
    hits = search.json()["devices"]
    assert any(h["serial"] == "SN-ROW" for h in hits)
    hit = next(h for h in hits if h["serial"] == "SN-ROW")
    assert hit["rack_row"] == "Row 1"
    assert hit["area_name"]

    auto = client.post(
        f"/api/projects/{pid}/racks",
        headers=auth,
        json={"name": "B02", "row_label": "AutoRow", "ru_height": 42},
    )
    assert auto.status_code == 201, auto.text
    assert auto.json()["row_id"]
    listed = client.get(f"/api/projects/{pid}/rows", headers=auth).json()
    assert any(r["name"] == "AutoRow" and r["id"] == auto.json()["row_id"] for r in listed)


def test_hierarchy_delete_unassigns_children(client, auth):
    project = client.post("/api/projects", headers=auth, json={"name": "Delete site"})
    assert project.status_code == 201, project.text
    pid = project.json()["id"]
    area = client.post(f"/api/projects/{pid}/areas", headers=auth, json={"name": "Hall Del"}).json()
    row = client.post(
        f"/api/projects/{pid}/rows",
        headers=auth,
        json={"name": "Row Del", "area_id": area["id"]},
    ).json()
    rack = client.post(
        f"/api/projects/{pid}/racks",
        headers=auth,
        json={"name": "D01", "row_id": row["id"], "area_id": area["id"], "ru_height": 42},
    ).json()
    device = client.post(
        f"/api/projects/{pid}/devices",
        headers=auth,
        json={"name": "sw-del", "rack_id": rack["id"], "serial": "SN-DEL", "ru_start": 10, "ru_end": 10},
    ).json()

    gone_device = client.delete(f"/api/projects/{pid}/devices/{device['id']}", headers=auth)
    assert gone_device.status_code == 200
    assert client.get(f"/api/projects/{pid}/devices/{device['id']}", headers=auth).status_code == 404

    device = client.post(
        f"/api/projects/{pid}/devices",
        headers=auth,
        json={"name": "sw-del-2", "rack_id": rack["id"], "serial": "SN-DEL-2", "ru_start": 11, "ru_end": 11},
    ).json()
    gone_rack = client.delete(f"/api/projects/{pid}/racks/{rack['id']}", headers=auth)
    assert gone_rack.status_code == 200
    leftover = client.get(f"/api/projects/{pid}/devices/{device['id']}", headers=auth)
    assert leftover.status_code == 200
    assert leftover.json()["rack_id"] is None

    rack = client.post(
        f"/api/projects/{pid}/racks",
        headers=auth,
        json={"name": "D02", "row_id": row["id"], "area_id": area["id"], "ru_height": 42},
    ).json()
    gone_row = client.delete(f"/api/projects/{pid}/rows/{row['id']}", headers=auth)
    assert gone_row.status_code == 200
    kept_rack = next(r for r in client.get(f"/api/projects/{pid}/racks", headers=auth).json() if r["id"] == rack["id"])
    assert kept_rack["row_id"] is None
    assert client.get(f"/api/projects/{pid}/rows", headers=auth).json() == []

    gone_area = client.delete(f"/api/projects/{pid}/areas/{area['id']}", headers=auth)
    assert gone_area.status_code == 200, gone_area.text
    assert client.get(f"/api/projects/{pid}/areas", headers=auth).json() == []
    kept_rack = next(r for r in client.get(f"/api/projects/{pid}/racks", headers=auth).json() if r["id"] == rack["id"])
    assert kept_rack["area_id"] is None
