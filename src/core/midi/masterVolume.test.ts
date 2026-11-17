import { test } from "node:test";
import assert from "node:assert/strict";
import { coalescedSender, effectiveGlobalChannel, globalMidiChannel, masterVolumeMessage } from "./masterVolume.ts";

test("masterVolumeMessage: min, mid, max and a non-zero channel, value = mm*128 + vv", () => {
  assert.deepEqual([...masterVolumeMessage(0, 0)], [0xf0, 0x7f, 0x00, 0x04, 0x01, 0x00, 0x00, 0xf7]);
  assert.deepEqual([...masterVolumeMessage(8192, 0)], [0xf0, 0x7f, 0x00, 0x04, 0x01, 0x00, 0x40, 0xf7]);
  assert.deepEqual([...masterVolumeMessage(16383, 0)], [0xf0, 0x7f, 0x00, 0x04, 0x01, 0x7f, 0x7f, 0xf7]);
  assert.deepEqual([...masterVolumeMessage(1000, 9)], [0xf0, 0x7f, 0x09, 0x04, 0x01, 0x68, 0x07, 0xf7]);
});

test("masterVolumeMessage clamps the value and the channel", () => {
  assert.deepEqual([...masterVolumeMessage(99999, 40)], [0xf0, 0x7f, 0x0f, 0x04, 0x01, 0x7f, 0x7f, 0xf7]);
  assert.deepEqual([...masterVolumeMessage(-5, -1)], [0xf0, 0x7f, 0x00, 0x04, 0x01, 0x00, 0x00, 0xf7]);
});

test("masterVolumeMessage with channel 0x7F is the all-devices id, not clamped", () => {
  assert.deepEqual([...masterVolumeMessage(16383, 0x7f)], [0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x7f, 0x7f, 0xf7]);
});

test("globalMidiChannel reads Global byte 24576, else channel 0", () => {
  const g = new Uint8Array(24708);
  g[24576] = 5;
  assert.equal(globalMidiChannel(g), 5);
  assert.equal(globalMidiChannel(null), 0);
  assert.equal(globalMidiChannel(new Uint8Array(10)), 0);
});

test("coalescedSender: a burst is one leading send plus one trailing send of the last value; flush sends it now", async () => {
  const got: number[] = [];
  const s = coalescedSender((v) => got.push(v), 10);
  s.set(1);
  s.set(2);
  s.set(3);
  assert.deepEqual(got, [1]);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(got, [1, 3]);
  s.set(7);
  s.set(9);
  s.flush();
  assert.deepEqual(got, [1, 3, 7, 9]);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(got, [1, 3, 7, 9]);
});

test("effectiveGlobalChannel: 'file' uses the file, 1..16 is n-1, anything else falls back to the file", () => {
  assert.equal(effectiveGlobalChannel("file", 5), 5);
  assert.equal(effectiveGlobalChannel("1", 5), 0);
  assert.equal(effectiveGlobalChannel("15", 0), 14);
  assert.equal(effectiveGlobalChannel("16", 3), 15);
  assert.equal(effectiveGlobalChannel("17", 3), 3);
  assert.equal(effectiveGlobalChannel("0", 3), 3);
  assert.equal(effectiveGlobalChannel("", 3), 3);
});
