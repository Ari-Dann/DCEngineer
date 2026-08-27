import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AisleRow,
  Area,
  Cable,
  Checklist,
  Device,
  Handoff,
  ImportResult,
  Project as ProjectT,
  Rack,
  downloadAuth,
  indicatorLabel,
  layoutPath,
  projects,
} from "../api";
import { DeviceEditorModal, RackHeightField } from "../components/DeviceEditor";
import ImportWizard from "../components/ImportWizard";
import LocatePanel from "../components/LocatePanel";
import PhotoGallery from "../components/PhotoGallery";
import RelocateDialog, { RelocateKind } from "../components/RelocateDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";

const TABS = ["overview", "areas", "rows", "racks", "devices", "locate", "cables", "checklists", "handoffs", "lifecycle"] as const;
type Tab = (typeof TABS)[number];

export default function Project() {
  const { id } = useParams();
  const pid = Number(id);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "overview";
  const [project, setProject] = useState<ProjectT | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [aisleRows, setAisleRows] = useState<AisleRow[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [lists, setLists] = useState<Checklist[]>([]);
  const [hands, setHands] = useState<Handoff[]>([]);
  const [error, setError] = useState("");
  const [areaName, setAreaName] = useState("");
  const [rowName, setRowName] = useState("");
  const [rackName, setRackName] = useState("");
  const [rackHeight, setRackHeight] = useState(42);
  const [areaFilter, setAreaFilter] = useState<number | "">("");
  const [rowFilter, setRowFilter] = useState<number | "">("");
  const [deviceArea, setDeviceArea] = useState<number | "">("");
  const [deviceRow, setDeviceRow] = useState<number | "">("");
  const [deviceRack, setDeviceRack] = useState<number | "">("");
  const [filter, setFilter] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [openArea, setOpenArea] = useState<number | null>(null);
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [relocate, setRelocate] = useState<{ kind: RelocateKind; id: number; mode: "copy" | "move" } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    kind: RelocateKind;
    id: number;
    name: string;
    detail: string;
  } | null>(null);
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
      setAisleRows(await projects.rows(pid));
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

  function setTab(next: Tab) {
    const nextParams = new URLSearchParams(params);
    if (next === "overview") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  }

  async function onImported(_target: number, result: ImportResult) {
    setImportOpen(false);
    setTab("devices");
    const placed = result.created + result.updated;
    const sheet = result.sheet ? ` from “${result.sheet}”` : "";
    const names = result.names?.length ? ` First records: ${result.names.slice(0, 8).join(", ")}.` : "";
    if (placed === 0) {
      setImportMsg(
        `Read ${result.rows} row${result.rows === 1 ? "" : "s"}${sheet} but none became devices (${result.skipped} skipped). Check the column mapping.`,
      );
    } else {
      setImportMsg(
        `Imported ${placed} device${placed === 1 ? "" : "s"} into this project${sheet}: ${result.created} created, ${result.updated} updated, ${result.racks_created} racks added, ${result.skipped} skipped.${names}`,
      );
    }
    if (result.errors.length) setError(result.errors.join(" · "));
    load();
  }

  if (!project) return <div className="page">{error || "Loading…"}</div>;

  const rowsForArea = areaFilter ? aisleRows.filter((r) => r.area_id === areaFilter) : aisleRows;
  const racksForRow = racks.filter((r) => {
    if (rowFilter && r.row_id !== rowFilter) return false;
    if (areaFilter && r.area_id !== areaFilter && aisleRows.find((row) => row.id === r.row_id)?.area_id !== areaFilter) {
      return false;
    }
    return true;
  });
  const deviceRows = deviceArea ? aisleRows.filter((r) => r.area_id === deviceArea) : aisleRows;
  const deviceRacks = racks.filter((r) => {
    if (deviceRow && r.row_id !== deviceRow) return false;
    if (deviceArea && r.area_id !== deviceArea && aisleRows.find((row) => row.id === r.row_id)?.area_id !== deviceArea) {
      return false;
    }
    return true;
  });
  const shown = devices.filter((d) => {
    if (deviceRack && d.rack_id !== deviceRack) return false;
    if (deviceRow || deviceArea) {
      const rack = racks.find((r) => r.id === d.rack_id);
      if (!rack) return false;
      if (deviceRow && rack.row_id !== deviceRow) return false;
      if (deviceArea && rack.area_id !== deviceArea && aisleRows.find((row) => row.id === rack.row_id)?.area_id !== deviceArea) {
        return false;
      }
    }
    if (!filter) return true;
    return [d.name, d.hostname, d.serial, d.vendor, d.model, d.management_ip, d.function]
      .join(" ")
      .toLowerCase()
      .includes(filter.toLowerCase());
  });

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
          {areas.map((a) => {
            const nested = aisleRows.filter((r) => r.area_id === a.id).length;
            const rackCount = racks.filter((r) => r.area_id === a.id).length;
            return (
              <div key={a.id}>
                <div className="list-item">
                  <button type="button" className="list-item clickable" style={{ padding: 0, border: 0 }} onClick={() => setOpenArea(openArea === a.id ? null : a.id)}>
                    <div style={{ textAlign: "left" }}>
                      <strong>{a.name}</strong>
                      <div className="muted">
                        {nested} row{nested === 1 ? "" : "s"} · {rackCount} rack{rackCount === 1 ? "" : "s"} ·{" "}
                        {a.restricted ? a.restriction_type || "restricted" : "in scope"} · photos{" "}
                        {a.photography_allowed ? "allowed" : "forbidden"}
                      </div>
                    </div>
                  </button>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" className="btn" onClick={() => setEditingArea(a)}>
                      Edit
                    </button>
                    <button type="button" className="btn" onClick={() => setRelocate({ kind: "area", id: a.id, mode: "copy" })}>
                      Copy
                    </button>
                    <button type="button" className="btn" onClick={() => setRelocate({ kind: "area", id: a.id, mode: "move" })}>
                      Move
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() =>
                        setPendingDelete({
                          kind: "area",
                          id: a.id,
                          name: a.name,
                          detail: `${nested} row${nested === 1 ? "" : "s"} and ${rackCount} rack${rackCount === 1 ? "" : "s"} stay in the project without this area.`,
                        })
                      }
                    >
                      Delete
                    </button>
                  </span>
                </div>
                {editingArea?.id === a.id && (
                  <form
                    className="card"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await projects.updateArea(pid, a.id, editingArea);
                      setEditingArea(null);
                      load();
                    }}
                  >
                    <label className="field">
                      <span>Name</span>
                      <input value={editingArea.name} onChange={(e) => setEditingArea({ ...editingArea, name: e.target.value })} />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={editingArea.restricted}
                        onChange={(e) => setEditingArea({ ...editingArea, restricted: e.target.checked })}
                      />
                      <span>Restricted</span>
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={editingArea.photography_allowed}
                        onChange={(e) => setEditingArea({ ...editingArea, photography_allowed: e.target.checked })}
                      />
                      <span>Photography allowed</span>
                    </label>
                    <button className="btn primary">Save area</button>
                  </form>
                )}
                {openArea === a.id && <PhotoGallery entityType="area" entityId={a.id} allowed={a.photography_allowed} />}
              </div>
            );
          })}
        </div>
      )}

      {tab === "rows" && (
        <div className="card">
          <p className="muted">Rows belong to an area. Pick an area, then add or reassign rows.</p>
          <label className="field">
            <span>Area</span>
            <select
              value={areaFilter}
              onChange={(e) => {
                setAreaFilter(e.target.value ? Number(e.target.value) : "");
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
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await projects.addRow(pid, { name: rowName, area_id: areaFilter || null });
              setRowName("");
              load();
            }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <input placeholder="Row / aisle" value={rowName} onChange={(e) => setRowName(e.target.value)} required />
            <button className="btn primary" disabled={!areaFilter}>
              Add under area
            </button>
          </form>
          {rowsForArea.map((r) => (
            <div className="list-item" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <div className="muted">
                  {areas.find((a) => a.id === r.area_id)?.name || "no area"} ·{" "}
                  {racks.filter((rack) => rack.row_id === r.id).length} racks
                </div>
              </div>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={r.area_id || ""}
                  onChange={async (e) => {
                    await projects.updateRow(pid, r.id, { name: r.name, area_id: e.target.value ? Number(e.target.value) : null, notes: r.notes });
                    load();
                  }}
                >
                  <option value="">no area</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => setRelocate({ kind: "row", id: r.id, mode: "copy" })}>
                  Copy
                </button>
                <button type="button" className="btn" onClick={() => setRelocate({ kind: "row", id: r.id, mode: "move" })}>
                  Move
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    const n = racks.filter((rack) => rack.row_id === r.id).length;
                    setPendingDelete({
                      kind: "row",
                      id: r.id,
                      name: r.name,
                      detail: `${n} rack${n === 1 ? "" : "s"} stay in the project without this row.`,
                    });
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "racks" && (
        <div className="card">
          <p className="muted">Racks belong to a row. Filter by area, then row, then add a rack.</p>
          <div className="row">
            <label className="field">
              <span>Area</span>
              <select
                value={areaFilter}
                onChange={(e) => {
                  setAreaFilter(e.target.value ? Number(e.target.value) : "");
                  setRowFilter("");
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
              <select value={rowFilter} onChange={(e) => setRowFilter(e.target.value ? Number(e.target.value) : "")}>
                <option value="">All rows</option>
                {rowsForArea.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await projects.addRack(pid, {
                name: rackName,
                ru_height: rackHeight,
                row_id: rowFilter || null,
                area_id: areaFilter || null,
                row_label: rowsForArea.find((r) => r.id === rowFilter)?.name || "",
              });
              setRackName("");
              load();
            }}
          >
            <div className="row">
              <label className="field">
                <span>Rack name</span>
                <input placeholder="A01" value={rackName} onChange={(e) => setRackName(e.target.value)} required />
              </label>
            </div>
            <RackHeightField value={rackHeight} onChange={setRackHeight} />
            <button className="btn primary" disabled={!rowFilter}>
              Add rack to row
            </button>
          </form>
          {racksForRow.map((r) => (
            <div className="list-item" key={r.id}>
              <Link to={`/projects/${pid}/racks/${r.id}`}>
                <strong>{r.name}</strong>
                <div className="muted">
                  {layoutPath(r, aisleRows, areas)} · {r.ru_height}U
                </div>
              </Link>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn" onClick={() => setRelocate({ kind: "rack", id: r.id, mode: "copy" })}>
                  Copy
                </button>
                <button type="button" className="btn" onClick={() => setRelocate({ kind: "rack", id: r.id, mode: "move" })}>
                  Move
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    const n = devices.filter((d) => d.rack_id === r.id).length;
                    setPendingDelete({
                      kind: "rack",
                      id: r.id,
                      name: r.name,
                      detail: `${n} device${n === 1 ? "" : "s"} in this rack will become unlocated.`,
                    });
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "devices" && (
        <>
          <div className="card">
            <div className="row three">
              <label className="field">
                <span>Area</span>
                <select
                  value={deviceArea}
                  onChange={(e) => {
                    setDeviceArea(e.target.value ? Number(e.target.value) : "");
                    setDeviceRow("");
                    setDeviceRack("");
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
                <select
                  value={deviceRow}
                  onChange={(e) => {
                    setDeviceRow(e.target.value ? Number(e.target.value) : "");
                    setDeviceRack("");
                  }}
                >
                  <option value="">All rows</option>
                  {deviceRows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Rack</span>
                <select value={deviceRack} onChange={(e) => setDeviceRack(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">All racks</option>
                  {deviceRacks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {layoutPath(r, aisleRows, areas)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Filter</span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="name, serial, hostname, vendor…"
              />
            </label>
            <button type="button" className="btn primary" onClick={() => setImportOpen(true)}>
              Import CSV / XLSX
            </button>
            <p className="muted">
              Imports into this project. You choose the sheet and map columns or rows onto device fields. Unlocated
              devices (no rack) show here and under Locate.
            </p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Area</th>
                  <th>Row</th>
                  <th>Rack</th>
                  <th>Vendor / model</th>
                  <th>Serial</th>
                  <th>RU</th>
                  <th>Fan</th>
                  <th>LED / screen</th>
                  <th>EOL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const rack = racks.find((r) => r.id === d.rack_id);
                  const row = aisleRows.find((r) => r.id === rack?.row_id);
                  const area = areas.find((a) => a.id === (rack?.area_id || row?.area_id));
                  return (
                    <tr key={d.id} className="clickable" onClick={() => setEditing(d)}>
                      <td>
                        {d.name}
                        {d.restricted ? " 🔒" : ""}
                        {d.undocumented ? " ⚠" : ""}
                      </td>
                      <td>{area?.name || "—"}</td>
                      <td>{row?.name || rack?.row_label || "—"}</td>
                      <td>{rack?.name || "—"}</td>
                      <td>
                        {d.vendor} {d.model}
                      </td>
                      <td>{d.serial}</td>
                      <td>
                        {d.ru_start || "—"}–{d.ru_end || "—"}
                      </td>
                      <td>{d.fan_orientation}</td>
                      <td>{indicatorLabel(d.indicator_type, d.indicator_color)}</td>
                      <td>
                        <span className={`badge ${d.eol_status || "unknown"}`}>{d.eol_status || "unknown"}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setRelocate({ kind: "device", id: d.id, mode: "copy" })}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setRelocate({ kind: "device", id: d.id, mode: "move" })}
                          >
                            Move
                          </button>
                          <button
                            type="button"
                            className="btn danger"
                            onClick={() =>
                              setPendingDelete({
                                kind: "device",
                                id: d.id,
                                name: d.name,
                                detail: "This device will be removed from the project.",
                              })
                            }
                          >
                            Delete
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "locate" && (
        <LocatePanel projectId={pid} racks={racks} areas={areas} rows={aisleRows} onLocated={load} />
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

      {importOpen && (
        <ImportWizard
          projectList={project ? [project] : []}
          projectId={pid}
          onClose={() => setImportOpen(false)}
          onImported={onImported}
        />
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
          onRelocate={(mode) => {
            setRelocate({ kind: "device", id: editing.id, mode });
            setEditing(null);
          }}
          onDelete={() => {
            setPendingDelete({
              kind: "device",
              id: editing.id,
              name: editing.name,
              detail: "This device will be removed from the project.",
            });
            setEditing(null);
          }}
        />
      )}
      {relocate && (
        <RelocateDialog
          kind={relocate.kind}
          mode={relocate.mode}
          projectId={pid}
          entityId={relocate.id}
          onClose={() => setRelocate(null)}
          onDone={load}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.kind} “${pendingDelete.name}”?`}
          message={pendingDelete.detail}
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            if (pendingDelete.kind === "area") await projects.deleteArea(pid, pendingDelete.id);
            else if (pendingDelete.kind === "row") await projects.deleteRow(pid, pendingDelete.id);
            else if (pendingDelete.kind === "rack") await projects.deleteRack(pid, pendingDelete.id);
            else await projects.deleteDevice(pid, pendingDelete.id);
            load();
          }}
        />
      )}
    </div>
  );
}
