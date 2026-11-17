import assert from "node:assert/strict";
import { test } from "node:test";
import type { Row } from "../params/params.ts";
import { bipolarOf, controlKind } from "./controls.ts";

const row = (min: number, max: number, over: Partial<Row> = {}): Row => ({
  ofs: 0, bitHi: null, bitLo: null, group: "G", name: "x", rawMin: min, rawMax: max, fixed: false, valueText: "~", signed: min < 0,
  continuation: false, parts: [[0, 6, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...over,
});
const nums = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => String(min + i));

test("two values are a toggle", () => {
  assert.equal(controlKind(row(0, 1), ["Off", "On"]), "toggle");
  assert.equal(controlKind(row(0, 1), ["0", "1"]), "toggle");
});

test("two named values that are not Off/On are a segmented row", () => {
  assert.equal(controlKind(row(0, 1), ["Pre", "Post"]), "segmented");
});

test("up to 8 named values are segmented, more are a select", () => {
  assert.equal(controlKind(row(0, 3), ["Low Pass", "High Pass", "Band Pass", "Band Reject"]), "segmented");
  assert.equal(controlKind(row(0, 8), Array.from({ length: 9 }, (_, i) => `n${i}`)), "select");
});

test("numbers with up to 128 steps are a dial, wider ones a field", () => {
  assert.equal(controlKind(row(0, 127), nums(0, 127)), "dial");
  assert.equal(controlKind(row(0, 200), nums(0, 200)), "field");
  assert.equal(controlKind(row(-99, 99), nums(-99, 99)), "field");
  assert.equal(controlKind(row(-12, 12), nums(-12, 12)), "dial");
});

test("a row with only its two ends named stays a dial", () => {
  const t = nums(0, 127); t[0] = "RND";
  assert.equal(controlKind(row(0, 127), t), "dial");
});

test("rows that cannot be edited are read-only", () => {
  assert.equal(controlKind(row(0, 127, { fixed: true }), nums(0, 127)), "readonly");
});

test("bipolar: raw range across zero, else null", () => {
  assert.equal(bipolarOf(row(-12, 12)), 0);
  assert.equal(bipolarOf(row(0, 127)), null);
});
