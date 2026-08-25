import { FormEvent, useState } from "react";
import { Rack, SearchHit, projects } from "../api";
import { draftFromDevice, payloadFromDraft } from "./DeviceEditor";

type Props = {
  projectId: number;
  racks: Rack[];
  defaultRackId?: number | "";
  onLocated?: () => void;
};

export default function LocatePanel({ projectId, racks, defaultRackId = "", onLocated }: Props) {
  const [q, setQ] = useState("");
  const [unlocated, setUnlocated] = useState(true);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [rackId, setRackId] = useState<number | "">(defaultRackId);
  const [ru, setRu] = useState(1);
  const [height, setHeight] = useState(1);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    setMsg("");
    try {
      const res = await projects.search(projectId, q, unlocated);
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
      const res = await projects.search(projectId, q, unlocated);
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
        Search logical identity (name, hostname, serial, vendor, model, IP) and pin it to a physical rack + RU.
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <form onSubmit={run}>
        <label className="field">
          <span>Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="hostname, serial, vendor, IP…"
            autoComplete="off"
          />
        </label>
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
            </div>
          </div>
          <span className="muted">
            {d.rack_name ? `${d.rack_name} U${d.ru_start || "—"}` : "unlocated"}
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
                {racks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.ru_height}U)
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
