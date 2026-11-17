import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMidi, barAtMs } from "./analysis.ts";

// Synthetic file: format 0, 480 ppq, one C major triad for one 4/4 bar at 120 bpm.
const body = [0, 0xff, 0x51, 3, 7, 0xa1, 0x20, ...[60, 64, 67].flatMap((n) => [0, 0x90, n, 100]), 0x8f, 0x00, 0x80, 60, 0, 0, 0x80, 64, 0, 0, 0x80, 67, 0, 0, 0xff, 0x2f, 0];
const bytes = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]);

test("one C major bar", () => {
  const a = analyzeMidi(bytes);
  assert.equal(a.durationMs, 2000);
  assert.equal(a.bars.length, 1);
  assert.equal(a.bars[0].chord, "C");
  assert.equal(a.key?.name, "C major");
  assert.equal(a.peakPolyphony, 3);
  assert.equal(barAtMs(a, 5000), 0);
});

test("not MIDI throws", () => assert.throws(() => analyzeMidi(new Uint8Array(3))));
