import { FormEvent, useEffect, useState } from "react";
import { AisleRow, Area, Device, Project, Rack, RelocateBody, projects } from "../api";

export type RelocateKind = "area" | "row" | "rack" | "device";
type Mode = "copy" | "move";

export default function RelocateDialog({
  kind,
  mode,
  projectId,
  entityId,
  entityIds,
  onClose,
  onDone,
}: {
  kind: RelocateKind;
  mode: Mode;
  projectId: number;
  entityId?: number;
  entityIds?: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const ids = entityIds?.length ? entityIds : entityId ? [entityId] : [];
  const [plist, setPlist] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [rows, setRows] = useState<AisleRow[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [sourceDevices, setSourceDevices] = useState<Device[]>([]);
  const [targetProject, setTargetProject] = useState<number | "">(projectId);
  const [targetArea, setTargetArea] = useState<number | "">("");
  const [targetRow, setTargetRow] = useState<number | "">("");
  const [targetRack, setTargetRack] = useState<number | "">("");
  const [targetRu, setTargetRu] = useState<number | "">("");
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
    if (kind !== "device" || !ids.length) {
      setSourceDevices([]);
      return;
    }
    Promise.all(ids.map((id) => projects.getDevice(projectId, id)))
      .then(setSourceDevices)
      .catch(() => setSourceDevices([]));
  }, [kind, projectId, ids.join(",")]);

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
    setTargetRu("");
  }, [targetProject]);

  const filteredRows = targetArea ? rows.filter((r) => r.area_id === targetArea) : rows;
  const filteredRacks = racks.filter((r) => {
    if (targetRow && r.row_id !== targetRow) return false;
    if (targetArea && r.area_id !== targetArea && rows.find((row) => row.id === r.row_id)?.area_id !== targetArea) {
      return false;
    }
    return true;
  });
  const selectedRack = targetRack ? filteredRacks.find((r) => r.id === targetRack) : undefined;
  const currentRu =
    sourceDevices.length === 1 && sourceDevices[0].ru_start
      ? `U${sourceDevices[0].ru_start}${
          sourceDevices[0].ru_end && sourceDevices[0].ru_end !== sourceDevices[0].ru_start
            ? `–${sourceDevices[0].ru_end}`
            : ""
        }`
      : "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!targetProject) {
      setError("Pick a destination project.");
      return;
    }
    if (kind === "device" && targetRu !== "" && !targetRack) {
      setError("Choose a target rack to place at a U elevation.");
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
    if (kind === "device") {
      body.target_rack_id = targetRack ? Number(targetRack) : null;
      if (targetRu !== "") body.target_ru_start = Number(targetRu);
    }
    try {
      for (const id of ids) {
        if (kind === "area") {
          await (mode === "copy" ? projects.copyArea : projects.moveArea)(projectId, id, body);
        } else if (kind === "row") {
          await (mode === "copy" ? projects.copyRow : projects.moveRow)(projectId, id, body);
        } else if (kind === "rack") {
          await (mode === "copy" ? projects.copyRack : projects.moveRack)(projectId, id, body);
        } else {
          await (mode === "copy" ? projects.copyDevice : projects.moveDevice)(projectId, id, body);
        }
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Relocate failed");
    } finally {
      setBusy(false);
    }
  }

  const title = `${mode === "copy" ? "Copy" : "Move"} ${ids.length > 1 ? `${ids.length} ${kind}s` : kind} to another project`;

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
            ? "Hierarchy is Project → Area → Row → Rack. Leave rack empty to keep the device unlocated, or pick a rack and optionally a U elevation."
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
                setTargetRu("");
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
                setTargetRu("");
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
          <>
            <label className="field">
              <span>Target rack</span>
              <select
                value={targetRack}
                onChange={(e) => {
                  setTargetRack(e.target.value ? Number(e.target.value) : "");
                  if (!e.target.value) setTargetRu("");
                }}
              >
                <option value="">Unlocated</option>
                {filteredRacks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.row_label ? ` · ${r.row_label}` : ""}
                    {` · ${r.ru_height}U`}
                  </option>
                ))}
              </select>
            </label>
            {targetRack !== "" && (
              <label className="field">
                <span>Place at RU (from bottom)</span>
                <input
                  type="number"
                  min={1}
                  max={selectedRack?.ru_height || 70}
                  value={targetRu}
                  onChange={(e) => setTargetRu(e.target.value ? Number(e.target.value) : "")}
                  placeholder={currentRu ? `Keep current (${currentRu})` : "Keep current U"}
                />
                <span>
                  Optional. Sets the bottom RU and keeps the device height
                  {selectedRack ? ` in this ${selectedRack.ru_height}U rack` : ""}.
                  {ids.length > 1 ? " All selected devices use this U." : ""}
                </span>
              </label>
            )}
          </>
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
        <button className="btn primary block" disabled={busy || !ids.length}>
          {busy ? "Working…" : mode === "copy" ? "Copy" : "Move"}
        </button>
      </form>
    </div>
  );
}
