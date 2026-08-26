import { FormEvent, useEffect, useMemo, useState } from "react";
import { Catalog, OTHER, learnCatalog, loadCatalog } from "../catalog";
import { Device, Rack, projects } from "../api";
import CameraModal from "./CameraModal";
import PhotoGallery from "./PhotoGallery";

export type DeviceDraft = {
  name: string;
  hostname: string;
  vendor: string;
  model: string;
  serial: string;
  asset_tag: string;
  device_type: string;
  function: string;
  rack_id: number | "";
  ru_start: number;
  ru_height: number;
  fan_orientation: string;
  management_ip: string;
  restricted: boolean;
  restricted_reason: string;
  notes: string;
  eol_date: string;
  eos_date: string;
  eol_notes: string;
  undocumented: boolean;
  power_draw_watts: number | "";
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
    device_type: "server",
    function: "",
    rack_id: rackId ?? "",
    ru_start: 1,
    ru_height: 1,
    fan_orientation: "front-intake",
    management_ip: "",
    restricted: false,
    restricted_reason: "",
    notes: "",
    eol_date: "",
    eos_date: "",
    eol_notes: "",
    undocumented: false,
    power_draw_watts: "",
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
    device_type: d.device_type || "server",
    function: d.function || "",
    rack_id: d.rack_id || "",
    ru_start: start,
    ru_height: Math.max(1, end - start + 1),
    fan_orientation: d.fan_orientation || "unknown",
    management_ip: d.management_ip || "",
    restricted: d.restricted,
    restricted_reason: d.restricted_reason || "",
    notes: d.notes || "",
    eol_date: d.eol_date || "",
    eos_date: d.eos_date || "",
    eol_notes: d.eol_notes || "",
    undocumented: d.undocumented,
    power_draw_watts: d.power_draw_watts ?? "",
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
    device_type: draft.device_type,
    function: draft.function,
    rack_id: rackId,
    ru_start: draft.ru_start,
    ru_end: draft.ru_start + draft.ru_height - 1,
    fan_orientation: draft.fan_orientation,
    management_ip: draft.management_ip,
    restricted: draft.restricted,
    restricted_reason: draft.restricted_reason,
    notes: draft.notes,
    eol_date: draft.eol_date || null,
    eos_date: draft.eos_date || null,
    eol_notes: draft.eol_notes,
    undocumented: draft.undocumented,
    power_draw_watts: draft.power_draw_watts === "" ? null : Number(draft.power_draw_watts),
    discovered_via: draft.discovered_via || "physical",
  };
}

function Combo({
  label,
  options,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
}) {
  const unique = Array.from(new Set(options.filter((o) => o && o.toLowerCase() !== OTHER.toLowerCase())));
  if (value && value.toLowerCase() !== OTHER.toLowerCase() && !unique.some((o) => o.toLowerCase() === value.toLowerCase())) {
    unique.push(value);
  }
  const known = unique.some((o) => o === value);
  const selectValue = !value ? "" : known ? value : OTHER;
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next === OTHER ? (known ? "" : value) || OTHER : next);
        }}
      >
        <option value="">Select…</option>
        {unique.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OTHER}>{OTHER}…</option>
      </select>
      {selectValue === OTHER && (
        <input
          className="mt"
          placeholder="Type a custom / Other value"
          value={value === OTHER ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const custom = (value === OTHER ? "" : value).trim();
            if (custom) onCommit?.(custom);
          }}
          autoComplete="off"
        />
      )}
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
  showLocation?: boolean;
  pendingPhotos?: File[];
  onPendingPhotos?: (files: File[]) => void;
  savedDeviceId?: number;
  projectId?: number;
  catalogNonce?: number;
};

export function DeviceFields({
  value,
  onChange,
  racks = [],
  showLocation = true,
  pendingPhotos,
  onPendingPhotos,
  savedDeviceId,
  projectId,
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
      <div className="row">
        <label className="field">
          <span>Hostname</span>
          <input value={value.hostname} onChange={(e) => set({ hostname: e.target.value })} autoComplete="off" />
        </label>
        <label className="field">
          <span>Asset tag</span>
          <input value={value.asset_tag} onChange={(e) => set({ asset_tag: e.target.value })} autoComplete="off" />
        </label>
      </div>
      <div className="row three">
        <Combo
          label="Type"
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
      {showLocation && (
        <label className="field">
          <span>Physical rack</span>
          <select
            value={value.rack_id}
            onChange={(e) => set({ rack_id: e.target.value ? Number(e.target.value) : "" })}
          >
            <option value="">Unlocated — assign later</option>
            {racks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.ru_height}U)
              </option>
            ))}
          </select>
        </label>
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
      <div className="row">
        <label className="field">
          <span>Management IP</span>
          <input value={value.management_ip} onChange={(e) => set({ management_ip: e.target.value })} />
        </label>
        <label className="field">
          <span>Power draw (W)</span>
          <input
            type="number"
            min={0}
            value={value.power_draw_watts}
            onChange={(e) => set({ power_draw_watts: e.target.value === "" ? "" : Number(e.target.value) })}
          />
        </label>
      </div>
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
      <label className="check-row">
        <input type="checkbox" checked={value.restricted} onChange={(e) => set({ restricted: e.target.checked })} />
        <span>Restricted (government / EMSS) — do not photograph</span>
      </label>
      {value.restricted && (
        <label className="field">
          <span>Restriction</span>
          <select value={value.restricted_reason} onChange={(e) => set({ restricted_reason: e.target.value })}>
            <option value="">—</option>
            <option>government</option>
            <option>EMSS</option>
            <option>other</option>
          </select>
        </label>
      )}
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
          allowed={!value.restricted}
          restricted={value.restricted}
        />
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h3>Photos ({pendingPhotos?.length || 0})</h3>
            <button type="button" className="btn" disabled={value.restricted} onClick={() => setCam("photo")}>
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
  onClose,
  onSaved,
}: {
  projectId: number;
  device: Device;
  racks: Rack[];
  onClose: () => void;
  onSaved: (d: Device) => void;
}) {
  const [draft, setDraft] = useState(draftFromDevice(device));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await projects.updateDevice(projectId, device.id, payloadFromDraft(draft));
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <form className="sheet" onSubmit={onSubmit}>
        <div className="camera-head">
          <h2>Edit {device.name}</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <DeviceFields value={draft} onChange={setDraft} racks={racks} savedDeviceId={device.id} projectId={projectId} />
        <button className="btn primary block" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
