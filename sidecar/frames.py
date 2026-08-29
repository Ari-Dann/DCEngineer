from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger("dce-sidecar")

VIDEO_TYPES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/mpeg",
    "video/3gpp",
}
VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".mpeg", ".mpg"}


def is_video(filename: str, content_type: str) -> bool:
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in VIDEO_TYPES or ctype.startswith("video/"):
        return True
    return Path(filename or "").suffix.lower() in VIDEO_SUFFIXES


def extract_frames(data: bytes, filename: str, max_frames: int = 24) -> list[tuple[bytes, int]]:
    """Return JPEG frames (bytes, timestamp_ms) from a video clip."""
    if not shutil.which("ffmpeg"):
        log.warning("ffmpeg not installed; cannot extract frames from %s", filename)
        return []
    suffix = Path(filename or "clip.mp4").suffix or ".mp4"
    frames: list[tuple[bytes, int]] = []
    with tempfile.TemporaryDirectory(prefix="dce-frames-") as tmp:
        src = Path(tmp) / f"src{suffix}"
        out_dir = Path(tmp) / "frames"
        out_dir.mkdir()
        src.write_bytes(data)
        pattern = str(out_dir / "frame_%03d.jpg")
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-vf",
            "select='gt(scene,0.22)+eq(n,0)',scale='min(1280,iw)':-2",
            "-vsync",
            "vfr",
            "-frames:v",
            str(max_frames),
            "-q:v",
            "4",
            pattern,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        files = sorted(out_dir.glob("frame_*.jpg"))
        if result.returncode != 0 or not files:
            fallback = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(src),
                "-vf",
                "fps=1,scale='min(1280,iw)':-2",
                "-frames:v",
                str(max_frames),
                "-q:v",
                "4",
                pattern,
            ]
            subprocess.run(fallback, capture_output=True, text=True, check=False)
            files = sorted(out_dir.glob("frame_*.jpg"))
        for i, path in enumerate(files[:max_frames]):
            frames.append((path.read_bytes(), i * 1000))
    log.info("Extracted %s frames from %s", len(frames), filename)
    return frames
