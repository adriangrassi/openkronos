import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMacro, applyMacros, changedSettings, macrosFor, MACRO_NAMES } from "./macros.ts";
import { readParam, type ParamTables, type Row } from "../params/params.ts";

// Synthetic rows only: no KORG data. Each field is one byte, and the offsets are arbitrary.
const row = (p: Partial<Row> & Pick<Row, "name" | "ofs">): Row => ({
  bitHi: null, bitLo: null, group: "G", rawMin: 0, rawMax: 99, fixed: false, valueText: "0~99", signed: false,
  continuation: false, parts: [[p.ofs, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...p,
});

const hd1: Row[] = [
  row({ group: "OSC1 Filter A", name: "Cutoff", ofs: 0 }),
  row({ group: "OSC1 Amplifier EG", name: "Attack Time", ofs: 1 }),
  row({ group: "OSC1 Amplifier EG", name: "Release Time", ofs: 2 }),
  row({ group: "OSC1 Amplifier", name: "Level", ofs: 3, rawMax: 127, valueText: "0~127" }),
  row({ group: "OSC1 Drive", name: "Drive", ofs: 4 }),
  row({ group: "Insert Effect1", name: "Send1", ofs: 5, rawMax: 127 }),
  row({ group: "Insert Effect1", name: "Effect Type", ofs: 6 }),
  row({ group: "OSC1 Output", name: "Panpot Mod.Intensity", ofs: 7, rawMin: -99, rawMax: 99, signed: true, valueText: "-99~+99" }),
];

const tables: ParamTables = {
  effectTypes: [], valueLists: {}, programHd1: hd1, programExiCommon: [], combi: [], global: [], drumkit: [], waveseq: [],
  engines: { "AL-1": [], "CX-3": [], "STR-1": [], "MS-20EX": [], PolysixEX: [], "MOD-7": [], "SGX-2": [], "EP-1": [] },
};

const entry = () => new Uint8Array(16).fill(0).map((_, i) => (i === 0 ? 40 : 10));
const macro = (ms: ReturnType<typeof macrosFor>, name: string) => ms.find((m) => m.name === name)!;

test("the eight macros come in the gate's order, and each names real editable settings", () => {
  const ms = macrosFor(tables, "hd1", entry());
  assert.deepEqual(ms.map((m) => m.name), [...MACRO_NAMES]);
  assert.deepEqual(macro(ms, "Brightness").targets.map((t) => t.row.name), ["Cutoff"]);
  assert.deepEqual(macro(ms, "Attack").targets.map((t) => t.row.name), ["Attack Time"]);
  for (const m of ms) for (const t of m.targets) assert.notEqual(t.row.name, "Effect Type");
});

test("a move changes each target by its amount, rounded, and leaves other bits alone", () => {
  const ms = macrosFor(tables, "hd1", entry());
  const base = entry();
  const out = applyMacro(base, macro(ms, "Drive"), 10);
  assert.equal(readParam(out, hd1[4]), 20);
  assert.deepEqual(Array.from(out).filter((_, i) => i !== 4), Array.from(base).filter((_, i) => i !== 4));
});

test("a move clamps to the range and never changes its input", () => {
  const ms = macrosFor(tables, "hd1", entry());
  const base = entry();
  const copy = Uint8Array.from(base);
  const up = applyMacro(copy, macro(ms, "Body"), 1000);
  const dn = applyMacro(copy, macro(ms, "Body"), -1000);
  assert.deepEqual(copy, base);
  assert.equal(readParam(up, hd1[3]), 127);
  assert.equal(readParam(dn, hd1[3]), 0);
});

test("a macro at zero changes nothing, and a move and its reverse cancel", () => {
  const ms = macrosFor(tables, "hd1", entry());
  const base = entry();
  assert.deepEqual(applyMacro(base, macro(ms, "Release"), 0), base);
  const there = applyMacro(base, macro(ms, "Release"), 2);
  assert.deepEqual(applyMacro(there, macro(ms, "Release"), -2), base);
});

test("several moves read from the same input, so they do not compound", () => {
  const ms = macrosFor(tables, "hd1", entry());
  const base = entry();
  const both = applyMacros(base, [{ macro: macro(ms, "Brightness"), delta: 5 }, { macro: macro(ms, "Attack"), delta: 5 }]);
  assert.equal(readParam(both, hd1[0]), 45);
  assert.equal(readParam(both, hd1[1]), 15);
  assert.deepEqual(applyMacros(base, [{ macro: macro(ms, "Brightness"), delta: 5 }]), applyMacro(base, macro(ms, "Brightness"), 5));
});

test("changedSettings names the settings whose values differ", () => {
  const ms = macrosFor(tables, "hd1", entry());
  const base = entry();
  const after = applyMacro(base, macro(ms, "Attack"), 10);
  assert.deepEqual(changedSettings(base, after, ms), ["OSC1 Amplifier EG / Attack Time"]);
  assert.deepEqual(changedSettings(base, base, ms), []);
});
