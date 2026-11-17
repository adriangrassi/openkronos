import { test } from "node:test";
import assert from "node:assert/strict";
import { insertName, toRange } from "./insertName.ts";

test("insertName spaces a name from its neighbours and moves the caret after it", () => {
  assert.deepEqual(insertName("", 0, 0, "C4"), { text: "C4", caret: 2, from: 0, to: 2 });
  assert.deepEqual(insertName("bass below", 10, 10, "C3"), { text: "bass below C3", caret: 13, from: 11, to: 13 });
  assert.deepEqual(insertName("bass below  up", 11, 11, "C3"), { text: "bass below C3 up", caret: 13, from: 11, to: 13 });
  assert.equal(insertName("play XX now", 5, 7, "F#2").text, "play F#2 now");
});

test("toRange turns the first name into a low-to-high range, whichever key came first", () => {
  const first = insertName("bass on", 7, 7, "C2"); // "bass on C2"
  const up = toRange(first.text, first.from, first.to, { name: "C2", note: 48 }, { name: "C3", note: 60 });
  assert.deepEqual(up, { text: "bass on C2 to C3", caret: 16 });
  const down = toRange(first.text, first.from, first.to, { name: "C2", note: 48 }, { name: "C1", note: 36 });
  assert.equal(down.text, "bass on C1 to C2");
  assert.equal(toRange(first.text, first.from, first.to, { name: "C2", note: 48 }, { name: "C2", note: 48 }).text, "bass on C2");
});
