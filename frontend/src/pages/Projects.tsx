import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ImportResult, Project, getSession, projects } from "../api";
import ImportWizard from "../components/ImportWizard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PromptDialog } from "../components/PromptDialog";
import RestrictionPicker from "../components/RestrictionPicker";
import { restrictionFields, restrictionTypeOf, type RestrictionType } from "../restriction";

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
  restricted: false,
  restriction_type: "",
  photography_allowed: true,
  in_scope_summary: "",
  discovery_port_access: "unknown",
  discovery_cdp_lldp: "unknown",
  discovery_saas_trial: "unknown",
  discovery_notes: "",
  start_date: "",
  target_end_date: "",
};

export default function Projects() {
  const navigate = useNavigate();
  const role = getSession()?.role;
  const isAdmin = role === "admin";
  const canImport = role === "admin" || role === "engineer";
  const [rows, setRows] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

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
        <div style={{ display: "flex", gap: 8 }}>
          {canImport && (
            <button className="btn" onClick={() => setImportOpen(true)} disabled={rows.length === 0}>
              Import inventory
            </button>
          )}
          <button className="btn primary" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "New project"}
          </button>
        </div>
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
          <RestrictionPicker
            name="new-project-restriction"
            value={restrictionTypeOf(form)}
            onChange={(type: RestrictionType) => setForm({ ...form, ...restrictionFields(type) })}
          />
          <label className="field"><span>Restricted equipment notes</span><textarea value={form.restricted_equipment_notes} onChange={(e) => set("restricted_equipment_notes", e.target.value)} /></label>
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
          <div className="card project-card" key={p.id}>
            <Link to={`/projects/${p.id}`} style={{ color: "inherit" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <h3>{p.name}</h3>
                <span className={`badge ${p.status}`}>{p.status}</span>
              </div>
              <div className="muted">{p.customer} · {p.site_name || "no site"} · rev {p.revision}</div>
            </Link>
            {isAdmin && (
              <div className="project-card-actions">
                <button type="button" className="btn" onClick={() => setRenaming(p)}>
                  Rename
                </button>
                <button type="button" className="btn danger" onClick={() => setDeleting(p)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="card muted">No projects yet. Create the RBI workbook shell to begin Phase 1.</div>}
      </div>
      {importOpen && (
        <ImportWizard
          projectList={rows}
          onClose={() => setImportOpen(false)}
          onImported={(pid: number, result: ImportResult) => {
            setImportOpen(false);
            const qs = new URLSearchParams({ tab: "devices" });
            if (result.created + result.updated === 0) qs.set("import", "empty");
            navigate(`/projects/${pid}?${qs.toString()}`);
          }}
        />
      )}
      {renaming && (
        <PromptDialog
          title={`Rename project “${renaming.name}”?`}
          label="Project name"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            await projects.update(renaming.id, { ...renaming, name });
            load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete project “${deleting.name}”?`}
          message="This removes the entire project: areas, rows, racks, devices, cables, checklists, and hand-offs."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await projects.delete(deleting.id);
            load();
          }}
        />
      )}
    </div>
  );
}
