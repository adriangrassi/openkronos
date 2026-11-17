import { test } from "node:test";
import assert from "node:assert/strict";
import { isWide, placeGraphs } from "./fx-place.ts";
import type { FxSection } from "../../../core/fx/desc.ts";
import type { FxGraphSpec } from "../../../core/fx/graphs.ts";

const sec = (title: string, n = 1, table = false): FxSection => ({
  title,
  lines: Array.from({ length: n }, (_, i) => ({ desc: { key: String(i), name: "p" + i, min: 0, max: 1, kind: "box" as const }, label: "p" + i, mods: [] })),
  ...(table ? { table: { title: "Band", cols: [], rows: [] } } : {}),
});
const g = (section: string): FxGraphSpec => ({ graph: "drive", section, drive: "Drive" });

test("placeGraphs puts a graph in its section and the rest on top", () => {
  const a = g("Parameters"), b = g("Nowhere");
  const r = placeGraphs([sec("Parameters"), sec("Output")], [a, b]);
  assert.deepEqual(r.top, [b]);
  assert.deepEqual(r.bySection.get("Parameters"), [a]);
  assert.equal(r.bySection.has("Output"), false);
});

test("placeGraphs keeps several graphs of one section in order", () => {
  const a = g("X"), b = g("X");
  assert.deepEqual(placeGraphs([sec("X")], [a, b]).bySection.get("X"), [a, b]);
});

test("isWide: table, graph, more than 10 lines, or Output", () => {
  assert.equal(isWide(sec("Parameters", 10), false), false);
  assert.equal(isWide(sec("Parameters", 11), false), true);
  assert.equal(isWide(sec("Parameters", 1, true), false), true);
  assert.equal(isWide(sec("Parameters", 1), true), true);
  assert.equal(isWide(sec("Output", 1), false), true);
});
