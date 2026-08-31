import { FormEvent, useState } from "react";
import { AisleRow, Area, Project, Rack, projects } from "../api";
import AiImageParse, { EntryMode, EntryModeRadios } from "./AiImageParse";
import RestrictionPicker from "./RestrictionPicker";
import { inheritedPhotoBlockers, restrictionFields, type RestrictionType } from "../restriction";

function parseNames(raw: string) {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type Props = {
  projectId: number;
  areas: Area[];
  rows: AisleRow[];
  racks: Rack[];
  areaId: number | "";
  project?: Project | null;
  onAreaChange: (id: number | "") => void;
  onCreated: (created: AisleRow[]) => void;
};

export default function CreateRowsPanel({
  projectId,
  areas,
  rows,
  areaId,
  project,
  onAreaChange,
  onCreated,
}: Props) {
  const [mode, setMode] = useState<EntryMode>("manual");
  const [names, setNames] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [restriction, setRestriction] = useState<RestrictionType>("");

  const rowsHere = areaId ? rows.filter((r) => r.area_id === areaId) : rows;

  async function onManual(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (!areaId) {
      setError("Select an area first. Rows sit under an area.");
      return;
    }
    const list = parseNames(names);
    if (!list.length) {
      setError("Enter one row name per line.");
      return;
    }
    setBusy(true);
    try {
      const result = await projects.addRows(projectId, {
        area_id: Number(areaId),
        names: list,
        ...restrictionFields(restriction),
      });
      setNames("");
      setRestriction("");
      const created = result.created.map((r) => r.name);
      const existing = result.existing.map((r) => r.name);
      setMsg(
        [created.length ? `Created ${created.join(", ")}` : "", existing.length ? `Already present: ${existing.join(", ")}` : ""]
          .filter(Boolean)
          .join(". ") || "No new rows.",
      );
      if (result.created.length) onCreated(result.created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create rows");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Rows</h3>
      <p>
        Area → <strong>Row</strong> → Rack. Create the aisle set for this area, then pick a row for rack capture.
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <label className="field">
        <span>Area for new rows</span>
        <select value={areaId} onChange={(e) => onAreaChange(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Select an area</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <EntryModeRadios name="entry-capture-rows" value={mode} onChange={setMode} />
      {mode === "manual" ? (
        <form onSubmit={onManual}>
          <label className="field">
            <span>Row names (one per line)</span>
            <textarea value={names} onChange={(e) => setNames(e.target.value)} placeholder={"A01\nA02\nA03"} rows={5} />
          </label>
          <RestrictionPicker
            name="capture-row-restriction"
            value={restriction}
            onChange={setRestriction}
            inherited={inheritedPhotoBlockers({
              project,
              area: areas.find((a) => a.id === areaId) || null,
            })}
          />
          <button className="btn primary" disabled={busy || !areaId}>
            {busy ? "Creating…" : "Create rows"}
          </button>
        </form>
      ) : (
        <AiImageParse
          projectId={projectId}
          target="row"
          areaId={areaId}
          project={project}
          areas={areas}
          rows={rows}
          onInventoryChanged={() => onCreated([])}
        />
      )}
      {rowsHere.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          In this {areaId ? "area" : "project"}: {rowsHere.map((r) => r.name).join(", ")}
        </p>
      )}
      {rowsHere.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          No rows yet. Add a set here, or use AI image parse on a wide aisle shot and confirm each name.
        </p>
      )}
    </div>
  );
}
