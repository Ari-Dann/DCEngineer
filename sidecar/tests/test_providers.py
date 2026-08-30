import json

from gemini import parse_gemini_response
from jsonutil import parse_json_object, without_additional_properties
from openai_compat import parse_ollama_response, parse_openai_response
from providers import detect_provider, load_backend, resolve_model
from schema import EXTRACTION_SCHEMA


def test_parse_json_object_from_fenced_markdown():
    text = """Here you go:
```json
{"devices": [{"name": "rtr-1", "serial": ""}]}
```
"""
    assert parse_json_object(text)["devices"][0]["name"] == "rtr-1"


def test_parse_json_wraps_bare_device():
    out = parse_json_object('{"name": "sw-1", "vendor": "Cisco"}')
    assert out["devices"][0]["name"] == "sw-1"


def test_gemini_parses_candidates():
    body = {
        "candidates": [
            {"content": {"parts": [{"text": '{"devices": [{"name": "pdu-a", "serial": ""}]}'}]}}
        ]
    }
    assert parse_gemini_response(body)["devices"][0]["name"] == "pdu-a"


def test_openai_parses_chat_content():
    body = {"choices": [{"message": {"content": '{"devices": [{"name": "x"}]}'}}]}
    assert parse_openai_response(body)["devices"][0]["name"] == "x"


def test_openai_parses_tool_call():
    body = {
        "choices": [
            {
                "message": {
                    "tool_calls": [
                        {"function": {"name": "submit_inventory_extraction", "arguments": '{"devices": [{"name": "y"}]}'}}
                    ]
                }
            }
        ]
    }
    assert parse_openai_response(body)["devices"][0]["name"] == "y"


def test_ollama_parses_message_content():
    body = {"message": {"content": '{"devices": [{"name": "ollama-sw"}]}'}}
    assert parse_ollama_response(body)["devices"][0]["name"] == "ollama-sw"


def test_llama31_alias_maps_to_llama32(monkeypatch):
    monkeypatch.delenv("VISION_PROVIDER", raising=False)
    resolved = resolve_model("huggingface", "llama-3.1-vision")
    assert resolved == "meta-llama/Llama-3.2-11B-Vision-Instruct"
    assert resolve_model("huggingface", "qwen-vl") == "Qwen/Qwen2.5-VL-7B-Instruct"
    assert resolve_model("huggingface", "qwen2-vl") == "Qwen/Qwen2-VL-7B-Instruct"
    assert resolve_model("ollama", "llama-3.2-vision") == "llama3.2-vision"
    assert resolve_model("gemini", "gemini-flash") == "gemini-2.0-flash"


def test_detect_gemini_from_key(monkeypatch):
    monkeypatch.delenv("VISION_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert detect_provider() == "gemini"


def test_detect_huggingface_from_token(monkeypatch):
    monkeypatch.setenv("VISION_PROVIDER", "")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("HF_TOKEN", "hf_test")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert detect_provider() == "huggingface"


def test_load_huggingface_backend(monkeypatch):
    monkeypatch.setenv("VISION_PROVIDER", "huggingface")
    monkeypatch.setenv("VISION_MODEL", "qwen-vl")
    monkeypatch.setenv("HF_TOKEN", "hf_test")
    backend = load_backend()
    assert backend.provider == "huggingface"
    assert backend.model == "Qwen/Qwen2.5-VL-7B-Instruct"
    assert backend.ready
    assert "huggingface.co" in backend.base_url


def test_load_gemini_backend(monkeypatch):
    monkeypatch.setenv("VISION_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "g-test")
    monkeypatch.delenv("VISION_MODEL", raising=False)
    backend = load_backend()
    assert backend.provider == "gemini"
    assert backend.model == "gemini-2.0-flash"
    assert backend.ready


def test_huggingface_without_token_is_not_ready(monkeypatch):
    monkeypatch.setenv("VISION_PROVIDER", "huggingface")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_KEY", raising=False)
    monkeypatch.delenv("HUGGINGFACEHUB_API_TOKEN", raising=False)
    monkeypatch.delenv("VISION_API_KEY", raising=False)
    backend = load_backend()
    assert not backend.ready
    assert "HF_TOKEN" in backend.missing


def test_ollama_ready_without_cloud_key(monkeypatch):
    monkeypatch.setenv("VISION_PROVIDER", "ollama")
    monkeypatch.setenv("VISION_MODEL", "llama-3.2-vision")
    monkeypatch.delenv("VISION_API_KEY", raising=False)
    backend = load_backend()
    assert backend.ready
    assert backend.model == "llama3.2-vision"


def test_schema_strip_keeps_devices():
    stripped = without_additional_properties(EXTRACTION_SCHEMA)
    assert "additionalProperties" not in stripped
    assert stripped["properties"]["devices"]["type"] == "array"


def test_gemini_extract_posts_inline_images(monkeypatch):
    import gemini

    captured = {}

    class FakeResponse:
        status_code = 200
        is_success = True
        text = ""

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "candidates": [
                    {"content": {"parts": [{"text": json.dumps({"devices": [{"name": "from-gemini"}]})}]}}
                ]
            }

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return FakeResponse()

    monkeypatch.setattr(gemini.httpx, "post", fake_post)
    extraction, _prompt, model = gemini.extract(
        "key",
        "gemini-2.0-flash",
        [(b"jpeg-bytes", "image/jpeg", "rack face")],
        "rack_face",
    )
    assert extraction["devices"][0]["name"] == "from-gemini"
    assert model == "gemini-2.0-flash"
    assert captured["json"]["contents"][0]["parts"][0]["inlineData"]["mimeType"] == "image/jpeg"
    assert captured["headers"]["x-goog-api-key"] == "key"


def test_openai_compat_posts_data_urls(monkeypatch):
    import openai_compat

    captured = {}

    class FakeResponse:
        status_code = 200
        is_success = True
        text = ""

        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({"devices": [{"name": "from-hf"}]})}}]}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return FakeResponse()

    monkeypatch.setattr(openai_compat.httpx, "post", fake_post)
    extraction, _prompt, model = openai_compat.extract(
        "hf_test",
        "Qwen/Qwen2.5-VL-7B-Instruct",
        [(b"jpeg-bytes", "image/jpeg", "serial frame")],
        "device_close",
        base_url="https://router.huggingface.co/v1",
    )
    assert extraction["devices"][0]["name"] == "from-hf"
    assert model.startswith("Qwen/")
    assert captured["url"].endswith("/chat/completions")
    content = captured["json"]["messages"][1]["content"]
    assert any(part.get("type") == "image_url" for part in content)
    assert captured["headers"]["Authorization"] == "Bearer hf_test"
