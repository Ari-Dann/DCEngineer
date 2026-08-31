export type Role = "admin" | "engineer" | "remote" | "viewer" | "sidecar";

export type Session = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  role: Role;
  username: string;
  user_id: number;
};

const ACCESS = "dce.access";
const REFRESH = "dce.refresh";
const META = "dce.meta";
const QUEUE = "dce.queue";

export function getSession(): Session | null {
  const raw = localStorage.getItem(META);
  const access = localStorage.getItem(ACCESS);
  const refresh = localStorage.getItem(REFRESH);
  if (!raw || !access || !refresh) return null;
  try {
    return { ...JSON.parse(raw), access_token: access, refresh_token: refresh };
  } catch {
    return null;
  }
}

export function setSession(s: Session) {
  localStorage.setItem(ACCESS, s.access_token);
  localStorage.setItem(REFRESH, s.refresh_token);
  localStorage.setItem(META, JSON.stringify({ role: s.role, username: s.username, user_id: s.user_id, token_type: s.token_type }));
}

export function clearSession() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
  localStorage.removeItem(META);
}

type QueueItem = { method: string; path: string; body: unknown };

export function enqueue(item: QueueItem) {
  const q = JSON.parse(localStorage.getItem(QUEUE) || "[]") as QueueItem[];
  q.push(item);
  localStorage.setItem(QUEUE, JSON.stringify(q));
}

export function queuedCount() {
  try {
    return (JSON.parse(localStorage.getItem(QUEUE) || "[]") as QueueItem[]).length;
  } catch {
    return 0;
  }
}

async function raw(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, headers });
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let session = getSession();
  let res = await raw(path, init, session?.access_token);
  if (res.status === 401 && session?.refresh_token) {
    const refreshed = await raw("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (refreshed.ok) {
      const next = (await refreshed.json()) as Session;
      setSession(next);
      session = next;
      res = await raw(path, init, next.access_token);
    } else {
      clearSession();
      throw new Error("Session expired");
    }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res as unknown as T;
}

export async function login(username: string, password: string) {
  const s = await api<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setSession(s);
  return s;
}

export async function logout() {
  const s = getSession();
  if (s?.refresh_token) {
    try {
      await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: s.refresh_token }) });
    } catch {
      /* ignore */
    }
  }
  clearSession();
}

export async function flushQueue() {
  const q = JSON.parse(localStorage.getItem(QUEUE) || "[]") as QueueItem[];
  const remain: QueueItem[] = [];
  for (const item of q) {
    try {
      await api(item.path, { method: item.method, body: JSON.stringify(item.body) });
    } catch {
      remain.push(item);
    }
  }
  localStorage.setItem(QUEUE, JSON.stringify(remain));
  return q.length - remain.length;
}

