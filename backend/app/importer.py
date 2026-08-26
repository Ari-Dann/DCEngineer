"""Import devices (and missing racks) from CSV or XLSX workbooks."""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime
from typing import Any

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.catalog import DEVICE_TYPES, IMPORT_FIELDS, learn_values
from app.models import Device, Rack

HEADER_MAP = {
    "name": ("name", "device", "device name", "device_name", "unit", "label", "hostname/device"),
    "hostname": ("hostname", "host", "dns", "fqdn"),
    "vendor": ("vendor", "manufacturer", "oem", "make", "mfg"),
    "model": ("model", "part", "pid", "sku", "part number", "part_number", "part no"),
    "serial": ("serial", "serial number", "serial_number", "sn", "s/n", "s/n."),
    "asset_tag": ("asset", "asset tag", "asset_tag", "tag", "asset no"),
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
}

KNOWN_FIELDS = {f["id"] for f in IMPORT_FIELDS}
PREFERRED_SHEETS = ("devices", "device list", "inventory", "assets", "equipment", "elevations")
KNOWN_TYPES = {t.lower() for t in DEVICE_TYPES}


def _norm(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value).strip()


def _label_key(cell: Any) -> str:
    text = _norm(cell).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def known_field(cell: Any) -> str | None:
    text = _label_key(cell)
    if not text:
        return None
    for field, aliases in HEADER_MAP.items():
        if text == field.replace("_", " ") or text in aliases:
            return field
    return None


def _mapped_count(cells: list[str]) -> int:
    seen: set[str] = set()
    for cell in cells:
        field = known_field(cell)
        if field:
            seen.add(field)
    return len(seen)


def _grid_from_csv(data: bytes) -> list[list[str]]:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    return [[_norm(c) for c in row] for row in reader]


def _sheets_from_xlsx(data: bytes) -> list[tuple[str, list[list[str]]]]:
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out: list[tuple[str, list[list[str]]]] = []
    for ws in wb.worksheets:
        grid = []
        for raw in ws.iter_rows(values_only=True):
            row = [_norm(c) for c in raw]
            if any(row):
                grid.append(row)
        out.append((ws.title, grid))
    return out


def parse_workbook(filename: str, data: bytes) -> list[tuple[str, list[list[str]]]]:
    name = (filename or "").lower()
    if name.endswith(".xls"):
        raise ValueError("Legacy .xls is not supported. Save as .xlsx or .csv and try again.")
    if name.endswith(".csv") or name.endswith(".txt"):
        return [(filename or "Sheet1", _grid_from_csv(data))]
    if name.endswith(".xlsx") or data[:2] == b"PK":
        return _sheets_from_xlsx(data)
    return [(filename or "Sheet1", _grid_from_csv(data))]


def _best_header_index(grid: list[list[str]], orientation: str) -> int:
    best_i, best_score = 0, -1
    if orientation == "rows":
        for i, row in enumerate(grid[:12]):
            score = _mapped_count(row)
            if score > best_score:
                best_i, best_score = i, score
        return best_i
    width = max((len(r) for r in grid), default=0)
    for i in range(min(5, width)):
        labels = [r[i] if i < len(r) else "" for r in grid]
        score = _mapped_count(labels)
        if score > best_score:
            best_i, best_score = i, score
    return best_i


def detect_orientation(grid: list[list[str]]) -> str:
    if not grid:
        return "rows"
    row_score = max((_mapped_count(row) for row in grid[:12]), default=0)
    col_score = _mapped_count([r[0] if r else "" for r in grid])
    return "columns" if col_score > row_score else "rows"


