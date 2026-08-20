import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Project, projects } from "../api";

const empty = {
  name: "",
  customer: "",
  site_name: "",
  site_address: "",
  revision: "A",
  status: "phase1",
  sponsor: "",
  escort_logistics: "",
  badging_notes: "",
  photography_rules: "",
  data_handling_rules: "",
  restricted_equipment_notes: "",
  in_scope_summary: "",
  discovery_port_access: "unknown",
  discovery_cdp_lldp: "unknown",
  discovery_saas_trial: "unknown",
  discovery_notes: "",
  start_date: "",
  target_end_date: "",
};

export default function Projects() {
  const [rows, setRows] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");

  function load() {
    projects.list().then(setRows).catch((e) => setError(String(e.message || e)));
  }
  useEffect(load, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await projects.create(form);
      setForm(empty);
      setOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h1>Sites & RBI projects</h1>
          <p>Phase 1 workbook shell through Phase 4 delivery.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "New project"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {open && (
        <form className="card" onSubmit={onSubmit} style={{ marginBottom: 16 }}>
          <h3>Phase 1 — Initiation</h3>
          <div className="row">
            <label className="field"><span>Project name</span><input value={form.name} onChange={(e) => set("name", e.target.value)} required /></label>
            <label className="field"><span>Customer</span><input value={form.customer} onChange={(e) => set("customer", e.target.value)} /></label>
          </div>
          <div className="row">
            <label className="field"><span>Site</span><input value={form.site_name} onChange={(e) => set("site_name", e.target.value)} /></label>
            <label className="field"><span>Sponsor</span><input value={form.sponsor} onChange={(e) => set("sponsor", e.target.value)} /></label>
          </div>
          <label className="field"><span>Address</span><input value={form.site_address} onChange={(e) => set("site_address", e.target.value)} /></label>
          <label className="field"><span>In-scope racks / areas</span><textarea value={form.in_scope_summary} onChange={(e) => set("in_scope_summary", e.target.value)} /></label>
          <label className="field"><span>Escort logistics</span><textarea value={form.escort_logistics} onChange={(e) => set("escort_logistics", e.target.value)} /></label>
          <label className="field"><span>Badging</span><textarea value={form.badging_notes} onChange={(e) => set("badging_notes", e.target.value)} /></label>
          <label className="field"><span>Photography rules</span><textarea value={form.photography_rules} onChange={(e) => set("photography_rules", e.target.value)} /></label>
          <label className="field"><span>Data handling</span><textarea value={form.data_handling_rules} onChange={(e) => set("data_handling_rules", e.target.value)} /></label>
          <label className="field"><span>Restricted (government / EMSS)</span><textarea value={form.restricted_equipment_notes} onChange={(e) => set("restricted_equipment_notes", e.target.value)} /></label>
          <div className="row three">
            <label className="field"><span>Port access</span>
              <select value={form.discovery_port_access} onChange={(e) => set("discovery_port_access", e.target.value)}>
                <option>unknown</option><option>yes</option><option>no</option>
              </select>
            </label>
            <label className="field"><span>CDP/LLDP</span>
              <select value={form.discovery_cdp_lldp} onChange={(e) => set("discovery_cdp_lldp", e.target.value)}>
                <option>unknown</option><option>yes</option><option>no</option>
              </select>
            </label>
            <label className="field"><span>SaaS trial</span>
              <select value={form.discovery_saas_trial} onChange={(e) => set("discovery_saas_trial", e.target.value)}>
                <option>unknown</option><option>yes</option><option>no</option>
              </select>
            </label>
          </div>
          <button className="btn primary">Create workbook shell</button>
        </form>
      )}
      <div className="grid">
        {rows.map((p) => (
          <Link className="card project-card" key={p.id} to={`/projects/${p.id}`}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h3>{p.name}</h3>
              <span className={`badge ${p.status}`}>{p.status}</span>
            </div>
            <div className="muted">{p.customer} · {p.site_name || "no site"} · rev {p.revision}</div>
          </Link>
        ))}
        {rows.length === 0 && <div className="card muted">No projects yet. Create the RBI workbook shell to begin Phase 1.</div>}
      </div>
    </div>
  );
}
