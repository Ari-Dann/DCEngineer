import assert from "node:assert/strict";
import test from "node:test";
import { queryFromOcr, scoreToken } from "./ocr.ts";

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
