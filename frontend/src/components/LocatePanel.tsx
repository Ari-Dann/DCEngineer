import { FormEvent, useState } from "react";
import { AisleRow, Area, Rack, SearchHit, layoutPath, projects } from "../api";
import { draftFromDevice, payloadFromDraft } from "./DeviceEditor";

type Props = {
  projectId: number;
  racks: Rack[];
  areas?: Area[];
  rows?: AisleRow[];
  defaultRackId?: number | "";
  onLocated?: () => void;
};

export default function LocatePanel({
  projectId,
  racks,
  areas = [],
  rows = [],
  defaultRackId = "",
  onLocated,
}: Props) {
  const [q, setQ] = useState("");
  const [unlocated, setUnlocated] = useState(true);
  const [areaId, setAreaId] = useState<number | "">("");
  const [rowId, setRowId] = useState<number | "">("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [rackId, setRackId] = useState<number | "">(defaultRackId);
  const [ru, setRu] = useState(1);
  const [height, setHeight] = useState(1);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const visibleRows = areaId ? rows.filter((r) => r.area_id === areaId) : rows;
  const visibleRacks = racks.filter((r) => {
    if (rowId && r.row_id !== rowId) return false;
    if (areaId && r.area_id !== areaId && rows.find((row) => row.id === r.row_id)?.area_id !== areaId) return false;
    return true;
  });

  async function run(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    setMsg("");
    try {
      const res = await projects.search(projectId, q, unlocated, {
        area_id: areaId || undefined,
        row_id: rowId || undefined,
      });
      setHits(res.devices);
      if (!res.devices.length) setMsg("No matching devices.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  }

  async function assign() {
    if (!picked || !rackId) {
      setError("Select a device and a rack.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const draft = draftFromDevice(picked);
      draft.rack_id = Number(rackId);
      draft.ru_start = ru;
      draft.ru_height = height;
      await projects.updateDevice(projectId, picked.id, payloadFromDraft(draft));
      setMsg(`Placed ${picked.name} in ${racks.find((r) => r.id === rackId)?.name || "rack"} U${ru}.`);
      setPicked(null);
      onLocated?.();
      const res = await projects.search(projectId, q, unlocated, {
        area_id: areaId || undefined,
        row_id: rowId || undefined,
      });
      setHits(res.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Locate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Locate known devices</h3>
      <p className="muted">
        Search logical identity (name, hostname, serial, vendor, model, IP, owner, area, row, rack) and pin it to a physical
        rack + RU.
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <form onSubmit={run}>
        <label className="field">
          <span>Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="hostname, serial, vendor, owner, row, area…"
            autoComplete="off"
          />
        </label>
        <div className="row">
          <label className="field">
            <span>Area</span>
            <select
              value={areaId}
              onChange={(e) => {
                setAreaId(e.target.value ? Number(e.target.value) : "");
                setRowId("");
              }}
            >
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Row</span>
            <select value={rowId} onChange={(e) => setRowId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">All rows</option>
              {visibleRows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={unlocated} onChange={(e) => setUnlocated(e.target.checked)} />
          <span>Only devices without a rack / RU</span>
        </label>
        <button className="btn primary">Search</button>
      </form>
      {hits.map((d) => (
        <button
          type="button"
          className={`list-item clickable ${picked?.id === d.id ? "picked" : ""}`}
          key={d.id}
          onClick={() => {
            setPicked(d);
            setRackId(d.rack_id || defaultRackId || "");
            setRu(d.ru_start || 1);
            setHeight(Math.max(1, (d.ru_end || d.ru_start || 1) - (d.ru_start || 1) + 1));
          }}
        >
          <div style={{ textAlign: "left" }}>
            <strong>{d.name}</strong>
            <div className="muted">
              {d.hostname || "no hostname"} · {d.vendor} {d.model} · SN {d.serial || "—"}
              {d.owner ? ` · ${d.owner}` : ""}
            </div>
          </div>
          <span className="muted">
            {d.rack_name
              ? `${d.area_name ? `${d.area_name} / ` : ""}${d.rack_row ? `${d.rack_row} / ` : ""}${d.rack_name} U${d.ru_start || "—"}`
              : "unlocated"}
          </span>
        </button>
      ))}
      {picked && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Place {picked.name}</h3>
          <div className="row three">
            <label className="field">
              <span>Rack</span>
              <select value={rackId} onChange={(e) => setRackId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">—</option>
                {visibleRacks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {layoutPath(r, rows, areas)} ({r.ru_height}U)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>RU start</span>
              <input type="number" min={1} max={70} value={ru} onChange={(e) => setRu(Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Height (U)</span>
              <input
                type="number"
                min={1}
                max={70}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </label>
          </div>
          <button type="button" className="btn primary block" disabled={busy} onClick={assign}>
            {busy ? "Saving…" : "Assign physical location"}
          </button>
        </div>
      )}
    </div>
  );
}
