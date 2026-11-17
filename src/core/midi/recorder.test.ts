import { test } from "node:test";
import assert from "node:assert/strict";
import { closingMessages } from "./recorder.ts";

test("a take cut off mid-note gets note-offs and a pedal release", () => {
  const m = closingMessages([{ data: [0x90, 60, 100] }, { data: [0x91, 62, 90] }, { data: [0xb0, 64, 127] }, { data: [0x80, 62, 0] }, { data: [0x91, 62, 90] }, { data: [0x90, 60, 0] }]);
  assert.deepEqual(m.map((x) => [...x]), [[0x81, 62, 0], [0xb0, 64, 0]]);
});
test("a clean take needs no closing messages", () => {
  assert.deepEqual(closingMessages([{ data: [0x90, 60, 100] }, { data: [0xb0, 64, 127] }, { data: [0x80, 60, 0] }, { data: [0xb0, 64, 0] }]), []);
});
