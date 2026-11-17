import { test } from "node:test";
import assert from "node:assert/strict";
import { sameBytes } from "./bytes.ts";

const old = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

test("sameBytes agrees with the element-wise compare for aligned, offset, odd-length and differing buffers", () => {
  const base = Uint8Array.from({ length: 4099 }, (_, i) => (i * 31) & 255);
  const views: [Uint8Array, Uint8Array][] = [
    [base, base.slice()],
    [base.subarray(0, 4096), base.slice(0, 4096)],
    [base.subarray(1, 4098), base.slice(1, 4098)], // unaligned views
    [base.subarray(0, 4099), base.slice(0, 4099)], // tail of 3 bytes
    [base, base.subarray(0, 4098)],
    [new Uint8Array(0), new Uint8Array(0)],
  ];
  for (const [a, b] of views) assert.equal(sameBytes(a, b), old(a, b));
  for (const at of [0, 1, 2, 3, 4, 2048, 4095, 4096, 4097, 4098]) {
    const b = base.slice();
    b[at] ^= 1;
    assert.equal(sameBytes(base, b), false, `byte ${at}`);
    assert.equal(sameBytes(base.subarray(1), b.subarray(1)), old(base.subarray(1), b.subarray(1)), `offset view, byte ${at}`);
  }
});
