import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  GlobalSearch,
  GlobalSearchDevice,
  GlobalSearchRack,
  ops,
} from "../api";
import CameraModal from "../components/CameraModal";
import { projectHref, rackHref } from "../nav";

const empty: GlobalSearch = { q: "", projects: [], areas: [], rows: [], racks: [], devices: [] };

function crumb(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" · ");
}

function deviceHref(d: GlobalSearchDevice) {
  if (d.rack_id) {
    return rackHref(d.project_id, d.rack_id, { area: d.area_id, row: d.row_id });
  }
  return projectHref(d.project_id, { tab: "devices" });
}

function rackPath(r: GlobalSearchRack) {
  return crumb(r.project_name, r.area_name, r.row_name, `${r.ru_height}U`);
}

function devicePath(d: GlobalSearchDevice) {
  const ru =
    d.ru_start != null
      ? d.ru_end && d.ru_end !== d.ru_start
        ? `U${d.ru_start}–${d.ru_end}`
        : `U${d.ru_start}`
      : null;
  return crumb(d.project_name, d.area_name, d.row_name, d.rack_name, ru, d.serial);
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const [draft, setDraft] = useState(q);
  const [result, setResult] = useState<GlobalSearch>(empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    setDraft(q);
  }, [q]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = draft.trim();
      if (next === q.trim()) return;
      const nextParams = new URLSearchParams();
      if (next) nextParams.set("q", next);
      setParams(nextParams, { replace: true });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [draft, q, setParams]);

  useEffect(() => {
    let cancelled = false;
    if (!q.trim()) {
      setResult(empty);
      setError("");
      setBusy(false);
      return;
    }
    setBusy(true);
    ops
      .search(q.trim())
      .then((res) => {
        if (!cancelled) {
          setResult(res);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  function applyQuery(next: string) {
    const value = next.trim();
    setDraft(value);
    const nextParams = new URLSearchParams();
    if (value) nextParams.set("q", value);
    setParams(nextParams);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    applyQuery(draft);
  }

  function onScan(value: string) {
    applyQuery(value);
  }

  const total =
    result.projects.length +
    result.areas.length +
    result.rows.length +
    result.racks.length +
    result.devices.length;
  const searching = Boolean(q.trim());

  return (
    <div className="page">
      <h1>Search</h1>
      <p>Find projects, areas, rows, racks, and devices across the site. Scan a barcode, QR code, or printed serial.</p>
      <form className="search-page-form" onSubmit={onSubmit} role="search">
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Name, serial, hostname, rack, site…"
          aria-label="Search inventory"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="button" className="btn" onClick={() => setScanning(true)} aria-label="Scan barcode, QR code, or text">
          Scan
        </button>
        <button className="btn primary" type="submit">
          Search
        </button>
      </form>
      {scanning && (
        <CameraModal
          mode="scan"
          ocr
          title="Scan barcode, QR, or text"
          initialHint="Point the camera at a barcode, QR code, or printed serial. Use Read text for labels."
          onClose={() => setScanning(false)}
          onScan={onScan}
        />
      )}
      {error && <div className="error">{error}</div>}
      {!searching && (
        <p className="muted">Type a name, serial, hostname, or location, or scan a barcode, QR code, or label.</p>
      )}
      {searching && busy && <p className="muted">Searching…</p>}
      {searching && !busy && total === 0 && !error && (
        <p className="muted">No matches for “{q.trim()}”.</p>
      )}
      {searching && !busy && total > 0 && (
        <p className="muted">
          {total} match{total === 1 ? "" : "es"} for “{result.q}”.
        </p>
      )}

      {result.projects.length > 0 && (
        <section className="card search-group">
          <h3>Projects</h3>
          {result.projects.map((p) => (
            <Link key={p.id} className="search-hit" to={projectHref(p.id)}>
              <strong>{p.name}</strong>
              <span className="muted">{crumb(p.customer, p.site_name, p.status)}</span>
            </Link>
          ))}
        </section>
      )}
      {result.areas.length > 0 && (
        <section className="card search-group">
          <h3>Areas</h3>
          {result.areas.map((a) => (
            <Link
              key={a.id}
              className="search-hit"
              to={projectHref(a.project_id, { tab: "areas", area: a.id })}
            >
              <strong>{a.name}</strong>
              <span className="muted">{crumb(a.project_name, a.description)}</span>
            </Link>
          ))}
        </section>
      )}
      {result.rows.length > 0 && (
        <section className="card search-group">
          <h3>Rows</h3>
          {result.rows.map((r) => (
            <Link
              key={r.id}
              className="search-hit"
              to={projectHref(r.project_id, { tab: "rows", area: r.area_id, row: r.id })}
            >
              <strong>{r.name}</strong>
              <span className="muted">{crumb(r.project_name, r.area_name)}</span>
            </Link>
          ))}
        </section>
      )}
      {result.racks.length > 0 && (
        <section className="card search-group">
          <h3>Racks</h3>
          {result.racks.map((r) => (
            <Link
              key={r.id}
              className="search-hit"
              to={rackHref(r.project_id, r.id, { area: r.area_id, row: r.row_id })}
            >
              <strong>{r.name}</strong>
              <span className="muted">{rackPath(r)}</span>
            </Link>
          ))}
        </section>
      )}
      {result.devices.length > 0 && (
        <section className="card search-group">
          <h3>Devices</h3>
          {result.devices.map((d) => (
            <Link key={d.id} className="search-hit" to={deviceHref(d)}>
              <strong>{d.name}</strong>
              <span className="muted">{devicePath(d)}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
