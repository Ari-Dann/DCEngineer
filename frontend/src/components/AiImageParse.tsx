import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AisleRow,
  Project,
  Rack,
  VisionProposal,
  VisionSession,
  VisionShotKind,
  fetchAttachmentBlob,
  uploadVisionClip,
  vision,
} from "../api";
import CameraModal from "./CameraModal";
import VideoRecorder from "./VideoRecorder";
import { photosAllowed } from "../restriction";

export type EntryMode = "manual" | "ai";
export type ParseTarget = "area" | "row" | "rack" | "device";

const SHOT_FOR: Record<ParseTarget, VisionShotKind> = {
  area: "aisle_wide",
  row: "aisle_wide",
  rack: "rack_face",
  device: "device_close",
};

const HELP: Record<ParseTarget, string> = {
  area: "Photo or video of the hall / cage. Suggested area names come back for you to confirm field by field.",
  row: "Wide aisle shot. Suggested row names come back for you to confirm field by field.",
  rack: "Cabinet face. Suggested rack names come back for you to confirm field by field.",
  device: "Labels, serials, and RU numbers. Each suggested field is confirmed on its own.",
};

const DEVICE_FIELDS: { key: keyof VisionProposal; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "hostname", label: "Hostname" },
  { key: "vendor", label: "Vendor" },
  { key: "model", label: "Model" },
  { key: "device_type", label: "Type" },
  { key: "serial", label: "Serial" },
  { key: "asset_tag", label: "Asset tag" },
  { key: "owner", label: "Owner" },
  { key: "function", label: "Function" },
  { key: "ru_start", label: "RU start" },
  { key: "ru_end", label: "RU end" },
  { key: "area_name", label: "Area" },
  { key: "row_name", label: "Row" },
  { key: "rack_name", label: "Rack" },
  { key: "notes", label: "Notes" },
];

const LAYOUT_FIELDS: Record<ParseTarget, { key: string; label: string }[]> = {
  area: [
    { key: "name", label: "Name" },
    { key: "notes", label: "Notes" },
  ],
  row: [
    { key: "name", label: "Name" },
    { key: "area_name", label: "Area" },
    { key: "notes", label: "Notes" },
  ],
  rack: [
    { key: "name", label: "Name" },
    { key: "row_name", label: "Row" },
    { key: "ru_height", label: "RU height" },
    { key: "notes", label: "Notes" },
  ],
  device: [],
};

export function EntryModeRadios({
  name,
  value,
  onChange,
}: {
  name: string;
  value: EntryMode;
  onChange: (next: EntryMode) => void;
}) {
  return (
    <div className="radio-mode" role="radiogroup" aria-label="How to add">
      <label className="check-row">
        <input type="radio" name={name} checked={value === "manual"} onChange={() => onChange("manual")} />
        <span>Manual entry</span>
      </label>
      <label className="check-row">
        <input type="radio" name={name} checked={value === "ai"} onChange={() => onChange("ai")} />
        <span>AI image parse</span>
      </label>
    </div>
  );
}

function layoutList(layout: unknown, kind: ParseTarget): Record<string, unknown>[] {
  if (!layout || typeof layout !== "object" || kind === "device") return [];
  const key = kind === "area" ? "areas" : kind === "row" ? "rows" : "racks";
  const raw = (layout as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === "string" ? { name: item } : (item as Record<string, unknown>)));
}

