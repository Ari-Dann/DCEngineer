"""Import devices (and missing racks) from CSV or XLSX workbooks."""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from typing import Any

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.models import Device, Rack

HEADER_MAP = {
    "name": ("name", "device", "device name", "device_name", "unit", "label"),
    "hostname": ("hostname", "host", "dns", "fqdn"),
    "vendor": ("vendor", "manufacturer", "oem", "make"),
    "model": ("model", "part", "pid", "sku", "part number", "part_number"),
    "serial": ("serial", "serial number", "serial_number", "sn", "s/n", "s/n."),
    "asset_tag": ("asset", "asset tag", "asset_tag", "tag"),
    "rack": ("rack", "rack name", "rack_name", "cabinet", "cab"),
    "ru_start": ("ru start", "ru_start", "ru", "u", "u start", "position", "ru position"),
    "ru_end": ("ru end", "ru_end", "u end"),
    "ru_height": ("height", "height u", "ru height", "ru_height", "u height"),
    "device_type": ("type", "device type", "device_type", "class", "category"),
    "function": ("function", "role", "purpose"),
    "management_ip": ("ip", "mgmt ip", "management_ip", "mgmt", "management ip"),
    "notes": ("notes", "note", "comment", "comments"),
    "eol_date": ("eol", "eol date", "eol_date", "end of life"),
    "eos_date": ("eos", "eos date", "eos_date", "end of sale", "end of support"),
    "fan_orientation": ("fan", "fan orientation", "fan_orientation", "airflow"),
    "hostname_alt": (),
}


def _norm(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value).strip()


def _header_key(cell: Any) -> str:
    text = _norm(cell).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    for field, aliases in HEADER_MAP.items():
        if field == "hostname_alt":
            continue
        if text == field.replace("_", " ") or text in aliases:
            return field
    return text.replace(" ", "_")


def _rows_from_csv(data: bytes) -> list[dict[str, str]]:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []
    headers = [_header_key(h) for h in rows[0]]
    out = []
    for raw in rows[1:]:
        item = {headers[i]: _norm(raw[i]) if i < len(raw) else "" for i in range(len(headers))}
        if any(item.values()):
            out.append(item)
    return out


def _rows_from_xlsx(data: bytes) -> list[dict[str, str]]:
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        return []
    headers = [_header_key(h) for h in header_row]
    out = []
    for raw in rows_iter:
        item = {headers[i]: _norm(raw[i]) if i < len(raw) else "" for i in range(len(headers))}
        if any(item.values()):
            out.append(item)
    return out


def parse_table(filename: str, data: bytes) -> list[dict[str, str]]:
    name = (filename or "").lower()
    if name.endswith(".csv") or name.endswith(".txt"):
        return _rows_from_csv(data)
    if name.endswith(".xlsx"):
        return _rows_from_xlsx(data)
    if name.endswith(".xls"):
        raise ValueError("Legacy .xls is not supported. Save as .xlsx or .csv and try again.")
    # sniff
    if data[:2] == b"PK":
        return _rows_from_xlsx(data)
    return _rows_from_csv(data)


def _int(value: str) -> int | None:
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def import_devices(db: Session, project_id: int, filename: str, data: bytes, user_id: int | None) -> dict:
    rows = parse_table(filename, data)
    created = 0
    updated = 0
    racks_created = 0
    skipped = 0
    errors: list[str] = []
    rack_cache: dict[str, Rack] = {
        r.name.lower(): r for r in db.query(Rack).filter(Rack.project_id == project_id).all()
    }

    for index, row in enumerate(rows, start=2):
        name = row.get("name") or row.get("hostname") or row.get("serial")
        if not name:
            skipped += 1
            continue
        rack_name = row.get("rack")
        rack = None
        if rack_name:
            key = rack_name.lower()
            rack = rack_cache.get(key)
            if not rack:
                rack = Rack(project_id=project_id, name=rack_name, ru_height=42)
                db.add(rack)
                db.flush()
                rack_cache[key] = rack
                racks_created += 1

        ru_start = _int(row.get("ru_start", ""))
        ru_end = _int(row.get("ru_end", ""))
        height = _int(row.get("ru_height", ""))
        if ru_start is not None and ru_end is None and height:
            ru_end = ru_start + height - 1
        if rack and ru_end and ru_end > rack.ru_height:
            rack.ru_height = min(70, ru_end)

        dtype = (row.get("device_type") or "server").lower()
        if dtype not in (
            "server",
            "switch",
            "router",
            "firewall",
            "storage",
            "pdu",
            "ups",
            "other",
        ):
            dtype = "other" if dtype else "server"

        serial = row.get("serial", "")
        existing = None
        if serial:
            existing = (
                db.query(Device)
                .filter(Device.project_id == project_id, Device.serial == serial)
                .first()
            )
        payload = dict(
            name=name[:255],
            hostname=row.get("hostname", "")[:255],
            vendor=row.get("vendor", "")[:128],
            model=row.get("model", "")[:128],
            serial=serial[:128],
            asset_tag=row.get("asset_tag", "")[:128],
            device_type=dtype[:64],
            function=row.get("function", "")[:255],
            ru_start=ru_start,
            ru_end=ru_end,
            rack_id=rack.id if rack else None,
            management_ip=row.get("management_ip", "")[:64],
            notes=row.get("notes", ""),
            eol_date=row.get("eol_date") or None,
            eos_date=row.get("eos_date") or None,
            fan_orientation=row.get("fan_orientation") or "unknown",
            discovered_via="import",
        )
        try:
            if existing:
                for key, value in payload.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                db.add(Device(project_id=project_id, captured_by=user_id, **payload))
                created += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Row {index}: {exc}")
            skipped += 1

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "racks_created": racks_created,
        "skipped": skipped,
        "rows": len(rows),
        "errors": errors[:20],
    }
