import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSmf, parseSmfChannels, SmfError } from "./smf.ts";

// Synthetic files only: built here from bytes, nothing from KORG.
const vlq = (n: number): number[] => {
  const out = [n & 127];
  while ((n >>= 7)) out.unshift((n & 127) | 128);
  return out;
};
const chunk = (id: string, body: number[]): number[] => [...id].map((c) => c.charCodeAt(0)).concat([(body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255], body);
const file = (format: number, division: number, ...tracks: number[][]): Uint8Array =>
  Uint8Array.from([...chunk("MThd", [0, format, 0, tracks.length, division >> 8, division & 255]), ...tracks.flatMap((t) => chunk("MTrk", t))]);
const END = [0, 0xff, 0x2f, 0];

test("a note at the default tempo is 500 ms per quarter note", () => {
  const r = parseSmf(file(0, 480, [...vlq(0), 0x90, 60, 100, ...vlq(480), 0x80, 60, 0, ...END]));
  assert.deepEqual(r.events, [{ ms: 0, data: [0x90, 60, 100] }, { ms: 500, data: [0x80, 60, 0] }]);
  assert.equal(r.durationMs, 500);
});

test("running status and a tempo change apply in order", () => {
  const t = [...vlq(0), 0x90, 60, 100, ...vlq(240), 60, 0, ...vlq(0), 0xff, 0x51, 3, 0x0f, 0x42, 0x40, ...vlq(480), 0x80, 64, 0, ...END];
  assert.deepEqual(parseSmf(file(0, 480, t)).events.map((e) => [e.ms, ...e.data]), [[0, 0x90, 60, 100], [250, 0x90, 60, 0], [1250, 0x80, 64, 0]]);
});

test("system messages in a file are never passed on", () => {
  const t = [...vlq(0), 0xf0, 3, 0x42, 0x30, 0xf7, ...vlq(0), 0xff, 0x01, 2, 65, 66, ...vlq(0), 0x90, 60, 100, ...END];
  const r = parseSmf(file(0, 480, t));
  assert.deepEqual(r.events.map((e) => e.data[0]), [0x90]);
});

test("malformed input is rejected with SmfError", () => {
  const good = file(0, 480, [...vlq(0), 0x90, 60, 100, ...END]);
  const cases: Record<string, Uint8Array> = {
    empty: new Uint8Array(0),
    truncated: good.subarray(0, 20),
    "bad magic": Uint8Array.from([0x58, ...good.subarray(1)]),
    "data byte with no status": file(0, 480, [...vlq(0), 60, 100, ...END]),
    "over-long VLQ": file(0, 480, [0xff, 0xff, 0xff, 0xff, 0x7f, 0x90, 60, 100]),
    "SMPTE timing": file(0, 0xe250, [...END]),
    "format 2": file(2, 480, [...END]),
    "tempo of zero": file(0, 480, [0, 0xff, 0x51, 3, 0, 0, 0, ...END]),
  };
  for (const [name, bytes] of Object.entries(cases)) assert.throws(() => parseSmf(bytes), SmfError, name);
});

test("a named track on a channel with no notes is listed with 0 notes", () => {
  const name = [0, 0xff, 0x03, 4, 75, 105, 99, 107]; // meta "Kick"
  const cc = [0, 0xb9, 7, 100]; // channel 10 volume, no notes
  const facts = parseSmfChannels(file(0, 480, [...name, ...cc, ...END]));
  assert.deepEqual(facts, [{ channel: 9, trackName: "Kick", program: null, notes: 0 }]);
});
