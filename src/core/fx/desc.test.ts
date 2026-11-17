import { test } from "node:test";
import assert from "node:assert/strict";
import { descText, descNumber, descPos, groupDescs, type ParamDesc } from "./desc.ts";

const d = (over: Partial<ParamDesc> & { name: string }): ParamDesc => ({
  key: over.name,
  min: 0,
  max: 10,
  kind: "box",
  ...over,
});

test("descText: texts override beats values, values beat ends, ends beat String", () => {
  const t = d({ name: "T", min: -39, max: 0, texts: { [-39]: "-Inf" } });
  assert.equal(descText(t, -39), "-Inf");
  assert.equal(descText(t, -38), "-38");
  const v = d({ name: "V", min: 0, max: 2, kind: "pick", values: ["A", "B", "C"], texts: { 0: "Z" } });
  assert.equal(descText(v, 0), "Z");
  assert.equal(descText(v, 1), "B");
  const e = d({ name: "E", min: 0, max: 5, ends: ["Low", "High"] });
  assert.equal(descText(e, 0), "Low");
  assert.equal(descText(e, 5), "High");
  assert.equal(descText(e, 2), "2");
});

test("descText: scale only when exact; non-exact scale falls through to String", () => {
  const exact = d({ name: "S", min: 0, max: 100, scale: { lo: 0, hi: 10, decimals: 1, exact: true } });
  assert.equal(descText(exact, 50), "5.0");
  const loose = d({ name: "L", min: 0, max: 10, scale: { lo: 0, hi: 1, decimals: 2, exact: false }, ends: ["a", "b"] });
  assert.equal(descText(loose, 5), "5");
  assert.equal(descText(loose, 10), "b");
});

test("descText: k formatting with kUnder10k and the 10k+ rule", () => {
  const k = d({ name: "K", min: 0, max: 98, scale: { lo: 20, hi: 1000, decimals: 0, kUnder10k: 2, exact: true } });
  assert.equal(descText(k, 98), "1.00k");
  assert.equal(descText(k, 50), "520");
  const big = d({ name: "B", min: 0, max: 100, scale: { lo: 0, hi: 20000, decimals: 0, kUnder10k: 2, exact: true } });
  assert.equal(descText(big, 50), "10.0k");
});

test("descText: plus sign only for positive values", () => {
  const p = d({ name: "P", min: 0, max: 24, scale: { lo: -12, hi: 12, decimals: 0, plus: true, exact: true } });
  assert.equal(descText(p, 18), "+6");
  assert.equal(descText(p, 6), "-6");
  assert.equal(descText(p, 12), "0");
});

test("descNumber gives the scale value even when not exact; null without scale", () => {
  const loose = d({ name: "N", min: 0, max: 10, scale: { lo: 0, hi: 1, decimals: 2, exact: false } });
  assert.equal(descNumber(loose, 5), 0.5);
  assert.equal(descNumber(d({ name: "X" }), 5), null);
});

test("descPos is linear and 0 for a single-value range", () => {
  assert.equal(descPos(d({ name: "A", min: 0, max: 10 }), 5), 0.5);
  assert.equal(descPos(d({ name: "A", min: 3, max: 3 }), 3), 0);
});

test("groupDescs: fixed rows dropped and mods pair with the named host", () => {
  const out = groupDescs([
    d({ name: "Cutoff" }),
    d({ name: "Cutoff Mod.Source", kind: "pick" }),
    d({ name: "Cutoff Mod.Intensity" }),
    d({ name: "Q" }),
    d({ name: "Hidden", kind: "fixed" }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].lines.map((l) => l.label), ["Cutoff", "Q"]);
  assert.deepEqual(out[0].lines[0].mods.map((m) => m.name), ["Cutoff Mod.Source", "Cutoff Mod.Intensity"]);
  assert.deepEqual(out[0].lines[1].mods, []);
});

test("groupDescs: a mod with no named host goes to the nearest previous line", () => {
  const out = groupDescs([d({ name: "Drive" }), d({ name: "Gain" }), d({ name: "Tone Mod.Source", kind: "pick" })]);
  const gain = out[0].lines.find((l) => l.label === "Gain");
  assert.deepEqual(gain?.mods.map((m) => m.name), ["Tone Mod.Source"]);
});

test("groupDescs: prefixed types put unprefixed rows in Output, Input or Common", () => {
  const out = groupDescs([
    d({ name: "(P4EQ) Gain" }),
    d({ name: "Common Level" }),
    d({ name: "(Effect1) Pan" }),
    d({ name: "Wet/Dry" }),
    d({ name: "Input Trim" }),
  ]);
  assert.deepEqual(out.map((s) => s.title), ["Input", "P4EQ", "Common", "Effect1", "Output"]);
  assert.deepEqual(out[1].lines.map((l) => l.label), ["Gain"]);
  assert.deepEqual(out[3].lines.map((l) => l.label), ["Pan"]);
});

test("groupDescs: unprefixed types use the name rules", () => {
  const out = groupDescs([
    d({ name: "LFO Type" }),
    d({ name: "Pre LEQ Cutoff" }),
    d({ name: "Side Cutoff" }),
    d({ name: "Envelope Attack" }),
    d({ name: "Other" }),
    d({ name: "Wet/Dry" }),
  ]);
  assert.deepEqual(out.map((s) => s.title), ["LFO", "Pre EQ", "Side Chain", "Envelope", "Parameters", "Output"]);
});

test("groupDescs: Band rows with 2+ numbers become a table with ordered cols and null holes", () => {
  const out = groupDescs([
    d({ name: "Input Trim" }),
    d({ name: "Band1 Type" }),
    d({ name: "Band1 Cutoff" }),
    d({ name: "Band1 Q" }),
    d({ name: "Band1 Gain" }),
    d({ name: "Band2 Type" }),
    d({ name: "Band2 Cutoff" }),
    d({ name: "Band2 Q" }),
    d({ name: "Band2 Gain" }),
    d({ name: "Band3 Type" }),
    d({ name: "Band3 Cutoff" }),
    d({ name: "Band3 Q" }),
    d({ name: "Band3 Gain" }),
    d({ name: "Band4 Type" }),
    d({ name: "Band4 Cutoff" }),
    d({ name: "Band4 Q" }),
    d({ name: "Band4 Gain" }),
    d({ name: "Wet/Dry" }),
  ]);
  assert.deepEqual(out.map((s) => s.title), ["Input", "Parameters", "Output"]);
  const t = out[1].table;
  assert.ok(t);
  assert.equal(t.title, "Band");
  assert.deepEqual(t.cols, ["Type", "Cutoff", "Q", "Gain"]);
  assert.deepEqual(t.rows.map((r) => r.label), ["Band1", "Band2", "Band3", "Band4"]);
  assert.ok(t.rows.every((r) => r.cells.length === 4 && r.cells.every((c) => c !== null)));
  assert.deepEqual(out[1].lines, []);
});

test("groupDescs: a missing table cell is null; a lone numbered row stays a line", () => {
  const holes = groupDescs([d({ name: "Tap1 Time" }), d({ name: "Tap2 Time" }), d({ name: "Tap2 Level" })]);
  const t = holes[0].table;
  assert.ok(t);
  assert.deepEqual(t.cols, ["Time", "Level"]);
  assert.equal(t.rows[0].cells[1], null);
  assert.notEqual(t.rows[1].cells[1], null);
  const lone = groupDescs([d({ name: "Band1 Gain" })]);
  assert.equal(lone[0].table, undefined);
  assert.equal(lone[0].lines.length, 1);
});
