import assert from "node:assert/strict";
import test from "node:test";
import { captureDraftHasWork, nextLoad, suggestedDeviceName } from "./loadGuard.ts";

test("nextLoad ignores results from an older generation", () => {
  const state = { id: 0 };
  const first = nextLoad(state);
  const second = nextLoad(state);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});

test("suggestedDeviceName uses U height when the name is blank", () => {
  assert.equal(suggestedDeviceName("leaf-1", 32), "leaf-1");
  assert.equal(suggestedDeviceName("  ", 32), "U32");
  assert.equal(suggestedDeviceName("", ""), "New device");
});

test("captureDraftHasWork treats leftover vendor/type as not worth saving", () => {
  const leftover = {
    name: "",
    serial: "",
    hostname: "",
    asset_tag: "",
    notes: "",
    model: "",
  };
  assert.equal(captureDraftHasWork(leftover, 0), false);
  assert.equal(captureDraftHasWork({ ...leftover, serial: "FCW1" }, 0), true);
  assert.equal(captureDraftHasWork(leftover, 1), true);
});
