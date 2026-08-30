from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from schema import EXTRACTION_SCHEMA, JSON_SYSTEM_PROMPT, SYSTEM_PROMPT, extraction_prompt

log = logging.getLogger("dce-sidecar")

PROVIDERS = ("claude", "gemini", "huggingface", "openai", "ollama")

# Short names for testing. Llama 3.1 has no official vision weights; 3.1 aliases map to 3.2.
HF_ALIASES = {
    "llama-3.2-vision": "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "llama-3.2-11b-vision": "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "llama-3.2-90b-vision": "meta-llama/Llama-3.2-90B-Vision-Instruct",
    "llama-3.1-vision": "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "llama3.2-vision": "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "qwen-vl": "Qwen/Qwen2.5-VL-7B-Instruct",
    "qwen2.5-vl": "Qwen/Qwen2.5-VL-7B-Instruct",
    "qwen2-vl": "Qwen/Qwen2-VL-7B-Instruct",
    "qwen-vl-7b": "Qwen/Qwen2.5-VL-7B-Instruct",
}

OLLAMA_ALIASES = {
    "llama-3.2-vision": "llama3.2-vision",
    "llama-3.1-vision": "llama3.2-vision",
    "llama3.2-vision": "llama3.2-vision",
    "qwen-vl": "qwen2.5vl",
    "qwen2.5-vl": "qwen2.5vl",
    "qwen2-vl": "qwen2-vl",
}

GEMINI_ALIASES = {
    "gemini-flash": "gemini-2.0-flash",
    "gemini-pro": "gemini-2.5-pro",
}

DEFAULT_MODELS = {
    "claude": "claude-sonnet-4-20250514",
    "gemini": "gemini-2.0-flash",
    "huggingface": "Qwen/Qwen2.5-VL-7B-Instruct",
    "openai": "gpt-4o",
    "ollama": "llama3.2-vision",
}

DEFAULT_BASE_URLS = {
    "claude": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "huggingface": "https://router.huggingface.co/v1",
    "openai": "https://api.openai.com/v1",
    "ollama": "http://ollama:11434",
}


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name, default) or default).strip()


def detect_provider() -> str:
    explicit = env("VISION_PROVIDER").lower()
    if explicit:
        if explicit in ("hf", "hugging-face", "hugging_face"):
            return "huggingface"
        if explicit in ("google", "google-gemini"):
            return "gemini"
        if explicit not in PROVIDERS:
            raise SystemExit(f"VISION_PROVIDER must be one of {', '.join(PROVIDERS)}")
        return explicit
    if env("ANTHROPIC_API_KEY"):
        return "claude"
    if env("GEMINI_API_KEY") or env("GOOGLE_API_KEY"):
        return "gemini"
    if env("HF_TOKEN") or env("HUGGINGFACE_API_KEY") or env("HUGGINGFACEHUB_API_TOKEN"):
        return "huggingface"
    if env("OPENAI_API_KEY"):
        return "openai"
    if env("OLLAMA_HOST") or env("VISION_BASE_URL"):
        return "ollama" if "11434" in env("VISION_BASE_URL") or env("OLLAMA_HOST") else "openai"
    return "claude"


def resolve_model(provider: str, model: str) -> str:
    raw = (model or "").strip() or DEFAULT_MODELS[provider]
    key = raw.lower()
    if provider == "huggingface":
        if key in {"llama-3.1-vision", "llama3.1-vision"}:
            log.warning("Llama 3.1 has no official vision weights; using Llama 3.2 Vision")
        return HF_ALIASES.get(key, raw)
    if provider == "ollama":
        if key in {"llama-3.1-vision", "llama3.1-vision"}:
            log.warning("Llama 3.1 has no official vision weights; using Ollama llama3.2-vision")
        return OLLAMA_ALIASES.get(key, raw)
    if provider == "gemini":
        return GEMINI_ALIASES.get(key, raw)
    return raw


def api_key_for(provider: str) -> str:
    if provider == "claude":
        return env("ANTHROPIC_API_KEY") or env("VISION_API_KEY")
    if provider == "gemini":
        return env("GEMINI_API_KEY") or env("GOOGLE_API_KEY") or env("VISION_API_KEY")
    if provider == "huggingface":
        return env("HF_TOKEN") or env("HUGGINGFACE_API_KEY") or env("HUGGINGFACEHUB_API_TOKEN") or env("VISION_API_KEY")
    if provider == "openai":
        return env("OPENAI_API_KEY") or env("VISION_API_KEY")
    if provider == "ollama":
        return env("OLLAMA_API_KEY") or env("VISION_API_KEY")
    return env("VISION_API_KEY")


@dataclass
class VisionBackend:
    provider: str
    model: str
    api_key: str
    base_url: str
    timeout: float = 120.0
    hf_provider: str = ""

    @property
    def ready(self) -> bool:
        if self.provider == "ollama":
            return bool(self.base_url)
        return bool(self.api_key)

    @property
    def missing(self) -> str:
        if self.provider == "claude":
            return "ANTHROPIC_API_KEY"
        if self.provider == "gemini":
            return "GEMINI_API_KEY (or GOOGLE_API_KEY)"
        if self.provider == "huggingface":
            return "HF_TOKEN"
        if self.provider == "openai":
            return "OPENAI_API_KEY"
        if self.provider == "ollama":
            return "VISION_BASE_URL or OLLAMA_HOST"
        return "VISION_API_KEY"

    def extract(self, images, shot_kind: str, notes: str = "") -> tuple[dict, str, str]:
        if self.provider == "claude":
            from claude import extract as claude_extract

            return claude_extract(self.api_key, self.model, images, shot_kind, notes, timeout=self.timeout)
        if self.provider == "gemini":
            from gemini import extract as gemini_extract

            return gemini_extract(
                self.api_key,
                self.model,
                images,
                shot_kind,
                notes,
                timeout=self.timeout,
                base_url=self.base_url,
            )
        from openai_compat import extract as openai_extract

        native = self.provider == "ollama" and "/v1" not in self.base_url.rstrip("/")
        return openai_extract(
            self.api_key,
            self.model,
            images,
            shot_kind,
            notes,
            timeout=self.timeout,
            base_url=self.base_url,
            native_ollama=native,
        )


def load_backend() -> VisionBackend:
    provider = detect_provider()
    model = resolve_model(provider, env("VISION_MODEL"))
    base = env("VISION_BASE_URL") or env("OLLAMA_HOST") or DEFAULT_BASE_URLS[provider]
    if provider == "ollama" and base.startswith("http") is False:
        base = f"http://{base}"
    timeout = float(env("VISION_TIMEOUT", "120") or "120")
    hf_provider = env("HF_PROVIDER") or env("VISION_HF_PROVIDER")
    if hf_provider and provider == "huggingface" and ":" not in model:
        # router.huggingface.co accepts model:provider
        model = f"{model}:{hf_provider}"
    backend = VisionBackend(
        provider=provider,
        model=model,
        api_key=api_key_for(provider),
        base_url=base,
        timeout=timeout,
        hf_provider=hf_provider,
    )
    log.info("Vision provider=%s model=%s", backend.provider, backend.model)
    return backend


# Re-export for tests that import prompt helpers from here.
__all__ = [
    "PROVIDERS",
    "VisionBackend",
    "detect_provider",
    "load_backend",
    "resolve_model",
    "EXTRACTION_SCHEMA",
    "SYSTEM_PROMPT",
    "JSON_SYSTEM_PROMPT",
    "extraction_prompt",
]
