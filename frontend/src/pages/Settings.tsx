import { FormEvent, useEffect, useState } from "react";
import { Role, User, getSession, ops } from "../api";

export default function Settings() {
  const me = getSession();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "", full_name: "", role: "engineer" as Role });
  const [installHint, setInstallHint] = useState("");

  useEffect(() => {
    if (me?.role === "admin") {
      ops.users().then(setUsers).catch((e) => setError(String(e.message || e)));
    }
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone || window.matchMedia("(display-mode: standalone)").matches) {
      setInstallHint("Running as an installed app.");
    } else {
      setInstallHint("Browser: use Install app / Add to Home screen. GrapheneOS: Vanadium → Install. Android APK: see android/README.md.");
    }
  }, [me?.role]);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    await ops.addUser(form);
    setForm({ username: "", email: "", password: "", full_name: "", role: "engineer" });
    setUsers(await ops.users());
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
        <form className="card" style={{ marginTop: 16 }} onSubmit={addUser}>
          <h3>Users</h3>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <label className="field"><span>Username</span><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
          </div>
          <div className="row">
            <label className="field"><span>Password</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required /></label>
            <label className="field"><span>Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option>admin</option><option>engineer</option><option>remote</option><option>viewer</option>
              </select>
            </label>
          </div>
          <button className="btn primary">Create user</button>
          {users.map((u) => (
            <div className="list-item" key={u.id}>
              <div>{u.username}<div className="muted">{u.email}</div></div>
              <span className="badge unknown">{u.role}</span>
            </div>
          ))}
        </form>
      )}
    </div>
  );
}
