import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Device, Elevation, PDU, downloadAuth, projects } from "../api";

const TYPES = ["server", "switch", "storage", "pdu", "ups", "other"];
const FANS = [
  { id: "front-intake", label: "Front intake (correct cold aisle)" },
  { id: "rear-intake", label: "Rear intake" },
  { id: "incorrect-hot-aisle", label: "Incorrect — hot aisle" },
  { id: "incorrect-cold-aisle", label: "Incorrect — cold aisle" },
  { id: "unknown", label: "Unknown / not visible" },
];

export default function RackPage() {
  const { id, rackId } = useParams();
  const pid = Number(id);
  const rid = Number(rackId);
  const [elev, setElev] = useState<Elevation | null>(null);
  const [pdus, setPdus] = useState<PDU[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", vendor: "", model: "", serial: "", device_type: "server",
    ru_start: 1, ru_end: 1, fan_orientation: "unknown", function: "", restricted: false, notes: "",
  });
  const [pduName, setPduName] = useState("PDU-A");

  async function load() {
    try {
      setElev(await projects.elevation(pid, rid));
      setPdus(await projects.pdus(pid, rid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }
  useEffect(() => { load(); }, [pid, rid]);

  const byId = useMemo(() => {
    const m = new Map<number, Device>();
    elev?.devices.forEach((d) => m.set(d.id, d));
    return m;
  }, [elev]);

  async function addDevice(e: FormEvent) {
    e.preventDefault();
    await projects.addDevice(pid, { ...form, rack_id: rid });
    setForm({ ...form, name: "", serial: "" });
    load();
  }

  if (!elev) return <div className="page">{error || "Loading…"}</div>;

  return (
    <div className="page">
      <p><Link to={`/projects/${pid}`}>← {elev.rack.name}</Link></p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>Rack {elev.rack.name}</h1>
          <p>{elev.rack.ru_height}U · row {elev.rack.row_label || "—"}</p>
        </div>
        <button className="btn" onClick={() => downloadAuth(`/api/projects/${pid}/racks/${rid}/elevation.svg`, `${elev.rack.name}.svg`)}>
          Download SVG layout
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="grid two">
        <div>
          <div className="elevation">
            {elev.slots.map((s) => {
              const dev = s.device_id ? byId.get(s.device_id) : undefined;
              const top = dev && (dev.ru_end || dev.ru_start) === s.u;
              return (
                <div className="ru" key={s.u}>
                  <div className="u">{s.u}</div>
                  <div className={`slot ${dev ? `dev-${dev.device_type}` : "empty"}`}>
                    {top ? `${dev?.name} · ${dev?.vendor} ${dev?.model}` : dev ? "" : "empty"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <form className="card" onSubmit={addDevice}>
            <h3>Add device to this rack</h3>
            <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="row">
              <label className="field"><span>Vendor</span><input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></label>
              <label className="field"><span>Model</span><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
            </div>
            <label className="field"><span>Serial</span><input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></label>
            <div className="row three">
              <label className="field"><span>Type</span>
                <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })}>
                  {TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label className="field"><span>RU start</span><input type="number" value={form.ru_start} onChange={(e) => setForm({ ...form, ru_start: Number(e.target.value) })} /></label>
              <label className="field"><span>RU end</span><input type="number" value={form.ru_end} onChange={(e) => setForm({ ...form, ru_end: Number(e.target.value) })} /></label>
            </div>
            <label className="field"><span>Fan orientation</span>
              <select value={form.fan_orientation} onChange={(e) => setForm({ ...form, fan_orientation: e.target.value })}>
                {FANS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.restricted} onChange={(e) => setForm({ ...form, restricted: e.target.checked })} />
              <span>Restricted (government / EMSS) — client engineer must complete remaining fields</span>
            </label>
            <button className="btn primary block">Save device</button>
          </form>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>PDU mapping</h3>
            <form onSubmit={async (e) => { e.preventDefault(); await projects.addPdu(pid, rid, { name: pduName, bank: pduName.endsWith("B") ? "B" : "A", outlet_count: 24 }); load(); }} style={{ display: "flex", gap: 8 }}>
              <input value={pduName} onChange={(e) => setPduName(e.target.value)} />
              <button className="btn">Add PDU</button>
            </form>
            {pdus.map((p) => (
              <div key={p.id} style={{ marginTop: 12 }}>
                <strong>{p.name}</strong> bank {p.bank}
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <thead><tr><th>Port</th><th>Device</th></tr></thead>
                    <tbody>
                      {p.ports.map((port) => (
                        <tr key={port.id}>
                          <td>{port.port_label}</td>
                          <td>
                            <select
                              value={port.device_id || ""}
                              onChange={async (e) => {
                                await projects.mapPort(pid, p.id, port.id, {
                                  port_label: port.port_label,
                                  device_id: e.target.value ? Number(e.target.value) : null,
                                  notes: port.notes,
                                });
                                load();
                              }}
                            >
                              <option value="">—</option>
                              {elev.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
