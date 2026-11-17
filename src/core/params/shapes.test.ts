import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCurve, filterFromPointer, keyTrackCurve, vectorFromPointer, vectorUnit, type Vector } from "./shapes.ts";
import type { Row } from "./params.ts";

const row = (name: string) => ({ name, rawMin: -127, rawMax: 127 }) as Row;

test("filter curves stay in 0..1 and the low pass falls", () => {
  for (const t of [0, 1, 2, 3]) {
    const c = filterCurve(t, 50, 99, 64);
    assert.equal(c.length, 64);
    assert.ok(c.every((y) => Number.isFinite(y) && y >= 0 && y <= 1));
  }
  const lp = filterCurve(0, 50, 0, 100);
  assert.ok(lp[0] > lp[99] + 0.3);
});

test("keyboard track is flat outside the keys and linear between them", () => {
  const p = { lowKey: 36, centerKey: 60, highKey: 84, lowRamp: -100, centerLowRamp: 0, centerHighRamp: 0, highRamp: 100, intensity: 99 };
  const y = keyTrackCurve(p);
  assert.equal(y.length, 88);
  assert.ok(Math.abs(y[48 - 21] - -50) < 1e-9);
  assert.equal(y[0], -100);
});

test("vector units round trip through the writes", () => {
  assert.equal(vectorUnit(0), 0.5);
  const pts = Array.from({ length: 5 }, (_, i) => ({ x: row(`(${i}) Position X`), y: row(`(${i}) Position Y`) }));
  const v: Vector = { group: "Vector Control", points: pts };
  const w = vectorFromPointer(v, 2, 1, 0);
  assert.deepEqual(w.map((x) => x.value), [127, -127]);
  assert.throws(() => vectorFromPointer(v, 5, 0, 0));
});

test("pointer to cutoff and resonance writes only what changed", () => {
  const f = { cutoff: { name: "Cutoff", rawMin: 0, rawMax: 99 } as Row, resonance: { name: "Resonance", rawMin: 0, rawMax: 99 } as Row };
  assert.deepEqual(filterFromPointer(f, { cutoff: 50, resonance: 74 }, 0.5, 0.25), []);
  assert.deepEqual(filterFromPointer(f, { cutoff: 50, resonance: 20 }, 0.5, 0.25).map((w) => w.value), [74]);
});
