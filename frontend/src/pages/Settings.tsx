import { FormEvent, useEffect, useState } from "react";
import { Role, User, getSession, ops } from "../api";

const empty = { username: "", email: "", password: "", full_name: "", role: "engineer" as Role, is_active: true };

export default function Settings() {
  const me = getSession();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [installHint, setInstallHint] = useState("");

  function loadUsers() {
    if (me?.role === "admin") {
      ops.users().then(setUsers).catch((e) => setError(String(e.message || e)));
    }
  }

  useEffect(() => {
    loadUsers();
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone || window.matchMedia("(display-mode: standalone)").matches) {
      setInstallHint("Running as an installed app.");
    } else {
      setInstallHint("Browser: use Install app / Add to Home screen. GrapheneOS: Vanadium → Install. Android APK: see android/README.md.");
    }
  }, [me?.role]);

  function startCreate() {
    setEditingId(null);
    setForm(empty);
    setError("");
    setMsg("");
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setForm({
      username: u.username,
      email: u.email,
      password: "",
      full_name: u.full_name || "",
      role: u.role,
      is_active: u.is_active,
    });
    setError("");
    setMsg("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      if (editingId) {
        const body: Parameters<typeof ops.updateUser>[1] = {
          username: form.username,
          email: form.email,
          full_name: form.full_name,
          role: form.role,
          is_active: form.is_active,
        };
        if (form.password) body.password = form.password;
        await ops.updateUser(editingId, body);
        setUsers(await ops.users());
        startCreate();
        setMsg(`Updated ${form.username}.`);
      } else {
        await ops.addUser(form);
        setUsers(await ops.users());
        startCreate();
        setMsg(`Created ${form.username}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="card">
        <h3>This device</h3>
        <p>Signed in as {me?.username} ({me?.role}). JWTAuth access token is stored on-device for the PWA / APK.</p>
        <p>{installHint}</p>
      </div>
      {me?.role === "admin" && (
        <>
          <form className="card" style={{ marginTop: 16 }} onSubmit={onSubmit}>
            <h3>{editingId ? `Edit ${form.username || "user"}` : "Create user"}</h3>
            {error && <div className="error">{error}</div>}
            {msg && <div className="success">{msg}</div>}
            <div className="row">
              <label className="field">
                <span>Username</span>
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              </label>
              <label className="field">
                <span>Email</span>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>Password{editingId ? " (leave blank to keep)" : ""}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  minLength={editingId ? undefined : 8}
                  required={!editingId}
                  placeholder={editingId ? "Unchanged" : ""}
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span>Full name</span>
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>Role</span>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  <option>admin</option>
                  <option>engineer</option>
                  <option>remote</option>
                  <option>viewer</option>
                  <option>sidecar</option>
                </select>
              </label>
              {editingId != null && (
                <label className="field">
                  <span>Status</span>
                  <select
                    value={form.is_active ? "active" : "inactive"}
                    onChange={(e) => setForm({ ...form, is_active: e.target.value === "active" })}
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary">{editingId ? "Save user" : "Create user"}</button>
              {editingId != null && (
                <button type="button" className="btn" onClick={startCreate}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Users</h3>
            {users.map((u) => (
              <div className="list-item" key={u.id}>
                <div>
                  {u.username}
                  <div className="muted">
                    {u.email}
                    {u.full_name ? ` · ${u.full_name}` : ""}
                    {u.is_active ? "" : " · inactive"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="badge unknown">{u.role}</span>
                  <button type="button" className="btn" onClick={() => startEdit(u)}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
