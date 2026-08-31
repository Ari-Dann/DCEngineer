import { FormEvent, useEffect, useMemo, useState } from "react";
import { Catalog, OTHER, learnCatalog, loadCatalog } from "../catalog";
import { AisleRow, Area, Device, PDU, Project, Rack, pduLabel, projects, uploadPhotos } from "../api";
import {
  displayFromWatts,
  formatHierarchyPower,
  rackIdsForArea,
  rackIdsForRow,
  sumDcAmps,
  sumPowerWatts,
  wattsFromDisplay,
  type PowerUnit,
} from "../power";
import CameraModal from "./CameraModal";
import PhotoGallery from "./PhotoGallery";
import RestrictionPicker from "./RestrictionPicker";
import { deviceRestrictionFields, inheritedPhotoBlockers, photosAllowed, restrictionTypeOf } from "../restriction";

export type DeviceDraft = {
  name: string;
  hostname: string;
  vendor: string;
  model: string;
  serial: string;
  asset_tag: string;
  owner: string;
  device_type: string;
  function: string;
  rack_id: number | "";
  ru_start: number;
  ru_height: number;
  fan_orientation: string;
  indicator_type: string;
  indicator_color: string;
  management_ip: string;
  restricted: boolean;
  restricted_reason: string;
  notes: string;
  eol_date: string;
  eos_date: string;
  eol_notes: string;
  undocumented: boolean;
  power_draw_watts: number | "";
  power_draw_unit: PowerUnit;
  dc_power_draw_amps: number | "";
  pdu_a_id: number | "";
  pdu_b_id: number | "";
  discovered_via: string;
};

export function emptyDraft(rackId?: number | ""): DeviceDraft {
  return {
    name: "",
    hostname: "",
    vendor: "",
    model: "",
    serial: "",
    asset_tag: "",
    owner: "",
    device_type: "",
    function: "",
    rack_id: rackId ?? "",
    ru_start: 1,
    ru_height: 1,
    fan_orientation: "front-intake",
    indicator_type: "unknown",
    indicator_color: "unknown",
    management_ip: "",
    restricted: false,
    restricted_reason: "",
    notes: "",
    eol_date: "",
    eos_date: "",
    eol_notes: "",
    undocumented: false,
    power_draw_watts: "",
    power_draw_unit: "W",
    dc_power_draw_amps: "",
    pdu_a_id: "",
    pdu_b_id: "",
    discovered_via: "physical",
  };
}

export function draftFromDevice(d: Device): DeviceDraft {
  const start = d.ru_start || 1;
  const end = d.ru_end || d.ru_start || 1;
  return {
    name: d.name,
    hostname: d.hostname || "",
    vendor: d.vendor || "",
    model: d.model || "",
    serial: d.serial || "",
    asset_tag: d.asset_tag || "",
    owner: d.owner || "",
    device_type: d.device_type || "",
    function: d.function || "",
    rack_id: d.rack_id || "",
    ru_start: start,
    ru_height: Math.max(1, end - start + 1),
    fan_orientation: d.fan_orientation || "unknown",
    indicator_type: d.indicator_type || "unknown",
    indicator_color: d.indicator_color || "unknown",
    management_ip: d.management_ip || "",
    restricted: d.restricted,
    restricted_reason: d.restricted_reason || "",
    notes: d.notes || "",
    eol_date: d.eol_date || "",
    eos_date: d.eos_date || "",
    eol_notes: d.eol_notes || "",
    undocumented: d.undocumented,
    power_draw_watts: d.power_draw_watts ?? "",
    power_draw_unit: d.power_draw_unit === "kW" ? "kW" : "W",
    dc_power_draw_amps: d.dc_power_draw_amps ?? "",
    pdu_a_id: d.pdu_a_id || "",
    pdu_b_id: d.pdu_b_id || "",
    discovered_via: d.discovered_via || "physical",
  };
}

