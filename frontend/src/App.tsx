import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
import Search from "./pages/Search";
import Settings from "./pages/Settings";
import ErrorBoundary from "./components/ErrorBoundary";

const SIDEBAR_KEY = "dce-sidebar";
const DESKTOP_NAV = "(min-width: 900px)";

const SEARCH_ICON = "M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={d} />
    </svg>
  );
}

function TopSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (location.pathname === "/search") {
      setQ(new URLSearchParams(location.search).get("q") || "");
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (location.pathname === "/search") inputRef.current?.focus();
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname !== "/search") return;
    const current = new URLSearchParams(location.search).get("q") || "";
    if (q.trim() === current.trim()) return;
    const handle = window.setTimeout(() => {
      const next = q.trim();
      navigate(next ? `/search?q=${encodeURIComponent(next)}` : "/search", { replace: true });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [q, location.pathname, location.search, navigate]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = q.trim();
    navigate(next ? `/search?q=${encodeURIComponent(next)}` : "/search");
  }

  return (
    <form className="top-search" onSubmit={onSubmit} role="search">
      <Icon d={SEARCH_ICON} />
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        aria-label="Search"
        autoComplete="off"
        enterKeyHint="search"
      />
    </form>
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
    { to: "/search", label: "Search", d: SEARCH_ICON },
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
            <span className="brand-text">DCEngineer</span>
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
            <span className="brand-text">DCEngineer</span>
          </div>
          <TopSearch />
          <span className="muted topbar-user">{session?.username}</span>
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
      <Route path="/search" element={<Private><Search /></Private>} />
      <Route path="/ops" element={<Private><Ops /></Private>} />
      <Route path="/settings" element={<Private><Settings /></Private>} />
    </Routes>
  );
}
