import { useEffect, useState } from "react";
import { readTheme, toggleTheme, THEME_CHANGE, type Theme } from "../theme";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M3 12h2M19 12h2M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 14.5A7 7 0 1 1 9.5 7 5.5 5.5 0 0 0 17 14.5z" />
    </svg>
  );
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const next = theme === "dark" ? "light" : "dark";

  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent<Theme>).detail;
      if (detail === "dark" || detail === "light") setTheme(detail);
    }
    window.addEventListener(THEME_CHANGE, onChange);
    return () => window.removeEventListener(THEME_CHANGE, onChange);
  }, []);

  return (
    <button
      type="button"
      className={`btn theme-toggle${compact ? " compact" : ""}`}
      onClick={() => setTheme(toggleTheme(theme))}
      aria-label={`Switch to ${next} mode`}
      title={theme === "dark" ? "Dark mode (Linux green). Switch to light." : "Light mode. Switch to dark."}
    >
      {theme === "dark" ? <MoonIcon /> : <SunIcon />}
      <span className="theme-toggle-text">{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