export function payloadFromDraft(draft: DeviceDraft) {
  const rackId = draft.rack_id === "" ? null : Number(draft.rack_id);
  return {
    name: draft.name,
    hostname: draft.hostname,
    vendor: draft.vendor,
    model: draft.model,
    serial: draft.serial,
    asset_tag: draft.asset_tag,
    owner: draft.owner,
    device_type: draft.device_type,
    function: draft.function,
    rack_id: rackId,
    ru_start: draft.ru_start,
    ru_end: draft.ru_start + draft.ru_height - 1,
    fan_orientation: draft.fan_orientation,
    indicator_type: draft.indicator_type,
    indicator_color: draft.indicator_type === "none" ? "none" : draft.indicator_color,
    management_ip: draft.management_ip,
    restricted: draft.restricted,
    restricted_reason: draft.restricted_reason,
    notes: draft.notes,
    eol_date: draft.eol_date || null,
    eos_date: draft.eos_date || null,
    eol_notes: draft.eol_notes,
    undocumented: draft.undocumented,
    power_draw_watts: draft.power_draw_watts === "" ? null : Number(draft.power_draw_watts),
    power_draw_unit: draft.power_draw_unit === "kW" ? "kW" : "W",
    dc_power_draw_amps: draft.dc_power_draw_amps === "" ? null : Number(draft.dc_power_draw_amps),
    pdu_a_id: draft.pdu_a_id === "" ? null : Number(draft.pdu_a_id),
    pdu_b_id: draft.pdu_b_id === "" ? null : Number(draft.pdu_b_id),
    discovered_via: draft.discovered_via || "physical",
  };
}

function Combo({
  label,
  options,
  value,
  onChange,
  onCommit,
  allowEmpty = false,
  emptyLabel = "Unspecified",
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const unique = Array.from(new Set(options.filter((o) => o && o.toLowerCase() !== OTHER.toLowerCase())));
  if (value && value.toLowerCase() !== OTHER.toLowerCase() && !unique.some((o) => o.toLowerCase() === value.toLowerCase())) {
    unique.unshift(value);
  }
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const typed = (open ? filter : value).trim();
  const needle = (open ? filter : "").trim().toLowerCase();
  const shown = needle ? unique.filter((o) => o.toLowerCase().includes(needle)) : unique;
  const isNew = Boolean(typed) && !unique.some((o) => o.toLowerCase() === typed.toLowerCase());
  const showEmpty = allowEmpty && !needle;

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setFilter("");
    if (next || allowEmpty) onCommit?.(next);
  }

  return (
    <label className="field">
      <span>{label}</span>
      <div className="combo">
        <input
          value={open ? filter : value}
          placeholder={allowEmpty ? emptyLabel : "Type to search or add a new value"}
          autoComplete="off"
          onFocus={() => {
            setFilter(value);
            setOpen(true);
          }}
          onChange={(e) => {
            setFilter(e.target.value);
            setOpen(true);
            onChange(e.target.value);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 180);
            const next = typed;
            if (next || allowEmpty) onCommit?.(next);
          }}
        />
        {open && (
          <div className="combo-list">
            {showEmpty && (
              <button type="button" className="combo-empty" onMouseDown={(e) => { e.preventDefault(); pick(""); }}>
                {emptyLabel}
              </button>
            )}
            {shown.slice(0, 40).map((o) => (
              <button type="button" key={o} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
                {o}
              </button>
            ))}
            {isNew && (
              <button type="button" className="combo-add" onMouseDown={(e) => { e.preventDefault(); pick(typed); }}>
                Add “{typed}” for next time
              </button>
            )}
            {!shown.length && !isNew && !showEmpty && <div className="muted" style={{ padding: 8 }}>No matches</div>}
          </div>
        )}
      </div>
    </label>
  );
}

