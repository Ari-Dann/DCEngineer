import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from dce_mcp.client import DCEError
from dce_mcp.redact import redact_device
from dce_mcp.tools import get_device, list_open_work, list_projects, rack_elevation, search, upsert_device


def test_redact_clears_secrets_when_capture_restricted():
    row = redact_device(
        {
            "name": "core",
            "serial": "SN1",
            "asset_tag": "A-1",
            "management_ip": "10.1.1.1",
            "notes": "cabinet combo",
            "capture_restricted": True,
            "restricted": False,
        }
    )
    assert row["name"] == "core"
    assert row["serial"] == ""
    assert row["asset_tag"] == ""
    assert row["management_ip"] == ""
    assert row["notes"] == ""
    assert row["redacted"] is True


def test_redact_keeps_a_normal_device():
    row = redact_device({"name": "leaf", "serial": "SN2", "restricted": False, "photography_allowed": True})
    assert row["serial"] == "SN2"
    assert row["redacted"] is False


class FakeClient:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, path, params=None):
        self.calls.append(("GET", path, params))
        return self.responses[path]

    def post(self, path, payload):
        self.calls.append(("POST", path, payload))
        if path not in self.responses:
            raise DCEError(403, "Insufficient scope")
        return self.responses[path]


def test_list_projects_summarizes():
    client = FakeClient(
        {
            "/api/projects": [
                {
                    "id": 3,
                    "name": "Hall A",
                    "customer": "Acme",
                    "site_name": "PHX",
                    "status": "phase2",
                    "restricted": True,
                }
            ]
        }
    )
    rows = list_projects(client)
    assert rows == [
        {
            "id": 3,
            "name": "Hall A",
            "customer": "Acme",
            "site_name": "PHX",
            "status": "phase2",
            "capture_restricted": True,
        }
    ]


def test_search_and_elevation_redact():
    device = {"id": 8, "name": "fw", "serial": "SECRET", "capture_restricted": True, "notes": "hide"}
    client = FakeClient(
        {
            "/api/search": {"q": "fw", "devices": [device], "projects": [], "areas": [], "rows": [], "racks": []},
            "/api/projects/3/devices/8": device,
            "/api/projects/3/racks/4/elevation": {
                "rack": {"id": 4, "name": "A01", "restricted": True, "photography_allowed": False},
                "devices": [{"id": 8, "name": "fw", "serial": "SECRET", "capture_restricted": False}],
                "slots": [{"u": 42, "device_id": 8}],
            },
        }
    )
    found = search(client, "fw", project_id=3)
    assert found["devices"][0]["serial"] == ""
    assert get_device(client, 3, 8)["notes"] == ""
    elevation = rack_elevation(client, 3, 4)
    assert elevation["devices"][0]["serial"] == ""
    assert elevation["slots"][0]["device_id"] == 8


def test_open_work_and_upsert_payload():
    client = FakeClient(
        {
            "/api/incidents": [{"id": 1, "project_id": 3, "title": "fan", "severity": "high", "status": "open", "vendor_ticket": "T1"}],
            "/api/work-orders": [{"id": 2, "project_id": 3, "title": "swap", "status": "planned", "wtype": "install", "priority": "normal"}],
            "/api/projects/3/devices/upsert": {
                "action": "updated",
                "device": {"id": 9, "name": "core", "serial": "SN", "capture_restricted": False},
            },
        }
    )
    work = list_open_work(client, project_id=3)
    assert work["incidents"][0]["vendor_ticket"] == "T1"
    assert work["work_orders"][0]["title"] == "swap"
    assert client.calls[0][2]["open_only"] == "true"
    result = upsert_device(client, 3, {"serial": "SN", "name": None, "vendor": "Cisco"})
    assert result["action"] == "updated"
    assert result["device"]["serial"] == "SN"
    posted = client.calls[-1]
    assert posted[0] == "POST"
    assert posted[2] == {"serial": "SN", "vendor": "Cisco"}


def test_server_registers_the_agent_tools():
    from dce_mcp.server import build_server

    server = build_server("http://127.0.0.1:8080", "dce_live_test")
    names = sorted(tool.name for tool in server._tool_manager.list_tools())
    assert names == [
        "add_handoff_note",
        "get_device",
        "list_open_work",
        "list_projects",
        "rack_elevation",
        "search",
        "upsert_device",
    ]


def test_upsert_surfaces_scope_errors():
    client = FakeClient({})
    with pytest.raises(DCEError) as caught:
        upsert_device(client, 3, {"serial": "SN"})
    assert caught.value.status == 403
