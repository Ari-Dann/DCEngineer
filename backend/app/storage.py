"""Pluggable object storage: local (also used for NFS bind-mounts) and SFTP."""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from app.config import get_settings


class StorageBackend(Protocol):
    def put(self, key: str, data: bytes) -> str: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...


def new_key(filename: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)[:120]
    return f"{uuid4().hex}/{safe}"


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if ".." in key.split("/"):
            raise ValueError("invalid storage key")
        path = (self.root / key).resolve()
        if not str(path).startswith(str(self.root.resolve())):
            raise ValueError("path escape")
        return path

    def put(self, key: str, data: bytes) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()


class SFTPStorage:
    def __init__(self):
        settings = get_settings()
        self.settings = settings

    def _connect(self):
        import paramiko

        client = paramiko.SSHClient()
        if self.settings.sftp_known_hosts:
            client.load_host_keys(self.settings.sftp_known_hosts)
            client.set_missing_host_key_policy(paramiko.RejectPolicy())
        else:
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        kwargs = {
            "hostname": self.settings.sftp_host,
            "port": self.settings.sftp_port,
            "username": self.settings.sftp_user,
            "timeout": 20,
        }
        if self.settings.sftp_key_path:
            kwargs["key_filename"] = self.settings.sftp_key_path
        if self.settings.sftp_password:
            kwargs["password"] = self.settings.sftp_password
        client.connect(**kwargs)
        return client

    def _remote(self, key: str) -> str:
        base = self.settings.sftp_remote_path.rstrip("/")
        return f"{base}/{key}"

    def put(self, key: str, data: bytes) -> str:
        client = self._connect()
        try:
            sftp = client.open_sftp()
            remote = self._remote(key)
            dirname = os.path.dirname(remote)
            self._mkdirs(sftp, dirname)
            with sftp.file(remote, "wb") as handle:
                handle.write(data)
            sftp.close()
        finally:
            client.close()
        return key

    def get(self, key: str) -> bytes:
        client = self._connect()
        try:
            sftp = client.open_sftp()
            with sftp.file(self._remote(key), "rb") as handle:
                data = handle.read()
            sftp.close()
        finally:
            client.close()
        return data

    def delete(self, key: str) -> None:
        client = self._connect()
        try:
            sftp = client.open_sftp()
            try:
                sftp.remove(self._remote(key))
            except FileNotFoundError:
                pass
            sftp.close()
        finally:
            client.close()

    def exists(self, key: str) -> bool:
        client = self._connect()
        try:
            sftp = client.open_sftp()
            try:
                sftp.stat(self._remote(key))
                found = True
            except FileNotFoundError:
                found = False
            sftp.close()
        finally:
            client.close()
        return found

    @staticmethod
    def _mkdirs(sftp, path: str) -> None:
        parts = []
        while path not in ("", "/"):
            parts.append(path)
            path = os.path.dirname(path)
        for part in reversed(parts):
            try:
                sftp.stat(part)
            except FileNotFoundError:
                sftp.mkdir(part)


_storage: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _storage
    if _storage is None:
        settings = get_settings()
        backend = settings.storage_backend.lower()
        if backend in ("local", "nfs"):
            _storage = LocalStorage(settings.storage_local_path)
        elif backend == "sftp":
            _storage = SFTPStorage()
        else:
            raise RuntimeError(f"Unknown STORAGE_BACKEND={backend}")
    return _storage


def reset_storage() -> None:
    global _storage
    _storage = None
