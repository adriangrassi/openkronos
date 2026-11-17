import assert from "node:assert/strict";
import { test } from "node:test";
import { arcDeg, detentOf, dialTicks, encoderTip, faderCapTop, faderTicks, knurlPath, radialAt } from "./face.ts";

const count = (d: string): number => (d.match(/M/g) ?? []).length;

test("a dial has n + 1 marks, the long ones every fifth", () => {
  const t = dialTicks(32, 32, 28.5, 10, 5, 2.5, 4.5);
  assert.equal(count(t.long), 3);
  assert.equal(count(t.short), 8);
});

test("the first dial mark is at 7 o'clock and the middle one straight up", () => {
  const t = dialTicks(0, 0, 10, 10, 5, 2, 4);
  assert.match(t.long, /^M-7\.07 7\.07L-9\.9 9\.9/);
  assert.ok(t.long.includes("M0 -10L0 -14"));
});

test("fader marks run top to bottom and grow leftwards from x", () => {
  const t = faderTicks(9, 12, 112, 10, 5, 4, 6);
  assert.equal(count(t.long) + count(t.short), 11);
  assert.ok(t.long.startsWith("M3 12L9 12"));
  assert.ok(t.long.endsWith("M3 112L9 112"));
});

test("the cap is at the bottom at the minimum, the top at the maximum, and clamps outside the range", () => {
  assert.equal(faderCapTop(0, 100, 24), 76);
  assert.equal(faderCapTop(1, 100, 24), 0);
  assert.equal(faderCapTop(0.5, 100, 24), 38);
  assert.equal(faderCapTop(2, 100, 24), 0);
  assert.equal(faderCapTop(-1, 100, 24), 76);
  assert.equal(faderCapTop(0.5, 10, 24), 0);
});

test("the encoder tip sweeps from 7 o'clock to 5 o'clock and clamps", () => {
  assert.deepEqual(encoderTip(10, 10, 5, 0.5), [10, 5]);
  assert.deepEqual(encoderTip(10, 10, 5, 0), encoderTip(10, 10, 5, -3));
  assert.deepEqual(encoderTip(10, 10, 5, 1), encoderTip(10, 10, 5, 9));
  assert.ok(encoderTip(10, 10, 5, 0)[0] < 10 && encoderTip(10, 10, 5, 1)[0] > 10);
});

test("a knurl is n evenly spaced radial lines, the first one straight up", () => {
  const d = knurlPath(0, 0, 10, 12, 4);
  assert.equal(count(d), 4);
  assert.ok(d.startsWith("M0 -10L0 -12"));
  assert.ok(d.includes("M10 0L12 0"));
});

test("a radial mark sits at the sweep's start, middle and end and stays inside the sweep when clamped", () => {
  assert.deepEqual(radialAt(0, 0, 4, 6, 0.5), { x1: 0, y1: -4, x2: 0, y2: -6 });
  const lo = radialAt(0, 0, 4, 6, 0), hi = radialAt(0, 0, 4, 6, 1);
  assert.ok(lo.x1 < 0 && hi.x1 > 0 && lo.y1 > 0 && hi.y1 > 0);
  assert.deepEqual(radialAt(0, 0, 4, 6, -2), lo);
  assert.deepEqual(radialAt(0, 0, 4, 6, 2), hi);
});

test("the detent of a bipolar dial is its zero, clamped, and a unipolar dial has none", () => {
  assert.equal(detentOf(null), null);
  assert.equal(detentOf(0.5), 0.5);
  assert.equal(detentOf(1.4), 1);
});

test("a cap edge arc names its end points and takes the long way over 180 degrees", () => {
  assert.equal(arcDeg(0, 0, 10, 0, 90), "M0 -10A10 10 0 0 1 10 0");
  assert.match(arcDeg(0, 0, 10, 0, 200), /A10 10 0 1 1/);
});
