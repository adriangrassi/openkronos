import assert from "node:assert/strict";
import { test } from "node:test";
import { differingSlots } from "./sendplan.ts";

const slots = (rows: number[][]) => (i: number) => Uint8Array.from(rows[i]);

test("identical banks have no differing slots", () => {
  const a = slots([[1, 2], [3, 4]]);
  assert.deepEqual(differingSlots(2, a, slots([[1, 2], [3, 4]])), []);
});

test("one changed byte returns that slot index only", () => {
  assert.deepEqual(differingSlots(3, slots([[1], [2], [3]]), slots([[1], [9], [3]])), [1]);
});

test("slots of different lengths count as different", () => {
  assert.deepEqual(differingSlots(2, slots([[1, 2], [5]]), slots([[1], [5]])), [0]);
});

test("all slots different returns every index", () => {
  assert.deepEqual(differingSlots(3, slots([[1], [2], [3]]), slots([[4], [5], [6]])), [0, 1, 2]);
});

test("a zero-slot bank returns nothing", () => {
  assert.deepEqual(differingSlots(0, slots([]), slots([])), []);
});
