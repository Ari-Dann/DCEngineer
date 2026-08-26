import { FormEvent, useEffect, useState } from "react";
import { AisleRow, Area, Project, Rack, RelocateBody, projects } from "../api";

export type RelocateKind = "area" | "row" | "rack" | "device";
type Mode = "copy" | "move";

export default function RelocateDialog({
  kind,
  mode,
  projectId,
  entityId,
  onClose,
  onDone,
}: {
  kind: RelocateKind;
  mode: Mode;
  projectId: number;
  entityId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [plist, setPlist] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [rows, setRows] = useState<AisleRow[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [targetProject, setTargetProject] = useState<number | "">(projectId);
  const [targetArea, setTargetArea] = useState<number | "">("");
  const [targetRow, setTargetRow] = useState<number | "">("");
  const [targetRack, setTargetRack] = useState<number | "">("");
  const [includeChildren, setIncludeChildren] = useState(true);
  const [includeDevices, setIncludeDevices] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    projects.list().then((list) => {
      setPlist(list);
      if (!targetProject && list[0]) setTargetProject(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!targetProject) {
      setAreas([]);
      setRows([]);
      setRacks([]);
      return;
    }
    const pid = Number(targetProject);
    projects.areas(pid).then(setAreas);
    projects.rows(pid).then(setRows);
    projects.racks(pid).then(setRacks);
    setTargetArea("");
    setTargetRow("");
    setTargetRack("");
  }, [targetProject]);

  const filteredRows = targetArea ? rows.filter((r) => r.area_id === targetArea) : rows;
  const filteredRacks = racks.filter((r) => {
    if (targetRow && r.row_id !== targetRow) return false;
    if (targetArea && r.area_id !== targetArea && rows.find((row) => row.id === r.row_id)?.area_id !== targetArea) {
      return false;
    }
    return true;
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!targetProject) {
      setError("Pick a destination project.");
      return;
    }
    setBusy(true);
    setError("");
    const body: RelocateBody = {
      target_project_id: Number(targetProject),
      include_children: includeChildren,
      include_devices: includeDevices,
    };
    if (kind === "row" || kind === "rack" || kind === "device") {
      body.target_area_id = targetArea ? Number(targetArea) : null;
    }
    if (kind === "rack" || kind === "device") body.target_row_id = targetRow ? Number(targetRow) : null;
    if (kind === "device") body.target_rack_id = targetRack ? Number(targetRack) : null;
    try {
      if (kind === "area") {
        await (mode === "copy" ? projects.copyArea : projects.moveArea)(projectId, entityId, body);
      } else if (kind === "row") {
        await (mode === "copy" ? projects.copyRow : projects.moveRow)(projectId, entityId, body);
      } else if (kind === "rack") {
        await (mode === "copy" ? projects.copyRack : projects.moveRack)(projectId, entityId, body);
      } else {
        await (mode === "copy" ? projects.copyDevice : projects.moveDevice)(projectId, entityId, body);
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Relocate failed");
    } finally {
      setBusy(false);
    }
  }

  const title = `${mode === "copy" ? "Copy" : "Move"} ${kind} to another project`;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <form className="sheet" onSubmit={onSubmit}>
        <div className="camera-head">
          <h2>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          {kind === "device"
            ? "Hierarchy is Project → Area → Row → Rack. Leave rack empty to keep the device unlocated in the destination project."
            : `Hierarchy is Area → Row → Rack. ${mode === "copy" ? "Copy duplicates structure." : "Move reassigns the record and its children."}`}
        </p>
        {error && <div className="error">{error}</div>}
        <label className="field">
          <span>Destination project</span>
          <select value={targetProject} onChange={(e) => setTargetProject(e.target.value ? Number(e.target.value) : "")} required>
            <option value="">Select…</option>
            {plist.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === projectId ? " (this project)" : ""}
              </option>
            ))}
          </select>
        </label>
        {(kind === "row" || kind === "rack" || kind === "device") && (
          <label className="field">
            <span>Target area</span>
            <select
              value={targetArea}
              onChange={(e) => {
                setTargetArea(e.target.value ? Number(e.target.value) : "");
                setTargetRow("");
                setTargetRack("");
              }}
            >
              <option value="">—</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {(kind === "rack" || kind === "device") && (
          <label className="field">
            <span>Target row</span>
            <select
              value={targetRow}
              onChange={(e) => {
                setTargetRow(e.target.value ? Number(e.target.value) : "");
                setTargetRack("");
              }}
            >
              <option value="">—</option>
              {filteredRows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.area_id ? ` · ${areas.find((a) => a.id === r.area_id)?.name || ""}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "device" && (
          <label className="field">
            <span>Target rack</span>
            <select value={targetRack} onChange={(e) => setTargetRack(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Unlocated</option>
              {filteredRacks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.row_label ? ` · ${r.row_label}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "rack" && kind !== "device" && (
          <label className="check-row">
            <input type="checkbox" checked={includeChildren} onChange={(e) => setIncludeChildren(e.target.checked)} />
            <span>Include nested {kind === "area" ? "rows and racks" : "racks"}</span>
          </label>
        )}
        {kind !== "device" && (
          <label className="check-row">
            <input type="checkbox" checked={includeDevices} onChange={(e) => setIncludeDevices(e.target.checked)} />
            <span>Include devices</span>
          </label>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy ? "Working…" : mode === "copy" ? "Copy" : "Move"}
        </button>
      </form>
    </div>
  );
}
