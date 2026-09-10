import assert from "node:assert/strict";
import test from "node:test";
import {
  queryFromOcr,
  scoreToken,
  fieldsFromOcr,
  ipCandidatesFromText,
  scanCandidatesFromText,
  uniqueScanValues,
} from "./ocr.ts";

test("prefers a labeled serial over nearby words", () => {
  assert.equal(queryFromOcr("Cisco\nCatalyst\nSerial: FCW2145L0AB\nMade in"), "FCW2145L0AB");
  assert.equal(queryFromOcr("S/N CN0ABC123"), "CN0ABC123");
  assert.equal(queryFromOcr("Asset tag: AT-00912"), "AT-00912");
});

test("picks a mixed alphanumeric token from a block of text", () => {
  assert.equal(queryFromOcr("UCS chassis\nCH-VIEW\nHall A"), "CH-VIEW");
});

test("returns empty string for blank OCR", () => {
  assert.equal(queryFromOcr("   "), "");
});

test("scores serial-like tokens above plain words", () => {
  assert.ok(scoreToken("CH-VIEW") > scoreToken("Cisco"));
  assert.equal(scoreToken("the"), 0);
});

test("fieldsFromOcr maps labeled serial and asset tag separately", () => {
  const fields = fieldsFromOcr("Cisco\nSerial: FCW2145L0AB\nAsset tag: AT-00912\nHostname: leaf-01");
  assert.equal(fields.serial, "FCW2145L0AB");
  assert.equal(fields.asset_tag, "AT-00912");
  assert.equal(fields.hostname, "leaf-01");
});

test("fieldsFromOcr does not copy an asset tag into serial", () => {
  const fields = fieldsFromOcr("Asset tag: AT-00912");
  assert.equal(fields.asset_tag, "AT-00912");
  assert.equal(fields.serial, undefined);
});

test("fieldsFromOcr uses an unlabeled serial-like token as serial", () => {
  assert.equal(fieldsFromOcr("UCS chassis\nCH-VIEW\nHall A").serial, "CH-VIEW");
});

test("ipCandidatesFromText finds every address in a block", () => {
  assert.deepEqual(
    ipCandidatesFromText("Mgmt IP: 10.10.1.8\nLoopback 192.168.0.1 and 10.0.0.1"),
    ["10.10.1.8", "192.168.0.1", "10.0.0.1"],
  );
});

test("ipCandidatesFromText ignores serial-like text without an address", () => {
  assert.deepEqual(ipCandidatesFromText("Serial: FCW2145L0AB\nAsset tag: AT-00912"), []);
});

test("scanCandidatesFromText for asset_tag prefers the tag and lists serial", () => {
  assert.deepEqual(scanCandidatesFromText("Serial: FCW2145L0AB\nAsset tag: AT-00912", "asset_tag"), [
    "AT-00912",
    "FCW2145L0AB",
  ]);
});

test("scanCandidatesFromText for serial lists serial then asset tag", () => {
  assert.deepEqual(scanCandidatesFromText("Serial: FCW2145L0AB\nAsset tag: AT-00912", "serial"), [
    "FCW2145L0AB",
    "AT-00912",
  ]);
});

test("uniqueScanValues dedupes case-insensitively", () => {
  assert.deepEqual(uniqueScanValues(["ABCdef", "ABCDEF", "other"]), ["ABCdef", "other"]);
});
