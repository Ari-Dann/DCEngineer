import assert from "node:assert/strict";
import test from "node:test";
import { queryFromOcr, scoreToken, fieldsFromOcr } from "./ocr.ts";

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
