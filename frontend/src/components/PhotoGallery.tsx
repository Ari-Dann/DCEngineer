import { useEffect, useRef, useState } from "react";
import { Attachment, deleteAttachment, fetchAttachmentBlob, listAttachments, uploadFile } from "../api";
import CameraModal from "./CameraModal";

type Props = {
  entityType: string;
  entityId: number;
  allowed?: boolean;
  restricted?: boolean;
};

export default function PhotoGallery({ entityType, entityId, allowed = true, restricted = false }: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const urlsRef = useRef<Record<number, string>>({});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<number | null>(null);

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

  if (!allowed) {
    return <p className="muted">Photography is not allowed in this area.</p>;
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
      <p className="muted">In-app camera only — files stay in DCEngineer, not the device gallery.</p>
      {error && <div className="error">{error}</div>}
      <div className="thumbs">
        {items.map((item) => (
          <div className="thumb" key={item.id}>
            {urls[item.id] ? (
              <img src={urls[item.id]} alt={item.filename} onClick={() => setView(item.id)} />
            ) : (
              <span className="muted">{item.filename}</span>
            )}
            <button
              type="button"
              className="btn danger"
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
          <img className="lightbox" src={urls[view]} alt="" />
        </div>
      )}
    </div>
  );
}
