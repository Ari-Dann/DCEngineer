import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  Cable,
  Checklist,
  Device,
  Handoff,
  ImportResult,
  Project as ProjectT,
  Rack,
  downloadAuth,
  projects,
} from "../api";
import { DeviceEditorModal, RackHeightField } from "../components/DeviceEditor";
import LocatePanel from "../components/LocatePanel";
import PhotoGallery from "../components/PhotoGallery";

const TABS = ["overview", "areas", "racks", "devices", "locate", "cables", "checklists", "handoffs", "lifecycle"] as const;
type Tab = (typeof TABS)[number];

export default function Project() {
  const { id } = useParams();
  const pid = Number(id);
  const [tab, setTab] = useState<Tab>("overview");
  const [project, setProject] = useState<ProjectT | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [lists, setLists] = useState<Checklist[]>([]);
  const [hands, setHands] = useState<Handoff[]>([]);
  const [error, setError] = useState("");
  const [areaName, setAreaName] = useState("");
  const [rackName, setRackName] = useState("");
  const [rackHeight, setRackHeight] = useState(42);
  const [rackRow, setRackRow] = useState("");
  const [filter, setFilter] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [editing, setEditing] = useState<Device | null>(null);
  const [openArea, setOpenArea] = useState<number | null>(null);
  const [hand, setHand] = useState({
    handoff_date: new Date().toISOString().slice(0, 10),
    from_name: "",
    to_name: "Remote",
    summary: "",
    devices_captured: 0,
    issues: "",
    follow_ups: "",
  });
  const [cable, setCable] = useState({
    from_label: "",
    from_port: "",
    to_label: "",
    to_port: "",
    media: "Cat6",
    traced: true,
    notes: "",
  });

  async function load() {
    try {
      const p = await projects.get(pid);
      setProject(p);
      setAreas(await projects.areas(pid));
      setRacks(await projects.racks(pid));
      setDevices(await projects.devices(pid));
      setCables(await projects.cables(pid));
      setLists(await projects.checklists(pid));
      setHands(await projects.handoffs(pid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }
  useEffect(() => {
    load();
  }, [pid]);

  async function saveProject(e: FormEvent) {
    e.preventDefault();
    if (!project) return;
    await projects.update(pid, project);
    load();
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    setError("");
    setImportMsg("");
    try {
      const result: ImportResult = await projects.importFile(pid, file);
      setImportMsg(
        `Imported ${result.rows} rows: ${result.created} created, ${result.updated} updated, ${result.racks_created} racks added, ${result.skipped} skipped.`,
      );
      if (result.errors.length) setError(result.errors.join(" · "));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  if (!project) return <div className="page">{error || "Loading…"}</div>;

  const shown = filter
    ? devices.filter((d) =>
        [d.name, d.hostname, d.serial, d.vendor, d.model, d.management_ip, d.function]
          .join(" ")
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : devices;

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>{project.name}</h1>
          <p>
            {project.customer} · {project.site_name} · revision {project.revision}
          </p>
        </div>
        <button className="btn primary" onClick={() => downloadAuth(projects.exportUrl(pid), `RBI-${project.name}.xlsx`)}>
          Export RBI workbook
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {importMsg && <div className="success">{importMsg}</div>}
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <form className="card" onSubmit={saveProject}>
            <div className="row">
              <label className="field">
                <span>Status</span>
                <select value={project.status} onChange={(e) => setProject({ ...project, status: e.target.value })}>
                  <option value="phase1">phase1</option>
                  <option value="phase2">phase2</option>
                  <option value="phase3">phase3</option>
                  <option value="phase4">phase4</option>
                  <option value="delivered">delivered</option>
                </select>
              </label>
              <label className="field">
                <span>Revision</span>
                <input value={project.revision} onChange={(e) => setProject({ ...project, revision: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Photography rules</span>
              <textarea
                value={project.photography_rules}
                onChange={(e) => setProject({ ...project, photography_rules: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Restricted equipment</span>
              <textarea
                value={project.restricted_equipment_notes}
                onChange={(e) => setProject({ ...project, restricted_equipment_notes: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Discovery notes</span>
              <textarea
                value={project.discovery_notes}
                onChange={(e) => setProject({ ...project, discovery_notes: e.target.value })}
              />
            </label>
            <button className="btn primary">Save</button>
          </form>
          <div className="card" style={{ marginTop: 12 }}>
            <PhotoGallery entityType="project" entityId={pid} />
          </div>
        </>
      )}

      {tab === "areas" && (
        <div className="card">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await projects.addArea(pid, { name: areaName });
              setAreaName("");
              load();
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input placeholder="Area / cage / hall" value={areaName} onChange={(e) => setAreaName(e.target.value)} required />
            <button className="btn primary">Add</button>
          </form>
          {areas.map((a) => (
            <div key={a.id}>
              <button type="button" className="list-item clickable" onClick={() => setOpenArea(openArea === a.id ? null : a.id)}>
                <div style={{ textAlign: "left" }}>
                  <strong>{a.name}</strong>
                  <div className="muted">
                    {a.restricted ? a.restriction_type || "restricted" : "in scope"} · photos{" "}
                    {a.photography_allowed ? "allowed" : "forbidden"}
                  </div>
                </div>
                <span className="muted">photos</span>
              </button>
              {openArea === a.id && (
                <PhotoGallery entityType="area" entityId={a.id} allowed={a.photography_allowed} />
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "racks" && (
        <div className="card">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await projects.addRack(pid, { name: rackName, ru_height: rackHeight, row_label: rackRow });
              setRackName("");
              load();
            }}
          >
            <div className="row">
              <label className="field">
                <span>Rack name</span>
                <input placeholder="A01" value={rackName} onChange={(e) => setRackName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Row</span>
                <input placeholder="A" value={rackRow} onChange={(e) => setRackRow(e.target.value)} />
              </label>
            </div>
            <RackHeightField value={rackHeight} onChange={setRackHeight} />
            <button className="btn primary">Add rack</button>
          </form>
          {racks.map((r) => (
            <Link className="list-item" key={r.id} to={`/projects/${pid}/racks/${r.id}`}>
              <div>
                <strong>{r.name}</strong>
                <div className="muted">
                  Row {r.row_label || "—"} · {r.ru_height}U
                </div>
              </div>
              <span className="muted">elevation →</span>
            </Link>
          ))}
        </div>
      )}

      {tab === "devices" && (
        <>
          <div className="card">
            <label className="field">
              <span>Filter</span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="name, serial, hostname, vendor…"
              />
            </label>
            <label className="field">
              <span>Import CSV or XLSX</span>
              <input
                type="file"
                accept=".csv,.xlsx,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => {
                  onImport(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="muted">
              Columns (any order): name, hostname, vendor, model, serial, asset tag, rack, RU start, RU end or height, type,
              function, management IP, notes, EOL, EOS. Matching serials are updated. Missing racks are created. Legacy .xls
              is not supported — save as .xlsx or CSV.
            </p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Rack</th>
                  <th>Vendor / model</th>
                  <th>Serial</th>
                  <th>RU</th>
                  <th>Fan</th>
                  <th>EOL</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => setEditing(d)}>
                    <td>
                      {d.name}
                      {d.restricted ? " 🔒" : ""}
                      {d.undocumented ? " ⚠" : ""}
                    </td>
                    <td>{racks.find((r) => r.id === d.rack_id)?.name || "—"}</td>
                    <td>
                      {d.vendor} {d.model}
                    </td>
                    <td>{d.serial}</td>
                    <td>
                      {d.ru_start || "—"}–{d.ru_end || "—"}
                    </td>
                    <td>{d.fan_orientation}</td>
                    <td>
                      <span className={`badge ${d.eol_status || "unknown"}`}>{d.eol_status || "unknown"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "locate" && (
        <LocatePanel projectId={pid} racks={racks} onLocated={load} />
      )}

      {tab === "cables" && (
        <div className="card">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await projects.addCable(pid, cable);
              setCable({ ...cable, from_label: "", from_port: "", to_label: "", to_port: "" });
              load();
            }}
          >
            <div className="row">
              <label className="field">
                <span>From</span>
                <input value={cable.from_label} onChange={(e) => setCable({ ...cable, from_label: e.target.value })} />
              </label>
              <label className="field">
                <span>From port</span>
                <input value={cable.from_port} onChange={(e) => setCable({ ...cable, from_port: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>To</span>
                <input value={cable.to_label} onChange={(e) => setCable({ ...cable, to_label: e.target.value })} />
              </label>
              <label className="field">
                <span>To port</span>
                <input value={cable.to_port} onChange={(e) => setCable({ ...cable, to_port: e.target.value })} />
              </label>
            </div>
            <button className="btn primary">Log cable / breakout</button>
          </form>
          {cables.map((c) => (
            <div className="list-item" key={c.id}>
              <div>
                {c.from_label}:{c.from_port} → {c.to_label}:{c.to_port}
              </div>
              <span className="muted">
                {c.media} {c.traced ? "traced" : "untraced"}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "checklists" && (
        <div className="grid">
          {lists.map((c) => (
            <div className="card" key={c.id}>
              <h3>{c.title}</h3>
              {c.items.map((item, idx) => (
                <label className="check-row" key={idx}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={async () => {
                      const items = c.items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it));
                      await projects.updateChecklist(pid, c.id, { title: c.title, template_key: c.template_key, items });
                      load();
                    }}
                  />
                  <span>{item.text}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "handoffs" && (
        <div className="card">
          <h3>Daily hand-off (Phase 2)</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await projects.addHandoff(pid, hand);
              load();
            }}
          >
            <div className="row">
              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={hand.handoff_date}
                  onChange={(e) => setHand({ ...hand, handoff_date: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Devices captured</span>
                <input
                  type="number"
                  value={hand.devices_captured}
                  onChange={(e) => setHand({ ...hand, devices_captured: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>From (onsite)</span>
                <input value={hand.from_name} onChange={(e) => setHand({ ...hand, from_name: e.target.value })} />
              </label>
              <label className="field">
                <span>To (remote)</span>
                <input value={hand.to_name} onChange={(e) => setHand({ ...hand, to_name: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Summary</span>
              <textarea value={hand.summary} onChange={(e) => setHand({ ...hand, summary: e.target.value })} />
            </label>
            <label className="field">
              <span>Issues</span>
              <textarea value={hand.issues} onChange={(e) => setHand({ ...hand, issues: e.target.value })} />
            </label>
            <button className="btn primary">Record hand-off</button>
          </form>
          {hands.map((h) => (
            <div className="list-item" key={h.id}>
              <div>
                <strong>{h.handoff_date}</strong>
                <div className="muted">
                  {h.from_name} → {h.to_name} · {h.devices_captured} devices
                </div>
                <div>{h.summary}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "lifecycle" && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Vendor</th>
                <th>EOL</th>
                <th>EOS</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setEditing(d)}>
                  <td>{d.name}</td>
                  <td>
                    {d.vendor} {d.model}
                  </td>
                  <td>{d.eol_date || "—"}</td>
                  <td>{d.eos_date || "—"}</td>
                  <td>
                    <span className={`badge ${d.eol_status || "unknown"}`}>{d.eol_status || "unknown"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
