import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dashboard, ops, flushQueue, queuedCount } from "../api";

export default function Home() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [flushed, setFlushed] = useState(0);
  const pending = queuedCount();

  useEffect(() => {
    ops.dashboard().then(setDash).catch((e) => setError(String(e.message || e)));
    flushQueue().then(setFlushed).catch(() => undefined);
  }, []);

  const cards = dash
    ? [
        { label: "Projects", value: dash.projects, cls: "info" },
        { label: "Devices", value: dash.devices, cls: "ok" },
        { label: "EOL", value: dash.eol_devices, cls: "danger" },
        { label: "Near EOL", value: dash.near_eol_devices, cls: "warn" },
        { label: "Fan issues", value: dash.fan_issues, cls: dash.fan_issues ? "warn" : "ok" },
        { label: "Undocumented", value: dash.undocumented_devices, cls: "warn" },
        { label: "Incidents", value: dash.open_incidents, cls: dash.open_incidents ? "danger" : "ok" },
        { label: "Inspections", value: dash.open_inspections, cls: "info" },
        { label: "Work orders", value: dash.open_work_orders, cls: "info" },
      ]
    : [];

  return (
    <div className="page">
      <h1>Operations board</h1>
      <p>Inventory, preventive maintenance, incidents, and RBI project health in one place.</p>
      {error && <div className="error">{error}</div>}
      {pending > 0 && <div className="banner">{pending} onsite capture(s) waiting to sync.</div>}
      {flushed > 0 && <div className="success">Synced {flushed} queued capture(s).</div>}
      <div className="grid stats">
        {cards.map((c) => (
          <div className="card" key={c.label}>
            <div className={`stat ${c.cls}`}>{c.value}</div>
            <div className="muted">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>On the floor</h3>
          <p>Use Capture for rack-by-rack physical intake. Works as a PWA on tablets and GrapheneOS (Vanadium).</p>
          <Link className="btn primary" to="/capture">Start capture</Link>
        </div>
        <div className="card">
          <h3>App backup</h3>
          <p>
            Last: {dash?.last_app_backup ? new Date(dash.last_app_backup).toLocaleString() : "none"} (
            {dash?.last_app_backup_status || "n/a"})
          </p>
          <p className="muted">Storage backend: {dash?.storage_backend || "—"}</p>
          <Link className="btn" to="/ops">Backup & DR</Link>
        </div>
      </div>
    </div>
  );
}
