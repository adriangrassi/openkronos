import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyFilter, fuzzyScore } from "./fuzzy.ts";

test("subsequence, case, blank query", () => {
  assert.notEqual(fuzzyScore("sve", "Save As"), null);
  assert.equal(fuzzyScore("vsx", "Save As"), null);
  assert.equal(fuzzyScore("saves", "Save"), null);
  assert.equal(fuzzyScore("   ", "anything"), 0);
});

test("ranking: consecutive and word start beat scattered", () => {
  assert.ok((fuzzyScore("sav", "Save") ?? 0) > (fuzzyScore("sav", "Set A Value") ?? 0));
  assert.ok((fuzzyScore("sa", "Save") ?? 0) > (fuzzyScore("sa", "Undo Save") ?? 0));
  assert.deepEqual(fuzzyFilter("sa", ["Redo", "Undo Save", "Save As", "Save"], (s) => s), ["Save", "Save As", "Undo Save"]);
});

test("filter keeps order on ties and honours the limit", () => {
  assert.deepEqual(fuzzyFilter("", ["b", "a"], (s) => s), ["b", "a"]);
  assert.deepEqual(fuzzyFilter("a", ["a1", "a2", "a3"], (s) => s, 2), ["a1", "a2"]);
});
