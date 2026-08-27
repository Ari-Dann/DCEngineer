from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="engineer", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    customer: Mapped[str] = mapped_column(String(255), default="")
    site_name: Mapped[str] = mapped_column(String(255), default="")
    site_address: Mapped[str] = mapped_column(String(512), default="")
    revision: Mapped[str] = mapped_column(String(64), default="A")
    status: Mapped[str] = mapped_column(String(32), default="phase1", index=True)
    sponsor: Mapped[str] = mapped_column(String(255), default="")
    escort_logistics: Mapped[str] = mapped_column(Text, default="")
    badging_notes: Mapped[str] = mapped_column(Text, default="")
    photography_rules: Mapped[str] = mapped_column(Text, default="")
    data_handling_rules: Mapped[str] = mapped_column(Text, default="")
    restricted_equipment_notes: Mapped[str] = mapped_column(Text, default="")
    in_scope_summary: Mapped[str] = mapped_column(Text, default="")
    discovery_port_access: Mapped[str] = mapped_column(String(32), default="unknown")
    discovery_cdp_lldp: Mapped[str] = mapped_column(String(32), default="unknown")
    discovery_saas_trial: Mapped[str] = mapped_column(String(32), default="unknown")
    discovery_notes: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    target_end_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    areas: Mapped[list["Area"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    aisle_rows: Mapped[list["AisleRow"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    racks: Mapped[list["Rack"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Area(Base):
    __tablename__ = "areas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    in_scope: Mapped[bool] = mapped_column(Boolean, default=True)
    restricted: Mapped[bool] = mapped_column(Boolean, default=False)
    restriction_type: Mapped[str] = mapped_column(String(64), default="")  # government / EMSS / other
    photography_allowed: Mapped[bool] = mapped_column(Boolean, default=True)

    project: Mapped["Project"] = relationship(back_populates="areas")
    aisle_rows: Mapped[list["AisleRow"]] = relationship(back_populates="area")
    racks: Mapped[list["Rack"]] = relationship(back_populates="area")


class AisleRow(Base):
    """A row / aisle inside an area. Racks belong to a row."""

    __tablename__ = "aisle_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[Optional[int]] = mapped_column(ForeignKey("areas.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped["Project"] = relationship(back_populates="aisle_rows")
    area: Mapped[Optional["Area"]] = relationship(back_populates="aisle_rows")
    racks: Mapped[list["Rack"]] = relationship(back_populates="aisle_row")


class Rack(Base):
    __tablename__ = "racks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[Optional[int]] = mapped_column(ForeignKey("areas.id"), nullable=True, index=True)
    row_id: Mapped[Optional[int]] = mapped_column(ForeignKey("aisle_rows.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    row_label: Mapped[str] = mapped_column(String(64), default="")
    position: Mapped[str] = mapped_column(String(64), default="")
    ru_height: Mapped[int] = mapped_column(Integer, default=42)
    width_inches: Mapped[float] = mapped_column(Float, default=19.0)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped["Project"] = relationship(back_populates="racks")
    area: Mapped[Optional["Area"]] = relationship(back_populates="racks")
    aisle_row: Mapped[Optional["AisleRow"]] = relationship(back_populates="racks")
    devices: Mapped[list["Device"]] = relationship(back_populates="rack", passive_deletes=True)
    pdus: Mapped[list["PDU"]] = relationship(back_populates="rack", cascade="all, delete-orphan")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    rack_id: Mapped[Optional[int]] = mapped_column(ForeignKey("racks.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    hostname: Mapped[str] = mapped_column(String(255), default="")
    vendor: Mapped[str] = mapped_column(String(128), default="", index=True)
    model: Mapped[str] = mapped_column(String(128), default="")
    serial: Mapped[str] = mapped_column(String(128), default="", index=True)
    asset_tag: Mapped[str] = mapped_column(String(128), default="")
    device_type: Mapped[str] = mapped_column(String(64), default="server", index=True)
    function: Mapped[str] = mapped_column(String(255), default="")
    ru_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ru_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    restricted: Mapped[bool] = mapped_column(Boolean, default=False)
    restricted_reason: Mapped[str] = mapped_column(String(128), default="")
    fan_orientation: Mapped[str] = mapped_column(String(64), default="unknown")
    indicator_type: Mapped[str] = mapped_column(String(32), default="unknown")  # none | led | screen | both | unknown
    indicator_color: Mapped[str] = mapped_column(String(32), default="unknown")
    power_draw_watts: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    power_draw_unit: Mapped[str] = mapped_column(String(8), default="W")  # W | kW (display preference)
    management_ip: Mapped[str] = mapped_column(String(64), default="")
    discovered_via: Mapped[str] = mapped_column(String(64), default="physical")
    undocumented: Mapped[bool] = mapped_column(Boolean, default=False)
    eol_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    eos_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    eol_notes: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    captured_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    rack: Mapped[Optional["Rack"]] = relationship(back_populates="devices")


class PDU(Base):
    __tablename__ = "pdus"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rack_id: Mapped[int] = mapped_column(ForeignKey("racks.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    bank: Mapped[str] = mapped_column(String(64), default="A")
    vendor: Mapped[str] = mapped_column(String(128), default="")
    model: Mapped[str] = mapped_column(String(128), default="")
    serial: Mapped[str] = mapped_column(String(128), default="")
    feed: Mapped[str] = mapped_column(String(64), default="")
    amperage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    voltage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    phase: Mapped[str] = mapped_column(String(16), default="1")
    outlet_count: Mapped[int] = mapped_column(Integer, default=24)

    rack: Mapped["Rack"] = relationship(back_populates="pdus")
    ports: Mapped[list["PDUPort"]] = relationship(back_populates="pdu", cascade="all, delete-orphan")


class PDUPort(Base):
    __tablename__ = "pdu_ports"
    __table_args__ = (UniqueConstraint("pdu_id", "port_label", name="uq_pdu_port"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pdu_id: Mapped[int] = mapped_column(ForeignKey("pdus.id", ondelete="CASCADE"), index=True)
    port_label: Mapped[str] = mapped_column(String(32))
    device_id: Mapped[Optional[int]] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    notes: Mapped[str] = mapped_column(String(255), default="")

    pdu: Mapped["PDU"] = relationship(back_populates="ports")


class Cable(Base):
    __tablename__ = "cables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    rack_id: Mapped[Optional[int]] = mapped_column(ForeignKey("racks.id", ondelete="SET NULL"), nullable=True)
    from_label: Mapped[str] = mapped_column(String(255), default="")
    from_port: Mapped[str] = mapped_column(String(64), default="")
    to_label: Mapped[str] = mapped_column(String(255), default="")
    to_port: Mapped[str] = mapped_column(String(64), default="")
    media: Mapped[str] = mapped_column(String(64), default="")
    color: Mapped[str] = mapped_column(String(32), default="")
    traced: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")


class Handoff(Base):
    __tablename__ = "handoffs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    handoff_date: Mapped[str] = mapped_column(String(32), index=True)
    from_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    from_name: Mapped[str] = mapped_column(String(128), default="")
    to_name: Mapped[str] = mapped_column(String(128), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    devices_captured: Mapped[int] = mapped_column(Integer, default=0)
    issues: Mapped[str] = mapped_column(Text, default="")
    follow_ups: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ChecklistTemplate(Base):
    __tablename__ = "checklist_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    phase: Mapped[str] = mapped_column(String(32), default="ops")
    items_json: Mapped[str] = mapped_column(Text, default="[]")


class Checklist(Base):
    __tablename__ = "checklists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    template_key: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(255))
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Inspection(Base):
    __tablename__ = "inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    itype: Mapped[str] = mapped_column(String(64), default="routine")
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    location: Mapped[str] = mapped_column(String(255), default="")
    findings: Mapped[str] = mapped_column(Text, default="")
    checklist_json: Mapped[str] = mapped_column(Text, default="[]")
    due_at: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    severity: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    category: Mapped[str] = mapped_column(String(64), default="hardware")
    vendor: Mapped[str] = mapped_column(String(128), default="")
    vendor_ticket: Mapped[str] = mapped_column(String(128), default="")
    affected_summary: Mapped[str] = mapped_column(Text, default="")
    timeline_json: Mapped[str] = mapped_column(Text, default="[]")
    resolution: Mapped[str] = mapped_column(Text, default="")
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    wtype: Mapped[str] = mapped_column(String(64), default="install")
    status: Mapped[str] = mapped_column(String(32), default="planned", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    location: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    scheduled_at: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BackupProcess(Base):
    __tablename__ = "backup_processes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    system_name: Mapped[str] = mapped_column(String(255), default="")
    method: Mapped[str] = mapped_column(String(64), default="nfs")
    schedule: Mapped[str] = mapped_column(String(128), default="")
    rpo_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rto_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_verified: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    notes: Mapped[str] = mapped_column(Text, default="")


class DRDrill(Base):
    __tablename__ = "dr_drills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    scenario: Mapped[str] = mapped_column(Text, default="")
    scheduled_at: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    participants: Mapped[str] = mapped_column(Text, default="")
    findings: Mapped[str] = mapped_column(Text, default="")
    procedure_updates: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="planned")


class CapacityNote(Base):
    __tablename__ = "capacity_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    current_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(32), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    storage_key: Mapped[str] = mapped_column(String(512))
    photography_restricted: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(64), default="")
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppBackup(Base):
    __tablename__ = "app_backups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(Integer, default=0)
    backend: Mapped[str] = mapped_column(String(32), default="local")
    status: Mapped[str] = mapped_column(String(32), default="ok")
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CatalogEntry(Base):
    """Custom vendor / model / type / function values from Other… or import."""

    __tablename__ = "catalog_entries"
    __table_args__ = (UniqueConstraint("kind", "parent", "value", name="uq_catalog_entry"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)  # vendor, model, device_type, function
    value: Mapped[str] = mapped_column(String(255))
    parent: Mapped[str] = mapped_column(String(128), default="")  # vendor name when kind=model
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
