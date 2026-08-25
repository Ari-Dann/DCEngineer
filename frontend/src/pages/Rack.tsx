import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Device, Elevation, PDU, Rack, downloadAuth, projects, uploadPhotos } from "../api";
import {
  DeviceDraft,
  DeviceEditorModal,
  DeviceFields,
  RackHeightField,
  emptyDraft,
  payloadFromDraft,
} from "../components/DeviceEditor";
import PhotoGallery from "../components/PhotoGallery";

export default function RackPage() {
  const { id, rackId } = useParams();
  const pid = Number(id);
  const rid = Number(rackId);
  const [elev, setElev] = useState<Elevation | null>(null);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [pdus, setPdus] = useState<PDU[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DeviceDraft>(emptyDraft(rid));
  const [photos, setPhotos] = useState<File[]>([]);
  const [pduName, setPduName] = useState("PDU-A");
  const [editing, setEditing] = useState<Device | null>(null);
  const [height, setHeight] = useState(42);

  async function load() {
    try {
      const next = await projects.elevation(pid, rid);
      setElev(next);
      setHeight(next.rack.ru_height);
      setPdus(await projects.pdus(pid, rid));
      setRacks(await projects.racks(pid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }
  useEffect(() => {
    load();
    setDraft(emptyDraft(rid));
  }, [pid, rid]);

  const byId = useMemo(() => {
    const m = new Map<number, Device>();
    elev?.devices.forEach((d) => m.set(d.id, d));
    return m;
  }, [elev]);

  async function addDevice(e: FormEvent) {
    e.preventDefault();
    const created = await projects.addDevice(pid, payloadFromDraft({ ...draft, rack_id: rid }));
    if (photos.length) {
      await uploadPhotos("device", created.id, photos, draft.restricted);
    }
    setDraft(emptyDraft(rid));
    setPhotos([]);
    load();
  }

  async function saveRack(e: FormEvent) {
    e.preventDefault();
    if (!elev) return;
    await projects.updateRack(pid, rid, { ...elev.rack, ru_height: height });
    load();
  }

  if (!elev) return <div className="page">{error || "Loading…"}</div>;

  return (
    <div className="page">
      <p>
        <Link to={`/projects/${pid}`}>← {elev.rack.name}</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>Rack {elev.rack.name}</h1>
          <p>
            {elev.rack.ru_height}U · row {elev.rack.row_label || "—"}
          </p>
        </div>
        <button
          className="btn"
          onClick={() => downloadAuth(`/api/projects/${pid}/racks/${rid}/elevation.svg`, `${elev.rack.name}.svg`)}
        >
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
                  <button
                    type="button"
                    className={`slot ${dev ? `dev-${dev.device_type}` : "empty"}`}
                    onClick={() => {
                      if (dev) setEditing(dev);
                      else setDraft((d) => ({ ...d, ru_start: s.u }));
                    }}
                  >
                    {top ? `${dev?.name} · ${dev?.vendor} ${dev?.model}` : dev ? "" : "empty"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <form className="card" onSubmit={saveRack}>
            <h3>Edit rack</h3>
            <RackHeightField value={height} onChange={setHeight} />
            <button className="btn">Save rack height</button>
          </form>
          <form className="card" onSubmit={addDevice} style={{ marginTop: 12 }}>
            <h3>Add device to this rack</h3>
            <DeviceFields
              value={draft}
              onChange={setDraft}
              racks={racks}
              showLocation={false}
              pendingPhotos={photos}
              onPendingPhotos={setPhotos}
            />
            <button className="btn primary block">Save device</button>
          </form>
          <div className="card" style={{ marginTop: 12 }}>
            <PhotoGallery entityType="rack" entityId={rid} />
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>PDU mapping</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await projects.addPdu(pid, rid, {
                  name: pduName,
                  bank: pduName.endsWith("B") ? "B" : "A",
                  outlet_count: 24,
                });
                load();
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input value={pduName} onChange={(e) => setPduName(e.target.value)} />
              <button className="btn">Add PDU</button>
            </form>
            {pdus.map((p) => (
              <div key={p.id} style={{ marginTop: 12 }}>
                <strong>{p.name}</strong> bank {p.bank}
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Port</th>
                        <th>Device</th>
                      </tr>
                    </thead>
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
                              {elev.devices.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
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
      {editing && (
        <DeviceEditorModal
          projectId={pid}
          device={editing}
          racks={racks}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
