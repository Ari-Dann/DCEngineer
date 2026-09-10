export type Theme = "dark" | "light";

export const THEME_KEY = "dce-theme";
export const THEME_CHANGE = "dce-theme-change";
export const THEME_COLORS: Record<Theme, string> = {
  dark: "#000000",
  light: "#f3f7f3",
};

export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "light" ? "light" : "dark";
}

export function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

export function persistTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
  applyTheme(theme);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE, { detail: theme }));
  }
}

export function toggleTheme(current: Theme): Theme {
  const next: Theme = current === "dark" ? "light" : "dark";
  persistTheme(next);
  return next;
}

