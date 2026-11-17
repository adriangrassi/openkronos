import { test } from "node:test";
import assert from "node:assert/strict";
import { editorKeys } from "./editorKeys.ts";

test("the editor's sibling panels never share a key", () => {
  const k = editorKeys("combi:INT-D", 4);
  assert.equal(new Set(Object.values(k)).size, 4);
  assert.notEqual(editorKeys("combi:INT-D", 4).effects, editorKeys("combi:INT-D", 5).effects);
});
