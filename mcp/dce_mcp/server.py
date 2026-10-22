"""MCP server. Stdio for a local agent, or streamable HTTP bound to loopback."""

from __future__ import annotations

import os
import secrets
from typing import Any

from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import AnyHttpUrl

from dce_mcp.client import DCEClient
from dce_mcp.tools import (
    add_handoff_note,
    get_device,
    list_open_work,
    list_projects,
    rack_elevation,
    search,
    upsert_device,
)

INSTRUCTIONS = (
    "DCEngineer inventory. Read tools omit serial, asset tag, management IP, and notes "
    "when a device, rack, row, area, or project is capture-restricted. "
    "upsert_device and add_handoff_note require inventory:write on the API key. "
    "This server does not accept photos."
)

_READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=True)
_UPSERT = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=True)
_NOTE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True)


class StaticKeyVerifier(TokenVerifier):
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            ok = secrets.compare_digest(token, self.api_key)
        except Exception:
            ok = False
        if not ok:
            return None
        return AccessToken(token=token, client_id="dcengineer", scopes=["dcengineer"])


def _csv(name: str) -> list[str]:
    return [part.strip() for part in os.environ.get(name, "").split(",") if part.strip()]


def build_server(base_url: str, api_key: str, *, http_auth: bool = False) -> FastMCP:
    client = DCEClient(base_url, api_key)
    auth = None
    verifier = None
    security = None
    if http_auth:
        public = os.environ.get("MCP_PUBLIC_URL") or f"http://{os.environ.get('MCP_HOST', '127.0.0.1')}:{os.environ.get('MCP_PORT', '8765')}"
        issuer = base_url if "://" in base_url else f"http://{base_url}"
        auth = AuthSettings(
            issuer_url=AnyHttpUrl(issuer),
            resource_server_url=AnyHttpUrl(public),
            required_scopes=["dcengineer"],
        )
        verifier = StaticKeyVerifier(api_key)
        hosts = ["127.0.0.1:*", "localhost:*", "[::1]:*"] + _csv("MCP_ALLOWED_HOSTS")
        origins = _csv("MCP_ALLOWED_ORIGINS")
        security = TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=hosts,
            allowed_origins=origins,
        )
    mcp = FastMCP(
        "DCEngineer",
        instructions=INSTRUCTIONS,
        token_verifier=verifier,
        auth=auth,
        transport_security=security,
        host=os.environ.get("MCP_HOST", "127.0.0.1"),
        port=int(os.environ.get("MCP_PORT", "8765")),
        stateless_http=True,
        json_response=True,
    )

    @mcp.tool(name="list_projects", annotations=_READ, structured_output=False)
    def list_projects_tool(limit: int = 100) -> list[dict]:
        """List projects: id, name, customer, site, and phase."""
        return list_projects(client, limit=limit)

    @mcp.tool(name="search", annotations=_READ, structured_output=False)
    def search_tool(query: str, project_id: int | None = None, limit: int = 40) -> dict:
        """Search projects, areas, rows, racks, and devices."""
        return search(client, query, project_id=project_id, limit=limit)

    @mcp.tool(name="get_device", annotations=_READ, structured_output=False)
    def get_device_tool(project_id: int, device_id: int) -> dict:
        """Fetch one device. Restricted gear omits serial, asset tag, management IP, and notes."""
        return get_device(client, project_id, device_id)

    @mcp.tool(name="rack_elevation", annotations=_READ, structured_output=False)
    def rack_elevation_tool(project_id: int, rack_id: int) -> dict:
        """Rack elevation: U slots and the devices in them."""
        return rack_elevation(client, project_id, rack_id)

    @mcp.tool(name="list_open_work", annotations=_READ, structured_output=False)
    def list_open_work_tool(project_id: int | None = None, limit: int = 50) -> dict:
        """Open incidents and work orders that are not complete or cancelled."""
        return list_open_work(client, project_id=project_id, limit=limit)

    @mcp.tool(name="upsert_device", annotations=_UPSERT, structured_output=False)
    def upsert_device_tool(
        project_id: int,
        name: str | None = None,
        serial: str | None = None,
        external_id: str | None = None,
        source: str | None = None,
        rack_id: int | None = None,
        vendor: str | None = None,
        model: str | None = None,
        hostname: str | None = None,
        asset_tag: str | None = None,
        device_type: str | None = None,
        function: str | None = None,
        ru_start: int | None = None,
        ru_end: int | None = None,
        owner: str | None = None,
        management_ip: str | None = None,
        notes: str | None = None,
        match: str | None = None,
    ) -> dict:
        """Create or update a device by serial or external_id. Does not move a device to another rack."""
        fields: dict[str, Any] = {
            "name": name,
            "serial": serial,
            "external_id": external_id,
            "source": source,
            "rack_id": rack_id,
            "vendor": vendor,
            "model": model,
            "hostname": hostname,
            "asset_tag": asset_tag,
            "device_type": device_type,
            "function": function,
            "ru_start": ru_start,
            "ru_end": ru_end,
            "owner": owner,
            "management_ip": management_ip,
            "notes": notes,
            "match": match,
        }
        return upsert_device(client, project_id, fields)

    @mcp.tool(name="add_handoff_note", annotations=_NOTE, structured_output=False)
    def add_handoff_note_tool(
        project_id: int,
        summary: str,
        handoff_date: str | None = None,
        from_name: str = "",
        to_name: str = "",
    ) -> dict:
        """Add a daily hand-off note on a project."""
        return add_handoff_note(
            client,
            project_id,
            summary,
            handoff_date=handoff_date,
            from_name=from_name,
            to_name=to_name,
        )

    return mcp
