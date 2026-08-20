"""Periodic application backups (sqlite + local files) into BACKUP_PATH."""

from __future__ import annotations

import asyncio
import logging
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import AppBackup

log = logging.getLogger("dcengineer.backup")


def run_backup(db: Session | None = None) -> AppBackup:
    settings = get_settings()
    dest_dir = Path(settings.backup_path)
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"dcengineer-{stamp}.tar.gz"
    dest = dest_dir / filename

    own_session = db is None
    if own_session:
        db = SessionLocal()

    try:
        with tarfile.open(dest, "w:gz") as tar:
            sqlite_path = settings.sqlite_path
            if sqlite_path and Path(sqlite_path).exists():
                tar.add(sqlite_path, arcname="dcengineer.db")
                wal = Path(str(sqlite_path) + "-wal")
                shm = Path(str(sqlite_path) + "-shm")
                if wal.exists():
                    tar.add(wal, arcname="dcengineer.db-wal")
                if shm.exists():
                    tar.add(shm, arcname="dcengineer.db-shm")
            files_root = Path(settings.storage_local_path)
            if files_root.exists() and settings.storage_backend.lower() in ("local", "nfs"):
                tar.add(files_root, arcname="files")

        record = AppBackup(
            filename=filename,
            size=dest.stat().st_size,
            backend=settings.storage_backend,
            status="ok",
            detail=str(dest),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        _prune(dest_dir, settings.backup_keep)
        log.info("Backup wrote %s (%s bytes)", dest, record.size)
        return record
    except Exception as exc:  # noqa: BLE001 — persist failure for the GUI
        log.exception("Backup failed")
        record = AppBackup(
            filename=filename,
            size=0,
            backend=settings.storage_backend,
            status="error",
            detail=str(exc),
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    finally:
        if own_session:
            db.close()


def _prune(dest_dir: Path, keep: int) -> None:
    archives = sorted(dest_dir.glob("dcengineer-*.tar.gz"))
    extra = archives[:-keep] if keep > 0 else archives
    for old in extra:
        try:
            old.unlink()
        except OSError:
            log.warning("Could not prune %s", old)


async def backup_loop() -> None:
    settings = get_settings()
    if not settings.backup_enabled:
        return
    interval = max(1, settings.backup_interval_hours) * 3600
    await asyncio.sleep(30)
    while True:
        try:
            await asyncio.to_thread(run_backup)
        except Exception:
            log.exception("Scheduled backup crashed")
        await asyncio.sleep(interval)
