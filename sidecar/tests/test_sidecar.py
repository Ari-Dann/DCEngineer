from schema import blank_unreadable, extraction_prompt
from worker import proposals_from_extraction, session_is_restricted
from claude import parse_tool_payload
from frames import is_video


def test_blank_unreadable_clears_guessed_serial():
    device = {
        "name": "sw-a01",
        "serial": "FCW-GUESSED",
        "vendor": "Cisco",
        "unreadable_fields": ["serial", "model"],
        "model": "C9300",
    }
    cleaned = blank_unreadable(device)
    assert cleaned["serial"] == ""
    assert cleaned["model"] == ""
    assert cleaned["name"] == "sw-a01"
    assert cleaned["vendor"] == "Cisco"


def test_session_restricted_flag_blocks_send():
    reason = session_is_restricted(
        {
            "restricted_blocked": True,
            "error_detail": "Restricted equipment — photos were not sent to the vision model.",
            "clips": [],
        }
    )
    assert reason
    assert "not sent" in reason.lower()


def test_photography_restricted_clip_blocks_send():
    reason = session_is_restricted(
        {
            "restricted_blocked": False,
            "restriction_reasons": [],
            "clips": [{"photography_restricted": True, "attachment_id": 9}],
        }
    )
    assert reason


def test_open_session_is_not_blocked():
    assert session_is_restricted({"restricted_blocked": False, "clips": [{"photography_restricted": False}]}) is None


def test_proposals_include_audit_and_evidence():
    extraction = {
        "layout": {"rows": [{"name": "A12"}]},
        "devices": [
            {
                "name": "rtr-1",
                "serial": "",
                "unreadable_fields": ["serial"],
                "evidence": [{"clip_index": 0, "reason": "faceplate"}],
            }
        ],
    }
    clips = [{"attachment_id": 44, "kind": "device_close"}]
    payload = proposals_from_extraction(extraction, clips, "prompt-body", "claude-test", [44])
    assert payload["model"] == "claude-test"
    assert payload["extractor_model"] == "claude-test"
    assert "Never guess" in payload["prompt_text"] or "prompt-body" in payload["prompt_text"]
    assert payload["raw_extraction"]["devices"][0]["name"] == "rtr-1"
    assert payload["proposals"][0]["serial"] == ""
    assert payload["proposals"][0]["evidence_attachment_ids"] == [44]
    assert payload["layout"]["rows"][0]["name"] == "A12"


def test_parse_tool_use_payload():
    body = {
        "content": [
            {"type": "tool_use", "name": "submit_inventory_extraction", "input": {"devices": [{"name": "x"}]}}
        ]
    }
    assert parse_tool_payload(body)["devices"][0]["name"] == "x"


def test_is_video_detects_webm():
    assert is_video("aisle.webm", "video/webm")
    assert not is_video("face.jpg", "image/jpeg")


def test_extraction_prompt_lists_clip_order():
    text = extraction_prompt("aisle_wide", ["aisle clip 0", "serial frame 1"])
    assert "index 0: aisle clip 0" in text
    assert "aisle_wide" in text
