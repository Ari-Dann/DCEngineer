import assert from "node:assert/strict";
import test from "node:test";
import { api, clearSession, resetAuthForTests, setSession, type Session } from "./api.ts";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function session(n: number): Session {
  return {
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    token_type: "bearer",
    role: "engineer",
    username: "tech",
    user_id: 1,
  };
}

test("concurrent 401s share one refresh and do not wipe the new session", async () => {
  const origStorage = globalThis.localStorage;
  const origFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStore() });
  resetAuthForTests();
  setSession(session(1));
  let refreshes = 0;
  const pending: Array<() => void> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/refresh")) {
      refreshes += 1;
      await new Promise<void>((resolve) => pending.push(resolve));
      return new Response(JSON.stringify(session(2)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const auth = new Headers(init?.headers).get("Authorization");
    if (auth === "Bearer access-1") {
      return new Response(JSON.stringify({ detail: "Token expired" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, auth }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const first = api<{ ok: boolean }>("/api/projects/1/devices/1", { method: "PATCH", body: JSON.stringify({ serial: "A" }) });
    const second = api<{ ok: boolean }>("/api/projects/1/devices/1", { method: "PATCH", body: JSON.stringify({ serial: "B" }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    pending.forEach((resolve) => resolve());
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(refreshes, 1);
    assert.equal(globalThis.localStorage.getItem("dce.access"), "access-2");
  } finally {
    globalThis.fetch = origFetch;
    resetAuthForTests();
    clearSession();
    if (origStorage) Object.defineProperty(globalThis, "localStorage", { configurable: true, value: origStorage });
  }
});
