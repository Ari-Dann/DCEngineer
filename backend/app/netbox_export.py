"""NetBox-shaped CSV / YAML export so a project can be imported in NetBox DCIM."""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import AisleRow, Area, Device, Project, Rack

UNSPECIFIED_ROLE = "unspecified"

ROLE_COLORS = {
    "server": "3d9cf0",
    "switch": "3dbf8c",
    "firewall": "e87a4c",
    "router": "5ec8e8",
    "storage": "9b7dff",
    "pdu": "e8a317",
    "ups": "e85d4c",
    "other": "8b9bb0",
    UNSPECIFIED_ROLE: "9e9e9e",
}

DEVICE_CSV_HEADERS = [
    "name",
    "role",
    "manufacturer",
    "device_type",
    "site",
    "location",
    "rack",
    "position",
    "serial",
    "asset_tag",
    "status",
    "tenant",
    "comments",
]


def slugify(value: str, fallback: str = "item") -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return (text or fallback)[:100]


def _site_name(project: Project) -> str:
    return (project.site_name or project.name or "site").strip() or "site"


def _csv_bytes(headers: list[str], rows: list[list[object]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow(["" if cell is None else cell for cell in row])
    return buf.getvalue().encode("utf-8")


def _yaml_scalar(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    if not text or text != text.strip() or any(ch in text for ch in ":#{}[],&*?|>!%@`'\"\\\n"):
        return json.dumps(text)
    return text


def _device_height(device: Device) -> int:
    start = device.ru_start or 1
    end = device.ru_end or device.ru_start or start
    return max(1, int(end) - int(start) + 1)


def _row_location_name(area: Area | None, aisle: AisleRow) -> str:
    if area and area.name.strip():
        return f"{area.name.strip()} / {aisle.name.strip()}"
    return aisle.name.strip()


def _layout_names(
    project: Project,
    areas: list[Area],
    rows: list[AisleRow],
    racks: list[Rack],
) -> tuple[str, dict[int, str], dict[int, str]]:
    site = _site_name(project)
    area_by_id = {a.id: a for a in areas}
    row_by_id = {r.id: r for r in rows}
    row_location: dict[int, str] = {}
    for aisle in rows:
        area = area_by_id.get(aisle.area_id) if aisle.area_id else None
        row_location[aisle.id] = _row_location_name(area, aisle)
    rack_location: dict[int, str] = {}
    for rack in racks:
        aisle = row_by_id.get(rack.row_id) if rack.row_id else None
        if aisle:
            rack_location[rack.id] = row_location[aisle.id]
        elif rack.area_id and rack.area_id in area_by_id:
            rack_location[rack.id] = area_by_id[rack.area_id].name
        else:
            rack_location[rack.id] = ""
    return site, row_location, rack_location


def _readme(project: Project) -> str:
    site = _site_name(project)
    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""DCEngineer — NetBox import pack
Site: {site}
Project: {project.name}
Exported: {when}

This ZIP is shaped for NetBox DCIM CSV / YAML import (not a live API dump).
Device CSV headers are the lowercase import names NetBox expects.

Import order in NetBox
  1. Organization → Sites            → sites.csv
  2. Organization → Locations        → locations.csv
     Areas are top-level locations. Rows are child locations named "Area / Row"
     so names stay unique when two halls share a row label.
  3. DCIM → Manufacturers            → manufacturers.csv
  4. DCIM → Device Types             → device-types.yaml  (YAML, not CSV)
  5. Organization → Device Roles     → device-roles.csv
  6. DCIM → Racks                    → racks.csv
  7. DCIM → Devices                  → devices.csv

Mapping (NetBox ← DCEngineer)
  site            ← project site name (or project name)
  location        ← area, or nested "area / row"
  rack            ← rack
  role            ← device type (server, switch, …). Blank types export as "{UNSPECIFIED_ROLE}"
  manufacturer    ← vendor
  device_type     ← model
  position        ← RU start (from the bottom)
  tenant          ← owner
  comments        ← notes
  status          ← active

Re-import into DCEngineer
  Project → Devices → Import the devices.csv (or this whole ZIP).
  DCEngineer detects NetBox headers so role becomes type, manufacturer becomes
  vendor, device_type becomes model, location becomes area/row, and position
  becomes RU start.
"""


def build_netbox_zip(db: Session, project: Project) -> bytes:
    areas = db.query(Area).filter(Area.project_id == project.id).order_by(Area.name, Area.id).all()
    rows = db.query(AisleRow).filter(AisleRow.project_id == project.id).order_by(AisleRow.name, AisleRow.id).all()
    racks = db.query(Rack).filter(Rack.project_id == project.id).order_by(Rack.name, Rack.id).all()
    devices = db.query(Device).filter(Device.project_id == project.id).order_by(Device.name, Device.id).all()
    site, row_location, rack_location = _layout_names(project, areas, rows, racks)
    site_slug = slugify(site, "site")
    area_by_id = {a.id: a for a in areas}

    location_rows: list[list[object]] = []
    for area in areas:
        location_rows.append(
            [area.name, slugify(area.name), site, "", "active", area.description or ""]
        )
    for aisle in rows:
        area = area_by_id.get(aisle.area_id) if aisle.area_id else None
        name = row_location[aisle.id]
        parent = area.name if area else ""
        location_rows.append([name, slugify(name), site, parent, "active", aisle.notes or ""])

    manufacturers = sorted({(d.vendor or "").strip() for d in devices if (d.vendor or "").strip()}, key=str.lower)
    roles: set[str] = set()
    for device in devices:
        role = (device.device_type or "").strip() or UNSPECIFIED_ROLE
        roles.add(role)

    type_docs: dict[tuple[str, str], int] = {}
    for device in devices:
        vendor = (device.vendor or "").strip()
        model = (device.model or "").strip()
        if not vendor or not model:
            continue
        key = (vendor, model)
        height = _device_height(device)
        type_docs[key] = max(type_docs.get(key, 1), height)

    yaml_chunks: list[str] = []
    for vendor, model in sorted(type_docs, key=lambda pair: (pair[0].lower(), pair[1].lower())):
        yaml_chunks.append(
            "---\n"
            f"manufacturer: {_yaml_scalar(vendor)}\n"
            f"model: {_yaml_scalar(model)}\n"
            f"slug: {slugify(f'{vendor} {model}')}\n"
            f"u_height: {type_docs[(vendor, model)]}\n"
        )

    rack_rows = []
    for rack in racks:
        rack_rows.append(
            [
                rack.name,
                site,
                rack_location.get(rack.id, ""),
                "active",
                rack.ru_height or 42,
                rack.notes or "",
            ]
        )

    device_rows = []
    for device in devices:
        rack = next((r for r in racks if r.id == device.rack_id), None) if device.rack_id else None
        role = (device.device_type or "").strip() or UNSPECIFIED_ROLE
        device_rows.append(
            [
                device.name,
                role,
                device.vendor or "",
                device.model or "",
                site,
                rack_location.get(rack.id, "") if rack else "",
                rack.name if rack else "",
                device.ru_start or "",
                device.serial or "",
                device.asset_tag or "",
                "active",
                device.owner or "",
                device.notes or "",
            ]
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", _readme(project))
        zf.writestr(
            "sites.csv",
            _csv_bytes(
                ["name", "slug", "status", "description"],
                [[site, site_slug, "active", project.site_address or ""]],
            ),
        )
        zf.writestr(
            "locations.csv",
            _csv_bytes(["name", "slug", "site", "parent", "status", "description"], location_rows),
        )
        zf.writestr(
            "manufacturers.csv",
            _csv_bytes(
                ["name", "slug"],
                [[name, slugify(name)] for name in manufacturers],
            ),
        )
        zf.writestr(
            "device-roles.csv",
            _csv_bytes(
                ["name", "slug", "color", "vm_role"],
                [
                    [role, slugify(role), ROLE_COLORS.get(role.lower(), "8b9bb0"), "false"]
                    for role in sorted(roles, key=str.lower)
                ],
            ),
        )
        zf.writestr(
            "racks.csv",
            _csv_bytes(["name", "site", "location", "status", "u_height", "comments"], rack_rows),
        )
        zf.writestr("devices.csv", _csv_bytes(DEVICE_CSV_HEADERS, device_rows))
        zf.writestr("device-types.yaml", "".join(yaml_chunks) or "# no manufacturer+model pairs to export\n")
    return buf.getvalue()
