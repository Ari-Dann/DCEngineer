from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    username: str
    user_id: int


class LoginIn(BaseModel):
    username: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class UserOut(ORMModel):
    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    username: str
    email: str
    password: str = Field(min_length=8)
    full_name: str = ""
    role: str = "engineer"


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class ProjectIn(BaseModel):
    name: str
    customer: str = ""
    site_name: str = ""
    site_address: str = ""
    revision: str = "A"
    status: str = "phase1"
    sponsor: str = ""
    escort_logistics: str = ""
    badging_notes: str = ""
    photography_rules: str = ""
    data_handling_rules: str = ""
    restricted_equipment_notes: str = ""
    in_scope_summary: str = ""
    discovery_port_access: str = "unknown"
    discovery_cdp_lldp: str = "unknown"
    discovery_saas_trial: str = "unknown"
    discovery_notes: str = ""
    start_date: Optional[str] = None
    target_end_date: Optional[str] = None


class ProjectOut(ORMModel):
    id: int
    name: str
    customer: str
    site_name: str
    site_address: str
    revision: str
    status: str
    sponsor: str
    escort_logistics: str
    badging_notes: str
    photography_rules: str
    data_handling_rules: str
    restricted_equipment_notes: str
    in_scope_summary: str
    discovery_port_access: str
    discovery_cdp_lldp: str
    discovery_saas_trial: str
    discovery_notes: str
    start_date: Optional[str]
    target_end_date: Optional[str]
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime


class AreaIn(BaseModel):
    name: str
    description: str = ""
    in_scope: bool = True
    restricted: bool = False
    restriction_type: str = ""
    photography_allowed: bool = True


class AreaOut(AreaIn, ORMModel):
    id: int
    project_id: int


class RackIn(BaseModel):
    name: str
    area_id: Optional[int] = None
    row_label: str = ""
    position: str = ""
    ru_height: int = Field(default=42, ge=1, le=70)
    width_inches: float = 19.0
    notes: str = ""


class RackOut(RackIn, ORMModel):
    id: int
    project_id: int


class DeviceIn(BaseModel):
    name: str
    rack_id: Optional[int] = None
    hostname: str = ""
    vendor: str = ""
    model: str = ""
    serial: str = ""
    asset_tag: str = ""
    device_type: str = "server"
    function: str = ""
    ru_start: Optional[int] = Field(default=None, ge=1, le=70)
    ru_end: Optional[int] = Field(default=None, ge=1, le=70)
    restricted: bool = False
    restricted_reason: str = ""
    fan_orientation: str = "unknown"
    power_draw_watts: Optional[int] = None
    management_ip: str = ""
    discovered_via: str = "physical"
    undocumented: bool = False
    eol_date: Optional[str] = None
    eos_date: Optional[str] = None
    eol_notes: str = ""
    notes: str = ""


class DevicePatch(BaseModel):
    name: Optional[str] = None
    rack_id: Optional[int] = None
    hostname: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    serial: Optional[str] = None
    asset_tag: Optional[str] = None
    device_type: Optional[str] = None
    function: Optional[str] = None
    ru_start: Optional[int] = Field(default=None, ge=1, le=70)
    ru_end: Optional[int] = Field(default=None, ge=1, le=70)
    restricted: Optional[bool] = None
    restricted_reason: Optional[str] = None
    fan_orientation: Optional[str] = None
    power_draw_watts: Optional[int] = None
    management_ip: Optional[str] = None
    discovered_via: Optional[str] = None
    undocumented: Optional[bool] = None
    eol_date: Optional[str] = None
    eos_date: Optional[str] = None
    eol_notes: Optional[str] = None
    notes: Optional[str] = None


class DeviceOut(DeviceIn, ORMModel):
    id: int
    project_id: int
    captured_by: Optional[int]
    captured_at: datetime
    eol_status: Optional[str] = None


class PDUIn(BaseModel):
    name: str
    bank: str = "A"
    vendor: str = ""
    model: str = ""
    serial: str = ""
    feed: str = ""
    amperage: Optional[float] = None
    voltage: Optional[float] = None
    phase: str = "1"
    outlet_count: int = 24


class PDUPortIn(BaseModel):
    port_label: str
    device_id: Optional[int] = None
    notes: str = ""


class PDUPortOut(PDUPortIn, ORMModel):
    id: int
    pdu_id: int


