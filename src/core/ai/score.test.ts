import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSound } from "./score.ts";
import type { ParamTables, Row } from "../params/params.ts";

// Synthetic data only: two engines with made-up field positions.
const row = (p: Partial<Row>): Row => ({ ofs: 0, bitHi: null, bitLo: null, group: "", name: "", rawMin: 0, rawMax: 127, fixed: false, valueText: "", signed: false, continuation: false, parts: [[0, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...p });
const EXI = 4960;
const AL1: Row[] = [
  row({ group: "OSC", name: "Wave", ofs: 0, parts: [[0, 7, 0]] }),
  row({ group: "Filter", name: "Cutoff", ofs: 1, parts: [[1, 7, 0]] }),
  row({ group: "Amplifier EG", name: "Attack Time", ofs: 2, parts: [[2, 7, 0]] }),
  row({ group: "Amplifier EG", name: "Release Time", ofs: 3, parts: [[3, 7, 0]] }),
];
const CX3: Row[] = [row({ group: "Drawbar", name: "16'", ofs: 0, parts: [[0, 7, 0]] }), row({ group: "Drawbar", name: "8'", ofs: 1, parts: [[1, 7, 0]] })];
const T = {
  effectTypes: [],
  valueLists: {},
  programHd1: [row({ group: "OSC1 Filter", name: "Cutoff", ofs: 5, parts: [[5, 7, 0]] })],
  programExiCommon: [
    row({ group: "EXi1 Common", name: "Algorithm Type", ofs: 40, parts: [[40, 7, 0]], rawMax: 9 }),
    row({ group: "EXi2 Common", name: "Algorithm Type", ofs: 41, parts: [[41, 7, 0]], rawMax: 9 }),
  ],
  combi: [],
  global: [],
  drumkit: [],
  waveseq: [],
  engines: { "AL-1": AL1, "CX-3": CX3, "STR-1": [], "MS-20EX": [], PolysixEX: [], "MOD-7": [], "SGX-2": [], "EP-1": [] },
} as unknown as ParamTables;

// Engine numbers as Algorithm Type values: 2 = AL-1, 3 = CX-3, 0 = Off.
const sound = (engine: number, values: Partial<Record<number, number>> = {}): Uint8Array => {
  const e = new Uint8Array(EXI + 16);
  e[40] = engine;
  e[41] = 0;
  for (const [ofs, v] of Object.entries(values)) if (v !== undefined) e[Number(ofs) + 2908] = v;
  return e;
};
const base = sound(2, { 0: 40, 1: 60, 2: 6, 3: 30 });

test("identical sounds score exactly 100", () => {
  assert.equal(scoreSound(T, "exi", base, "exi", base).total, 100);
});

test("a changed setting lowers the score in its part only, and more change lowers it more", () => {
  const near = scoreSound(T, "exi", base, "exi", sound(2, { 0: 40, 1: 60, 2: 20, 3: 30 }));
  const far = scoreSound(T, "exi", base, "exi", sound(2, { 0: 40, 1: 60, 2: 90, 3: 30 }));
  assert.ok(near.total < 100);
  assert.ok(far.total < near.total);
  assert.equal(near.parts.engine, 100);
  assert.equal(near.parts.oscillators, 100);
});

test("a different engine scores low on engine and overall", () => {
  const s = scoreSound(T, "exi", base, "exi", sound(3, { 0: 40, 1: 60 }));
  assert.equal(s.parts.engine, 0);
  assert.ok(s.total <= 50);
});

test("a Program of another type scores low", () => {
  const h = scoreSound(T, "exi", base, "hd1", new Uint8Array(16));
  assert.ok(h.total < 60);
});