def suggest_mapping(headers: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for index, header in enumerate(headers):
        field = known_field(header)
        if field and field not in mapping:
            mapping[field] = index
    return mapping


def _trim_trailing(row: list[str]) -> list[str]:
    out = list(row)
    while out and not out[-1]:
        out.pop()
    return out


def _headers_for(grid: list[list[str]], orientation: str, header_index: int) -> list[str]:
    if orientation == "rows":
        return _trim_trailing(list(grid[header_index]) if header_index < len(grid) else [])
    return _trim_trailing([r[header_index] if header_index < len(r) else "" for r in grid])


def records_from_grid(
    grid: list[list[str]],
    orientation: str,
    header_index: int,
    mapping: dict[str, int] | None,
) -> list[dict[str, str]]:
    headers = _headers_for(grid, orientation, header_index)
    used = mapping if mapping is not None else suggest_mapping(headers)
    records: list[dict[str, str]] = []
    if orientation == "rows":
        for row in grid[header_index + 1 :]:
            rec = {field: (row[idx] if idx < len(row) else "") for field, idx in used.items()}
            if any(_norm(v) for v in rec.values()):
                records.append(rec)
        return records
    width = max((len(r) for r in grid), default=0)
    for col in range(header_index + 1, width):
        rec = {}
        for field, row_idx in used.items():
            row = grid[row_idx] if row_idx < len(grid) else []
            rec[field] = row[col] if col < len(row) else ""
        if any(_norm(v) for v in rec.values()):
            records.append(rec)
    return records


def _raw_sample(grid: list[list[str]], orientation: str, header_index: int, limit: int = 8) -> list[list[str]]:
    if orientation == "rows":
        return [list(r) for r in grid[header_index + 1 : header_index + 1 + limit]]
    width = max((len(r) for r in grid), default=0)
    sample = []
    for col in range(header_index + 1, min(width, header_index + 1 + limit)):
        sample.append([r[col] if col < len(r) else "" for r in grid])
    return sample


def describe_sheet(
    name: str,
    grid: list[list[str]],
    *,
    orientation: str | None = None,
    header_index: int | None = None,
    mapping: dict[str, int] | None = None,
) -> dict[str, Any]:
    orientation = orientation or detect_orientation(grid)
    if header_index is None:
        header_index = _best_header_index(grid, orientation)
    headers = _headers_for(grid, orientation, header_index)
    suggested = mapping if mapping is not None else suggest_mapping(headers)
    records = records_from_grid(grid, orientation, header_index, suggested)
    return {
        "name": name,
        "orientation": orientation,
        "header_index": header_index,
        "headers": [
            {"index": i, "label": label or f"Column {i + 1}", "suggested": suggested_field}
            for i, label in enumerate(headers)
            for suggested_field in [next((f for f, idx in suggested.items() if idx == i), "")]
        ],
        "raw_sample": _raw_sample(grid, orientation, header_index),
        "sample_records": records[:8],
        "record_count": len(records),
        "mapped_fields": sorted(suggested.keys()),
    }


def pick_sheet(sheets: list[dict[str, Any]]) -> str:
    if not sheets:
        return ""
    by_name = {s["name"].lower().strip(): s for s in sheets}
    for pref in PREFERRED_SHEETS:
        if pref in by_name:
            return by_name[pref]["name"]
    return max(sheets, key=lambda s: (len(s.get("mapped_fields") or []), s.get("record_count") or 0))["name"]


def preview_import(
    filename: str,
    data: bytes,
    *,
    sheet: str | None = None,
    orientation: str | None = None,
    header_index: int | None = None,
) -> dict[str, Any]:
    parsed = parse_workbook(filename, data)
    if not parsed:
        return {"filename": filename, "sheets": [], "suggested_sheet": "", "fields": IMPORT_FIELDS}
    described = []
    for name, grid in parsed:
        use_opts = name == sheet if sheet else False
        described.append(
            describe_sheet(
                name,
                grid,
                orientation=orientation if use_opts or len(parsed) == 1 else None,
                header_index=header_index if use_opts or len(parsed) == 1 else None,
            )
        )
    suggested = sheet or pick_sheet(described)
    return {
        "filename": filename,
        "sheets": described,
        "suggested_sheet": suggested,
        "fields": IMPORT_FIELDS,
    }


def _int(value: str) -> int | None:
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _normalize_type(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return "server"
    lower = text.lower()
    if lower in KNOWN_TYPES:
        return lower
    return text


def _parse_mapping(raw: str | dict | None) -> dict[str, int] | None:
    if not raw:
        return None
    data = json.loads(raw) if isinstance(raw, str) else raw
    out: dict[str, int] = {}
    for key, value in (data or {}).items():
        if key not in KNOWN_FIELDS or value is None or value == "":
            continue
        try:
            out[key] = int(value)
        except (TypeError, ValueError):
            continue
    return out or None


def import_devices(
    db: Session,
    project_id: int,
    filename: str,
    data: bytes,
    user_id: int | None,
    *,
    sheet: str | None = None,
    orientation: str | None = None,
    header_index: int | None = None,
    mapping: dict[str, int] | str | None = None,
) -> dict:
    parsed = parse_workbook(filename, data)
    if not parsed:
        return {
            "created": 0,
            "updated": 0,
            "racks_created": 0,
            "skipped": 0,
            "rows": 0,
            "errors": ["File contained no rows"],
            "names": [],
            "sheet": "",
            "orientation": "rows",
        }

    chosen = sheet or pick_sheet([describe_sheet(n, g) for n, g in parsed])
    grid = next((g for n, g in parsed if n == chosen), parsed[0][1])
    used_sheet = next((n for n, g in parsed if n == chosen), parsed[0][0])
    orientation = orientation or detect_orientation(grid)
    if header_index is None:
        header_index = _best_header_index(grid, orientation)
    used_mapping = _parse_mapping(mapping)
    rows = records_from_grid(grid, orientation, header_index, used_mapping)

    created = 0
    updated = 0
    racks_created = 0
    skipped = 0
    errors: list[str] = []
    names: list[str] = []
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

        dtype = _normalize_type(row.get("device_type", ""))
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
            names.append(payload["name"])
            learn_values(
                db,
                vendor=payload["vendor"],
                model=payload["model"],
                device_type=payload["device_type"],
                function=payload["function"],
            )
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
        "names": names[:25],
        "sheet": used_sheet,
        "orientation": orientation,
    }


# Back-compat for older tests / callers that only need row dicts from a simple table.
def parse_table(filename: str, data: bytes) -> list[dict[str, str]]:
    preview = preview_import(filename, data)
    if not preview["sheets"]:
        return []
    chosen = next((s for s in preview["sheets"] if s["name"] == preview["suggested_sheet"]), preview["sheets"][0])
    parsed = parse_workbook(filename, data)
    grid = next((g for n, g in parsed if n == chosen["name"]), parsed[0][1])
    mapping = {h["suggested"]: h["index"] for h in chosen["headers"] if h["suggested"]}
    return records_from_grid(grid, chosen["orientation"], chosen["header_index"], mapping or None)