class PDUOut(PDUIn, ORMModel):
    id: int
    rack_id: int
    ports: list[PDUPortOut] = []


class CableIn(BaseModel):
    rack_id: Optional[int] = None
    from_label: str = ""
    from_port: str = ""
    to_label: str = ""
    to_port: str = ""
    media: str = ""
    color: str = ""
    traced: bool = False
    notes: str = ""


class CableOut(CableIn, ORMModel):
    id: int
    project_id: int


class HandoffIn(BaseModel):
    handoff_date: str
    from_name: str = ""
    to_name: str = ""
    from_user_id: Optional[int] = None
    to_user_id: Optional[int] = None
    summary: str = ""
    devices_captured: int = 0
    issues: str = ""
    follow_ups: str = ""


class HandoffOut(HandoffIn, ORMModel):
    id: int
    project_id: int
    created_at: datetime


class ChecklistIn(BaseModel):
    template_key: str = ""
    title: str
    items: list[dict[str, Any]] = []


class ChecklistOut(ORMModel):
    id: int
    project_id: int
    template_key: str
    title: str
    items: list[dict[str, Any]]
    completed_at: Optional[datetime]
    created_at: datetime


class InspectionIn(BaseModel):
    project_id: Optional[int] = None
    title: str
    itype: str = "routine"
    status: str = "open"
    location: str = ""
    findings: str = ""
    checklist: list[dict[str, Any]] = []
    due_at: Optional[str] = None


class InspectionOut(ORMModel):
    id: int
    project_id: Optional[int]
    title: str
    itype: str
    status: str
    location: str
    findings: str
    checklist: list[dict[str, Any]]
    due_at: Optional[str]
    completed_at: Optional[datetime]
    created_by: Optional[int]
    created_at: datetime


class IncidentIn(BaseModel):
    project_id: Optional[int] = None
    title: str
    severity: str = "medium"
    status: str = "open"
    category: str = "hardware"
    vendor: str = ""
    vendor_ticket: str = ""
    affected_summary: str = ""
    timeline: list[dict[str, Any]] = []
    resolution: str = ""


class IncidentOut(ORMModel):
    id: int
    project_id: Optional[int]
    title: str
    severity: str
    status: str
    category: str
    vendor: str
    vendor_ticket: str
    affected_summary: str
    timeline: list[dict[str, Any]]
    resolution: str
    opened_at: datetime
    resolved_at: Optional[datetime]
    created_by: Optional[int]


class WorkOrderIn(BaseModel):
    project_id: Optional[int] = None
    title: str
    wtype: str = "install"
    status: str = "planned"
    priority: str = "normal"
    location: str = ""
    description: str = ""
    scheduled_at: Optional[str] = None


class WorkOrderOut(WorkOrderIn, ORMModel):
    id: int
    completed_at: Optional[datetime]
    created_by: Optional[int]
    created_at: datetime


class BackupProcessIn(BaseModel):
    project_id: Optional[int] = None
    name: str
    system_name: str = ""
    method: str = "nfs"
    schedule: str = ""
    rpo_hours: Optional[float] = None
    rto_hours: Optional[float] = None
    last_verified: Optional[str] = None
    status: str = "unknown"
    notes: str = ""


class BackupProcessOut(BackupProcessIn, ORMModel):
    id: int


class DRDrillIn(BaseModel):
    project_id: Optional[int] = None
    title: str
    scenario: str = ""
    scheduled_at: Optional[str] = None
    participants: str = ""
    findings: str = ""
    procedure_updates: str = ""
    status: str = "planned"


class DRDrillOut(DRDrillIn, ORMModel):
    id: int
    completed_at: Optional[datetime]


class CapacityIn(BaseModel):
    project_id: Optional[int] = None
    category: str
    current_value: Optional[float] = None
    max_value: Optional[float] = None
    unit: str = ""
    notes: str = ""


class CapacityOut(CapacityIn, ORMModel):
    id: int
    recorded_at: datetime


class AttachmentOut(ORMModel):
    id: int
    entity_type: str
    entity_id: int
    filename: str
    content_type: str
    size: int
    photography_restricted: bool
    created_at: datetime


class CatalogLearnIn(BaseModel):
    vendor: Optional[str] = None
    model: Optional[str] = None
    device_type: Optional[str] = None
    function: Optional[str] = None
