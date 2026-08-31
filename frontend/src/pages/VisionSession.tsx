import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Rack, VisionProposal, VisionSession, fetchAttachmentBlob, projects, vision } from "../api";

function statusBadge(status: string) {
  if (status === "accepted" || status === "done") return "ok";
  if (status === "refused" || status === "rejected" || status === "error") return "eol";
  if (status === "needs_review" || status === "queued" || status === "running") return "near";
  return "unknown";
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
  if (!ids.length) return <p className="muted">No evidence frames attached.</p>;
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

function FieldConfirmBar({
  field,
  proposal,
  session,
  value,
  locked,
  busy,
  onChanged,
}: {
  field: string;
  proposal: VisionProposal;
  session: VisionSession;
  value: unknown;
  locked: boolean;
  busy: boolean;
  onChanged: () => void;
}) {
  const confirmed = (proposal.confirmed_fields || []).map((f) => f.toLowerCase()).includes(field);
  const skipped = (proposal.skipped_fields || []).map((f) => f.toLowerCase()).includes(field);
  if (locked || confirmed || skipped) {
    return (
      <span className="muted" style={{ fontSize: "0.8rem" }}>
        {confirmed ? "confirmed" : skipped ? "skipped" : ""}
      </span>
    );
  }
  return (
    <div className="field-confirm-actions" style={{ marginTop: 4 }}>
      <button
        type="button"
        className="btn good"
        disabled={busy}
        onClick={async () => {
          await vision.confirmField(session.id, proposal.id, field, value);
          onChanged();
        }}
      >
        Confirm
      </button>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          await vision.skipField(session.id, proposal.id, field);
          onChanged();
        }}
      >
        Skip
      </button>
    </div>
  );
}

