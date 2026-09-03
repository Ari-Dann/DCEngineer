import { FormEvent, useEffect, useState } from "react";
import { AisleRow, Area, Device, PDU, Project, Rack, enqueue, layoutPath, projects, uploadPhotos } from "../api";
import { DeviceEditorModal, DeviceFields, emptyDraft, payloadFromDraft } from "../components/DeviceEditor";
import CreateRowsPanel from "../components/CreateRowsPanel";
import LocatePanel from "../components/LocatePanel";
import AiImageParse, { EntryMode, EntryModeRadios } from "../components/AiImageParse";
import type { DeviceDraft } from "../components/DeviceEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SavedRestrictionPicker } from "../components/RestrictionPicker";
import { learnCatalog } from "../catalog";
import { inheritedPhotoBlockers, photosAllowed, restrictionFields } from "../restriction";

export default function Capture() {
  const [plist, setPlist] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [aisleRows, setAisleRows] = useState<AisleRow[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pdus, setPdus] = useState<PDU[]>([]);
  const [pid, setPid] = useState<number | "">("");
  const [areaId, setAreaId] = useState<number | "">("");
  const [rowId, setRowId] = useState<number | "">("");
  const [rid, setRid] = useState<number | "">("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [draft, setDraft] = useState<DeviceDraft>(emptyDraft());
  const [editing, setEditing] = useState<Device | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogNonce, setCatalogNonce] = useState(0);
  const [deviceMode, setDeviceMode] = useState<EntryMode>("manual");

  useEffect(() => {
    projects.list().then((rows) => {
      setPlist(rows);
      if (rows[0]) setPid(rows[0].id);
    });
  }, []);

  useEffect(() => {
    if (!pid) return;
    reloadLayout();
  }, [pid]);

  async function reloadLayout() {
    if (!pid) return;
    const [nextAreas, nextRows, nextRacks, nextPdus] = await Promise.all([
      projects.areas(Number(pid)),
      projects.rows(Number(pid)),
      projects.racks(Number(pid)),
      projects.projectPdus(Number(pid)),
    ]);
    setAreas(nextAreas);
    setAisleRows(nextRows);
    setRacks(nextRacks);
    setPdus(nextPdus);
    setAreaId((current) => (current && nextAreas.some((a) => a.id === current) ? current : ""));
    setRowId((current) => (current && nextRows.some((r) => r.id === current) ? current : ""));
    setRid((current) => {
      if (current && nextRacks.some((r) => r.id === current)) return current;
      return "";
    });
  }

  useEffect(() => {
    setDraft((d) => ({ ...d, rack_id: rid }));
  }, [rid]);

  const visibleRows = areaId ? aisleRows.filter((r) => r.area_id === areaId) : aisleRows;
  const visibleRacks = racks.filter((r) => {
    if (rowId && r.row_id !== rowId) return false;
    if (areaId && r.area_id !== areaId && aisleRows.find((row) => row.id === r.row_id)?.area_id !== areaId) return false;
    return true;
  });

  async function loadDevices() {
    if (!pid) return;
    setDevices(await projects.devices(Number(pid)));
  }
  useEffect(() => {
    loadDevices().catch(() => undefined);
  }, [pid]);

  const rackDevices = rid ? devices.filter((d) => d.rack_id === rid) : devices;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (!pid) {
      setError("Select a project first.");
      return;
    }
    const body = payloadFromDraft({ ...draft, rack_id: rid });
    if (!body.name) {
      setError("Device name is required.");
      return;
    }
    setBusy(true);
    try {
      const created = await projects.addDevice(Number(pid), body);
      if (photos.length) {
        await uploadPhotos("device", created.id, photos, draft.restricted);
      }
      await learnCatalog({
        vendor: created.vendor,
        model: created.model,
        device_type: created.device_type,
        function: created.function,
      });
      setCatalogNonce((n) => n + 1);
      setDraft({
        ...emptyDraft(rid),
        device_type: draft.device_type,
        vendor: draft.vendor,
        fan_orientation: draft.fan_orientation,
        indicator_type: draft.indicator_type,
        indicator_color: draft.indicator_type === "none" ? "none" : draft.indicator_color,
      });
      setPhotos([]);
      setMsg(`Saved ${created.name}. Ready for the next device.`);
      await loadDevices();
    } catch {
      enqueue({ method: "POST", path: `/api/projects/${pid}/devices`, body });
      setMsg(
        photos.length
          ? "No network — device fields queued. Photos need a connection; recapture after sync."
          : "No network — queued for sync. Keep capturing.",
      );
    } finally {
      setBusy(false);
    }
  }

  const project = plist.find((p) => p.id === pid);
  const selectedArea = areas.find((a) => a.id === areaId) || null;
  const selectedRow = aisleRows.find((r) => r.id === rowId) || null;
  const selectedRack = racks.find((r) => r.id === rid) || null;

  return (
    <div className="page">
      <h1>Onsite capture</h1>
      <p>Phase 2 intake. Create rows under an area (typed or from aisle photos), then capture rack by rack.</p>
      {project?.photography_rules && <div className="banner">{project.photography_rules}</div>}
      {project &&
        !photosAllowed({
          project,
          area: selectedArea,
          row: selectedRow,
          rack: selectedRack,
        }) && (
          <div className="banner">This location is tagged government / EMSS — photography is blocked.</div>
        )}
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <div className="card">
        <div className="row">
          <label className="field">
            <span>Project</span>
            <select value={pid} onChange={(e) => setPid(Number(e.target.value))}>
              {plist.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Area</span>
            <select
              value={areaId}
              onChange={(e) => {
                setAreaId(e.target.value ? Number(e.target.value) : "");
                setRowId("");
                setRid("");
              }}
            >
              <option value="">All areas / unlocated</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {pid && (
        <CreateRowsPanel
          projectId={Number(pid)}
          areas={areas}
          rows={aisleRows}
          racks={racks}
          areaId={areaId}
          project={project}
          onAreaChange={(next) => {
            setAreaId(next);
            setRowId("");
            setRid("");
          }}
          onCreated={(created) => {
            reloadLayout().then(() => {
              if (created[0]) {
                setRowId(created[0].id);
                setRid("");
              }
            });
          }}
        />
      )}

      <form className="card" onSubmit={onSubmit} style={{ marginTop: 16 }}>
        <EntryModeRadios name="entry-capture-device" value={deviceMode} onChange={setDeviceMode} />
        <div className="row">
          <label className="field">
            <span>Row</span>
            <select
              value={rowId}
              onChange={(e) => {
                setRowId(e.target.value ? Number(e.target.value) : "");
                setRid("");
              }}
            >
              <option value="">All rows / unlocated</option>
              {visibleRows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Rack</span>
            <select value={rid} onChange={(e) => setRid(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Unlocated</option>
              {visibleRacks.map((r) => (
                <option key={r.id} value={r.id}>
                  {layoutPath(r, aisleRows, areas)} ({r.ru_height}U)
                </option>
              ))}
            </select>
          </label>
        </div>
        {pid && selectedRow && (
          <SavedRestrictionPicker
            name={`capture-row-${selectedRow.id}`}
            entity={selectedRow}
            scope="row"
            inherited={inheritedPhotoBlockers({ project })}
            onPersist={async (type) => {
              try {
                const saved = await projects.updateRow(Number(pid), selectedRow.id, { ...selectedRow, ...restrictionFields(type) });
                setAisleRows((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not save row restriction");
                throw err;
              }
            }}
          />
        )}
        {pid && selectedRack && (
          <SavedRestrictionPicker
            name={`capture-rack-${selectedRack.id}`}
            entity={selectedRack}
            scope="rack"
            inherited={inheritedPhotoBlockers({ project, row: selectedRow })}
            onPersist={async (type) => {
              try {
                const saved = await projects.updateRack(Number(pid), selectedRack.id, { ...selectedRack, ...restrictionFields(type) });
                setRacks((items) => items.map((item) => (item.id === saved.id ? saved : item)));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not save rack restriction");
                throw err;
              }
            }}
          />
        )}
        {deviceMode === "ai" ? (
          pid ? (
            <AiImageParse
              projectId={Number(pid)}
              target="device"
              areaId={areaId}
              rowId={rowId}
              rackId={rid}
              project={project}
              areas={areas}
              rows={aisleRows}
              racks={racks}
              onInventoryChanged={loadDevices}
            />
          ) : (
            <p className="muted">Select a project first.</p>
          )
        ) : (
          <>
            <DeviceFields
          value={draft}
          onChange={setDraft}
          racks={racks}
          areas={areas}
          rows={aisleRows}
          devices={devices}
          pdus={pdus}
          project={project}
          showLocation={false}
          showKnownLocation={false}
          pendingPhotos={photos}
          onPendingPhotos={setPhotos}
          catalogNonce={catalogNonce}
            />
            <button className="btn primary block" disabled={busy}>
              {busy ? "Saving…" : "Save & next"}
            </button>
          </>
        )}
      </form>

      {pid && (
        <div style={{ marginTop: 16 }}>
          <LocatePanel
            projectId={Number(pid)}
            racks={racks}
            areas={areas}
            rows={aisleRows}
            defaultRackId={rid}
            onLocated={() => loadDevices()}
          />
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Devices in this rack</h3>
        {rackDevices.length === 0 && <p className="muted">None captured here yet.</p>}
        {rackDevices.map((d) => (
          <button type="button" className="list-item clickable" key={d.id} onClick={() => setEditing(d)}>
            <div style={{ textAlign: "left" }}>
              <strong>
                {d.name}
                {d.restricted ? " 🔒" : ""}
              </strong>
              <div className="muted">
                {d.vendor} {d.model} · SN {d.serial || "—"} · U{d.ru_start || "—"}
                {d.parent_device_id
                  ? ` (in ${devices.find((p) => p.id === d.parent_device_id)?.name || "parent"})`
                  : ""}
              </div>
            </div>
            <span className="muted">edit</span>
          </button>
        ))}
      </div>

      {editing && pid && (
        <DeviceEditorModal
          key={editing.id}
          projectId={Number(pid)}
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
            loadDevices();
          }}
          onSelectDevice={setEditing}
          onDelete={() => {
            setPendingDelete(editing);
            setEditing(null);
          }}
        />
      )}
      {pendingDelete && pid && (
        <ConfirmDialog
          title={`Delete device “${pendingDelete.name}”?`}
          message="This device will be removed from the project."
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            await projects.deleteDevice(Number(pid), pendingDelete.id);
            loadDevices();
          }}
        />
      )}
    </div>
  );
}
