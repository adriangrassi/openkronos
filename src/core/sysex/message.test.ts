import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKorg, DEVICE_INQUIRY, parseDeviceInquiryReply, parseKorg } from "./message.ts";

const u8 = (...xs: number[]) => Uint8Array.from(xs);

test("buildKorg writes the Kronos envelope with the channel in the low nibble", () => {
  assert.deepEqual([...buildKorg(0, 0x72, [0, 0x40, 0, 5])], [0xf0, 0x42, 0x30, 0x68, 0x72, 0, 0x40, 0, 5, 0xf7]);
  assert.deepEqual([...buildKorg(15, 0x37, [0, 0x40])], [0xf0, 0x42, 0x3f, 0x68, 0x37, 0, 0x40, 0xf7]);
});

test("buildKorg refuses bad channels, functions and non-7-bit payload", () => {
  assert.throws(() => buildKorg(16, 0x37, []), RangeError);
  assert.throws(() => buildKorg(0, 0x80, []), RangeError);
  assert.throws(() => buildKorg(0, 0x73, [0x80]), RangeError);
});

test("parseKorg returns channel, function and payload of a complete message", () => {
  const p = parseKorg(u8(0xf0, 0x42, 0x35, 0x68, 0x24, 0x41, 0xf7));
  assert.ok(p);
  assert.equal(p.channel, 5);
  assert.equal(p.fn, 0x24);
  assert.deepEqual([...p.payload], [0x41]);
});

test("parseKorg returns null for other manufacturers, models, truncation and non-SysEx", () => {
  assert.equal(parseKorg(u8(0xf0, 0x41, 0x30, 0x68, 0x24, 0x00, 0xf7)), null);
  assert.equal(parseKorg(u8(0xf0, 0x42, 0x30, 0x50, 0x24, 0x00, 0xf7)), null);
  assert.equal(parseKorg(u8(0xf0, 0x42, 0x30, 0x68, 0x24, 0x00)), null);
  assert.equal(parseKorg(u8(0xf8)), null);
  // two messages glued together: the first F7 is inside the frame
  assert.equal(parseKorg(u8(0xf0, 0x42, 0x30, 0x68, 0x24, 0x00, 0xf7, 0x00, 0xf7)), null);
});

test("device inquiry request bytes", () => {
  assert.deepEqual([...DEVICE_INQUIRY], [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
});

test("device inquiry reply: family and member are 14-bit little-endian", () => {
  const r = parseDeviceInquiryReply(u8(0xf0, 0x7e, 0x00, 0x06, 0x02, 0x42, 0x68, 0x00, 0x17, 0x00, 0x03, 0x01, 0x02, 0x00, 0xf7));
  assert.ok(r);
  assert.deepEqual(Object.keys(r).sort(), ["channel", "family", "manufacturer", "member", "version"]);
  assert.equal(r.manufacturer, 0x42);
  assert.equal(r.family, 0x68);
  assert.equal(r.member, 0x17);
  assert.deepEqual(r.version, [3, 1, 2, 0]);
});

test("device inquiry reply: wrong length or wrong frame is null", () => {
  assert.equal(parseDeviceInquiryReply(u8(0xf0, 0x7e, 0x00, 0x06, 0x02, 0x42, 0x68, 0x00, 0x17, 0x00, 0x03, 0x01, 0x02, 0xf7)), null);
  assert.equal(parseDeviceInquiryReply(u8(0xf0, 0x42, 0x30, 0x68, 0x24, 0x00, 0xf7)), null);
});
