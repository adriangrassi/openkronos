import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSmf } from "./smf.ts";
import { writeSmf } from "./smfwrite.ts";
import { isRecordable, MidiRecorder } from "./recorder.ts";

test("written events read back through parseSmf", () => {
  const r = parseSmf(writeSmf([{ ms: 1000, data: [0x80, 60, 0] }, { ms: 0, data: [0x90, 60, 100] }, { ms: 0, data: [0xc0, 5] }]));
  assert.deepEqual(r.events.map((e) => e.data), [[0x90, 60, 100], [0xc0, 5], [0x80, 60, 0]]);
  assert.ok(Math.abs(r.events[2].ms - 1000) <= 1);
});

test("the writer refuses non-channel messages and negative times", () => {
  assert.throws(() => writeSmf([{ ms: 0, data: [0xf8] }]));
  assert.throws(() => writeSmf([{ ms: -1, data: [0x90, 60, 1] }]));
});

test("the recorder ignores clock and stops at its limit", () => {
  const r = new MidiRecorder(2);
  assert.equal(isRecordable([0xf8]), false);
  assert.equal(r.add([0xf8], 0), false);
  r.add([0x90, 60, 1], 10);
  r.add([0x80, 60, 0], 30);
  assert.equal(r.full, true);
  assert.equal(r.add([0x90, 61, 1], 40), false);
  assert.equal(r.lengthMs, 20);
  assert.equal(r.noteCount, 1);
});
