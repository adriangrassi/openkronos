import assert from "node:assert/strict";
import { test } from "node:test";
import { angleOf, dragPos, dragValue, fracOf, resetValue, valueAtFrac, wheelNotch, wheelValue, arcPath, stepValue } from "./dial.ts";

test("value maps to a fraction and an angle across the 270 degree sweep", () => {
  assert.equal(fracOf(0, 0, 127), 0);
  assert.equal(fracOf(127, 0, 127), 1);
  assert.equal(angleOf(0, 0, 100), -135);
  assert.equal(angleOf(50, 0, 100), 0);
  assert.equal(angleOf(100, 0, 100), 135);
  assert.equal(fracOf(5, 5, 5), 0);
});

test("fraction maps back to a clamped whole value", () => {
  assert.equal(valueAtFrac(0.5, -99, 99), 0);
  assert.equal(valueAtFrac(2, 0, 10), 10);
  assert.equal(valueAtFrac(-1, 0, 10), 0);
});

test("dragging up raises the value, shift is finer, result stays in range", () => {
  assert.equal(dragValue(50, 30, 0, 100, false), 80);
  assert.equal(dragValue(50, -30, 0, 100, false), 20);
  assert.equal(dragValue(50, 80, 0, 100, true), 60);
  assert.equal(dragValue(95, 500, 0, 100, false), 100);
});

test("wheel nudges one step against the scroll direction", () => {
  assert.equal(wheelValue(10, -100, 0, 127), 11);
  assert.equal(wheelValue(10, 100, 0, 127), 9);
  assert.equal(wheelValue(0, 100, 0, 127), 0);
});

test("an arrow press steps by 1, by 10 with Shift, and stops at the range ends", () => {
  assert.equal(stepValue(10, 1, false, 0, 127), 11);
  assert.equal(stepValue(10, -1, false, 0, 127), 9);
  assert.equal(stepValue(10, 1, true, 0, 127), 20);
  assert.equal(stepValue(125, 1, true, 0, 127), 127);
  assert.equal(stepValue(-98, -1, true, -99, 99), -99);
  assert.equal(stepValue(99, 1, false, 0, 99), 99);
});

test("arc path is empty for no sweep and a single M..A for a sweep", () => {
  assert.equal(arcPath(40, 40, 30, 0.3, 0.3), "");
  assert.match(arcPath(40, 40, 30, 0, 1), /^M [\d.-]+ [\d.-]+ A 30 30 0 1 1 [\d.-]+ [\d.-]+$/);
});

test("a relative drag accumulates a fractional position and Shift changes only the rate", () => {
  let pos = 50;
  pos = dragPos(pos, 10, 0, 100, false);
  assert.equal(pos, 60);
  pos = dragPos(pos, 8, 0, 100, true);
  assert.equal(Math.round(pos), 61);
  assert.equal(pos, 61);
  assert.equal(dragPos(99, 500, 0, 100, false), 100);
  assert.equal(dragPos(1, -500, 0, 100, false), 0);
  assert.equal(dragPos(100, -10, 0, 100, false), 90);
});

test("a wheel notch is 1 on a narrow range, wider on a wide one, 1 with Shift, and reads the horizontal axis Shift produces", () => {
  assert.equal(wheelNotch(10, 0, -100, 0, 127, false), 11);
  assert.equal(wheelNotch(10, 0, 100, 0, 127, false), 9);
  assert.equal(wheelNotch(1000, 0, -100, 0, 16383, false), 1128);
  assert.equal(wheelNotch(1000, 0, -100, 0, 16383, true), 1001);
  assert.equal(wheelNotch(10, -100, 0, 0, 127, true), 11);
  assert.equal(wheelNotch(10, 0, 0, 0, 127, false), 10);
  assert.equal(wheelNotch(127, 0, -100, 0, 127, false), 127);
});

test("reset goes to the saved value, kept inside the range", () => {
  assert.equal(resetValue(64, 0, 127), 64);
  assert.equal(resetValue(200, 0, 127), 127);
  assert.equal(resetValue(-5, -3, 3), -3);
});
