import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AisleRow, Area, Device, Elevation, PDU, Project, Rack, downloadAuth, layoutPath, projects, uploadPhotos } from "../api";
import { formatHierarchyPower, sumDcAmps, sumPowerWatts } from "../power";
import {
  DeviceDraft,
  DeviceEditorModal,
  DeviceFields,
  RackHeightField,
  emptyDraft,
  payloadFromDraft,
} from "../components/DeviceEditor";
import PhotoGallery from "../components/PhotoGallery";
import RelocateDialog, { RelocateKind } from "../components/RelocateDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import RestrictionPicker from "../components/RestrictionPicker";
import { parseIdParam, projectHref } from "../nav";
import AiImageParse, { EntryMode, EntryModeRadios } from "../components/AiImageParse";
import { inheritedPhotoBlockers, photosAllowed, restrictionFields, restrictionTypeOf } from "../restriction";

export default function RackPage() {
  const { id, rackId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pid = Number(id);
  const rid = Number(rackId);
  const [elev, setElev] = useState<Elevation | null>(null);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [aisleRows, setAisleRows] = useState<AisleRow[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pdus, setPdus] = useState<PDU[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DeviceDraft>(emptyDraft(rid));
  const [photos, setPhotos] = useState<File[]>([]);
  const [pduName, setPduName] = useState("PDU-A");
  const [editing, setEditing] = useState<Device | null>(null);
  const [adding, setAdding] = useState<DeviceDraft | null>(null);
  const [relocate, setRelocate] = useState<{ kind: RelocateKind; ids: number[]; mode: "copy" | "move" } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "rack" | "device"; id: number; name: string; detail: string } | null>(
    null,
  );
  const [height, setHeight] = useState(42);
  const [deviceMode, setDeviceMode] = useState<EntryMode>("manual");

  async function load() {
    try {
      const next = await projects.elevation(pid, rid);
      setElev(next);
      setHeight(next.rack.ru_height);
      setPdus(await projects.pdus(pid, rid));
      setRacks(await projects.racks(pid));
      setAreas(await projects.areas(pid));
      setAisleRows(await projects.rows(pid));
      setProject(await projects.get(pid));
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

  const backArea = parseIdParam(params.get("area")) || elev.rack.area_id || "";
  const backRow = parseIdParam(params.get("row")) || elev.rack.row_id || "";
  const backRowName = aisleRows.find((r) => r.id === backRow)?.name || elev.rack.row_label || "row";
  const backHref = projectHref(pid, { tab: backRow ? "racks" : "rows", area: backArea, row: backRow });
  const parentRow = aisleRows.find((r) => r.id === elev.rack.row_id);
  const rackInherited = inheritedPhotoBlockers({ project, row: parentRow });
  const rackPhotosOk = photosAllowed({ project, row: parentRow, rack: elev.rack });

  return (
    <div className="page">
      <nav className="crumb">
        <Link to="/projects">Projects</Link>
        <span className="muted">/</span>
        <Link to={projectHref(pid)}>Project</Link>
        {backArea ? (
          <>
            <span className="muted">/</span>
            <Link to={projectHref(pid, { tab: "rows", area: backArea })}>
              {areas.find((a) => a.id === backArea)?.name || "Area"}
            </Link>
          </>
        ) : null}
        {backRow ? (
          <>
            <span className="muted">/</span>
            <Link to={backHref}>{backRowName}</Link>
          </>
        ) : null}
        <span className="muted">/</span>
        <span className="here">{elev.rack.name}</span>
      </nav>
      <p>
        <Link to={backHref}>← {backRow ? backRowName : elev.rack.name}</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>Rack {elev.rack.name}</h1>
          <p>
            {layoutPath(elev.rack, aisleRows, areas)} · {elev.rack.ru_height}U ·{" "}
            {formatHierarchyPower(sumPowerWatts(elev.devices, [rid]), sumDcAmps(elev.devices, [rid]))}
            {rackPhotosOk ? "" : " · no photos"}
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
                    className={`slot ${dev ? `dev-${dev.device_type}` : "empty"}${!dev && adding?.ru_start === s.u ? " picked" : ""}`}
                    onClick={() => {
                      if (dev) {
                        setAdding(null);
                        setEditing(dev);
                      } else {
                        setEditing(null);
                        setAdding({ ...emptyDraft(rid), ru_start: s.u, ru_height: 1 });
                      }
                    }}
                  >
                    {top ? `${dev?.name} · ${dev?.vendor} ${dev?.model}` : dev ? "" : "empty — click to add"}
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
            <RestrictionPicker
              name="rack-page-restriction"
              noun="rack"
              value={restrictionTypeOf(elev.rack)}
              onChange={(type) => setElev({ ...elev, rack: { ...elev.rack, ...restrictionFields(type) } })}
              inherited={rackInherited}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn">Save rack</button>
              <button
                type="button"
                className="btn"
                onClick={() => setRelocate({ kind: "rack", ids: [rid], mode: "copy" })}
              >
                Copy
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setRelocate({ kind: "rack", ids: [rid], mode: "move" })}
              >
                Move
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() =>
                  setPendingDelete({
                    kind: "rack",
                    id: rid,
                    name: elev.rack.name,
                    detail: `${elev.devices.length} device${elev.devices.length === 1 ? "" : "s"} in this rack will become unlocated.`,
                  })
                }
              >
                Delete
              </button>
            </div>
          </form>
          <form className="card" onSubmit={addDevice} style={{ marginTop: 12 }}>
            <h3>Add device to this rack</h3>
            <EntryModeRadios name="entry-rack-device" value={deviceMode} onChange={setDeviceMode} />
            {deviceMode === "ai" ? (
              <AiImageParse
                projectId={pid}
                target="device"
                areaId={elev.rack.area_id || ""}
                rowId={elev.rack.row_id || ""}
                rackId={rid}
                project={project}
                areas={areas}
                rows={aisleRows}
                racks={racks}
                onInventoryChanged={load}
              />
            ) : (
              <>
                <DeviceFields
                  value={draft}
                  onChange={setDraft}
                  racks={racks}
                  areas={areas}
                  rows={aisleRows}
                  devices={elev.devices}
                  pdus={pdus}
                  project={project}
                  showLocation={false}
                  pendingPhotos={photos}
                  onPendingPhotos={setPhotos}
                />
                <button className="btn primary block">Save device</button>
              </>
            )}
          </form>
          <div className="card" style={{ marginTop: 12 }}>
            <PhotoGallery entityType="rack" entityId={rid} allowed={rackPhotosOk} restricted={!rackPhotosOk} />
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
      {adding && (
        <DeviceEditorModal
          projectId={pid}
          project={project}
          racks={racks}
          areas={areas}
          rows={aisleRows}
          devices={elev.devices}
          pdus={pdus}
          initialDraft={adding}
          showLocation={false}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {editing && (
        <DeviceEditorModal
          projectId={pid}
          project={project}
          device={editing}
          racks={racks}
          areas={areas}
          rows={aisleRows}
          devices={elev.devices}
          pdus={pdus}
          showLocation={false}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onRelocate={(mode) => {
            setRelocate({ kind: "device", ids: [editing.id], mode });
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
          entityIds={relocate.ids}
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
            if (pendingDelete.kind === "rack") {
              await projects.deleteRack(pid, pendingDelete.id);
              navigate(backHref);
            } else {
              await projects.deleteDevice(pid, pendingDelete.id);
              load();
            }
          }}
        />
      )}
    </div>
  );
}
