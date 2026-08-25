import { FormEvent, useEffect, useState } from "react";
import { Incident, Inspection, WorkOrder, ops } from "../api";
import PhotoGallery from "../components/PhotoGallery";

type Tab = "inspections" | "incidents" | "orders";

export default function Work() {
  const [tab, setTab] = useState<Tab>("inspections");
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [insp, setInsp] = useState({ title: "Daily walkthrough", itype: "routine", location: "", findings: "" });
  const [inc, setInc] = useState({
    title: "",
    severity: "medium",
    category: "hardware",
    vendor: "",
    vendor_ticket: "",
    affected_summary: "",
  });
  const [wo, setWo] = useState({ title: "", wtype: "install", priority: "normal", location: "", description: "" });
  const [openPhotos, setOpenPhotos] = useState<{ type: string; id: number } | null>(null);

  function load() {
    ops.inspections().then(setInspections);
    ops.incidents().then(setIncidents);
    ops.workOrders().then(setOrders);
  }
  useEffect(load, []);

  async function addInsp(e: FormEvent) {
    e.preventDefault();
    await ops.addInspection({ ...insp, status: "open", checklist: [] });
    setInsp({ ...insp, findings: "" });
    load();
  }
  async function addInc(e: FormEvent) {
    e.preventDefault();
    await ops.addIncident({ ...inc, status: "open" });
    setInc({ ...inc, title: "" });
    load();
  }
  async function addWo(e: FormEvent) {
    e.preventDefault();
    await ops.addWorkOrder({ ...wo, status: "planned" });
    setWo({ ...wo, title: "" });
    load();
  }

  function photosToggle(type: string, id: number) {
    setOpenPhotos((cur) => (cur && cur.type === type && cur.id === id ? null : { type, id }));
  }

  return (
    <div className="page">
      <h1>Work</h1>
      <p>Inspections, incidents (with vendor tickets), and install / upgrade work orders. Photos stay in-app.</p>
      <div className="tabs">
        {(["inspections", "incidents", "orders"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "inspections" && (
        <>
          <form className="card" onSubmit={addInsp}>
            <div className="row">
              <label className="field">
                <span>Title</span>
                <input value={insp.title} onChange={(e) => setInsp({ ...insp, title: e.target.value })} />
              </label>
              <label className="field">
                <span>Location</span>
                <input value={insp.location} onChange={(e) => setInsp({ ...insp, location: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Findings</span>
              <textarea value={insp.findings} onChange={(e) => setInsp({ ...insp, findings: e.target.value })} />
            </label>
            <button className="btn primary">Log inspection</button>
          </form>
          {inspections.map((i) => (
            <div className="card" key={i.id} style={{ marginTop: 12 }}>
              <div className="list-item">
                <div>
                  <strong>{i.title}</strong>
                  <div className="muted">
                    {i.location} · {i.itype}
                  </div>
                  <div>{i.findings}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn" onClick={() => photosToggle("inspection", i.id)}>
                    Photos
                  </button>
                  <button
                    className="btn"
                    onClick={() => ops.patchInspection(i.id, { ...i, title: i.title, status: "complete" }).then(load)}
                  >
                    Done
                  </button>
                </div>
              </div>
              {openPhotos?.type === "inspection" && openPhotos.id === i.id && (
                <PhotoGallery entityType="inspection" entityId={i.id} />
              )}
            </div>
          ))}
        </>
      )}

      {tab === "incidents" && (
        <>
          <form className="card" onSubmit={addInc}>
            <label className="field">
              <span>Title</span>
              <input value={inc.title} onChange={(e) => setInc({ ...inc, title: e.target.value })} required />
            </label>
            <div className="row three">
              <label className="field">
                <span>Severity</span>
                <select value={inc.severity} onChange={(e) => setInc({ ...inc, severity: e.target.value })}>
                  <option>low</option>
                  <option>medium</option>
                  <option>high</option>
                  <option>critical</option>
                </select>
              </label>
              <label className="field">
                <span>Category</span>
                <select value={inc.category} onChange={(e) => setInc({ ...inc, category: e.target.value })}>
                  <option>hardware</option>
                  <option>software</option>
                  <option>network</option>
                  <option>facility</option>
                  <option>security</option>
                  <option>power</option>
                </select>
              </label>
              <label className="field">
                <span>Vendor ticket</span>
                <input value={inc.vendor_ticket} onChange={(e) => setInc({ ...inc, vendor_ticket: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Affected</span>
              <textarea value={inc.affected_summary} onChange={(e) => setInc({ ...inc, affected_summary: e.target.value })} />
            </label>
            <button className="btn danger">Open incident</button>
          </form>
          {incidents.map((i) => (
            <div className="card" key={i.id} style={{ marginTop: 12 }}>
              <div className="list-item">
                <div>
                  <strong>{i.title}</strong>
                  <div className="muted">
                    {i.category} · {i.vendor} {i.vendor_ticket}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" className="btn" onClick={() => photosToggle("incident", i.id)}>
                    Photos
                  </button>
                  <span className={`badge ${i.severity === "high" || i.severity === "critical" ? "high" : "open"}`}>
                    {i.severity} · {i.status}
                  </span>
                </div>
              </div>
              {openPhotos?.type === "incident" && openPhotos.id === i.id && (
                <PhotoGallery entityType="incident" entityId={i.id} />
              )}
            </div>
          ))}
        </>
      )}

      {tab === "orders" && (
        <>
          <form className="card" onSubmit={addWo}>
            <label className="field">
              <span>Title</span>
              <input value={wo.title} onChange={(e) => setWo({ ...wo, title: e.target.value })} required />
            </label>
            <div className="row">
              <label className="field">
                <span>Type</span>
                <select value={wo.wtype} onChange={(e) => setWo({ ...wo, wtype: e.target.value })}>
                  <option>install</option>
                  <option>upgrade</option>
                  <option>cabling</option>
                  <option>power</option>
                  <option>decommission</option>
                </select>
              </label>
              <label className="field">
                <span>Location</span>
                <input value={wo.location} onChange={(e) => setWo({ ...wo, location: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <textarea value={wo.description} onChange={(e) => setWo({ ...wo, description: e.target.value })} />
            </label>
            <button className="btn primary">Create work order</button>
          </form>
          {orders.map((o) => (
            <div className="card" key={o.id} style={{ marginTop: 12 }}>
              <div className="list-item">
                <div>
                  <strong>{o.title}</strong>
                  <div className="muted">
                    {o.wtype} · {o.location}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" className="btn" onClick={() => photosToggle("work_order", o.id)}>
                    Photos
                  </button>
                  <span className="badge open">{o.status}</span>
                </div>
              </div>
              {openPhotos?.type === "work_order" && openPhotos.id === o.id && (
                <PhotoGallery entityType="work_order" entityId={o.id} />
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
