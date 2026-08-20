import { FormEvent, useEffect, useState } from "react";
import { AppBackup, BackupProc, Capacity, Drill, ops } from "../api";

export default function Ops() {
  const [backups, setBackups] = useState<BackupProc[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [cap, setCap] = useState<Capacity[]>([]);
  const [appB, setAppB] = useState<AppBackup[]>([]);
  const [bp, setBp] = useState({ name: "", system_name: "", method: "nfs", schedule: "daily", rpo_hours: 24, rto_hours: 4, notes: "" });
  const [dr, setDr] = useState({ title: "", scenario: "", participants: "" });
  const [c, setC] = useState({ category: "power", current_value: 0, max_value: 0, unit: "kW", notes: "" });
  const [msg, setMsg] = useState("");

  function load() {
    ops.backupProcesses().then(setBackups);
    ops.drills().then(setDrills);
    ops.capacity().then(setCap);
    ops.appBackups().then(setAppB);
  }
  useEffect(load, []);

  async function addBp(e: FormEvent) { e.preventDefault(); await ops.addBackupProcess({ ...bp, status: "unknown" }); load(); }
  async function addDr(e: FormEvent) { e.preventDefault(); await ops.addDrill({ ...dr, status: "planned" }); load(); }
  async function addCap(e: FormEvent) { e.preventDefault(); await ops.addCapacity(c); load(); }

  return (
    <div className="page">
      <h1>Backup, DR & capacity</h1>
      <p>Track site backup processes, disaster-recovery drills, and resource headroom. Also run DCEngineer app backups to NFS.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Application backups</h3>
        <p className="muted">SQLite + local files archived to BACKUP_PATH (set in .env; often an NFS mount on your NAS).</p>
        <button className="btn primary" onClick={async () => { const r = await ops.triggerBackup(); setMsg(`${r.status}: ${r.filename}`); load(); }}>
          Run backup now
        </button>
        {msg && <div className="success" style={{ marginTop: 12 }}>{msg}</div>}
        {appB.slice(0, 8).map((b) => (
          <div className="list-item" key={b.id}>
            <div>{b.filename}<div className="muted">{new Date(b.created_at).toLocaleString()} · {(b.size / 1024).toFixed(1)} KiB</div></div>
            <span className={`badge ${b.status === "ok" ? "ok" : "eol"}`}>{b.status}</span>
          </div>
        ))}
      </div>

      <div className="grid two">
        <form className="card" onSubmit={addBp}>
          <h3>Backup process (site systems)</h3>
          <label className="field"><span>Name</span><input value={bp.name} onChange={(e) => setBp({ ...bp, name: e.target.value })} required /></label>
          <label className="field"><span>System</span><input value={bp.system_name} onChange={(e) => setBp({ ...bp, system_name: e.target.value })} /></label>
          <div className="row">
            <label className="field"><span>Method</span>
              <select value={bp.method} onChange={(e) => setBp({ ...bp, method: e.target.value })}>
                <option>nfs</option><option>sftp</option><option>veeam</option><option>restic</option><option>tape</option>
              </select>
            </label>
            <label className="field"><span>Schedule</span><input value={bp.schedule} onChange={(e) => setBp({ ...bp, schedule: e.target.value })} /></label>
          </div>
          <button className="btn">Add process</button>
          {backups.map((b) => <div className="list-item" key={b.id}><div>{b.name}<div className="muted">{b.method} · {b.schedule}</div></div></div>)}
        </form>
        <form className="card" onSubmit={addDr}>
          <h3>DR drill</h3>
          <label className="field"><span>Title</span><input value={dr.title} onChange={(e) => setDr({ ...dr, title: e.target.value })} required /></label>
          <label className="field"><span>Scenario</span><textarea value={dr.scenario} onChange={(e) => setDr({ ...dr, scenario: e.target.value })} /></label>
          <label className="field"><span>Participants</span><input value={dr.participants} onChange={(e) => setDr({ ...dr, participants: e.target.value })} /></label>
          <button className="btn">Schedule drill</button>
          {drills.map((d) => <div className="list-item" key={d.id}><div>{d.title}<div className="muted">{d.status}</div></div></div>)}
        </form>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={addCap}>
        <h3>Capacity snapshot</h3>
        <div className="row three">
          <label className="field"><span>Category</span>
            <select value={c.category} onChange={(e) => setC({ ...c, category: e.target.value })}>
              <option>power</option><option>cooling</option><option>rack_ru</option><option>network_ports</option><option>storage</option>
            </select>
          </label>
          <label className="field"><span>Current</span><input type="number" value={c.current_value} onChange={(e) => setC({ ...c, current_value: Number(e.target.value) })} /></label>
          <label className="field"><span>Max</span><input type="number" value={c.max_value} onChange={(e) => setC({ ...c, max_value: Number(e.target.value) })} /></label>
        </div>
        <button className="btn">Record</button>
        {cap.map((x) => (
          <div className="list-item" key={x.id}>
            <div>{x.category}<div className="muted">{x.current_value}/{x.max_value} {x.unit}</div></div>
          </div>
        ))}
      </form>
    </div>
  );
}
