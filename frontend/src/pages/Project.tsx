import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AisleRow,
  Area,
  Cable,
  Checklist,
  Device,
  Handoff,
  ImportResult,
  PDU,
  Project as ProjectT,
  Rack,
  downloadAuth,
  getSession,
  indicatorLabel,
  layoutPath,
  projects,
} from "../api";
import { countDevices, formatAmps, formatHierarchyPower, formatPowerWatts, rackIdsForArea, rackIdsForRow, sumDcAmps, sumPowerWatts } from "../power";
import { DeviceEditorModal, RackHeightField } from "../components/DeviceEditor";
import ImportWizard from "../components/ImportWizard";
import LocatePanel from "../components/LocatePanel";
import PhotoGallery from "../components/PhotoGallery";
import RelocateDialog, { RelocateKind } from "../components/RelocateDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PromptDialog } from "../components/PromptDialog";
import { ItemSelect, SelectMode, SelectModeToggle, SelectionToolbar } from "../components/SelectionBar";
import AiImageParse, { EntryMode, EntryModeRadios } from "../components/AiImageParse";
import RestrictionPicker, { SavedRestrictionPicker } from "../components/RestrictionPicker";
import { parseIdParam, projectHref, rackHref } from "../nav";
import {
  inheritedPhotoBlockers,
  photosAllowed,
  restrictionCaption,
  restrictionFields,
  restrictionTypeOf,
  type RestrictionType,
} from "../restriction";

const TABS = ["overview", "areas", "rows", "racks", "devices", "locate", "cables", "checklists", "handoffs", "lifecycle"] as const;
type Tab = (typeof TABS)[number];
const LAYOUT_TABS: Tab[] = ["areas", "rows", "racks", "devices"];
const OTHER_TABS: Tab[] = ["overview", "locate", "cables", "checklists", "handoffs", "lifecycle"];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  areas: "Areas",
  rows: "Rows",
  racks: "Racks",
  devices: "Devices",
  locate: "Locate",
  cables: "Cables",
  checklists: "Checklists",
  handoffs: "Handoffs",
  lifecycle: "Lifecycle",
};

