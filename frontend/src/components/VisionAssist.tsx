import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AisleRow,
  LayoutAcceptResult,
  Project,
  Rack,
  VisionClipKind,
  VisionSession,
  VisionShotKind,
  layoutPath,
  uploadVisionClip,
  vision,
} from "../api";
import CameraModal from "./CameraModal";
import VideoRecorder from "./VideoRecorder";
import { inheritedPhotoBlockers } from "../restriction";

const SHOTS: { id: VisionShotKind; label: string; help: string }[] = [
  { id: "aisle_wide", label: "Aisle / row", help: "Wide shot of the row so the sidecar can read layout." },
  { id: "rack_face", label: "Rack face", help: "Whole cabinet, front or rear." },
  { id: "device_close", label: "Device close-up", help: "Labels, serials, and RU numbers." },
  { id: "mixed", label: "Mixed", help: "Several distances in one session." },
];

function clipKindFor(shot: VisionShotKind): VisionClipKind {
  if (shot === "mixed") return "other";
  return shot;
}

function suggestedRowNames(session?: VisionSession | null) {
  const rows = session?.layout && typeof session.layout === "object" ? (session.layout as { rows?: { name?: string }[] }).rows : [];
  return (rows || []).map((r) => (r?.name || "").trim()).filter(Boolean);
}

type Props = {
  projectId: number;
  areaId: number | "";
  rowId: number | "";
  rackId: number | "";
  areas: Area[];
  rows: AisleRow[];
  racks: Rack[];
  project?: Project | null;
  purpose?: "layout" | "inventory";
  embedded?: boolean;
  onLayoutAccepted?: (result: LayoutAcceptResult) => void;
};

