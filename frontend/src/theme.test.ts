import assert from "node:assert/strict";
import test from "node:test";
import { parseTheme, toggleTheme, THEME_KEY } from "./theme.ts";

test("parseTheme defaults to dark, including invalid values", () => {
  assert.equal(parseTheme(null), "dark");
  assert.equal(parseTheme(undefined), "dark");
  assert.equal(parseTheme(""), "dark");
  assert.equal(parseTheme("system"), "dark");
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme("light"), "light");
});

test("toggleTheme flips dark to light and persists", () => {
  const store = new Map<string, string>();
  const orig = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
  try {
    assert.equal(toggleTheme("dark"), "light");
    assert.equal(store.get(THEME_KEY), "light");
    assert.equal(toggleTheme("light"), "dark");
    assert.equal(store.get(THEME_KEY), "dark");
  } finally {
    if (orig) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).localStorage;
    }
  }
});
