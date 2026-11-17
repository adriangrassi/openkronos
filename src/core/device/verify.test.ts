import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParamTables, Row } from "../params/params.ts";
import { compareEditBuffer, soundName } from "./verify.ts";

const mk = (ofs: number, group: string, name: string, extra: Partial<Row> = {}): Row => ({
  ofs, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax: 255, fixed: false, valueText: "", signed: false, continuation: false,
  parts: [[ofs, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...extra,
});
const rows = [mk(30, "Master Effect1", "L Delay Time"), mk(31, "Master Effect1", "Level"), mk(32, "", "", { continuation: true })];
const T = { programHd1: rows, programExiCommon: [], combi: [], valueLists: {} } as unknown as ParamTables;
const entry = (n: number) => new Uint8Array(n);

test("identical buffers are equal", () => {
  const a = entry(40);
  const r = compareEditBuffer(a, Uint8Array.from(a), T, "hd1");
  assert.equal(r.equal, true);
  assert.deepEqual(r.differing, []);
});

test("a differing named row is listed with both values", () => {
  const a = entry(40);
  const b = Uint8Array.from(a);
  a[30] = 100;
  b[30] = 7;
  const r = compareEditBuffer(a, b, T, "hd1");
  assert.equal(r.equal, false);
  assert.equal(r.differing.length, 1);
  assert.deepEqual({ ...r.differing[0] }, { name: "L Delay Time", group: "Master Effect1", sent: r.differing[0].sent, got: r.differing[0].got });
  assert.notEqual(r.differing[0].sent, r.differing[0].got);
  assert.equal(r.unknownBytes, 0);
});

test("a byte no row names counts as unknown, and a size difference is reported", () => {
  const a = entry(40);
  const b = Uint8Array.from(a);
  b[35] = 1;
  const r = compareEditBuffer(a, b, T, "hd1");
  assert.equal(r.equal, false);
  assert.equal(r.unknownBytes, 1);
  const s = compareEditBuffer(a, entry(38), T, "hd1");
  assert.equal(s.equal, false);
  assert.equal([s.sizeSent, s.sizeGot].join(), "40,38");
});

test("the differing list is capped at 20", () => {
  const many = Array.from({ length: 30 }, (_, i) => mk(i, "G", `P${i}`));
  const t = { ...T, programHd1: many } as unknown as ParamTables;
  const r = compareEditBuffer(entry(40), Uint8Array.from({ length: 40 }, () => 1), t, "hd1");
  assert.equal(r.differing.length, 20);
  assert.equal(r.more, 10);
});

test("soundName reads the 24 byte name field", () => {
  const e = entry(40);
  [..."Warm Pad"].forEach((c, i) => (e[i] = c.charCodeAt(0)));
  assert.equal(soundName(e), "Warm Pad");
});
