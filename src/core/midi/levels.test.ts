import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLevels, levelBytes, parseLevels } from "./levels.ts";
import type { PlayEvent } from "./player.ts";

const ev = (ms: number, ...data: number[]): PlayEvent => ({ ms, data });
const cc7 = (ms: number, ch: number, v: number) => ev(ms, 0xb0 | ch, 7, v);

test("applyLevels drops CC7 only on leveled channels and keeps the rest in order", () => {
  const events = [cc7(0, 0, 80), cc7(0, 1, 90), ev(5, 0x90 | 0, 60, 100), ev(6, 0xb0 | 0, 10, 64), ev(7, 0x90 | 1, 62, 90), cc7(8, 2, 70)];
  const out = applyLevels(events, { 0: 100, 1: 50 });
  assert.deepEqual(out, [ev(5, 0x90, 60, 100), ev(6, 0xb0, 10, 64), ev(7, 0x91, 62, 90), cc7(8, 2, 70)]);
});

test("applyLevels with no levels returns the same content", () => {
  const events = [cc7(0, 0, 80), ev(5, 0x90, 60, 100)];
  assert.deepEqual(applyLevels(events, {}), events);
});

test("applyLevels does not mutate its input", () => {
  const events = [cc7(0, 0, 80), ev(5, 0x90, 60, 100)];
  const copy = structuredClone(events);
  const out = applyLevels(events, { 0: 100 });
  assert.deepEqual(events, copy);
  assert.notEqual(out, events);
});

test("levelBytes is a CC7 message on the channel", () => {
  assert.deepEqual([...levelBytes(3, 100)], [0xb3, 7, 100]);
});

test("levelBytes clamps and rounds the value", () => {
  assert.deepEqual([...levelBytes(0, -5)], [0xb0, 7, 0]);
  assert.deepEqual([...levelBytes(0, 300)], [0xb0, 7, 127]);
  assert.deepEqual([...levelBytes(0, 99.6)], [0xb0, 7, 100]);
});

test("levelBytes rejects a channel outside 0..15", () => {
  assert.throws(() => levelBytes(16, 100), /channel 16 is out of range/);
  assert.throws(() => levelBytes(-1, 100), /channel -1 is out of range/);
});

test("parseLevels keeps valid non-default entries and ignores anything corrupt", () => {
  assert.deepEqual(parseLevels(null), {});
  assert.deepEqual(parseLevels("not json"), {});
  assert.deepEqual(parseLevels("[1,2]"), {});
  assert.deepEqual(parseLevels('{"0":80,"1":"loud","2":100,"16":50,"3":200,"4":-1,"5":64.5}'), { 0: 80 });
});
