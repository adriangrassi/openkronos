import { test } from "node:test";
import assert from "node:assert/strict";
import { digest } from "./digest.ts";

const row = (id: string, name: string, to = "1") => ({ id, name, to });

test("groups are deduped, in first-touched order, and parameters counted once", () => {
  const d = digest([row("1", "Filter / Cutoff"), row("2", "Amp / Level"), row("3", "Filter / Resonance"), row("1", "Filter / Cutoff")]);
  assert.equal(d.groups, "Filter, Amp");
  assert.equal(d.count, 3);
});

test("an Effect Type change shows the type name", () => {
  assert.equal(digest([row("9", "Insert Effect1 / Effect Type", "Stereo Chorus"), row("10", "Insert Effect1 / Wet")]).groups, "Insert Effect1 (Stereo Chorus)");
});

test("more than 6 groups are capped with +N more", () => {
  const rows = "ABCDEFGHI".split("").map((g, i) => row(String(i), `${g} / x`));
  assert.equal(digest(rows).groups, "A, B, C, D, E, F, +3 more");
});
