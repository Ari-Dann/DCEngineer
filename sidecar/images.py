from __future__ import annotations

import base64

IMAGE_TYPES = {
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/gif": "image/gif",
    "image/webp": "image/webp",
}


def media_type_for(content_type: str, filename: str) -> str | None:
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in IMAGE_TYPES:
        return IMAGE_TYPES[ctype]
    suffix = (filename or "").rsplit(".", 1)[-1].lower()
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
    }.get(suffix)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def data_url(data: bytes, media_type: str) -> str:
    return f"data:{media_type};base64,{b64(data)}"
