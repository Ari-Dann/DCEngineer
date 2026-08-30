from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    dce_app_name: str = "DCEngineer"
    dce_hostname: str = "localhost"
    dce_public_url: str = "http://localhost:8080"
    dce_port: int = 8080
    tz: str = "UTC"
    log_level: str = "INFO"

    jwt_secret: str = "insecure-dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_minutes: int = 480
    jwt_refresh_days: int = 14

    bootstrap_admin_user: str = "admin"
    bootstrap_admin_password: str = "admin"
    bootstrap_admin_email: str = "admin@localhost"

    bootstrap_sidecar_user: str = ""
    bootstrap_sidecar_password: str = ""
    bootstrap_sidecar_email: str = "sidecar@localhost"

    database_url: str = "sqlite:////data/dcengineer.db"

    cors_origins: str = ""
    max_upload_mb: int = 32
    near_eol_days: int = 365

    storage_backend: str = "local"  # local | nfs | sftp
    storage_local_path: str = "/data/files"
    static_dir: str = "/app/static"

    nfs_host: str = ""
    nfs_export: str = ""
    nfs_mount_options: str = "rw,nfsvers=4"

    sftp_host: str = ""
    sftp_port: int = 22
    sftp_user: str = ""
    sftp_password: str = ""
    sftp_key_path: str = ""
    sftp_remote_path: str = "/dcengineer"
    sftp_known_hosts: str = ""

    backup_enabled: bool = True
    backup_interval_hours: int = 6
    backup_keep: int = 14
    backup_path: str = "/backups"

    reverse_proxy: str = "traefik"

    @property
    def cors_origin_list(self) -> List[str]:
        raw = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        if self.dce_public_url:
            raw.append(self.dce_public_url.rstrip("/"))
        return list(dict.fromkeys(raw)) or ["*"]

    @property
    def sqlite_path(self) -> str | None:
        if self.database_url.startswith("sqlite"):
            return self.database_url.split("///")[-1]
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
