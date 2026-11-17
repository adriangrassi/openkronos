import assert from "node:assert/strict";
import { test } from "node:test";
import type { Row } from "../params/params.ts";
import { panelsOf } from "./panels.ts";

const row = (ofs: number, group: string, name: string): Row => ({
  ofs, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax: 127, fixed: false, valueText: "~", signed: false,
  continuation: false, parts: [[ofs, 6, 0]], typ: null, soc: null, sub: null, pid: null, idx: null,
});
const make = (groups: string[], names: string[], first = 0): Row[] => groups.flatMap((g, i) => names.map((n, j) => row(first + i * 10 + j, g, n)));

test("one panel per group, in order of first appearance", () => {
  const p = panelsOf([...make(["A"], ["x", "y"]), ...make(["B"], ["z"], 100)]);
  assert.deepEqual(p.map((x) => x.title), ["A", "B"]);
  assert.ok(p.every((x) => x.kind === "rows"));
});

test("three or more groups with the same names become one table", () => {
  const names = ["Level", "Pan", "Mute"];
  const p = panelsOf([...make(["Audio Input"], ["Use"]), ...make(["Audio Input 1", "Audio Input 2", "S/PDIF L"], names, 50)]);
  assert.equal(p.length, 2);
  const t = p[1];
  assert.equal(t.kind, "table");
  if (t.kind === "table") {
    assert.deepEqual(t.cols, names);
    assert.deepEqual(t.lines.map((l) => l.label), ["Audio Input 1", "Audio Input 2", "S/PDIF L"]);
    assert.equal(t.lines[2].rows.length, 3);
    assert.equal(t.title, "Audio Input");
  }
});

test("two similar groups stay as panels", () => {
  const p = panelsOf(make(["A1", "A2"], ["Level", "Pan", "Mute"]));
  assert.deepEqual(p.map((x) => x.kind), ["rows", "rows"]);
});