function countPhrase(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export default function Project() {
  const { id } = useParams();
  const pid = Number(id);
  const navigate = useNavigate();
  const role = getSession()?.role;
  const isAdmin = role === "admin";
  const canImport = role === "admin" || role === "engineer";
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "overview";
  const areaFilter = parseIdParam(params.get("area"));
  const rowFilter = parseIdParam(params.get("row"));
  const [project, setProject] = useState<ProjectT | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [aisleRows, setAisleRows] = useState<AisleRow[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pdus, setPdus] = useState<PDU[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [lists, setLists] = useState<Checklist[]>([]);
  const [hands, setHands] = useState<Handoff[]>([]);
  const [error, setError] = useState("");
  const [areaName, setAreaName] = useState("");
  const [rowName, setRowName] = useState("");
  const [rowAreaId, setRowAreaId] = useState<number | "">("");
  const [rowBulk, setRowBulk] = useState("");
  const [areaMode, setAreaMode] = useState<EntryMode>("manual");
  const [rowMode, setRowMode] = useState<EntryMode>("manual");
  const [rackMode, setRackMode] = useState<EntryMode>("manual");
  const [deviceMode, setDeviceMode] = useState<EntryMode>("manual");
  const [rackName, setRackName] = useState("");
  const [rackHeight, setRackHeight] = useState(42);
  const [deviceArea, setDeviceArea] = useState<number | "">("");
  const [deviceRow, setDeviceRow] = useState<number | "">("");
  const [deviceRack, setDeviceRack] = useState<number | "">("");
  const [filter, setFilter] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [openArea, setOpenArea] = useState<number | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [editingRow, setEditingRow] = useState<AisleRow | null>(null);
  const [editingRack, setEditingRack] = useState<Rack | null>(null);
  const [selectMode, setSelectMode] = useState<SelectMode>("one");
  const [selected, setSelected] = useState<number[]>([]);
  const [relocate, setRelocate] = useState<{ kind: RelocateKind; ids: number[]; mode: "copy" | "move" } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    kind: RelocateKind | "project";
    ids: number[];
    name: string;
    detail: string;
  } | null>(null);
  const [renamingProject, setRenamingProject] = useState(false);
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
      setPdus(await projects.projectPdus(pid));
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

  useEffect(() => {
    setRowAreaId(areaFilter || "");
  }, [areaFilter]);

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
    setSelected([]);
  }

  function setHierarchy(next: { tab?: Tab; area?: number | ""; row?: number | "" }) {
    const nextParams = new URLSearchParams(params);
    const nextTab = next.tab ?? tab;
    if (nextTab === "overview") nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    const area = next.area === undefined ? areaFilter : next.area;
    const row = next.row === undefined ? rowFilter : next.row;
    if (area) nextParams.set("area", String(area));
    else nextParams.delete("area");
    if (row) nextParams.set("row", String(row));
    else nextParams.delete("row");
    setParams(nextParams);
    setSelected([]);
  }

  function changeSelectMode(next: SelectMode) {
    setSelectMode(next);
    setSelected((ids) => (next === "one" ? ids.slice(0, 1) : ids));
  }

  async function persistRowRestriction(row: AisleRow, type: RestrictionType) {
    try {
      const saved = await projects.updateRow(pid, row.id, { ...row, ...restrictionFields(type) });
      setAisleRows((rows) => rows.map((item) => (item.id === saved.id ? saved : item)));
      setEditingRow((current) => (current?.id === saved.id ? saved : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save row restriction");
      throw e;
    }
  }

  async function persistRackRestriction(rack: Rack, type: RestrictionType) {
    try {
      const saved = await projects.updateRack(pid, rack.id, { ...rack, ...restrictionFields(type) });
      setRacks((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      setEditingRack((current) => (current?.id === saved.id ? saved : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rack restriction");
      throw e;
    }
  }

  async function onImported(_target: number, result: ImportResult) {
    setImportOpen(false);
    setTab("devices");
    const placed = result.created + result.updated;
    const sheet = result.sheet ? ` from “${result.sheet}”` : "";
    const names = result.names?.length ? ` First records: ${result.names.slice(0, 8).join(", ")}.` : "";
    const preserved = result.preserved
      ? ` ${result.preserved} existing item${result.preserved === 1 ? "" : "s"} left in place.`
      : "";
    const layout = [
      result.areas_created ? `${result.areas_created} area${result.areas_created === 1 ? "" : "s"}` : "",
      result.rows_created ? `${result.rows_created} row${result.rows_created === 1 ? "" : "s"}` : "",
      result.racks_created ? `${result.racks_created} rack${result.racks_created === 1 ? "" : "s"}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    if (placed === 0 && !layout) {
      setImportMsg(
        `Read ${result.rows} row${result.rows === 1 ? "" : "s"}${sheet} but none became devices (${result.skipped} skipped).${preserved || " Check the column mapping."}`,
      );
    } else {
      setImportMsg(
        `Imported${sheet}: ${result.created} created, ${result.updated} updated${layout ? `, layout ${layout}` : ""}${result.nested ? `, ${result.nested} nested` : ""}, ${result.skipped} skipped.${preserved}${names}`,
      );
    }
    if (result.errors.length) setError(result.errors.join(" · "));
    load();
  }

  if (!project) return <div className="page">{error || "Loading…"}</div>;

  const currentArea = areas.find((a) => a.id === areaFilter);
  const currentRow = aisleRows.find((r) => r.id === rowFilter);
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
    return [d.name, d.hostname, d.serial, d.vendor, d.model, d.management_ip, d.function, d.owner]
      .join(" ")
      .toLowerCase()
      .includes(filter.toLowerCase());
  });

  return (
    <div className="page">
      <nav className="crumb">
        <Link to="/projects">Projects</Link>
        <span className="muted">/</span>
        <Link to={projectHref(pid)} className={!currentArea && !currentRow ? "here" : undefined}>
          {project.name}
        </Link>
        {currentArea && (
          <>
            <span className="muted">/</span>
            <Link to={projectHref(pid, { tab: "rows", area: currentArea.id })} className={!currentRow ? "here" : undefined}>
              {currentArea.name}
            </Link>
          </>
        )}
        {currentRow && (
          <>
            <span className="muted">/</span>
            <Link to={projectHref(pid, { tab: "racks", area: currentRow.area_id, row: currentRow.id })} className="here">
              {currentRow.name}
            </Link>
          </>
        )}
      </nav>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>{project.name}</h1>
          <p>
            {project.customer} · {project.site_name} · revision {project.revision}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isAdmin && (
            <>
              <button type="button" className="btn" onClick={() => setRenamingProject(true)}>
                Rename
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() =>
                  setPendingDelete({
                    kind: "project",
                    ids: [pid],
                    name: project.name,
                    detail: "This removes the entire project: areas, rows, racks, devices, cables, checklists, and hand-offs.",
                  })
                }
              >
                Delete project
              </button>
            </>
          )}
          <button className="btn primary" onClick={() => downloadAuth(projects.exportUrl(pid), `RBI-${project.name}.xlsx`)}>
            Export RBI workbook
          </button>
          <button
            className="btn"
            onClick={() => downloadAuth(projects.exportVisioUrl(pid), `${project.name}-Visio-Office.zip`)}
          >
            Export for Visio / Office
          </button>
          <button
            className="btn"
            onClick={() => downloadAuth(projects.exportNetboxUrl(pid), `${project.name}-NetBox.zip`)}
          >
            Export for NetBox
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {importMsg && <div className="success">{importMsg}</div>}
      <p className="tabs-label">Layout</p>
      <div className="tabs">
        {LAYOUT_TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="tabs-label">Project</p>
      <div className="tabs">
        {OTHER_TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="layout-stats">
            {(
              [
                ["areas", "Areas", areas.length],
                ["rows", "Rows", aisleRows.length],
                ["racks", "Racks", racks.length],
                ["devices", "Devices", devices.length],
              ] as const
            ).map(([next, label, count]) => (
              <button key={next} type="button" className="layout-stat" onClick={() => setTab(next)}>
                <strong>{count}</strong>
                <span className="muted">{label}</span>
              </button>
            ))}
          </div>
          <form className="card" onSubmit={saveProject}>
            {isAdmin && (
              <label className="field">
                <span>Project name</span>
                <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} required />
              </label>
            )}
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
            <RestrictionPicker
              name="project-restriction"
              noun="project"
              value={restrictionTypeOf(project)}
              onChange={(type) => setProject({ ...project, ...restrictionFields(type) })}
              scope="project"
              entityName={project.name}
            />
            <label className="field">
              <span>Restricted equipment notes</span>
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
            <PhotoGallery entityType="project" entityId={pid} allowed={photosAllowed({ project })} />
          </div>
        </>
      )}

      {tab === "areas" && (
        <div className="card">
          <EntryModeRadios name="entry-areas" value={areaMode} onChange={setAreaMode} />
          <p className="muted">Click an area to open its rows. Use Individual or Bulk to select items to edit, move, or delete.</p>
          {areaMode === "ai" ? (
            <AiImageParse projectId={pid} target="area" project={project} areas={areas} onInventoryChanged={load} />
          ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await projects.addArea(pid, { name: areaName });
              setAreaName("");
              load();
            }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <input placeholder="Area / cage / hall" value={areaName} onChange={(e) => setAreaName(e.target.value)} required />
            <button className="btn primary">Add</button>
            {canImport && (
              <button type="button" className="btn" onClick={() => setImportOpen(true)}>
                Import CSV / XLSX / ODS
              </button>
            )}
          </form>
          )}
          <SelectModeToggle mode={selectMode} onChange={changeSelectMode} />
          <SelectionToolbar
            noun="area"
            selectedCount={selected.length}
            total={areas.length}
            onSelectAll={selectMode === "many" ? () => setSelected(areas.map((a) => a.id)) : undefined}
            onClear={() => setSelected([])}
            onEdit={() => {
              const area = areas.find((a) => a.id === selected[0]);
              if (area) setEditingArea(area);
            }}
            onCopy={() => setRelocate({ kind: "area", ids: selected, mode: "copy" })}
            onMove={() => setRelocate({ kind: "area", ids: selected, mode: "move" })}
            onDelete={() => {
              const names = areas.filter((a) => selected.includes(a.id)).map((a) => a.name);
              setPendingDelete({
                kind: "area",
                ids: selected,
                name: names.join(", "),
                detail: "Rows and racks stay in the project without these areas.",
              });
            }}
          />
          {areas.map((a) => {
            const rowCount = aisleRows.filter((r) => r.area_id === a.id).length;
            const nestedRackIds = rackIdsForArea(a.id, racks, aisleRows);
            const rackCount = nestedRackIds.length;
            const deviceCount = countDevices(devices, nestedRackIds);
            const watts = sumPowerWatts(devices, nestedRackIds);
            const amps = sumDcAmps(devices, nestedRackIds);
            return (
              <div key={a.id} className="list-entry">
                <div className="list-item">
                  <div className="list-main">
                    <ItemSelect mode={selectMode} group="area-pick" id={a.id} selected={selected} onChange={setSelected} />
                    <button
                      type="button"
                      className="list-main"
                      onClick={() => setHierarchy({ tab: "rows", area: a.id, row: "" })}
                    >
                      <span>
                        <strong>{a.name}</strong>
                        <div className="muted">
                          {countPhrase(rowCount, "row")} · {countPhrase(rackCount, "rack")} · {countPhrase(deviceCount, "device")} ·{" "}
                          {formatHierarchyPower(watts, amps)} · {restrictionCaption(a)}
                        </div>
                      </span>
                    </button>
                  </div>
                  <button type="button" className="btn" onClick={() => setOpenArea(openArea === a.id ? null : a.id)}>
                    Photos
                  </button>
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
                    <RestrictionPicker
                      name={`area-restriction-${a.id}`}
                      noun="area"
                      value={restrictionTypeOf(editingArea)}
                      onChange={(type) => setEditingArea({ ...editingArea, ...restrictionFields(type) })}
                      inherited={inheritedPhotoBlockers({ project })}
                      scope="area"
                      entityName={editingArea.name}
                    />
                    <button className="btn primary">Save area</button>
                  </form>
                )}
                {openArea === a.id && (
                  <PhotoGallery entityType="area" entityId={a.id} allowed={photosAllowed({ project, area: a })} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "rows" && (
        <div className="card">
          <EntryModeRadios name="entry-rows" value={rowMode} onChange={setRowMode} />
          <p className="muted">
            Rows sit between areas and racks. {currentArea ? `Showing ${currentArea.name}.` : "Filter by area, or add a set below."}{" "}
            Click a row to open its racks. Tag government / EMSS on a specific row — other rows stay open.
          </p>
          {currentArea && (
            <p>
              <Link to={projectHref(pid, { tab: "areas" })}>← {currentArea.name}</Link>
            </p>
          )}
          <label className="field">
            <span>Filter by area</span>
            <select
              value={areaFilter}
              onChange={(e) => setHierarchy({ tab: "rows", area: e.target.value ? Number(e.target.value) : "", row: "" })}
            >
              <option value="">All areas</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {rowMode === "ai" ? (
            <AiImageParse
              projectId={pid}
              target="row"
              areaId={rowAreaId || areaFilter || ""}
              project={project}
              areas={areas}
              rows={aisleRows}
              onInventoryChanged={load}
            />
          ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const targetArea = rowAreaId || areaFilter;
              if (!targetArea) {
                setError("Select an area before creating rows.");
                return;
              }
              const names = [rowName, ...rowBulk.split(/[\n,;]+/)].map((s) => s.trim()).filter(Boolean);
              if (!names.length) {
                setError("Enter at least one row name.");
                return;
              }
              setError("");
              await projects.addRows(pid, {
                area_id: Number(targetArea),
                names,
              });
              setRowName("");
              setRowBulk("");
              load();
            }}
            style={{ display: "grid", gap: 8 }}
          >
            <label className="field">
              <span>Create under area</span>
              <select value={rowAreaId} onChange={(e) => setRowAreaId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Select an area</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <input placeholder="One row name, or leave blank and paste a list" value={rowName} onChange={(e) => setRowName(e.target.value)} />
            <label className="field">
              <span>Or a set of rows (one per line)</span>
              <textarea value={rowBulk} onChange={(e) => setRowBulk(e.target.value)} placeholder={"A01\nA02\nA03"} rows={4} />
            </label>
            <button className="btn primary" disabled={!rowAreaId && !areaFilter}>
              Create rows
            </button>
          </form>
          )}
          {rowsForArea.length === 0 && (
            <p className="muted" style={{ marginTop: 12 }}>
              No rows yet. Add them here or capture a wide aisle shot on New Device and create the suggested names.
            </p>
          )}
          <SelectModeToggle mode={selectMode} onChange={changeSelectMode} />
          <SelectionToolbar
            noun="row"
            selectedCount={selected.length}
            total={rowsForArea.length}
            onSelectAll={selectMode === "many" ? () => setSelected(rowsForArea.map((r) => r.id)) : undefined}
            onClear={() => setSelected([])}
            onEdit={() => {
              const row = aisleRows.find((r) => r.id === selected[0]);
              if (row) setEditingRow(row);
            }}
            onCopy={() => setRelocate({ kind: "row", ids: selected, mode: "copy" })}
            onMove={() => setRelocate({ kind: "row", ids: selected, mode: "move" })}
            onDelete={() => {
              const names = aisleRows.filter((r) => selected.includes(r.id)).map((r) => r.name);
              setPendingDelete({
                kind: "row",
                ids: selected,
                name: names.join(", "),
                detail: "Racks stay in the project without these rows.",
              });
            }}
          />
          {rowsForArea.map((r) => {
            const nestedRackIds = rackIdsForRow(r.id, racks);
            const rackCount = nestedRackIds.length;
            const deviceCount = countDevices(devices, nestedRackIds);
            const watts = sumPowerWatts(devices, nestedRackIds);
            const amps = sumDcAmps(devices, nestedRackIds);
            const parentArea = areas.find((a) => a.id === r.area_id);
            return (
            <div key={r.id} className="list-entry">
            <div className="list-item">
              <div className="list-main">
                <ItemSelect mode={selectMode} group="row-pick" id={r.id} selected={selected} onChange={setSelected} />
                <div className="list-identity">
                  <button
                    type="button"
                    className="list-name"
                    onClick={() => setHierarchy({ tab: "racks", area: r.area_id || areaFilter || "", row: r.id })}
                  >
                    <strong>{r.name}</strong>
                  </button>
                  <SavedRestrictionPicker
                    name={`row-restriction-${r.id}`}
                    entity={r}
                    scope="row"
                    compact
                    inline
                    inherited={inheritedPhotoBlockers({ project })}
                    onPersist={(type) => persistRowRestriction(r, type)}
                  />
                  <button
                    type="button"
                    className="list-meta muted"
                    onClick={() => setHierarchy({ tab: "racks", area: r.area_id || areaFilter || "", row: r.id })}
                  >
                    {parentArea?.name || "no area"} · {countPhrase(rackCount, "rack")} · {countPhrase(deviceCount, "device")} ·{" "}
                    {formatHierarchyPower(watts, amps)} · {restrictionCaption(r)}
                  </button>
                </div>
              </div>
              <button type="button" className="btn" onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                Photos
              </button>
            </div>
            {editingRow?.id === r.id && (
              <form
                className="card"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await projects.updateRow(pid, r.id, editingRow);
                  setEditingRow(null);
                  load();
                }}
              >
                <label className="field">
                  <span>Name</span>
                  <input value={editingRow.name} onChange={(e) => setEditingRow({ ...editingRow, name: e.target.value })} />
                </label>
                <button className="btn primary">Save row</button>
              </form>
            )}
            {openRow === r.id && (
              <PhotoGallery
                entityType="row"
                entityId={r.id}
                allowed={photosAllowed({ project, row: r })}
              />
            )}
            </div>
            );
          })}
        </div>
      )}

      {tab === "racks" && (
        <div className="card">
          <EntryModeRadios name="entry-racks" value={rackMode} onChange={setRackMode} />
          <p className="muted">
            {currentRow
              ? `Racks in ${currentRow.name}. Click a rack to open its elevation. The switch above tags this row only.`
              : "Racks belong to a row. Open a row from the Rows tab, or filter below. Tag government / EMSS on a specific rack."}
          </p>
          {currentRow && (
            <p>
              <Link to={projectHref(pid, { tab: "rows", area: currentRow.area_id || areaFilter || "" })}>
                ← {currentRow.name}
              </Link>
            </p>
          )}
          {currentRow && (
            <SavedRestrictionPicker
              name={`current-row-restriction-${currentRow.id}`}
              entity={currentRow}
              scope="row"
              inherited={inheritedPhotoBlockers({ project })}
              onPersist={(type) => persistRowRestriction(currentRow, type)}
            />
          )}
          <div className="row">
            <label className="field">
              <span>Area</span>
              <select
                value={areaFilter}
                onChange={(e) => setHierarchy({ tab: "racks", area: e.target.value ? Number(e.target.value) : "", row: "" })}
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
                value={rowFilter}
                onChange={(e) => setHierarchy({ tab: "racks", row: e.target.value ? Number(e.target.value) : "" })}
              >
                <option value="">All rows</option>
                {rowsForArea.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {rackMode === "ai" ? (
            <AiImageParse
              projectId={pid}
              target="rack"
              areaId={areaFilter || ""}
              rowId={rowFilter || ""}
              project={project}
              areas={areas}
              rows={aisleRows}
              racks={racks}
              onInventoryChanged={load}
            />
          ) : (
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
          )}
          <SelectModeToggle mode={selectMode} onChange={changeSelectMode} />
          <SelectionToolbar
            noun="rack"
            selectedCount={selected.length}
            total={racksForRow.length}
            onSelectAll={selectMode === "many" ? () => setSelected(racksForRow.map((r) => r.id)) : undefined}
            onClear={() => setSelected([])}
            onEdit={() => {
              const rack = racks.find((r) => r.id === selected[0]);
              if (rack) setEditingRack(rack);
            }}
            onCopy={() => setRelocate({ kind: "rack", ids: selected, mode: "copy" })}
            onMove={() => setRelocate({ kind: "rack", ids: selected, mode: "move" })}
            onDelete={() => {
              const names = racks.filter((r) => selected.includes(r.id)).map((r) => r.name);
              setPendingDelete({
                kind: "rack",
                ids: selected,
                name: names.join(", "),
                detail: "Devices in these racks will become unlocated.",
              });
            }}
          />
          {racksForRow.map((r) => {
            const parentRow = aisleRows.find((row) => row.id === r.row_id);
            const deviceCount = countDevices(devices, [r.id]);
            return (
            <div key={r.id} className="list-entry">
            <div className="list-item">
              <div className="list-main">
                <ItemSelect mode={selectMode} group="rack-pick" id={r.id} selected={selected} onChange={setSelected} />
                <div className="list-identity">
                  <Link
                    className="list-name"
                    to={rackHref(pid, r.id, { area: r.area_id || areaFilter, row: r.row_id || rowFilter })}
                  >
                    <strong>{r.name}</strong>
                  </Link>
                  <SavedRestrictionPicker
                    name={`rack-restriction-${r.id}`}
                    entity={r}
                    scope="rack"
                    compact
                    inline
                    inherited={inheritedPhotoBlockers({ project, row: parentRow })}
                    onPersist={(type) => persistRackRestriction(r, type)}
                  />
                  <Link
                    className="list-meta muted"
                    to={rackHref(pid, r.id, { area: r.area_id || areaFilter, row: r.row_id || rowFilter })}
                  >
                    {layoutPath(r, aisleRows, areas)} · {r.ru_height}U · {countPhrase(deviceCount, "device")} ·{" "}
                    {formatHierarchyPower(sumPowerWatts(devices, [r.id]), sumDcAmps(devices, [r.id]))} ·{" "}
                    {restrictionCaption(r)}
                  </Link>
                </div>
              </div>
            </div>
            {editingRack?.id === r.id && (
              <form
                className="card"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await projects.updateRack(pid, r.id, editingRack);
                  setEditingRack(null);
                  load();
                }}
              >
                <label className="field">
                  <span>Name</span>
                  <input value={editingRack.name} onChange={(e) => setEditingRack({ ...editingRack, name: e.target.value })} />
                </label>
                <button className="btn primary">Save rack</button>
              </form>
            )}
            </div>
            );
          })}
        </div>
      )}

      {tab === "devices" && (
        <>
          <div className="card">
            <EntryModeRadios name="entry-devices" value={deviceMode} onChange={setDeviceMode} />
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
            {deviceMode === "ai" && (
              <AiImageParse
                projectId={pid}
                target="device"
                areaId={deviceArea || ""}
                rowId={deviceRow || ""}
                rackId={deviceRack || ""}
                project={project}
                areas={areas}
                rows={aisleRows}
                racks={racks}
                onInventoryChanged={load}
              />
            )}
            <label className="field">
              <span>Filter</span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="name, serial, hostname, vendor, owner…"
              />
            </label>
            {canImport && (
              <button type="button" className="btn primary" onClick={() => setImportOpen(true)}>
                Import CSV / XLSX / ODS
              </button>
            )}
            <p className="muted">
              {canImport
                ? "Imports into this project. Map Area and Row/Aisle columns to populate a whole area, even when some lines have no device."
                : "Unlocated devices (no rack) show here and under Locate."}
            </p>
            <SelectModeToggle mode={selectMode} onChange={changeSelectMode} />
            <SelectionToolbar
              noun="device"
              selectedCount={selected.length}
              total={shown.length}
              onSelectAll={selectMode === "many" ? () => setSelected(shown.map((d) => d.id)) : undefined}
              onClear={() => setSelected([])}
              onEdit={() => {
                const device = devices.find((d) => d.id === selected[0]);
                if (device) setEditing(device);
              }}
              onCopy={() => setRelocate({ kind: "device", ids: selected, mode: "copy" })}
              onMove={() => setRelocate({ kind: "device", ids: selected, mode: "move" })}
              onDelete={() => {
                const names = devices.filter((d) => selected.includes(d.id)).map((d) => d.name);
                setPendingDelete({
                  kind: "device",
                  ids: selected,
                  name: names.join(", "),
                  detail: "Selected devices will be removed from the project.",
                });
              }}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Area</th>
                  <th>Row</th>
                  <th>Rack</th>
                  <th>Vendor / model</th>
                  <th>Serial</th>
                  <th>RU</th>
                  <th>AC</th>
                  <th>DC</th>
                  <th>PDU A</th>
                  <th>PDU B</th>
                  <th>Fan</th>
                  <th>LED / screen</th>
                  <th>EOL</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const rack = racks.find((r) => r.id === d.rack_id);
                  const row = aisleRows.find((r) => r.id === rack?.row_id);
                  const area = areas.find((a) => a.id === (rack?.area_id || row?.area_id));
                  const parent = d.parent_device_id ? devices.find((p) => p.id === d.parent_device_id) : undefined;
                  const ru =
                    d.ru_start || d.ru_end
                      ? `${d.ru_start || "—"}${d.ru_end && d.ru_end !== d.ru_start ? `–${d.ru_end}` : ""}`
                      : "—";
                  return (
                    <tr key={d.id} className={`clickable${d.parent_device_id ? " nested-device" : ""}`} onClick={() => setEditing(d)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <ItemSelect mode={selectMode} group="device-pick" id={d.id} selected={selected} onChange={setSelected} />
                      </td>
                      <td>
                        {d.name}
                        {d.restricted || !photosAllowed({ project, row, rack, device: d }) ? " 🔒" : ""}
                        {d.undocumented ? " ⚠" : ""}
                      </td>
                      <td>{d.owner || "—"}</td>
                      <td>{area?.name || "—"}</td>
                      <td>{row?.name || rack?.row_label || "—"}</td>
                      <td>{rack?.name || "—"}</td>
                      <td>
                        {d.vendor} {d.model}
                      </td>
                      <td>{d.serial}</td>
                      <td>
                        {ru}
                        {parent ? ` (in ${parent.name})` : ""}
                      </td>
                      <td>{formatPowerWatts(d.power_draw_watts)}</td>
                      <td>{formatAmps(d.dc_power_draw_amps)}</td>
                      <td>{pdus.find((p) => p.id === d.pdu_a_id)?.name || "—"}</td>
                      <td>{pdus.find((p) => p.id === d.pdu_b_id)?.name || "—"}</td>
                      <td>{d.fan_orientation}</td>
                      <td>{indicatorLabel(d.indicator_type, d.indicator_color)}</td>
                      <td>
                        <span className={`badge ${d.eol_status || "unknown"}`}>{d.eol_status || "unknown"}</span>
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

      {importOpen && canImport && (
        <ImportWizard
          projectList={project ? [project] : []}
          projectId={pid}
          defaultAreaId={areaFilter || undefined}
          onClose={() => setImportOpen(false)}
          onImported={onImported}
        />
      )}
      {editing && (
        <DeviceEditorModal
          key={editing.id}
          projectId={pid}
          project={project}
          device={editing}
          racks={racks}
          areas={areas}
          rows={aisleRows}
          devices={devices}
          pdus={pdus}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onSelectDevice={setEditing}
          onRelocate={(mode) => {
            setRelocate({ kind: "device", ids: [editing.id], mode });
            setEditing(null);
          }}
          onDelete={() => {
            setPendingDelete({
              kind: "device",
              ids: [editing.id],
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
          entityIds={relocate.ids}
          onClose={() => setRelocate(null)}
          onDone={() => {
            setSelected([]);
            load();
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.kind}${pendingDelete.ids.length > 1 ? "s" : ""} “${pendingDelete.name}”?`}
          message={pendingDelete.detail}
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            if (pendingDelete.kind === "project") {
              await projects.delete(pid);
              navigate("/projects");
              return;
            }
            for (const entityId of pendingDelete.ids) {
              if (pendingDelete.kind === "area") await projects.deleteArea(pid, entityId);
              else if (pendingDelete.kind === "row") await projects.deleteRow(pid, entityId);
              else if (pendingDelete.kind === "rack") await projects.deleteRack(pid, entityId);
              else await projects.deleteDevice(pid, entityId);
            }
            setSelected([]);
            load();
          }}
        />
      )}
      {renamingProject && project && (
        <PromptDialog
          title="Rename project"
          label="Project name"
          initial={project.name}
          onClose={() => setRenamingProject(false)}
          onSave={async (name) => {
            await projects.update(pid, { ...project, name });
            load();
          }}
        />
      )}
    </div>
  );
}
