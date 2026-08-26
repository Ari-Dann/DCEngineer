import { FormEvent, useEffect, useState } from "react";
import { AisleRow, Area, Project, RelocateBody, projects } from "../api";

type Kind = "area" | "row" | "rack";
type Mode = "copy" | "move";

export default function RelocateDialog({
  kind,
  mode,
  projectId,
  entityId,
  onClose,
  onDone,
}: {
  kind: Kind;
  mode: Mode;
  projectId: number;
  entityId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [plist, setPlist] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [rows, setRows] = useState<AisleRow[]>([]);
  const [targetProject, setTargetProject] = useState<number | "">(projectId);
  const [targetArea, setTargetArea] = useState<number | "">("");
  const [targetRow, setTargetRow] = useState<number | "">("");
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
      return;
    }
    projects.areas(Number(targetProject)).then(setAreas);
    projects.rows(Number(targetProject)).then(setRows);
    setTargetArea("");
    setTargetRow("");
  }, [targetProject]);

  const filteredRows = targetArea ? rows.filter((r) => r.area_id === targetArea) : rows;

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
    if (kind === "row" || kind === "rack") body.target_area_id = targetArea ? Number(targetArea) : null;
    if (kind === "rack") body.target_row_id = targetRow ? Number(targetRow) : null;
    try {
      if (kind === "area") {
        await (mode === "copy" ? projects.copyArea : projects.moveArea)(projectId, entityId, body);
      } else if (kind === "row") {
        await (mode === "copy" ? projects.copyRow : projects.moveRow)(projectId, entityId, body);
      } else {
        await (mode === "copy" ? projects.copyRack : projects.moveRack)(projectId, entityId, body);
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
          Hierarchy is Area → Row → Rack. {mode === "copy" ? "Copy duplicates structure." : "Move reassigns the record and its children."}
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
        {(kind === "row" || kind === "rack") && (
          <label className="field">
            <span>Target area</span>
            <select value={targetArea} onChange={(e) => setTargetArea(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "rack" && (
          <label className="field">
            <span>Target row</span>
            <select value={targetRow} onChange={(e) => setTargetRow(e.target.value ? Number(e.target.value) : "")}>
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
        {kind !== "rack" && (
          <label className="check-row">
            <input type="checkbox" checked={includeChildren} onChange={(e) => setIncludeChildren(e.target.checked)} />
            <span>Include nested {kind === "area" ? "rows and racks" : "racks"}</span>
          </label>
        )}
        <label className="check-row">
          <input type="checkbox" checked={includeDevices} onChange={(e) => setIncludeDevices(e.target.checked)} />
          <span>Include devices</span>
        </label>
        <button className="btn primary block" disabled={busy}>
          {busy ? "Working…" : mode === "copy" ? "Copy" : "Move"}
        </button>
      </form>
    </div>
  );
}
