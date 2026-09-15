import assert from "node:assert/strict";
import test from "node:test";
import { applyDraftFields, clampRu, payloadsDiffer } from "./formSync.ts";
import { runLatest } from "./persistLock.ts";
import {
  clearCaptureDraft,
  clearOpenDeviceDraft,
  readCaptureDraft,
  readOpenDeviceDraft,
  writeCaptureDraft,
  writeOpenDeviceDraft,
} from "./draftStore.ts";

function sampleDraft(rackId: number) {
  return {
    name: "",
    hostname: "",
    vendor: "",
    model: "",
    serial: "",
    asset_tag: "",
    owner: "",
    device_type: "",
    function: "",
    rack_id: rackId,
    ru_start: 1,
    ru_height: 1,
    fan_orientation: "front-intake",
    notes: "",
  };
}

test("clampRu rejects empty and out-of-range values that would fail device PATCH", () => {
  assert.equal(clampRu("", 32), 32);
  assert.equal(clampRu(0, 1), 1);
  assert.equal(clampRu(99, 1), 70);
  assert.equal(clampRu("18", 1), 18);
});

test("applyDraftFields prefers live DOM values over stale React state", () => {
  const draft = sampleDraft(4);
  draft.name = "old";
  draft.serial = "";
  const next = applyDraftFields(draft, { name: "leaf-a10", serial: "FCW123", ru_start: "40" });
  assert.equal(next.name, "leaf-a10");
  assert.equal(next.serial, "FCW123");
  assert.equal(next.ru_start, 40);
});

test("runLatest repeats when newer edits land during the in-flight save", async () => {
  const lock = { current: null as Promise<unknown> | null };
  let saves = 0;
  let dirty = true;
  const result = await runLatest(
    lock,
    async () => {
      saves += 1;
      if (saves >= 2) dirty = false;
      return saves === 1 ? "stale" : "latest";
    },
    () => dirty,
  );
  assert.equal(result, "latest");
  assert.equal(saves, 2);
});

test("runLatest waits for an in-flight save instead of returning that stale result", async () => {
  const lock = { current: null as Promise<unknown> | null };
  let started = 0;
  const first = runLatest(
    lock,
    async () => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return "a";
    },
    () => false,
  );
  const second = runLatest(
    lock,
    async () => {
      started += 1;
      return "b";
    },
    () => false,
  );
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, "a");
  assert.equal(b, "b");
  assert.equal(started, 2);
});

test("payloadsDiffer detects a later field edit", () => {
  assert.equal(payloadsDiffer({ serial: "A" }, { serial: "A" }), false);
  assert.equal(payloadsDiffer({ serial: "A" }, { serial: "B" }), true);
});

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

test("open device drafts survive a simulated iPhone page reload", () => {
  const orig = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStore() });
  try {
    writeOpenDeviceDraft({
      projectId: 9,
      deviceId: 3,
      rackId: 4,
      draft: { ...sampleDraft(4), name: "leaf-1", serial: "FCW1" },
      savedAt: Date.now(),
    });
    const restored = readOpenDeviceDraft(9, 3);
    assert.equal(restored?.draft && (restored.draft as { serial: string }).serial, "FCW1");
    clearOpenDeviceDraft(9, 3);
    assert.equal(readOpenDeviceDraft(9, 3), null);
  } finally {
    if (orig) Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
  }
});

test("capture drafts restore the in-progress new device form", () => {
  const orig = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStore() });
  try {
    writeCaptureDraft({
      projectId: 2,
      areaId: 1,
      rowId: 8,
      rackId: 11,
      draft: { ...sampleDraft(11), hostname: "sw1" },
      savedAt: Date.now(),
    });
    const restored = readCaptureDraft(2);
    assert.equal(restored?.rackId, 11);
    assert.equal(restored?.draft && (restored.draft as { hostname: string }).hostname, "sw1");
    clearCaptureDraft(2);
    assert.equal(readCaptureDraft(2), null);
  } finally {
    if (orig) Object.defineProperty(globalThis, "localStorage", { configurable: true, value: orig });
  }
});
