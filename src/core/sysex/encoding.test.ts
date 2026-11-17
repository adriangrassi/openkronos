import { test } from "node:test";
import assert from "node:assert/strict";
import { binarySize, decode7, decodeSigned21, encode7, encodeSigned21, sysExSize } from "./encoding.ts";

const u8 = (...xs: number[]) => Uint8Array.from(xs);

test("encode7 puts the high bits of a group in one leading byte", () => {
  assert.deepEqual([...encode7(u8(0x80, 0x01))], [0x01, 0x00, 0x01]);
  assert.deepEqual([...encode7(u8(0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x81))], [0x41, 0, 0, 0, 0, 0, 0, 0x01]);
});

test("encode7 output is 7-bit and round-trips through decode7", () => {
  for (let n = 0; n < 40; n++) {
    const src = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 200) & 0xff);
    const wire = encode7(src);
    assert.ok(wire.every((b) => b < 0x80));
    assert.deepEqual([...decode7(wire)], [...src], `length ${n}`);
  }
});

test("sizes agree with the real encoded length", () => {
  for (let n = 0; n <= 500; n++) {
    const wire = encode7(new Uint8Array(n)).length;
    assert.equal(sysExSize(n), wire);
    assert.equal(binarySize(wire), n);
  }
});

test("decode7 rejects a lone trailing MS byte and bytes above 7F", () => {
  assert.throws(() => decode7(u8(0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)), RangeError);
  assert.throws(() => decode7(u8(0x00, 0x80)), RangeError);
});

test("signed 21-bit values use the top bit of the high byte as sign", () => {
  assert.deepEqual(encodeSigned21(-1), [0x7f, 0x7f, 0x7f]);
  assert.deepEqual(encodeSigned21(-1048576), [0x40, 0, 0]);
  assert.deepEqual(encodeSigned21(1048575), [0x3f, 0x7f, 0x7f]);
  for (const v of [-1048576, -129, -1, 0, 1, 129, 1048575]) {
    const [h, m, l] = encodeSigned21(v);
    assert.equal(decodeSigned21(h, m, l), v);
  }
});

test("signed 21-bit values outside the range are refused", () => {
  assert.throws(() => encodeSigned21(1048576), RangeError);
  assert.throws(() => encodeSigned21(-1048577), RangeError);
  assert.throws(() => encodeSigned21(1.5), RangeError);
});
