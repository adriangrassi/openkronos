// Synthetic tables and pages only: no KORG data.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParamTables, Row } from "../params/params.ts";
import { screensFor, type PageMap } from "./view.ts";

const row = (ofs: number, group: string, name: string, over: Partial<Row> = {}): Row => ({
  ofs, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax: 127, fixed: false, valueText: "~", signed: false,
  continuation: false, parts: [[ofs, 6, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...over,
});
const ENG_BASE = 2908; // matches ENGINE_BASE[0] in params.ts

const tables: ParamTables = {
  effectTypes: [],
  valueLists: {},
  programHd1: [
    row(0, "Common", "Volume"),
    row(1, "Common", "Name", { continuation: true }),
    row(2, "OSC1 Amplifier EG", "Attack Level"),
    row(3, "OSC1 Amplifier EG", "Attack Time"),
    row(4, "Loose", "Orphan"), // in no page: must land on More
    row(5, "KARMA Common", "Tempo", { fixed: true }),
    row(6, "Mode", "Switch", { rawMax: 1 }),
  ],
  programExiCommon: [
    row(0, "EXi1 Common", "Algorithm Type", { parts: [[0, 3, 0]], rawMax: 9 }),
    row(1, "EXi2 Common", "Algorithm Type", { parts: [[1, 3, 0]], rawMax: 9 }),
    row(2, "Common", "Volume"),
  ],
  combi: [row(0, "Timbre1", "Volume"), row(1, "Timbre1", "Pan")],
  global: [],
  drumkit: [],
  waveseq: [],
  engines: {
    "AL-1": [row(0, "OSC", "Wave"), row(1, "", "", { continuation: true })],
    "CX-3": [], "STR-1": [], "MS-20EX": [], PolysixEX: [], "MOD-7": [], "SGX-2": [], "EP-1": [],
  },
};

const pages: PageMap = {
  program: {
    hd1: [
      { page: "P0", title: "Play", tabs: [] },
      { page: "P4", title: "Amp/EQ", tabs: [{ id: "4-3", title: "Amp1 EG", groups: ["OSC1 Amplifier EG"] }] },
      { page: "P1", title: "Basic", tabs: [{ id: "1-1", title: "Common", groups: ["Common"] }, { id: "1-2", title: "Mode", params: ["Mode/Switch"] }] },
    ],
    exiCommon: [{ page: "P0", title: "Play", tabs: [{ id: "0-1", title: "Main", groups: ["EXi1 Common", "EXi2 Common", "Common"] }] }],
    engines: {
      "AL-1": [{ page: "P4", title: "OSC", tabs: [{ id: "4-1", title: "OSC", groups: ["OSC"] }] }],
      "CX-3": [],
    },
  },
  combi: [{ page: "P0", title: "Play", tabs: [{ id: "0-1", title: "Timbre", params: ["Timbre1/Volume"] }] }],
};

const entry = (algo1: number, algo2 = 0): Uint8Array => {
  const e = new Uint8Array(4960);
  e[0] = algo1;
  e[1] = algo2;
  e[ENG_BASE] = 0;
  return e;
};

test("only hd1, exi and combi have keyboard screens", () => {
  for (const t of ["drumkit", "waveseq", "global"] as const) assert.equal(screensFor(pages, tables, t, entry(0)), null);
});

test("hd1 pages keep their order, drop empty pages and list rows by group", () => {
  const s = screensFor(pages, tables, "hd1", entry(0));
  assert.ok(s);
  assert.deepEqual(s.map((p) => p.page), ["P4", "P1"]);
  const amp = s[0].tabs[0];
  assert.equal(amp.id, "4-3");
  assert.deepEqual(amp.rows.map((r) => r.name), ["Attack Level", "Attack Time"]);
});

test("params entries match group/name and continuation rows never show", () => {
  const s = screensFor(pages, tables, "hd1", entry(0))!;
  const mode = s[1].tabs.find((t) => t.id === "1-2")!;
  assert.deepEqual(mode.rows.map((r) => r.name), ["Switch"]);
  const all = s.flatMap((p) => p.tabs.flatMap((t) => t.rows));
  assert.ok(all.every((r) => !r.continuation));
});

test("editable settings no tab shows land on More on the last page", () => {
  const s = screensFor(pages, tables, "hd1", entry(0))!;
  const last = s[s.length - 1];
  const more = last.tabs.find((t) => t.id === "more");
  assert.ok(more);
  assert.deepEqual(more.rows.map((r) => r.name), ["Orphan"]);
  const fixedShown = s.flatMap((p) => p.tabs.flatMap((t) => t.rows)).some((r) => r.name === "Tempo");
  assert.equal(fixedShown, false);
});

test("exi shows common pages then the engine pages of each slot, with prefixed groups", () => {
  const s = screensFor(pages, tables, "exi", entry(2, 0))!;
  assert.deepEqual(s.map((p) => `${p.slot ?? 0}:${p.page}:${p.engine ?? ""}`), ["0:P0:", "1:P4:AL-1"]);
  const osc = s[1].tabs[0].rows;
  assert.deepEqual(osc.map((r) => r.group), ["EXi1 AL-1: OSC"]);
});

test("an Off engine adds no engine pages, and a slot with no pages adds none", () => {
  const s = screensFor(pages, tables, "exi", entry(0, 0))!;
  assert.ok(s.every((p) => p.engine === undefined));
  const cx = screensFor(pages, tables, "exi", entry(3, 0))!;
  assert.ok(cx.every((p) => p.engine === undefined));
});

test("combi: a setting on no tab goes to More, and no tab repeats a setting", () => {
  const s = screensFor(pages, tables, "combi", entry(0))!;
  for (const p of s) for (const t of p.tabs) {
    const keys = t.rows.map((r) => `${r.ofs}.${r.bitLo ?? 0}`);
    assert.equal(new Set(keys).size, keys.length, `${p.page} ${t.id} repeats`);
  }
  assert.deepEqual(s[0].tabs[0].rows.map((r) => r.name), ["Volume"]);
  assert.equal(s[0].tabs.some((t) => t.id === "more" && t.rows.length), true);
});
