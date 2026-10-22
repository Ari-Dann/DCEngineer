"""Tool bodies. They talk to the DCEngineer REST API and redact restricted gear."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from dce_mcp.client import DCEClient
from dce_mcp.redact import is_restricted, redact_device, redact_devices


def list_projects(client: DCEClient, limit: int = 100) -> list[dict]:
    rows = client.get("/api/projects", params={"limit": limit}) or []
    return [
        {
            "id": row["id"],
            "name": row.get("name") or "",
            "customer": row.get("customer") or "",
            "site_name": row.get("site_name") or "",
            "status": row.get("status") or "",
            "capture_restricted": bool(row.get("restricted") or row.get("photography_allowed") is False),
        }
        for row in rows
    ]


def search(client: DCEClient, query: str, project_id: int | None = None, limit: int = 40) -> dict:
    params: dict[str, Any] = {"q": query, "limit": limit}
    if project_id:
        params["project_id"] = project_id
    body = client.get("/api/search", params=params) or {}
    devices = redact_devices(body.get("devices") or [])
    return {
        "q": body.get("q") or query,
        "projects": body.get("projects") or [],
        "areas": body.get("areas") or [],
        "rows": body.get("rows") or [],
        "racks": body.get("racks") or [],
        "devices": devices,
    }


def get_device(client: DCEClient, project_id: int, device_id: int) -> dict:
    row = client.get(f"/api/projects/{project_id}/devices/{device_id}")
    return redact_device(row)


def rack_elevation(client: DCEClient, project_id: int, rack_id: int) -> dict:
    body = client.get(f"/api/projects/{project_id}/racks/{rack_id}/elevation")
    rack = body.get("rack") or {}
    hide = is_restricted(rack)
    devices = redact_devices(body.get("devices") or [], restricted=True if hide else None)
    return {"rack": rack, "devices": devices, "slots": body.get("slots") or []}


def list_open_work(client: DCEClient, project_id: int | None = None, limit: int = 50) -> dict:
    params: dict[str, Any] = {"open_only": "true", "limit": limit}
    if project_id:
        params["project_id"] = project_id
    incidents = client.get("/api/incidents", params=params) or []
    orders = client.get("/api/work-orders", params=params) or []
    return {
        "incidents": [
            {
                "id": row["id"],
                "project_id": row.get("project_id"),
                "title": row.get("title") or "",
                "severity": row.get("severity") or "",
                "status": row.get("status") or "",
                "vendor_ticket": row.get("vendor_ticket") or "",
            }
            for row in incidents
        ],
        "work_orders": [
            {
                "id": row["id"],
                "project_id": row.get("project_id"),
                "title": row.get("title") or "",
                "status": row.get("status") or "",
                "wtype": row.get("wtype") or "",
                "priority": row.get("priority") or "",
            }
            for row in orders
        ],
    }


def upsert_device(client: DCEClient, project_id: int, fields: dict[str, Any]) -> dict:
    payload = {key: value for key, value in fields.items() if value is not None}
    result = client.post(f"/api/projects/{project_id}/devices/upsert", payload)
    device = redact_device(result.get("device") or {})
    return {"action": result.get("action"), "device": device}


def add_handoff_note(
    client: DCEClient,
    project_id: int,
    summary: str,
    handoff_date: str | None = None,
    from_name: str = "",
    to_name: str = "",
) -> dict:
    payload = {
        "handoff_date": handoff_date or datetime.now(timezone.utc).date().isoformat(),
        "summary": summary,
        "from_name": from_name,
        "to_name": to_name,
    }
    return client.post(f"/api/projects/{project_id}/handoffs", payload)