export const projects = {
  list: () => api<Project[]>("/api/projects"),
  get: (id: number) => api<Project>(`/api/projects/${id}`),
  create: (body: Partial<Project> & { name: string }) => api<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: Partial<Project> & { name: string }) =>
    api<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: number) => api<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  areas: (id: number) => api<Area[]>(`/api/projects/${id}/areas`),
  addArea: (id: number, body: Partial<Area> & { name: string }) =>
    api<Area>(`/api/projects/${id}/areas`, { method: "POST", body: JSON.stringify(body) }),
  updateArea: (id: number, areaId: number, body: Partial<Area> & { name: string }) =>
    api<Area>(`/api/projects/${id}/areas/${areaId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteArea: (id: number, areaId: number) =>
    api<{ ok: boolean }>(`/api/projects/${id}/areas/${areaId}`, { method: "DELETE" }),
  rows: (id: number, areaId?: number) =>
    api<AisleRow[]>(`/api/projects/${id}/rows${areaId ? `?area_id=${areaId}` : ""}`),
  addRow: (id: number, body: Partial<AisleRow> & { name: string }) =>
    api<AisleRow>(`/api/projects/${id}/rows`, { method: "POST", body: JSON.stringify(body) }),
  addRows: (id: number, body: { area_id: number; names: string[] }) =>
    api<RowBulkResult>(`/api/projects/${id}/rows/bulk`, { method: "POST", body: JSON.stringify(body) }),
  updateRow: (id: number, rowId: number, body: Partial<AisleRow> & { name: string }) =>
    api<AisleRow>(`/api/projects/${id}/rows/${rowId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRow: (id: number, rowId: number) =>
    api<{ ok: boolean }>(`/api/projects/${id}/rows/${rowId}`, { method: "DELETE" }),
  racks: (id: number) => api<Rack[]>(`/api/projects/${id}/racks`),
  addRack: (id: number, body: Partial<Rack> & { name: string }) =>
    api<Rack>(`/api/projects/${id}/racks`, { method: "POST", body: JSON.stringify(body) }),
  elevation: (pid: number, rid: number) => api<Elevation>(`/api/projects/${pid}/racks/${rid}/elevation`),
  updateRack: (pid: number, rid: number, body: Partial<Rack> & { name: string }) =>
    api<Rack>(`/api/projects/${pid}/racks/${rid}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRack: (pid: number, rid: number) =>
    api<{ ok: boolean }>(`/api/projects/${pid}/racks/${rid}`, { method: "DELETE" }),
  copyArea: (id: number, areaId: number, body: RelocateBody) =>
    api<Area>(`/api/projects/${id}/areas/${areaId}/copy`, { method: "POST", body: JSON.stringify(body) }),
  moveArea: (id: number, areaId: number, body: RelocateBody) =>
    api<Area>(`/api/projects/${id}/areas/${areaId}/move`, { method: "POST", body: JSON.stringify(body) }),
  copyRow: (id: number, rowId: number, body: RelocateBody) =>
    api<AisleRow>(`/api/projects/${id}/rows/${rowId}/copy`, { method: "POST", body: JSON.stringify(body) }),
  moveRow: (id: number, rowId: number, body: RelocateBody) =>
    api<AisleRow>(`/api/projects/${id}/rows/${rowId}/move`, { method: "POST", body: JSON.stringify(body) }),
  copyRack: (id: number, rackId: number, body: RelocateBody) =>
    api<Rack>(`/api/projects/${id}/racks/${rackId}/copy`, { method: "POST", body: JSON.stringify(body) }),
  moveRack: (id: number, rackId: number, body: RelocateBody) =>
    api<Rack>(`/api/projects/${id}/racks/${rackId}/move`, { method: "POST", body: JSON.stringify(body) }),
  copyDevice: (id: number, deviceId: number, body: RelocateBody) =>
    api<Device>(`/api/projects/${id}/devices/${deviceId}/copy`, { method: "POST", body: JSON.stringify(body) }),
  moveDevice: (id: number, deviceId: number, body: RelocateBody) =>
    api<Device>(`/api/projects/${id}/devices/${deviceId}/move`, { method: "POST", body: JSON.stringify(body) }),
  devices: (id: number, extra = "") => api<Device[]>(`/api/projects/${id}/devices${extra}`),
  getDevice: (pid: number, did: number) => api<Device>(`/api/projects/${pid}/devices/${did}`),
  addDevice: (id: number, body: Partial<Device> & { name: string }) =>
    api<Device>(`/api/projects/${id}/devices`, { method: "POST", body: JSON.stringify(body) }),
  updateDevice: (pid: number, did: number, body: Partial<Device>) =>
    api<Device>(`/api/projects/${pid}/devices/${did}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDevice: (pid: number, did: number) =>
    api<{ ok: boolean }>(`/api/projects/${pid}/devices/${did}`, { method: "DELETE" }),
  search: (
    id: number,
    q = "",
    unlocated = false,
    extra?: { area_id?: number; row_id?: number; rack_id?: number },
  ) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (unlocated) params.set("unlocated", "true");
    if (extra?.area_id) params.set("area_id", String(extra.area_id));
    if (extra?.row_id) params.set("row_id", String(extra.row_id));
    if (extra?.rack_id) params.set("rack_id", String(extra.rack_id));
    const qs = params.toString();
    return api<SearchResult>(`/api/projects/${id}/search${qs ? `?${qs}` : ""}`);
  },
  previewImport: (file: File, opts?: { sheet?: string; orientation?: string; header_index?: number }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (opts?.sheet) fd.append("sheet", opts.sheet);
    if (opts?.orientation) fd.append("orientation", opts.orientation);
    if (opts?.header_index != null) fd.append("header_index", String(opts.header_index));
    return api<ImportPreview>("/api/imports/preview", { method: "POST", body: fd });
  },
  importFile: (id: number, file: File, opts?: ImportOptions) => {
    const fd = new FormData();
    fd.append("file", file);
    if (opts?.sheet) fd.append("sheet", opts.sheet);
    if (opts?.orientation) fd.append("orientation", opts.orientation);
    if (opts?.header_index != null) fd.append("header_index", String(opts.header_index));
    if (opts?.mapping) fd.append("mapping", JSON.stringify(opts.mapping));
    if (opts?.default_area_id) fd.append("default_area_id", String(opts.default_area_id));
    if (opts?.all_sheets) fd.append("all_sheets", "true");
    return api<ImportResult>(`/api/projects/${id}/import`, { method: "POST", body: fd });
  },
  pdus: (pid: number, rid: number) => api<PDU[]>(`/api/projects/${pid}/racks/${rid}/pdus`),
  projectPdus: (pid: number) => api<PDU[]>(`/api/projects/${pid}/pdus`),
  addPdu: (pid: number, rid: number, body: Partial<PDU> & { name: string }) =>
    api<PDU>(`/api/projects/${pid}/racks/${rid}/pdus`, { method: "POST", body: JSON.stringify(body) }),
  mapPort: (pid: number, pduId: number, portId: number, body: { port_label: string; device_id: number | null; notes: string }) =>
    api<PDU>(`/api/projects/${pid}/pdus/${pduId}/ports/${portId}`, { method: "PATCH", body: JSON.stringify(body) }),
  cables: (id: number) => api<Cable[]>(`/api/projects/${id}/cables`),
  addCable: (id: number, body: Partial<Cable>) => api<Cable>(`/api/projects/${id}/cables`, { method: "POST", body: JSON.stringify(body) }),
  handoffs: (id: number) => api<Handoff[]>(`/api/projects/${id}/handoffs`),
  addHandoff: (id: number, body: Partial<Handoff> & { handoff_date: string }) =>
    api<Handoff>(`/api/projects/${id}/handoffs`, { method: "POST", body: JSON.stringify(body) }),
  checklists: (id: number) => api<Checklist[]>(`/api/projects/${id}/checklists`),
  updateChecklist: (pid: number, cid: number, body: { title: string; template_key: string; items: { text: string; done: boolean }[] }) =>
    api<Checklist>(`/api/projects/${pid}/checklists/${cid}`, { method: "PATCH", body: JSON.stringify(body) }),
  exportUrl: (id: number) => `/api/projects/${id}/export.xlsx`,
  exportVisioUrl: (id: number) => `/api/projects/${id}/export-visio.zip`,
};

export const ops = {
  dashboard: () => api<Dashboard>("/api/dashboard"),
  inspections: (project_id?: number) => api<Inspection[]>(`/api/inspections${project_id ? `?project_id=${project_id}` : ""}`),
  addInspection: (body: Partial<Inspection> & { title: string }) =>
    api<Inspection>("/api/inspections", { method: "POST", body: JSON.stringify(body) }),
  patchInspection: (id: number, body: Partial<Inspection> & { title: string }) =>
    api<Inspection>(`/api/inspections/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  incidents: (project_id?: number) => api<Incident[]>(`/api/incidents${project_id ? `?project_id=${project_id}` : ""}`),
  addIncident: (body: Partial<Incident> & { title: string }) =>
    api<Incident>("/api/incidents", { method: "POST", body: JSON.stringify(body) }),
  patchIncident: (id: number, body: Partial<Incident> & { title: string }) =>
    api<Incident>(`/api/incidents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  workOrders: (project_id?: number) => api<WorkOrder[]>(`/api/work-orders${project_id ? `?project_id=${project_id}` : ""}`),
  addWorkOrder: (body: Partial<WorkOrder> & { title: string }) =>
    api<WorkOrder>("/api/work-orders", { method: "POST", body: JSON.stringify(body) }),
  backupProcesses: () => api<BackupProc[]>("/api/backup-processes"),
  addBackupProcess: (body: Partial<BackupProc> & { name: string }) =>
    api<BackupProc>("/api/backup-processes", { method: "POST", body: JSON.stringify(body) }),
  drills: () => api<Drill[]>("/api/dr-drills"),
  addDrill: (body: Partial<Drill> & { title: string }) => api<Drill>("/api/dr-drills", { method: "POST", body: JSON.stringify(body) }),
  capacity: () => api<Capacity[]>("/api/capacity"),
  addCapacity: (body: Partial<Capacity> & { category: string }) =>
    api<Capacity>("/api/capacity", { method: "POST", body: JSON.stringify(body) }),
  appBackups: () => api<AppBackup[]>("/api/app-backups"),
  triggerBackup: () => api<AppBackup>("/api/app-backups", { method: "POST" }),
  users: () => api<User[]>("/api/users"),
  addUser: (body: { username: string; email: string; password: string; full_name?: string; role: Role }) =>
    api<User>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (
    id: number,
    body: { username?: string; email?: string; password?: string; full_name?: string; role?: Role; is_active?: boolean },
  ) => api<User>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  me: () => api<User>("/api/auth/me"),
};

export async function downloadAuth(url: string, filename: string) {
  const session = getSession();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session?.access_token}` } });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export type Attachment = {
  id: number;
  entity_type: string;
  entity_id: number;
  filename: string;
  content_type: string;
  size: number;
  photography_restricted: boolean;
  created_at: string;
};

export type SearchHit = Device & { rack_name?: string | null; rack_row?: string | null; area_name?: string | null };
export type SearchResult = { query: string; count: number; devices: SearchHit[] };
export type ImportResult = {
  created: number;
  updated: number;
  racks_created: number;
  areas_created?: number;
  rows_created?: number;
  preserved?: number;
  skipped: number;
  rows: number;
  errors: string[];
  names?: string[];
  sheet?: string;
  orientation?: string;
};

export type ImportField = { id: string; label: string };
export type ImportHeader = { index: number; label: string; suggested: string };
export type ImportPreviewSheet = {
  name: string;
  orientation: "rows" | "columns";
  header_index: number;
  headers: ImportHeader[];
  raw_sample: string[][];
  sample_records: Record<string, string>[];
  record_count: number;
  mapped_fields: string[];
};
export type ImportPreview = {
  filename: string;
  sheets: ImportPreviewSheet[];
  suggested_sheet: string;
  fields: ImportField[];
};
export type ImportOptions = {
  sheet?: string;
  orientation?: "rows" | "columns";
  header_index?: number;
  mapping?: Record<string, number>;
  default_area_id?: number;
  all_sheets?: boolean;
};

async function authFetch(path: string, init: RequestInit = {}) {
  let session = getSession();
  let res = await raw(path, init, session?.access_token);
  if (res.status === 401 && session?.refresh_token) {
    const refreshed = await raw("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (refreshed.ok) {
      const next = (await refreshed.json()) as Session;
      setSession(next);
      res = await raw(path, init, next.access_token);
    } else {
      clearSession();
      throw new Error("Session expired");
    }
  }
  return res;
}

export async function uploadFile(entity_type: string, entity_id: number, file: File, photography_restricted = false) {
  const fd = new FormData();
  fd.append("entity_type", entity_type);
  fd.append("entity_id", String(entity_id));
  fd.append("photography_restricted", photography_restricted ? "true" : "false");
  fd.append("file", file);
  const res = await authFetch("/api/attachments", { method: "POST", body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Attachment>;
}

export async function uploadPhotos(
  entityType: string,
  entityId: number,
  files: File[],
  photographyRestricted = false,
) {
  const out: Attachment[] = [];
  for (const file of files) {
    out.push(await uploadFile(entityType, entityId, file, photographyRestricted));
  }
  return out;
}

export function listAttachments(entityType: string, entityId: number) {
  const params = new URLSearchParams({ entity_type: entityType, entity_id: String(entityId) });
  return api<Attachment[]>(`/api/attachments?${params}`);
}

export function deleteAttachment(id: number) {
  return api<{ ok: boolean }>(`/api/attachments/${id}`, { method: "DELETE" });
}

export async function fetchAttachmentBlob(id: number) {
  const res = await authFetch(`/api/attachments/${id}/download`);
  if (!res.ok) throw new Error("Download failed");
  return URL.createObjectURL(await res.blob());
}

export type VisionShotKind = "aisle_wide" | "rack_face" | "device_close" | "mixed";
export type VisionClipKind = "aisle_wide" | "rack_face" | "device_close" | "serial_frame" | "other";
export type VisionSessionStatus = "open" | "queued" | "running" | "needs_review" | "done" | "refused" | "error";

export type VisionClip = {
  id: number;
  session_id: number;
  attachment_id: number;
  kind: VisionClipKind | string;
  source: string;
  source_attachment_id?: number | null;
  timestamp_ms?: number | null;
  notes: string;
  created_at: string;
  filename: string;
  content_type: string;
  size: number;
  photography_restricted: boolean;
};

export type VisionProposal = {
  id: number;
  session_id: number;
  status: "pending" | "accepted" | "rejected" | "edited" | string;
  name: string;
  hostname: string;
  vendor: string;
  model: string;
  serial: string;
  asset_tag: string;
  owner: string;
  device_type: string;
  function: string;
  ru_start?: number | null;
  ru_end?: number | null;
  area_name: string;
  row_name: string;
  rack_name: string;
  rack_id?: number | null;
  notes: string;
  unreadable_fields: string[];
  evidence_attachment_ids: number[];
  prompt_text: string;
  extractor_model: string;
  raw_extraction?: unknown;
  confirmed_fields?: string[];
  skipped_fields?: string[];
  accepted_device_id?: number | null;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type VisionSession = {
  id: number;
  project_id: number;
  area_id?: number | null;
  row_id?: number | null;
  rack_id?: number | null;
  status: VisionSessionStatus | string;
  shot_kind: VisionShotKind | string;
  notes: string;
  restricted_blocked: boolean;
  error_detail: string;
  layout?: unknown;
  layout_review?: Record<string, Record<string, { fields?: Record<string, string>; id?: number }>>;
  restriction_reasons: string[];
  created_by?: number | null;
  claimed_by?: number | null;
  claimed_at?: string | null;
  created_at: string;
  updated_at: string;
  clip_count: number;
  proposal_count: number;
  pending_count: number;
  clips: VisionClip[];
  proposals: VisionProposal[];
};

export type VisionProposalPatch = Partial<
  Pick<
    VisionProposal,
    | "name"
    | "hostname"
    | "vendor"
    | "model"
    | "serial"
    | "asset_tag"
    | "owner"
    | "device_type"
    | "function"
    | "ru_start"
    | "ru_end"
    | "area_name"
    | "row_name"
    | "rack_name"
    | "rack_id"
    | "notes"
  >
>;

export const vision = {
  sessions: (projectId?: number, status?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", String(projectId));
    if (status) params.set("status", status);
    const q = params.toString();
    return api<VisionSession[]>(`/api/vision/sessions${q ? `?${q}` : ""}`);
  },
  get: (id: number) => api<VisionSession>(`/api/vision/sessions/${id}`),
  create: (body: {
    project_id: number;
    area_id?: number | null;
    row_id?: number | null;
    rack_id?: number | null;
    shot_kind?: VisionShotKind;
    notes?: string;
  }) => api<VisionSession>("/api/vision/sessions", { method: "POST", body: JSON.stringify(body) }),
  analyze: (id: number) => api<VisionSession>(`/api/vision/sessions/${id}/analyze`, { method: "POST" }),
  remove: (id: number) => api<{ ok: boolean }>(`/api/vision/sessions/${id}`, { method: "DELETE" }),
  patchProposal: (sessionId: number, proposalId: number, body: VisionProposalPatch) =>
    api<VisionProposal>(`/api/vision/sessions/${sessionId}/proposals/${proposalId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  accept: (sessionId: number, proposalId: number) =>
    api<Device>(`/api/vision/sessions/${sessionId}/proposals/${proposalId}/accept`, { method: "POST" }),
  reject: (sessionId: number, proposalId: number) =>
    api<VisionProposal>(`/api/vision/sessions/${sessionId}/proposals/${proposalId}/reject`, { method: "POST" }),
  acceptLayout: (sessionId: number, body?: { area_id?: number | null; names?: string[]; create_racks?: boolean }) =>
    api<LayoutAcceptResult>(`/api/vision/sessions/${sessionId}/layout/accept`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  confirmField: (sessionId: number, proposalId: number, field: string, value?: unknown) =>
    api<VisionProposal>(`/api/vision/sessions/${sessionId}/proposals/${proposalId}/fields/${encodeURIComponent(field)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ value: value ?? null }),
    }),
  skipField: (sessionId: number, proposalId: number, field: string) =>
    api<VisionProposal>(
      `/api/vision/sessions/${sessionId}/proposals/${proposalId}/fields/${encodeURIComponent(field)}/skip`,
      { method: "POST" },
    ),
  confirmLayoutField: (
    sessionId: number,
    body: { kind: "area" | "row" | "rack"; index: number; field: string; value?: unknown },
  ) =>
    api<{ ok: boolean; session: VisionSession }>(`/api/vision/sessions/${sessionId}/layout/fields/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  skipLayoutField: (sessionId: number, body: { kind: "area" | "row" | "rack"; index: number; field: string }) =>
    api<{ ok: boolean; session: VisionSession }>(`/api/vision/sessions/${sessionId}/layout/fields/skip`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export async function uploadVisionClip(
  sessionId: number,
  file: File,
  kind: VisionClipKind,
  source: "upload" | "video_frame" = "upload",
) {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("source", source);
  fd.append("file", file);
  const res = await authFetch(`/api/vision/sessions/${sessionId}/clips`, { method: "POST", body: fd });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<VisionClip>;
}

export type Project = {
  id: number;
  name: string;
  customer: string;
  site_name: string;
  site_address: string;
  revision: string;
  status: string;
  sponsor: string;
  escort_logistics: string;
  badging_notes: string;
  photography_rules: string;
  data_handling_rules: string;
  restricted_equipment_notes: string;
  in_scope_summary: string;
  discovery_port_access: string;
  discovery_cdp_lldp: string;
  discovery_saas_trial: string;
  discovery_notes: string;
  start_date?: string | null;
  target_end_date?: string | null;
};

export type Area = {
  id: number;
  project_id: number;
  name: string;
  description: string;
  in_scope: boolean;
  restricted: boolean;
  restriction_type: string;
  photography_allowed: boolean;
};

export type AisleRow = {
  id: number;
  project_id: number;
  name: string;
  area_id?: number | null;
  notes: string;
};

export type RowBulkResult = {
  created: AisleRow[];
  existing: AisleRow[];
};

export type RelocateBody = {
  target_project_id: number;
  target_area_id?: number | null;
  target_row_id?: number | null;
  target_rack_id?: number | null;
  include_children?: boolean;
  include_devices?: boolean;
};

export type Rack = {
  id: number;
  project_id: number;
  area_id?: number | null;
  row_id?: number | null;
  name: string;
  row_label: string;
  position: string;
  ru_height: number;
  width_inches: number;
  notes: string;
};

export type LayoutAcceptResult = RowBulkResult & {
  racks_created: Rack[];
  racks_existing: Rack[];
};

export function layoutPath(rack: Rack, rows: AisleRow[] = [], areas: Area[] = []) {
  const row = rows.find((r) => r.id === rack.row_id);
  const area = areas.find((a) => a.id === (rack.area_id || row?.area_id));
  return [area?.name, row?.name || rack.row_label, rack.name].filter(Boolean).join(" / ");
}

export function pduLabel(pdu: PDU, racks: Rack[] = []) {
  const rack = racks.find((r) => r.id === pdu.rack_id);
  return rack ? `${pdu.name} (${rack.name})` : pdu.name;
}

export type Device = {
  id: number;
  project_id: number;
  rack_id?: number | null;
  name: string;
  hostname: string;
  vendor: string;
  model: string;
  serial: string;
  asset_tag: string;
  owner?: string;
  device_type: string;
  function: string;
  ru_start?: number | null;
  ru_end?: number | null;
  restricted: boolean;
  restricted_reason: string;
  fan_orientation: string;
  indicator_type?: string;
  indicator_color?: string;
  power_draw_watts?: number | null;
  power_draw_unit?: "W" | "kW" | null;
  dc_power_draw_amps?: number | null;
  pdu_a_id?: number | null;
  pdu_b_id?: number | null;
  management_ip: string;
  discovered_via: string;
  undocumented: boolean;
  eol_date?: string | null;
  eos_date?: string | null;
  eol_notes: string;
  notes: string;
  eol_status?: string | null;
};

export function indicatorLabel(type?: string, color?: string) {
  const presence = type || "unknown";
  if (presence === "none") return "none";
  const tint = color || "unknown";
  if (!tint || tint === "none" || tint === "unknown") return presence;
  return `${presence} · ${tint}`;
}

export type PDU = {
  id: number;
  rack_id: number;
  name: string;
  bank: string;
  vendor: string;
  model: string;
  serial: string;
  feed: string;
  amperage?: number | null;
  voltage?: number | null;
  phase: string;
  outlet_count: number;
  ports: { id: number; pdu_id: number; port_label: string; device_id?: number | null; notes: string }[];
};

export type Cable = {
  id: number;
  project_id: number;
  rack_id?: number | null;
  from_label: string;
  from_port: string;
  to_label: string;
  to_port: string;
  media: string;
  color: string;
  traced: boolean;
  notes: string;
};

export type Handoff = {
  id: number;
  project_id: number;
  handoff_date: string;
  from_name: string;
  to_name: string;
  summary: string;
  devices_captured: number;
  issues: string;
  follow_ups: string;
};

export type Checklist = {
  id: number;
  project_id: number;
  template_key: string;
  title: string;
  items: { text: string; done: boolean }[];
  completed_at?: string | null;
};

export type Elevation = { rack: Rack; devices: Device[]; slots: { u: number; device_id?: number | null }[] };

export type Dashboard = {
  projects: number;
  racks: number;
  devices: number;
  restricted_devices: number;
  undocumented_devices: number;
  fan_issues: number;
  eol_devices: number;
  near_eol_devices: number;
  open_incidents: number;
  open_inspections: number;
  open_work_orders: number;
  last_app_backup?: string | null;
  last_app_backup_status?: string | null;
  storage_backend: string;
};

export type Inspection = {
  id: number;
  project_id?: number | null;
  title: string;
  itype: string;
  status: string;
  location: string;
  findings: string;
  checklist: { text: string; done: boolean }[];
  due_at?: string | null;
};

export type Incident = {
  id: number;
  project_id?: number | null;
  title: string;
  severity: string;
  status: string;
  category: string;
  vendor: string;
  vendor_ticket: string;
  affected_summary: string;
  resolution: string;
};

export type WorkOrder = {
  id: number;
  title: string;
  wtype: string;
  status: string;
  priority: string;
  location: string;
  description: string;
  scheduled_at?: string | null;
};

export type BackupProc = {
  id: number;
  name: string;
  system_name: string;
  method: string;
  schedule: string;
  rpo_hours?: number | null;
  rto_hours?: number | null;
  last_verified?: string | null;
  status: string;
  notes: string;
};

export type Drill = {
  id: number;
  title: string;
  scenario: string;
  scheduled_at?: string | null;
  participants: string;
  findings: string;
  procedure_updates: string;
  status: string;
};

export type Capacity = {
  id: number;
  category: string;
  current_value?: number | null;
  max_value?: number | null;
  unit: string;
  notes: string;
  recorded_at: string;
};

export type AppBackup = {
  id: number;
  filename: string;
  size: number;
  backend: string;
  status: string;
  detail: string;
  created_at: string;
};

export type User = {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
};