export default function VisionAssist({
  projectId,
  areaId,
  rowId,
  rackId,
  areas,
  rows,
  racks,
  project,
  purpose = "inventory",
  embedded = false,
  onLayoutAccepted,
}: Props) {
  const [sessions, setSessions] = useState<VisionSession[]>([]);
  const [shotKind, setShotKind] = useState<VisionShotKind>(purpose === "layout" ? "aisle_wide" : "mixed");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState<"photo" | "video" | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  const selectedArea = areaId ? areas.find((a) => a.id === areaId) : undefined;
  const selectedRow = rowId ? rows.find((r) => r.id === rowId) : undefined;
  const selectedRack = rackId ? racks.find((r) => r.id === rackId) : undefined;
  const blockedHere =
    inheritedPhotoBlockers({
      project,
      area: selectedArea,
      row: selectedRow,
      rack: selectedRack,
    }).length > 0;
  const layoutMode = purpose === "layout";

  async function reload() {
    setSessions(await vision.sessions(projectId));
  }

  useEffect(() => {
    reload().catch(() => undefined);
  }, [projectId]);

  async function ensureSession() {
    if (activeId) {
      const existing = sessions.find((s) => s.id === activeId);
      if (existing && (existing.status === "open" || existing.status === "error")) return existing;
    }
    const created = await vision.create({
      project_id: projectId,
      area_id: areaId || null,
      row_id: rowId || null,
      rack_id: rackId || null,
      shot_kind: shotKind,
      notes,
    });
    setActiveId(created.id);
    await reload();
    return created;
  }

  async function addFile(file: File) {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const session = await ensureSession();
      await uploadVisionClip(session.id, file, clipKindFor(shotKind));
      await reload();
      setMsg(`Attached ${file.name} to vision session #${session.id}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function queueAnalyze(id: number) {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const next = await vision.analyze(id);
      await reload();
      if (next.restricted_blocked) {
        setError(next.error_detail || "Restricted equipment — photos were not sent.");
      } else if (next.status === "queued") {
        setMsg(
          layoutMode
            ? "Queued for the vision sidecar. Suggested row names stay staging until you create them."
            : "Queued for the vision sidecar. Proposals will appear here for review — nothing is written as a device yet.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyze failed");
    } finally {
      setBusy(false);
    }
  }

  async function createSuggestedRows(session: VisionSession) {
    setError("");
    setMsg("");
    if (!areaId && !session.area_id) {
      setError("Select an area first. Rows sit under an area.");
      return;
    }
    setBusy(true);
    try {
      const result = await vision.acceptLayout(session.id, {
        area_id: areaId || session.area_id || undefined,
      });
      onLayoutAccepted?.(result);
      const created = result.created.map((r) => r.name).join(", ");
      const existing = result.existing.map((r) => r.name).join(", ");
      setMsg(
        [created ? `Created rows ${created}` : "", existing ? `Already present: ${existing}` : ""]
          .filter(Boolean)
          .join(". ") || "No new rows.",
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create rows");
    } finally {
      setBusy(false);
    }
  }

  const active = sessions.find((s) => s.id === activeId);
  const inner = (
    <>
      {!embedded && <h3>{layoutMode ? "Capture rows from photos / video" : "Vision assist"}</h3>}
      <p>
        {layoutMode
          ? "Wide aisle photo or video. The sidecar suggests row names; you create that set after review. Nothing is written until you confirm."
          : "Capture a wide aisle clip, then closer rack and serial shots. The sidecar proposes fields; you accept, edit, or reject. Unreadable text stays blank. Original media stays on the session as evidence."}
      </p>
      {layoutMode && !areaId && (
        <p className="muted">Select an area above so suggested rows are created in the right place.</p>
      )}
      {blockedHere && (
        <div className="banner">
          This location is tagged government / EMSS. Photography is blocked and Analyze will not send images to the
          model.
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <label className="field">
        <span>Shot kind</span>
        <select value={shotKind} onChange={(e) => setShotKind(e.target.value as VisionShotKind)}>
          {SHOTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">{SHOTS.find((s) => s.id === shotKind)?.help}</p>
      <label className="field">
        <span>Notes for the model (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. rear of A12, serials on left ear" />
      </label>
      <div className="choice compact">
        <button type="button" className="btn" disabled={busy || blockedHere} onClick={() => setCam("photo")}>
          Photo
        </button>
        <button type="button" className="btn" disabled={busy || blockedHere} onClick={() => setCam("video")}>
          Video
        </button>
        <label className="btn" style={{ cursor: blockedHere ? "not-allowed" : "pointer" }}>
          Files
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            disabled={busy || blockedHere}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              for (const file of files) await addFile(file);
            }}
          />
        </label>
      </div>
      {active && (
        <p className="muted">
          Session #{active.id} · {active.status} · {active.clip_count} clips
          {active.status === "open" || active.status === "error" ? (
            <>
              {" "}
              <button type="button" className="btn" disabled={busy || active.clip_count === 0} onClick={() => queueAnalyze(active.id)}>
                Analyze
              </button>
            </>
          ) : null}
        </p>
      )}
      <div style={{ marginTop: 8 }}>
        {sessions.length === 0 && <p className="muted">No vision sessions for this project yet.</p>}
        {sessions.slice(0, 8).map((s) => {
          const rack = racks.find((r) => r.id === s.rack_id);
          const names = suggestedRowNames(s);
          return (
            <div key={s.id} className="list-item" style={{ flexWrap: "wrap" }}>
              <Link className="list-main" to={`/capture/vision/${s.id}`} style={{ textDecoration: "none" }}>
                <strong>
                  #{s.id} · {s.shot_kind.replace("_", " ")}
                </strong>
                <div className="muted">
                  {s.status}
                  {s.pending_count ? ` · ${s.pending_count} to review` : ""}
                  {rack ? ` · ${layoutPath(rack, rows, areas)}` : ""}
                  {names.length ? ` · rows ${names.join(", ")}` : ""}
                  {s.restricted_blocked ? " · blocked" : ""}
                </div>
              </Link>
              {names.length > 0 && (
                <button type="button" className="btn" disabled={busy} onClick={() => createSuggestedRows(s)}>
                  Create these rows
                </button>
              )}
            </div>
          );
        })}
      </div>
      {cam === "photo" && <CameraModal mode="photo" onClose={() => setCam(null)} onPhoto={(file) => addFile(file)} />}
      {cam === "video" && (
        <VideoRecorder
          onClose={() => setCam(null)}
          onCapture={(file) => addFile(file)}
          hint={SHOTS.find((s) => s.id === shotKind)?.help}
        />
      )}
    </>
  );

  if (embedded) return <div>{inner}</div>;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      {inner}
    </div>
  );
}