function PendingThumbs({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  if (!files.length) return null;
  return (
    <div className="thumbs">
      {files.map((file, idx) => (
        <div className="thumb" key={`${file.name}-${file.size}-${idx}`}>
          {urls[idx] ? <img src={urls[idx]} alt={file.name} /> : <span className="muted">{file.name}</span>}
          <button type="button" className="btn" onClick={() => onRemove(idx)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

export function RackHeightField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [presets, setPresets] = useState([42, 45, 47, 48, 52, 58]);
  useEffect(() => {
    loadCatalog().then((c) => setPresets(c.rack_height_presets));
  }, []);
  return (
    <label className="field">
      <span>Rack height (U)</span>
      <div className="choice compact">
        {presets.map((h) => (
          <button type="button" key={h} className={`btn ${value === h ? "on" : ""}`} onClick={() => onChange(h)}>
            {h}U
          </button>
        ))}
      </div>
      <input
        type="number"
        min={1}
        max={70}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(70, Number(e.target.value) || 1)))}
      />
      <span className="muted">Presets or any height from 1U to 70U.</span>
    </label>
  );
}

type Props = {
  value: DeviceDraft;
  onChange: (next: DeviceDraft) => void;
  racks?: Rack[];
  areas?: Area[];
  rows?: AisleRow[];
  devices?: Device[];
  pdus?: PDU[];
  showLocation?: boolean;
  showKnownLocation?: boolean;
  pendingPhotos?: File[];
  onPendingPhotos?: (files: File[]) => void;
  savedDeviceId?: number;
  projectId?: number;
  project?: Project | null;
  catalogNonce?: number;
};

export function DeviceFields({
  value,
  onChange,
  racks = [],
  areas = [],
  rows = [],
  devices = [],
  pdus = [],
  showLocation = true,
  showKnownLocation,
  pendingPhotos,
  onPendingPhotos,
  savedDeviceId,
  projectId,
  project,
  catalogNonce = 0,
}: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [cam, setCam] = useState<"scan" | "photo" | null>(null);
  useEffect(() => {
    loadCatalog(catalogNonce > 0).then(setCatalog);
  }, [catalogNonce]);

  const vendorNames = useMemo(() => catalog?.vendors.map((v) => v.name) ?? [OTHER], [catalog]);
  const models = useMemo(() => {
    const entry = catalog?.vendors.find((v) => v.name === value.vendor);
    return entry?.models ?? [OTHER];
  }, [catalog, value.vendor]);
  const set = (patch: Partial<DeviceDraft>) => onChange({ ...value, ...patch });
  const knownLocation = showKnownLocation ?? !showLocation;

  const selectedRack = racks.find((r) => r.id === value.rack_id);
  const selectedRow = rows.find((r) => r.id === selectedRack?.row_id);
  const selectedArea = areas.find((a) => a.id === (selectedRack?.area_id || selectedRow?.area_id));
  const inherited = inheritedPhotoBlockers({ project, area: selectedArea, row: selectedRow, rack: selectedRack });
  const photosOk = photosAllowed({
    project,
    area: selectedArea,
    row: selectedRow,
    rack: selectedRack,
    device: { restricted: value.restricted, restricted_reason: value.restricted_reason },
  });
  const [areaId, setAreaId] = useState<number | "">(selectedArea?.id ?? "");
  const [rowId, setRowId] = useState<number | "">(selectedRow?.id ?? "");

  useEffect(() => {
    setAreaId(selectedArea?.id ?? "");
    setRowId(selectedRow?.id ?? "");
  }, [selectedArea?.id, selectedRow?.id]);

  const rowsForArea = areaId ? rows.filter((r) => r.area_id === areaId) : rows;
  const racksForRow = racks.filter((r) => {
    if (rowId && r.row_id !== rowId) return false;
    if (areaId && r.area_id !== areaId && rows.find((row) => row.id === r.row_id)?.area_id !== areaId) return false;
    return true;
  });

  const liveDevices = useMemo(() => {
    const watts = value.power_draw_watts === "" ? 0 : Number(value.power_draw_watts) || 0;
    const amps = value.dc_power_draw_amps === "" ? 0 : Number(value.dc_power_draw_amps) || 0;
    const rackId = value.rack_id === "" ? null : Number(value.rack_id);
    if (!savedDeviceId) {
      return [
        ...devices,
        {
          id: -1,
          project_id: projectId || 0,
          rack_id: rackId,
          name: value.name,
          hostname: "",
          vendor: "",
          model: "",
          serial: "",
          asset_tag: "",
          owner: "",
          device_type: value.device_type,
          function: "",
          restricted: false,
          restricted_reason: "",
          fan_orientation: "",
          power_draw_watts: watts,
          dc_power_draw_amps: amps,
          management_ip: "",
          discovered_via: "",
          undocumented: false,
          eol_notes: "",
          notes: "",
        } as Device,
      ];
    }
    return devices.map((d) =>
      d.id === savedDeviceId ? { ...d, rack_id: rackId, power_draw_watts: watts, dc_power_draw_amps: amps } : d,
    );
  }, [
    devices,
    projectId,
    savedDeviceId,
    value.dc_power_draw_amps,
    value.device_type,
    value.name,
    value.power_draw_watts,
    value.rack_id,
  ]);

  const knownRowId = rowId || selectedRow?.id || "";
  const knownAreaId = areaId || selectedArea?.id || "";
  const rackIds = value.rack_id === "" ? undefined : [Number(value.rack_id)];
  const rowRackIds = knownRowId === "" ? undefined : rackIdsForRow(Number(knownRowId), racks);
  const areaRackIds = knownAreaId === "" ? undefined : rackIdsForArea(Number(knownAreaId), racks, rows);
  const rackTotal = formatHierarchyPower(
    value.rack_id === "" ? null : sumPowerWatts(liveDevices, rackIds),
    value.rack_id === "" ? null : sumDcAmps(liveDevices, rackIds),
  );
  const rowTotal = formatHierarchyPower(
    knownRowId === "" ? null : sumPowerWatts(liveDevices, rowRackIds),
    knownRowId === "" ? null : sumDcAmps(liveDevices, rowRackIds),
  );
  const areaTotal = formatHierarchyPower(
    knownAreaId === "" ? null : sumPowerWatts(liveDevices, areaRackIds),
    knownAreaId === "" ? null : sumDcAmps(liveDevices, areaRackIds),
  );
  const powerDisplay = value.power_draw_watts === "" ? "" : displayFromWatts(Number(value.power_draw_watts), value.power_draw_unit);

  const pdusForRack = useMemo(() => {
    const rackId = value.rack_id === "" ? null : Number(value.rack_id);
    const onRack = rackId ? pdus.filter((p) => p.rack_id === rackId) : pdus;
    const extra = pdus.filter((p) => p.id === value.pdu_a_id || p.id === value.pdu_b_id);
    const seen = new Set(onRack.map((p) => p.id));
    return [...onRack, ...extra.filter((p) => !seen.has(p.id))];
  }, [pdus, value.pdu_a_id, value.pdu_b_id, value.rack_id]);

  function assignRack(next: number | "") {
    const keep = (id: number | "") => {
      if (id === "" || next === "") return id;
      const pdu = pdus.find((p) => p.id === id);
      return pdu && pdu.rack_id === next ? id : "";
    };
    set({ rack_id: next, pdu_a_id: keep(value.pdu_a_id), pdu_b_id: keep(value.pdu_b_id) });
  }

  async function persist(body: { vendor?: string; model?: string; device_type?: string; function?: string }) {
    const next = await learnCatalog(body);
    setCatalog(next);
  }

  return (
    <>
      <label className="field">
        <span>Device name</span>
        <input value={value.name} onChange={(e) => set({ name: e.target.value })} required autoComplete="off" />
      </label>
      <div className="row">
        <Combo
          label="Vendor"
          options={vendorNames}
          value={value.vendor}
          onChange={(vendor) => set({ vendor, model: "" })}
          onCommit={(vendor) => persist({ vendor })}
        />
        <Combo
          label="Model"
          options={models}
          value={value.model}
          onChange={(model) => set({ model })}
          onCommit={(model) => persist({ vendor: value.vendor, model })}
        />
      </div>
      <label className="field">
        <span>Serial</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={value.serial}
            onChange={(e) => set({ serial: e.target.value })}
            style={{ flex: 1 }}
            autoComplete="off"
          />
          <button type="button" className="btn" onClick={() => setCam("scan")}>
            Scan
          </button>
        </div>
      </label>
      <div className="row three">
        <label className="field">
          <span>Hostname</span>
          <input value={value.hostname} onChange={(e) => set({ hostname: e.target.value })} autoComplete="off" />
        </label>
        <label className="field">
          <span>Asset tag</span>
          <input value={value.asset_tag} onChange={(e) => set({ asset_tag: e.target.value })} autoComplete="off" />
        </label>
        <label className="field">
          <span>Owner</span>
          <input
            list="dce-owners"
            value={value.owner}
            onChange={(e) => set({ owner: e.target.value })}
            placeholder="client / tenant sharing this rack"
            autoComplete="off"
          />
          <datalist id="dce-owners">
            {Array.from(new Set(devices.map((d) => (d.owner || "").trim()).filter(Boolean))).map((owner) => (
              <option key={owner} value={owner} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="row three">
        <Combo
          label="Type"
          allowEmpty
          options={catalog?.device_types ?? ["server", "switch", "router", "firewall", "other"]}
          value={value.device_type}
          onChange={(device_type) => set({ device_type })}
          onCommit={(device_type) => persist({ device_type })}
        />
        <label className="field">
          <span>RU start (from bottom)</span>
          <input
            type="number"
            min={1}
            max={70}
            value={value.ru_start}
            onChange={(e) => set({ ru_start: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Height (U)</span>
          <input
            type="number"
            min={1}
            max={70}
            value={value.ru_height}
            onChange={(e) => set({ ru_height: Number(e.target.value) })}
          />
        </label>
      </div>
      {showLocation ? (
        <div className="row three">
          <label className="field">
            <span>Area</span>
            <select
              value={areaId}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : "";
                setAreaId(next);
                setRowId("");
                assignRack("");
              }}
            >
              <option value="">Unassigned</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Row</span>
            <select
              value={rowId}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : "";
                setRowId(next);
                const row = rows.find((r) => r.id === next);
                if (row?.area_id) setAreaId(row.area_id);
                const rack = racks.find((r) => r.id === value.rack_id);
                if (!next || rack?.row_id !== next) assignRack("");
              }}
            >
              <option value="">Unassigned</option>
              {rowsForArea.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Physical rack</span>
            <select
              value={value.rack_id}
              onChange={(e) => assignRack(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Unlocated — assign later</option>
              {(rowId || areaId ? racksForRow : racks).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.ru_height}U)
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        knownLocation &&
        (areas.length > 0 || rows.length > 0) && (
          <div className="row three">
            <label className="field">
              <span>Area</span>
              <div className="viewfield">{selectedArea?.name || "—"}</div>
            </label>
            <label className="field">
              <span>Row</span>
              <div className="viewfield">{selectedRow?.name || selectedRack?.row_label || "—"}</div>
            </label>
            <label className="field">
              <span>Physical rack</span>
              <div className="viewfield">{selectedRack?.name || "—"}</div>
            </label>
          </div>
        )
      )}
      <label className="field">
        <span>Function / logical role</span>
        <input
          list="dce-functions"
          value={value.function}
          onChange={(e) => set({ function: e.target.value })}
          onBlur={() => {
            const fn = value.function.trim();
            if (fn) persist({ function: fn });
          }}
          placeholder="core switch, hypervisor, WAN edge…"
          autoComplete="off"
        />
        <datalist id="dce-functions">
          {(catalog?.functions ?? []).map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Management IP</span>
        <input value={value.management_ip} onChange={(e) => set({ management_ip: e.target.value })} />
      </label>
      <div className="row">
        <label className="field">
          <span>AC power draw</span>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              type="number"
              min={0}
              step={value.power_draw_unit === "kW" ? 0.001 : 1}
              value={powerDisplay}
              onChange={(e) => {
                if (e.target.value === "") {
                  set({ power_draw_watts: "" });
                  return;
                }
                set({ power_draw_watts: wattsFromDisplay(Number(e.target.value), value.power_draw_unit) });
              }}
              style={{ flex: 1 }}
            />
            <div className="unit-toggle">
              {(["W", "kW"] as PowerUnit[]).map((unit) => (
                <button
                  type="button"
                  key={unit}
                  className={`btn ${value.power_draw_unit === unit ? "on" : ""}`}
                  onClick={() => set({ power_draw_unit: unit })}
                >
                  {unit}
                </button>
              ))}
            </div>
          </div>
        </label>
        <label className="field">
          <span>DC power draw</span>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              type="number"
              min={0}
              step={0.1}
              value={value.dc_power_draw_amps}
              onChange={(e) =>
                set({ dc_power_draw_amps: e.target.value === "" ? "" : Number(e.target.value) })
              }
              style={{ flex: 1 }}
            />
            <div className="viewfield" style={{ minWidth: 52, justifyContent: "center" }}>
              A
            </div>
          </div>
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>PDU A</span>
          <select
            value={value.pdu_a_id}
            onChange={(e) => set({ pdu_a_id: e.target.value ? Number(e.target.value) : "" })}
          >
            <option value="">Not connected</option>
            {pdusForRack.map((p) => (
              <option key={p.id} value={p.id}>
                {pduLabel(p, racks)}
              </option>
            ))}
          </select>
          {value.rack_id !== "" && pdusForRack.length === 0 && (
            <span className="muted">Add PDUs on this rack to assign feeds.</span>
          )}
        </label>
        <label className="field">
          <span>PDU B</span>
          <select
            value={value.pdu_b_id}
            onChange={(e) => set({ pdu_b_id: e.target.value ? Number(e.target.value) : "" })}
          >
            <option value="">Not connected</option>
            {pdusForRack.map((p) => (
              <option key={p.id} value={p.id}>
                {pduLabel(p, racks)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(value.rack_id !== "" || knownRowId !== "" || knownAreaId !== "") && (
        <div className="row three">
          <label className="field">
            <span>Rack total</span>
            <div className="viewfield">{value.rack_id === "" ? "—" : rackTotal}</div>
          </label>
          <label className="field">
            <span>Row total</span>
            <div className="viewfield">{knownRowId === "" ? "—" : rowTotal}</div>
          </label>
          <label className="field">
            <span>Area total</span>
            <div className="viewfield">{knownAreaId === "" ? "—" : areaTotal}</div>
          </label>
        </div>
      )}
      <span className="muted">Fan orientation</span>
      <div className="choice">
        {(catalog?.fan_orientations ?? []).map((f) => (
          <button
            type="button"
            key={f.id}
            className={`btn ${value.fan_orientation === f.id ? "on" : ""}`}
            onClick={() => set({ fan_orientation: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <span className="muted">LED / screen</span>
      <div className="choice">
        {(catalog?.indicator_types ?? []).map((option) => (
          <button
            type="button"
            key={option.id}
            className={`btn ${value.indicator_type === option.id ? "on" : ""}`}
            onClick={() =>
              set({
                indicator_type: option.id,
                indicator_color: option.id === "none" ? "none" : value.indicator_color === "none" ? "unknown" : value.indicator_color,
              })
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      {value.indicator_type !== "none" && (
        <>
          <span className="muted">LED / screen color</span>
          <div className="choice compact">
            {(catalog?.indicator_colors ?? []).filter((option) => option.id !== "none").map((option) => (
              <button
                type="button"
                key={option.id}
                className={`btn ${value.indicator_color === option.id ? "on" : ""}`}
                onClick={() => set({ indicator_color: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
      <RestrictionPicker
        name="device-restriction"
        value={restrictionTypeOf({ restricted: value.restricted, restricted_reason: value.restricted_reason })}
        onChange={(type) => set(deviceRestrictionFields(type))}
        inherited={inherited}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={value.undocumented}
          onChange={(e) => set({ undocumented: e.target.checked })}
        />
        <span>Undocumented vs discovery / CMDB</span>
      </label>
      <div className="row">
        <label className="field">
          <span>EOL date</span>
          <input type="date" value={value.eol_date} onChange={(e) => set({ eol_date: e.target.value })} />
        </label>
        <label className="field">
          <span>EOS date</span>
          <input type="date" value={value.eos_date} onChange={(e) => set({ eos_date: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Lifecycle notes</span>
        <input value={value.eol_notes} onChange={(e) => set({ eol_notes: e.target.value })} />
      </label>
      <label className="field">
        <span>Notes / cabling</span>
        <textarea value={value.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>

      {savedDeviceId && projectId ? (
        <PhotoGallery
          entityType="device"
          entityId={savedDeviceId}
          allowed={photosOk}
          restricted={!photosOk}
        />
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h3>Photos ({pendingPhotos?.length || 0})</h3>
            <button type="button" className="btn" disabled={!photosOk} onClick={() => setCam("photo")}>
              Capture photo
            </button>
          </div>
          <p className="muted">Stored in the app after save — not in the phone/tablet gallery.</p>
          <PendingThumbs
            files={pendingPhotos || []}
            onRemove={(idx) => onPendingPhotos?.((pendingPhotos || []).filter((_, i) => i !== idx))}
          />
        </div>
      )}

      {cam && (
        <CameraModal
          mode={cam}
          onClose={() => setCam(null)}
          onScan={(serial) => set({ serial })}
          onPhoto={(file) => onPendingPhotos?.([...(pendingPhotos || []), file])}
        />
      )}
    </>
  );
}

export function DeviceEditorModal({
  projectId,
  device,
  racks,
  areas = [],
  rows = [],
  devices = [],
  pdus = [],
  initialDraft,
  showLocation = true,
  project,
  onClose,
  onSaved,
  onRelocate,
  onDelete,
}: {
  projectId: number;
  device?: Device | null;
  racks: Rack[];
  areas?: Area[];
  rows?: AisleRow[];
  devices?: Device[];
  pdus?: PDU[];
  initialDraft?: DeviceDraft;
  showLocation?: boolean;
  project?: Project | null;
  onClose: () => void;
  onSaved: (d: Device) => void;
  onRelocate?: (mode: "copy" | "move") => void;
  onDelete?: () => void;
}) {
  const creating = !device;
  const [draft, setDraft] = useState(device ? draftFromDevice(device) : initialDraft || emptyDraft());
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = payloadFromDraft(draft);
      if (!body.name) {
        setError("Device name is required.");
        setBusy(false);
        return;
      }
      const saved = device
        ? await projects.updateDevice(projectId, device.id, body)
        : await projects.addDevice(projectId, body);
      if (!device && photos.length) {
        await uploadPhotos("device", saved.id, photos, draft.restricted);
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const title = device
    ? `Edit ${device.name}`
    : draft.ru_start
      ? `Add device at U${draft.ru_start}`
      : "Add device";

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <form className="sheet" onSubmit={onSubmit}>
        <div className="camera-head">
          <h2>{title}</h2>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {!creating && onRelocate && (
              <>
                <button type="button" className="btn" onClick={() => onRelocate("copy")}>
                  Copy
                </button>
                <button type="button" className="btn" onClick={() => onRelocate("move")}>
                  Move
                </button>
              </>
            )}
            {!creating && onDelete && (
              <button type="button" className="btn danger" onClick={onDelete}>
                Delete
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        {error && <div className="error">{error}</div>}
        <DeviceFields
          value={draft}
          onChange={setDraft}
          racks={racks}
          areas={areas}
          rows={rows}
          devices={devices}
          pdus={pdus}
          showLocation={showLocation}
          savedDeviceId={device?.id}
          projectId={projectId}
          project={project}
          pendingPhotos={creating ? photos : undefined}
          onPendingPhotos={creating ? setPhotos : undefined}
        />
        <button className="btn primary block" disabled={busy}>
          {busy ? "Saving…" : creating ? "Save device" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