function ProposalCard({
  session,
  proposal,
  racks,
  onChanged,
}: {
  session: VisionSession;
  proposal: VisionProposal;
  racks: Rack[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(proposal);
  const [audit, setAudit] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = proposal.status === "accepted" || proposal.status === "rejected";

  useEffect(() => {
    setDraft(proposal);
  }, [proposal]);

  function set<K extends keyof VisionProposal>(key: K, value: VisionProposal[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function saveEdits() {
    await vision.patchProposal(session.id, proposal.id, {
      name: draft.name,
      hostname: draft.hostname,
      vendor: draft.vendor,
      model: draft.model,
      serial: draft.serial,
      asset_tag: draft.asset_tag,
      owner: draft.owner,
      device_type: draft.device_type,
      function: draft.function,
      ru_start: draft.ru_start || null,
      ru_end: draft.ru_end || null,
      area_name: draft.area_name,
      row_name: draft.row_name,
      rack_name: draft.rack_name,
      rack_id: draft.rack_id || null,
      notes: draft.notes,
    });
  }

  async function onAccept(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!locked) await saveEdits();
      await vision.accept(session.id, proposal.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    setError("");
    setBusy(true);
    try {
      await vision.reject(session.id, proposal.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  const unread = new Set((proposal.unreadable_fields || []).map((f) => f.toLowerCase()));

  return (
    <form className="card" style={{ marginTop: 12 }} onSubmit={onAccept}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <h3>Proposal #{proposal.id}</h3>
        <span className={`badge ${statusBadge(proposal.status)}`}>{proposal.status}</span>
      </div>
      {error && <div className="error">{error}</div>}
      {unread.size > 0 && (
        <p className="muted">Left blank (unreadable): {[...unread].join(", ")}</p>
      )}
      <div className="row">
        <label className="field">
          <span>Name</span>
          <input value={draft.name} disabled={locked} onChange={(e) => set("name", e.target.value)} />
          <FieldConfirmBar field="name" proposal={proposal} session={session} value={draft.name} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
        <label className="field">
          <span>Hostname</span>
          <input value={draft.hostname} disabled={locked} onChange={(e) => set("hostname", e.target.value)} />
          <FieldConfirmBar field="hostname" proposal={proposal} session={session} value={draft.hostname} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
      </div>
      <div className="row three">
        <label className="field">
          <span>Vendor</span>
          <input value={draft.vendor} disabled={locked} onChange={(e) => set("vendor", e.target.value)} />
          <FieldConfirmBar field="vendor" proposal={proposal} session={session} value={draft.vendor} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
        <label className="field">
          <span>Model</span>
          <input value={draft.model} disabled={locked} onChange={(e) => set("model", e.target.value)} />
          <FieldConfirmBar field="model" proposal={proposal} session={session} value={draft.model} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
        <label className="field">
          <span>Type</span>
          <input value={draft.device_type} disabled={locked} onChange={(e) => set("device_type", e.target.value)} />
          <FieldConfirmBar field="device_type" proposal={proposal} session={session} value={draft.device_type} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
      </div>
      <div className="row three">
        <label className="field">
          <span>Serial</span>
          <input value={draft.serial} disabled={locked} onChange={(e) => set("serial", e.target.value)} />
          <FieldConfirmBar field="serial" proposal={proposal} session={session} value={draft.serial} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
        <label className="field">
          <span>Asset tag</span>
          <input value={draft.asset_tag} disabled={locked} onChange={(e) => set("asset_tag", e.target.value)} />
          <FieldConfirmBar field="asset_tag" proposal={proposal} session={session} value={draft.asset_tag} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
        <label className="field">
          <span>Owner</span>
          <input value={draft.owner} disabled={locked} onChange={(e) => set("owner", e.target.value)} />
          <FieldConfirmBar field="owner" proposal={proposal} session={session} value={draft.owner} locked={locked} busy={busy} onChanged={onChanged} />
        </label>
      </div>
      <div className="row three">
        <label className="field">
          <span>RU start</span>
          <input
            type="number"
            value={draft.ru_start ?? ""}
            disabled={locked}
            onChange={(e) => set("ru_start", e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <label className="field">
          <span>RU end</span>
          <input
            type="number"
            value={draft.ru_end ?? ""}
            disabled={locked}
            onChange={(e) => set("ru_end", e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <label className="field">
          <span>Rack</span>
          <select
            value={draft.rack_id ?? ""}
            disabled={locked}
            onChange={(e) => set("rack_id", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Unlocated</option>
            {racks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea value={draft.notes} disabled={locked} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <p className="muted">Evidence (originals and serial frames stay on the session even after accept)</p>
      <EvidenceThumbs ids={proposal.evidence_attachment_ids?.length ? proposal.evidence_attachment_ids : session.clips.map((c) => c.attachment_id)} />
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setAudit((v) => !v)}>
        {audit ? "Hide audit" : "Show prompt / model / raw"}
      </button>
      {audit && (
        <div className="card" style={{ marginTop: 8, background: "var(--bg)" }}>
          <p>
            <strong>Model</strong> {proposal.extractor_model || "—"}
          </p>
          <pre className="audit-block">{proposal.prompt_text || "—"}</pre>
          <pre className="audit-block">{JSON.stringify(proposal.raw_extraction, null, 2)}</pre>
        </div>
      )}
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn good" disabled={busy}>
            {busy ? "Saving…" : "Confirm remaining"}
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={onReject}>
            Reject
          </button>
        </div>
      )}
      {proposal.accepted_device_id && <p className="muted">Created device #{proposal.accepted_device_id}.</p>}
    </form>
  );
}

export default function VisionSessionPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const [session, setSession] = useState<VisionSession | null>(null);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowNames, setRowNames] = useState("");
  const [createRacks, setCreateRacks] = useState(false);
  const [layoutMsg, setLayoutMsg] = useState("");

  async function load() {
    const next = await vision.get(sessionId);
    setSession(next);
    setRacks(await projects.racks(next.project_id));
    const suggested = ((next.layout as { rows?: { name?: string }[] } | null)?.rows || [])
      .map((r) => (r.name || "").trim())
      .filter(Boolean);
    setRowNames((current) => current || suggested.join("\n"));
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [sessionId]);

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      const next = await vision.analyze(sessionId);
      setSession(next);
      const suggested = ((next.layout as { rows?: { name?: string }[] } | null)?.rows || [])
        .map((r) => (r.name || "").trim())
        .filter(Boolean);
      if (suggested.length) setRowNames((current) => current || suggested.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyze failed");
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="page">
        <Link to="/capture">← Capture</Link>
        {error && <div className="error">{error}</div>}
        <p className="muted">Loading session…</p>
      </div>
    );
  }

  const layout = session.layout as { notes?: string; rows?: { name: string }[]; racks?: { name: string }[] } | null;

  return (
    <div className="page">
      <div className="crumb">
        <Link to="/capture">Capture</Link>
        <span>/</span>
        <span className="here">Vision #{session.id}</span>
      </div>
      <h1>Vision session #{session.id}</h1>
      <p>
        Staging only. Confirm each suggested field on its own. Confirming a name writes that area, row, rack, or device;
        skipped fields stay blank. Rejecting a device leaves inventory unchanged.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span className={`badge ${statusBadge(session.status)}`}>{session.status}</span>
          <span className="muted">
            {session.shot_kind.replace(/_/g, " ")} · {session.clip_count} clips · {session.proposal_count} proposals
          </span>
        </div>
        {session.restricted_blocked && <div className="banner">{session.error_detail}</div>}
        {session.status === "error" && session.error_detail && <div className="error">{session.error_detail}</div>}
        {session.status === "queued" && (
          <p className="muted">Waiting for the vision sidecar. If it is not running, jobs stay queued.</p>
        )}
        {(session.status === "open" || session.status === "error") && (
          <button className="btn primary" disabled={busy || session.clip_count === 0} onClick={analyze} style={{ marginTop: 8 }}>
            Analyze
          </button>
        )}
        {layout && (
          <div style={{ marginTop: 12 }}>
            <h3>Suggested layout</h3>
            <p className="muted">
              {layout.notes || "From the wide / aisle shots. Review the names, then create rows under this session’s area."}
            </p>
            {layoutMsg && <div className="success">{layoutMsg}</div>}
            <label className="field">
              <span>Row names to create (one per line)</span>
              <textarea value={rowNames} onChange={(e) => setRowNames(e.target.value)} rows={5} placeholder={"A01\nA02"} />
            </label>
            {layout.racks?.length ? (
              <label className="check-row">
                <input type="checkbox" checked={createRacks} onChange={(e) => setCreateRacks(e.target.checked)} />
                <span>Also create placeholder racks ({layout.racks.map((r) => r.name).filter(Boolean).join(", ")})</span>
              </label>
            ) : null}
            <button
              type="button"
              className="btn primary"
              disabled={busy || !rowNames.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                setLayoutMsg("");
                try {
                  const names = rowNames
                    .split(/[\n,;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const result = await vision.acceptLayout(session.id, {
                    area_id: session.area_id,
                    names,
                    create_racks: createRacks,
                  });
                  const created = result.created.map((r) => r.name).join(", ");
                  const existing = result.existing.map((r) => r.name).join(", ");
                  const racksMade = result.racks_created.map((r) => r.name).join(", ");
                  setLayoutMsg(
                    [
                      created ? `Created rows ${created}` : "",
                      existing ? `Already present: ${existing}` : "",
                      racksMade ? `Created racks ${racksMade}` : "",
                    ]
                      .filter(Boolean)
                      .join(". ") || "No new rows.",
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not create rows");
                } finally {
                  setBusy(false);
                }
              }}
              style={{ marginTop: 8 }}
            >
              Create rows
            </button>
          </div>
        )}
      </div>
      <h3 style={{ marginTop: 16 }}>Evidence</h3>
      <EvidenceThumbs ids={session.clips.map((c) => c.attachment_id)} />
      <div className="muted" style={{ marginTop: 8 }}>
        {session.clips.map((c) => (
          <div key={c.id}>
            {c.filename} · {c.kind}
            {c.source === "video_frame" ? ` · frame ${c.timestamp_ms ?? 0}ms` : ""}
            {c.photography_restricted ? " · restricted" : ""}
          </div>
        ))}
      </div>
      {session.proposals.map((p) => (
        <ProposalCard key={p.id} session={session} proposal={p} racks={racks} onChanged={load} />
      ))}
      {session.status === "needs_review" && session.proposals.length === 0 && (
        <p className="muted">Sidecar finished but proposed no devices. Unreadable fields were left blank.</p>
      )}
    </div>
  );
}
