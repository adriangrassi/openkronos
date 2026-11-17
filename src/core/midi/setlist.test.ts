import { test } from "node:test";
import assert from "node:assert/strict";
import { setListSelectBytes } from "./setlist.ts";

test("setListSelectBytes: Bank MSB 0, Bank LSB = set, Program Change = slot, on the given channel", () => {
  assert.deepEqual(setListSelectBytes(5, 100, 14).map((m) => [...m]), [[0xbe, 0x00, 0x00], [0xbe, 0x20, 0x05], [0xce, 0x64]]);
  assert.deepEqual(setListSelectBytes(127, 127, 0).map((m) => [...m]), [[0xb0, 0x00, 0x00], [0xb0, 0x20, 0x7f], [0xc0, 0x7f]]);
  assert.throws(() => setListSelectBytes(128, 0, 0));
  assert.throws(() => setListSelectBytes(0, 0, 16));
});
