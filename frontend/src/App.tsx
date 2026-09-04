import { type ReactNode, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getSession, logout } from "./api";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import Project from "./pages/Project";
import Rack from "./pages/Rack";
import Capture from "./pages/Capture";
import VisionSession from "./pages/VisionSession";
import Work from "./pages/Work";
import Ops from "./pages/Ops";
import Settings from "./pages/Settings";
import ErrorBoundary from "./components/ErrorBoundary";

const SIDEBAR_KEY = "dce-sidebar";
const DESKTOP_NAV = "(min-width: 900px)";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={d} />
    </svg>
  );
}

function isDesktopNav() {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_NAV).matches;
}

function readSidebarOpen() {
  if (typeof window === "undefined") return true;
  if (!isDesktopNav()) return false;
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

function persistOpen(next: boolean) {
  if (!isDesktopNav()) return;
  try {
    localStorage.setItem(SIDEBAR_KEY, next ? "open" : "closed");
  } catch {
    /* ignore quota / private mode */
  }
}

function Layout({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const location = useLocation();
  const session = getSession();
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const items = [
    { to: "/", label: "Home", d: "M4 10.5 12 4l8 6.5V20H4z" },
    { to: "/capture", label: "New Device", d: "M4 7h4l2-2h4l2 2h4v12H4z M12 10a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" },
    { to: "/projects", label: "Project", d: "M4 20V4h6v16H4zm10-10h6v10h-6z" },
    { to: "/work", label: "Work", d: "M9 5h6l2 3h5v12H2V8h5z" },
    { to: "/ops", label: "More", d: "M5 7h14M5 12h14M5 17h10" },
  ];

  useEffect(() => {
    if (!isDesktopNav()) setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onResize() {
      setSidebarOpen(readSidebarOpen());
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSidebarOpen(false);
        persistOpen(false);
      }
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggleSidebar() {
    setSidebarOpen((open) => {
      const next = !open;
      persistOpen(next);
      return next;
    });
  }

  function closeSidebar() {
    if (!isDesktopNav()) setSidebarOpen(false);
  }

  return (
    <>
      <aside id="app-sidebar" className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="Main">
        <div className="sidebar-head">
          <div className="brand">
            <img src="/icon.svg" alt="" />
            DCEngineer
          </div>
          <button type="button" className="btn sidebar-close" onClick={toggleSidebar} aria-label="Hide menu">
            Hide
          </button>
        </div>
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === "/"} onClick={closeSidebar}>
            {i.label}
          </NavLink>
        ))}
        <NavLink to="/settings" onClick={closeSidebar}>
          Settings
        </NavLink>
        <div className="sidebar-account">
          <div className="muted">
            {session?.username} · {session?.role}
          </div>
          <button
            className="btn block"
            onClick={async () => {
              await logout();
              nav("/login");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      {sidebarOpen ? (
        <button type="button" className="sidebar-backdrop" aria-label="Close menu" onClick={toggleSidebar} />
      ) : null}
      <div className={`app-shell${sidebarOpen ? " with-sidebar" : ""}`}>
        <header className="topbar">
          <button
            type="button"
            className="btn sidebar-toggle"
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            aria-label={sidebarOpen ? "Hide menu" : "Show menu"}
          >
            <Icon d={sidebarOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </button>
          <div className="brand">
            <img src="/icon.svg" alt="" />
            DCEngineer
          </div>
          <div className="grow" />
          <span className="muted">{session?.username}</span>
        </header>
        <ErrorBoundary>{children}</ErrorBoundary>
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
      <Route path="/capture/vision/:id" element={<Private><VisionSession /></Private>} />
      <Route path="/work" element={<Private><Work /></Private>} />
      <Route path="/ops" element={<Private><Ops /></Private>} />
      <Route path="/settings" element={<Private><Settings /></Private>} />
    </Routes>
  );
}
