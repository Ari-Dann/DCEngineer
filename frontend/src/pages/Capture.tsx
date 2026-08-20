import { FormEvent, useEffect, useState } from "react";
import { Device, Project, Rack, enqueue, projects, uploadFile } from "../api";

const FANS = [
  { id: "front-intake", label: "Front intake" },
  { id: "rear-intake", label: "Rear intake" },
  { id: "incorrect-hot-aisle", label: "Wrong — hot aisle" },
  { id: "incorrect-cold-aisle", label: "Wrong — cold aisle" },
];

export default function Capture() {
  const [plist, setPlist] = useState<Project[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [pid, setPid] = useState<number | "">("");
  const [rid, setRid] = useState<number | "">("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [form, setForm] = useState({
    name: "", vendor: "", model: "", serial: "", device_type: "server",
    ru_start: 1, ru_height: 1, fan_orientation: "front-intake", function: "",
    restricted: false, restricted_reason: "", notes: "",
  });

  useEffect(() => {
    projects.list().then((rows) => {
      setPlist(rows);
      if (rows[0]) setPid(rows[0].id);
    });
  }, []);
  useEffect(() => {
    if (!pid) return;
    projects.racks(Number(pid)).then((rows) => {
      setRacks(rows);
      setRid(rows[0]?.id || "");
    });
  }, [pid]);

  async function scanSerial() {
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      setError("BarcodeDetector is not available in this browser. Type the serial instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      const detector = new Detector({ formats: ["code_128", "qr_code", "code_39", "ean_13"] });
      const timer = window.setInterval(async () => {
        const codes = await detector.detect(video);
        if (codes[0]) {
          setForm((f) => ({ ...f, serial: codes[0].rawValue }));
          stream.getTracks().forEach((t) => t.stop());
          window.clearInterval(timer);
          setMsg("Serial scanned");
        }
      }, 400);
      window.setTimeout(() => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(timer);
      }, 12000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera failed");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    if (!pid || !rid) {
      setError("Select a project and rack first.");
      return;
    }
    const body: Partial<Device> & { name: string } = {
      name: form.name,
      vendor: form.vendor,
      model: form.model,
      serial: form.serial,
      device_type: form.device_type,
      ru_start: form.ru_start,
      ru_end: form.ru_start + form.ru_height - 1,
      fan_orientation: form.fan_orientation,
      function: form.function,
      restricted: form.restricted,
      restricted_reason: form.restricted_reason,
      notes: form.notes,
      rack_id: Number(rid),
      discovered_via: "physical",
    };
    try {
      const created = await projects.addDevice(Number(pid), body);
      if (photo) {
        await uploadFile("device", created.id, photo, form.restricted);
      }
      setForm({ ...form, name: "", serial: "", notes: "" });
      setPhoto(null);
      setMsg(`Saved ${created.name}. Ready for the next device.`);
    } catch {
      enqueue({ method: "POST", path: `/api/projects/${pid}/devices`, body });
      setMsg("No network — queued for sync. Keep capturing.");
    }
  }

  const project = plist.find((p) => p.id === pid);

  return (
    <div className="page">
      <h1>Onsite capture</h1>
      <p>Phase 2 rack-by-rack intake. Large targets, camera serial scan, offline queue.</p>
      {project?.photography_rules && <div className="banner">{project.photography_rules}</div>}
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}
      <form className="card" onSubmit={onSubmit}>
        <div className="row">
          <label className="field"><span>Project</span>
            <select value={pid} onChange={(e) => setPid(Number(e.target.value))}>
              {plist.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Rack</span>
            <select value={rid} onChange={(e) => setRid(Number(e.target.value))}>
              {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>Device name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="off" /></label>
        <div className="row">
          <label className="field"><span>Vendor</span><input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></label>
          <label className="field"><span>Model</span><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
        </div>
        <label className="field"><span>Serial</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={scanSerial}>Scan</button>
          </div>
        </label>
        <div className="row three">
          <label className="field"><span>Type</span>
            <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })}>
              <option>server</option><option>switch</option><option>storage</option><option>pdu</option><option>ups</option><option>other</option>
            </select>
          </label>
          <label className="field"><span>RU start (from bottom)</span><input type="number" value={form.ru_start} onChange={(e) => setForm({ ...form, ru_start: Number(e.target.value) })} /></label>
          <label className="field"><span>Height (U)</span><input type="number" value={form.ru_height} onChange={(e) => setForm({ ...form, ru_height: Number(e.target.value) })} /></label>
        </div>
        <span className="muted">Fan orientation</span>
        <div className="choice">
          {FANS.map((f) => (
            <button type="button" key={f.id} className={`btn ${form.fan_orientation === f.id ? "on" : ""}`} onClick={() => setForm({ ...form, fan_orientation: f.id })}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={form.restricted} onChange={(e) => setForm({ ...form, restricted: e.target.checked })} />
          <span>Government / EMSS — do not photograph; mark for client engineer</span>
        </label>
        {form.restricted && (
          <label className="field"><span>Restriction</span>
            <select value={form.restricted_reason} onChange={(e) => setForm({ ...form, restricted_reason: e.target.value })}>
              <option value="">—</option><option>government</option><option>EMSS</option><option>other</option>
            </select>
          </label>
        )}
        <label className="field"><span>Photo (skipped automatically if restricted)</span>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} disabled={form.restricted} />
        </label>
        <label className="field"><span>Notes / cabling</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <button className="btn primary block">Save & next</button>
      </form>
    </div>
  );
}
