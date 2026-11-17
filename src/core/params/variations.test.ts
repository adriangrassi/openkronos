import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, isEnumerated, morph, mutate } from "./variations.ts";
import type { ParamTables, Row } from "./params.ts";

const row = (p: Partial<Row> & Pick<Row, "name" | "ofs">): Row => ({
  bitHi: null, bitLo: null, group: "Filter", rawMin: 0, rawMax: 99, fixed: false, valueText: "0~99", signed: false,
  continuation: false, parts: [[p.ofs, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...p,
});
const rows = [row({ name: "Cutoff", ofs: 30 }), row({ name: "Resonance", ofs: 31 }), row({ name: "Filter Decay", ofs: 32 }), row({ name: "LFO Speed", ofs: 33 }), row({ name: "Oscillator Mode", ofs: 34, rawMax: 3, list: "x" })];
const alg = (g: string, ofs: number) => row({ group: g, name: "Algorithm Type", ofs, rawMax: 9 });
const T = { programHd1: rows, programExiCommon: [alg("EXi1 Common", 36), alg("EXi2 Common", 37)] } as unknown as ParamTables;
const mk = (v: number) => { const e = new Uint8Array(40); rows.forEach((r) => (e[r.ofs] = v)); return e; };

test("mutate is seeded, bounded and leaves structural rows alone", () => {
  const e = mk(50), a = mutate(T, "hd1", e, 1, 5);
  assert.deepEqual(a, mutate(T, "hd1", e, 1, 5));
  assert.equal(a[34], 50);
  assert.deepEqual(mutate(T, "hd1", e, 0, 5), e);
  assert.throws(() => mutate(T, "hd1", e, 2, 5), RangeError);
  const c = candidates(T, "hd1", e, 0.5, 9);
  assert.notDeepEqual(c[0], c[1]);
});
test("morph blends numbers and switches choices at 50", () => {
  const a = mk(0), b = mk(100); b[34] = 3; a[34] = 1;
  assert.equal(morph(T, "hd1", a, b, 25)[30], 25);
  assert.equal(morph(T, "hd1", a, b, 49)[34], 1);
  assert.equal(morph(T, "hd1", a, b, 50)[34], 3);
  assert.equal(isEnumerated(rows[4]), true);
  assert.equal(isEnumerated(row({ name: "x", ofs: 1, rawMax: 1 })), true);
});
