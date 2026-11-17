import assert from "node:assert/strict";
import { test } from "node:test";
import { modeChangeBytes, modeFromMessage, modeRequestBytes } from "./modes.ts";

test("Mode Change and Mode Request bytes", () => {
  assert.deepEqual([...modeChangeBytes(7, 2)], [0xf0, 0x42, 0x32, 0x68, 0x4e, 7, 0xf7]);
  assert.deepEqual([...modeRequestBytes(0)], [0xf0, 0x42, 0x30, 0x68, 0x12, 0xf7]);
});

test("reads the mode from Mode Change and Mode Data only", () => {
  assert.equal(modeFromMessage(modeChangeBytes(9, 0)), 9);
  assert.equal(modeFromMessage(Uint8Array.of(0xf0, 0x42, 0x30, 0x68, 0x42, 4, 0, 0, 0, 0, 0xf7)), 4);
  assert.equal(modeFromMessage(Uint8Array.of(0xf0, 0x42, 0x30, 0x68, 0x24, 0, 0xf7)), null);
  assert.equal(modeFromMessage(Uint8Array.of(0xf0, 0x7e, 0x30, 0x68, 0x4e, 2, 0xf7)), null);
  assert.equal(modeFromMessage(Uint8Array.of(0x90, 60, 100)), null);
});
