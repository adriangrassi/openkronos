import { test } from "node:test";
import assert from "node:assert/strict";
import { stateBlocks } from "./stateBlocks.ts";

test("unsaved is amber with a count, idle at zero, and differs is only shown after a Check keyboard", () => {
  const none = stateBlocks({ unsaved: 0, fileName: "a.PCG", differs: null });
  assert.deepEqual(none.map((b) => [b.id, b.tone]), [["unsaved", "idle"]]);
  const one = stateBlocks({ unsaved: 1, fileName: "a.PCG", differs: null });
  assert.equal(one[0].tone, "warn");
  assert.equal(one[0].title, "1 unsaved change");
  assert.equal(one[0].sub, "Not saved to a.PCG");
  assert.equal(stateBlocks({ unsaved: 3, fileName: "", differs: null })[0].title, "3 unsaved changes");
});

test("a Check keyboard result is amber when it differs and green when it matches", () => {
  assert.equal(stateBlocks({ unsaved: 0, fileName: "a", differs: true })[1].tone, "warn");
  assert.equal(stateBlocks({ unsaved: 0, fileName: "a", differs: false })[1].tone, "ok");
});