function EvidenceThumbs({ ids }: { ids: number[] }) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<number, string> = {};
      for (const id of ids) {
        try {
          const url = await fetchAttachmentBlob(id);
          created.push(url);
          next[id] = url;
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ids.join(",")]);
  if (!ids.length) return null;
  return (
    <div className="thumbs">
      {ids.map((id) => (
        <div className="thumb" key={id}>
          {urls[id] ? <img src={urls[id]} alt={`Evidence ${id}`} /> : <div className="muted" style={{ padding: 12 }}>#{id}</div>}
        </div>
      ))}
    </div>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  status,
  unreadable,
  locked,
  busy,
  onConfirm,
  onSkip,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  status?: string;
  unreadable?: boolean;
  locked?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  return (
    <div className={`field-confirm ${status || ""}`}>
      <label className="field" style={{ margin: 0 }}>
        <span>
          {label}
          {unreadable ? " · unreadable" : ""}
          {status === "confirmed" ? " · confirmed" : ""}
          {status === "skipped" ? " · skipped" : ""}
        </span>
        <input value={value} disabled={locked || status === "confirmed" || status === "skipped"} onChange={(e) => onChange(e.target.value)} />
      </label>
      {!locked && status !== "confirmed" && status !== "skipped" && (
        <div className="field-confirm-actions">
          <button type="button" className="btn good" disabled={busy || (!value.trim() && !unreadable)} onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onSkip}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

type Props = {
  projectId: number;
  target: ParseTarget;
  areaId?: number | "";
  rowId?: number | "";
  rackId?: number | "";
  areas?: Area[];
  rows?: AisleRow[];
  racks?: Rack[];
  project?: Project | null;
  onInventoryChanged?: () => void;
};

export default function AiImageParse({
  projectId,
  target,
  areaId = "",
  rowId = "",
  rackId = "",
  areas = [],
  rows = [],
  racks = [],
  project,
  onInventoryChanged,
}: Props) {
  const shotKind = SHOT_FOR[target];
  const [session, setSession] = useState<VisionSession | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState<"photo" | "video" | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const selectedArea = areaId ? areas.find((a) => a.id === areaId) : undefined;
  const selectedRow = rowId ? rows.find((r) => r.id === rowId) : undefined;
  const selectedRack = rackId ? racks.find((r) => r.id === rackId) : undefined;
  const blockedHere = !photosAllowed({
    project,
    area: selectedRow || selectedRack ? undefined : selectedArea,
    row: selectedRow,
    rack: selectedRack,
  });

  async function refresh(id?: number) {
    const sid = id || session?.id;
    if (!sid) return;
    const next = await vision.get(sid);
    setSession(next);
    return next;
  }

  useEffect(() => {
    if (!session) return;
    if (session.status !== "queued" && session.status !== "running") return;
    const t = window.setInterval(() => {
      refresh(session.id).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(t);
  }, [session?.id, session?.status]);

  async function ensureSession() {
    if (session && (session.status === "open" || session.status === "error")) return session;
    const created = await vision.create({
      project_id: projectId,
      area_id: areaId || null,
      row_id: rowId || null,
      rack_id: rackId || null,
      shot_kind: shotKind,
    });
    const full = await vision.get(created.id);
    setSession(full);
    return full;
  }

  async function addFile(file: File) {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const current = await ensureSession();
      await uploadVisionClip(current.id, file, shotKind);
      await refresh(current.id);
      setMsg(`Attached ${file.name}. Add more or run parse.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function runParse() {
    if (!session) return;
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const next = await vision.analyze(session.id);
      setSession(next);
      if (next.restricted_blocked) {
        setError(next.error_detail || "Restricted equipment — photos were not sent.");
      } else {
        setMsg("Queued for the sidecar. Suggestions will appear here to confirm field by field.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  async function newParse() {
    setSession(null);
    setEdits({});
    setMsg("");
    setError("");
  }

  const items = layoutList(session?.layout, target);
  const review = session?.layout_review || {};
  const proposals = session?.proposals || [];
  const waiting = session?.status === "queued" || session?.status === "running";
  const ready = session?.status === "needs_review" || session?.status === "done" || Boolean(items.length || proposals.length);

  return (
    <div className="ai-parse">
      <p>{HELP[target]}</p>
      {target === "row" && !areaId && (
        <p className="muted">Select an area so confirmed rows land in the right place.</p>
      )}
      {target === "rack" && !rowId && <p className="muted">Open a row so confirmed racks attach to it.</p>}
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      {blockedHere && (
        <div className="banner">This location is tagged government / EMSS. Photography is blocked and Analyze will not send images.</div>
      )}
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
      {session && (
        <p className="muted">
          Session #{session.id} · {session.status} · {session.clip_count} clips{" "}
          <Link to={`/capture/vision/${session.id}`}>Open full review</Link>
          {" · "}
          <button type="button" className="btn" onClick={newParse}>
            New parse
          </button>
        </p>
      )}
      {session && (session.status === "open" || session.status === "error") && (
        <button type="button" className="btn primary" disabled={busy || session.clip_count === 0} onClick={runParse}>
          {busy ? "Queuing…" : "Run AI image parse"}
        </button>
      )}
      {waiting && <p className="muted">Sidecar is reading the images. This page updates when suggestions arrive.</p>}
      {session?.restricted_blocked && <div className="banner">{session.error_detail}</div>}
      {session && <EvidenceThumbs ids={session.clips.map((c) => c.attachment_id)} />}

      {ready && target !== "device" && (
        <div style={{ marginTop: 12 }}>
          <h3>Suggested {target === "area" ? "areas" : target === "row" ? "rows" : "racks"}</h3>
          {items.length === 0 && <p className="muted">No {target} names came back. Unreadable text stays blank.</p>}
          {items.map((item, index) => {
            const bucket = review[target]?.[String(index)] || {};
            const fields = bucket.fields || {};
            return (
              <div className="card" key={`${target}-${index}`} style={{ marginTop: 8, background: "var(--bg)" }}>
                <strong>
                  {String(item.name || `${target} ${index + 1}`)}
                  {bucket.id ? ` · #${bucket.id}` : ""}
                </strong>
                {LAYOUT_FIELDS[target].map((meta) => {
                  const editKey = `${target}-${index}-${meta.key}`;
                  const raw = item[meta.key];
                  const value = edits[editKey] ?? (raw == null ? "" : String(raw));
                  return (
                    <FieldRow
                      key={meta.key}
                      label={meta.label}
                      value={value}
                      onChange={(next) => setEdits((e) => ({ ...e, [editKey]: next }))}
                      status={fields[meta.key]}
                      busy={busy}
                      onConfirm={async () => {
                        if (!session) return;
                        setBusy(true);
                        setError("");
                        try {
                          const res = await vision.confirmLayoutField(session.id, {
                            kind: target,
                            index,
                            field: meta.key,
                            value,
                          });
                          setSession(res.session);
                          onInventoryChanged?.();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Confirm failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                      onSkip={async () => {
                        if (!session) return;
                        setBusy(true);
                        setError("");
                        try {
                          const res = await vision.skipLayoutField(session.id, { kind: target, index, field: meta.key });
                          setSession(res.session);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Skip failed");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {ready && target === "device" && (
        <div style={{ marginTop: 12 }}>
          <h3>Suggested devices</h3>
          {proposals.length === 0 && <p className="muted">No devices proposed. Unreadable fields were left blank.</p>}
          {proposals.map((p) => (
            <ProposalFields
              key={p.id}
              sessionId={session!.id}
              proposal={p}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onChanged={async () => {
                await refresh(session!.id);
                onInventoryChanged?.();
              }}
            />
          ))}
        </div>
      )}

      {cam === "photo" && <CameraModal mode="photo" onClose={() => setCam(null)} onPhoto={(file) => addFile(file)} />}
      {cam === "video" && (
        <VideoRecorder onClose={() => setCam(null)} onCapture={(file) => addFile(file)} hint={HELP[target]} />
      )}
    </div>
  );
}

function ProposalFields({
  sessionId,
  proposal,
  busy,
  setBusy,
  setError,
  onChanged,
}: {
  sessionId: number;
  proposal: VisionProposal;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(proposal);
  useEffect(() => setDraft(proposal), [proposal]);
  const confirmed = new Set((proposal.confirmed_fields || []).map((f) => f.toLowerCase()));
  const skipped = new Set((proposal.skipped_fields || []).map((f) => f.toLowerCase()));
  const unread = new Set((proposal.unreadable_fields || []).map((f) => f.toLowerCase()));
  const locked = proposal.status === "accepted" || proposal.status === "rejected";

  return (
    <div className="card" style={{ marginTop: 8, background: "var(--bg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong>{draft.name || `Proposal #${proposal.id}`}</strong>
        <span className={`badge ${proposal.status === "accepted" ? "ok" : proposal.status === "rejected" ? "eol" : "near"}`}>
          {proposal.status}
        </span>
      </div>
      {proposal.accepted_device_id ? <p className="muted">Written to device #{proposal.accepted_device_id} as fields are confirmed.</p> : null}
      {DEVICE_FIELDS.map((meta) => {
        const raw = draft[meta.key];
        const value = raw == null ? "" : String(raw);
        const status = confirmed.has(meta.key) ? "confirmed" : skipped.has(meta.key) ? "skipped" : undefined;
        return (
          <FieldRow
            key={meta.key}
            label={meta.label}
            value={value}
            onChange={(next) => setDraft((d) => ({ ...d, [meta.key]: next }))}
            status={status}
            unreadable={unread.has(meta.key)}
            locked={locked}
            busy={busy}
            onConfirm={async () => {
              setBusy(true);
              setError("");
              try {
                await vision.confirmField(sessionId, proposal.id, meta.key, value);
                onChanged();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Confirm failed");
              } finally {
                setBusy(false);
              }
            }}
            onSkip={async () => {
              setBusy(true);
              setError("");
              try {
                await vision.skipField(sessionId, proposal.id, meta.key);
                onChanged();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Skip failed");
              } finally {
                setBusy(false);
              }
            }}
          />
        );
      })}
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn good"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await vision.accept(sessionId, proposal.id);
                onChanged();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Accept failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm remaining
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await vision.reject(sessionId, proposal.id);
                onChanged();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Reject failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Reject device
          </button>
        </div>
      )}
    </div>
  );
}
