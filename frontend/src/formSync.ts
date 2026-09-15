/** Helpers so iPhone WebKit (Chrome/Edge/Firefox/Safari) does not drop the last keystrokes. */

export const IDENTIFIER_INPUT_PROPS = {
  autoComplete: "off" as const,
  autoCorrect: "off" as const,
  autoCapitalize: "none" as const,
  spellCheck: false,
};

export function commitActiveInput(root?: ParentNode | null) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (root && !root.contains(active)) return;
  active.blur();
}

export function readDraftFields(root: ParentNode | null | undefined): Record<string, string | boolean> {
  if (!root) return {};
  const out: Record<string, string | boolean> = {};
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-draft]").forEach((el) => {
    const key = el.getAttribute("data-draft");
    if (!key) return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      out[key] = el.checked;
      return;
    }
    out[key] = el.value;
  });
  return out;
}

export function clampRu(value: number | string | "", fallback = 1) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return Math.max(1, fallback || 1);
  return Math.min(70, Math.round(n));
}

const EMPTY_SELECT = new Set(["rack_id", "pdu_a_id", "pdu_b_id"]);
const NUMBER_OR_EMPTY = new Set(["dc_power_draw_amps"]);

export function applyDraftFields<T extends object>(draft: T, fields: Record<string, string | boolean>): T {
  const keys = Object.keys(fields);
  if (!keys.length) return draft;
  const next: Record<string, unknown> = { ...(draft as Record<string, unknown>) };
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in next)) continue;
    if (typeof value === "boolean") {
      next[key] = value;
      continue;
    }
    if (key === "ru_start" || key === "ru_height") {
      next[key] = clampRu(value, Number(next[key]) || 1);
      continue;
    }
    if (EMPTY_SELECT.has(key)) {
      next[key] = value === "" ? "" : Number(value);
      continue;
    }
    if (NUMBER_OR_EMPTY.has(key)) {
      next[key] = value === "" ? "" : Number(value);
      continue;
    }
    next[key] = value;
  }
  return next as T;
}

export function payloadsDiffer(a: unknown, b: unknown) {
  return JSON.stringify(a) !== JSON.stringify(b);
}
