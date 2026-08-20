import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { getSession, logout } from "./api";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import Project from "./pages/Project";
import Rack from "./pages/Rack";
import Capture from "./pages/Capture";
import Work from "./pages/Work";
import Ops from "./pages/Ops";
import Settings from "./pages/Settings";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={d} />
    </svg>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const session = getSession();
  const items = [
    { to: "/", label: "Home", d: "M4 10.5 12 4l8 6.5V20H4z" },
    { to: "/capture", label: "Capture", d: "M4 7h4l2-2h4l2 2h4v12H4z M12 10a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" },
    { to: "/projects", label: "Floor", d: "M4 20V4h6v16H4zm10-10h6v10h-6z" },
    { to: "/work", label: "Work", d: "M9 5h6l2 3h5v12H2V8h5z" },
    { to: "/ops", label: "More", d: "M5 7h14M5 12h14M5 17h10" },
  ];
  return (
    <>
      <aside className="sidebar">
        <div className="brand" style={{ padding: "8px 8px 16px" }}>
          <img src="/icon.svg" alt="" />
          DCEngineer
        </div>
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === "/"}>
            {i.label}
          </NavLink>
        ))}
        <NavLink to="/settings">Settings</NavLink>
        <div className="grow" />
        <div className="muted" style={{ padding: 8 }}>
          {session?.username} · {session?.role}
        </div>
        <button
          className="btn"
          onClick={async () => {
            await logout();
            nav("/login");
          }}
        >
          Sign out
        </button>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <img src="/icon.svg" alt="" />
            DCEngineer
          </div>
          <div className="grow" />
          <span className="muted">{session?.username}</span>
        </header>
        {children}
        <nav className="nav">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === "/"}>
              <Icon d={i.d} />
              {i.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  );
}

function Private({ children }: { children: ReactNode }) {
  if (!getSession()) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Private><Home /></Private>} />
      <Route path="/projects" element={<Private><Projects /></Private>} />
      <Route path="/projects/:id" element={<Private><Project /></Private>} />
      <Route path="/projects/:id/racks/:rackId" element={<Private><Rack /></Private>} />
      <Route path="/capture" element={<Private><Capture /></Private>} />
      <Route path="/work" element={<Private><Work /></Private>} />
      <Route path="/ops" element={<Private><Ops /></Private>} />
      <Route path="/settings" element={<Private><Settings /></Private>} />
    </Routes>
  );
}
