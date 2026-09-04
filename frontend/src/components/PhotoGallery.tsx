import { useEffect, useRef, useState } from "react";
import { Attachment, deleteAttachment, fetchAttachmentBlob, listAttachments, uploadFile } from "../api";
import CameraModal from "./CameraModal";

type Props = {
  entityType: string;
  entityId: number;
  allowed?: boolean;
  restricted?: boolean;
  onReadPhoto?: (blob: Blob) => Promise<void> | void;
};

export default function PhotoGallery({
  entityType,
  entityId,
  allowed = true,
  restricted = false,
  onReadPhoto,
}: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const urlsRef = useRef<Record<number, string>>({});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<number | null>(null);
  const [readingId, setReadingId] = useState<number | null>(null);

  async function load() {
    const rows = await listAttachments(entityType, entityId);
    setItems(rows);
    const next: Record<number, string> = {};
    for (const row of rows) {
      if (row.content_type.startsWith("image/")) {
        try {
          next[row.id] = await fetchAttachmentBlob(row.id);
        } catch {
          /* skip */
        }
      }
    }
    Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = next;
    setUrls(next);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load photos"));
    return () => {
      Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function readPhoto(id: number) {
    if (!onReadPhoto) return;
    const url = urls[id];
    if (!url) {
      setError("Photo is not loaded yet.");
      return;
    }
    setReadingId(id);
    setError("");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Could not read photo");
      await onReadPhoto(await res.blob());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read photo");
    } finally {
      setReadingId(null);
    }
  }

  if (!allowed) {
    return <p className="muted">Photography is not allowed here (government / EMSS).</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <h3>Photos ({items.length})</h3>
        <button type="button" className="btn primary" disabled={restricted} onClick={() => setOpen(true)}>
          Capture photo
        </button>
      </div>
      {restricted && <p className="muted">Restricted equipment — photos are blocked.</p>}
      <p className="muted">
        In-app camera only — files stay in DCEngineer, not the device gallery.
        {onReadPhoto ? " Use Fill fields to read a serial, asset tag, or hostname from a photo." : ""}
      </p>
      {error && <div className="error">{error}</div>}
      <div className="thumbs">
        {items.map((item) => (
          <div className="thumb" key={item.id}>
            {urls[item.id] ? (
              <img src={urls[item.id]} alt={item.filename} onClick={() => setView(item.id)} />
            ) : (
              <span className="muted">{item.filename}</span>
            )}
            {onReadPhoto && urls[item.id] ? (
              <button
                type="button"
                className="btn"
                disabled={readingId !== null}
                onClick={() => readPhoto(item.id)}
              >
                {readingId === item.id ? "Reading…" : "Fill fields"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn danger"
              disabled={readingId !== null}
              onClick={async () => {
                await deleteAttachment(item.id);
                await load();
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {open && (
        <CameraModal
          mode="photo"
          onClose={() => setOpen(false)}
          onPhoto={async (file) => {
            await uploadFile(entityType, entityId, file, restricted);
            await load();
          }}
        />
      )}
      {view && urls[view] && (
        <div className="overlay" onClick={() => setView(null)}>
          <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
            <img className="lightbox" src={urls[view]} alt="" />
            {onReadPhoto ? (
              <button
                type="button"
                className="btn primary block"
                disabled={readingId !== null}
                onClick={() => readPhoto(view)}
              >
                {readingId === view ? "Reading…" : "Fill fields from this photo"}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
