import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePcg } from "./pcg.ts";
import { PADS_PER_PAGE, copySlot, editSlot, padOf, readSlot, slotAt, stepSlot } from "./setlist.ts";

test("pad and slot arithmetic round-trips", () => {
  for (let s = 0; s < 128; s++) { const { page, pad } = padOf(s); assert.equal(slotAt(page, pad), s); }
  assert.equal(PADS_PER_PAGE, 16);
  assert.throws(() => slotAt(8, 0));
});

test("stepSlot stops at both ends", () => {
  assert.equal(stepSlot(127, 1), 127);
  assert.equal(stepSlot(0, -1), 0);
  assert.equal(stepSlot(15, 1), 16);
});

test("editSlot renames a slot and copySlot duplicates one", () => {
  const f = parsePcg(new Uint8Array(readFileSync(new URL("../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG", import.meta.url))));
  editSlot(f, 0, 3, { name: "Piano X", volume: 90, comment: "hi" });
  assert.equal(readSlot(f, 0, 3).name, "Piano X");
  copySlot(f, 0, 3, 40);
  const a = readSlot(f, 0, 3), b = readSlot(f, 0, 40);
  assert.deepEqual({ ...b, slot: 3 }, a);
  assert.throws(() => editSlot(f, 0, 3, { name: "x".repeat(25) }));
});
