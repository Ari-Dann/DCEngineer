import assert from "node:assert/strict";
import test from "node:test";
import { safeDownloadFilename } from "./api.ts";

test("safeDownloadFilename strips reserved characters and keeps a zip name", () => {
  assert.equal(safeDownloadFilename("Hall:West/Visio?.zip"), "Hall_West_Visio_.zip");
  assert.equal(safeDownloadFilename("   "), "download");
  assert.equal(safeDownloadFilename(""), "download");
  assert.equal(safeDownloadFilename("Lab Hall-Visio-Office.zip"), "Lab Hall-Visio-Office.zip");
});
