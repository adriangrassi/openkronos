import { test } from "node:test";
import assert from "node:assert/strict";
import { groupDescs } from "../fx/desc.ts";
import { specNames } from "../fx/graphs.ts";
import { kronosFxDescs } from "./fx-kronos.ts";
import { kronosFxGraphs } from "./fx-kronos-family.ts";

const TYPES = 198;
const MUST_HAVE_GRAPH = [11, 12, 13, 2, 3, 5, 8, 27, 28, 100, 101, 107, 77, 79, 81, 85, 93, 95, 40, 48, 51, 61, 63, 109, 141, 149];
const NO_GRAPH = [0, 1, 4, 9, 10, 14, 26, 29, 32, 33, 34, 35, 38, 39, 186, 192, 197];

test("all 198 effect types resolve without throwing", () => {
  assert.equal(kronosFxDescs(TYPES - 1).length > 0, true);
  for (let id = 0; id < TYPES; id++) assert.ok(Array.isArray(kronosFxGraphs(id)), `type ${id}`);
});

test("every graph names only parameters of its own type, in a real section", () => {
  for (let id = 0; id < TYPES; id++) {
    const descs = kronosFxDescs(id);
    const names = new Set(descs.map((d) => d.name));
    const titles = new Set(groupDescs(descs).map((s) => s.title));
    for (const g of kronosFxGraphs(id)) {
      for (const n of specNames(g)) assert.ok(names.has(n), `type ${id}: missing "${n}"`);
      assert.ok(titles.has(g.section), `type ${id}: section "${g.section}"`);
    }
  }
});

test("spec-named types get a graph", () => {
  for (const id of MUST_HAVE_GRAPH) assert.ok(kronosFxGraphs(id).length > 0, `type ${id}`);
});

test("types without a family get no graph", () => {
  for (const id of NO_GRAPH) assert.deepEqual(kronosFxGraphs(id), [], `type ${id}`);
});

test("141 P4EQ // P4EQ gets one EQ spec per effect section", () => {
  const eq = kronosFxGraphs(141).filter((g) => g.graph === "peq").map((g) => g.section);
  assert.deepEqual(eq, ["Effect1", "Effect2"]);
});

test("pinned type ids per graph kind", () => {
  const ids = (kind: string) => {
    const hit: number[] = [];
    for (let id = 0; id < TYPES; id++) if (kronosFxGraphs(id).some((g) => g.graph === kind)) hit.push(id);
    return hit.join(",");
  };
  assert.equal(ids("peq"), "11,13,109,110,111,112,113,117,121,141,142,143,144,145,146,147,148,149");
  assert.equal(ids("geq"), "12");
  assert.equal(ids("dyn"), "2,3,5,6,7,8");
  assert.equal(ids("drive"), "27,28,30,31,36,37,116,130,131,132,133,145,153,160,166,171,172,173,174,175");
  assert.equal(ids("decay"), "100,101,102,103,104,105,106,107,108,140");
  assert.equal(ids("taps"), "77,78,79,80,81,82,83,84,85,91,92,93,94,95,96,97,113,120,124,129,133,138,149,157,164,170,175,179,182,184");
  assert.equal(ids("lfo"), "40,41,42,48,49,51,52,55,56,61,62,63,72,111,112,118,119,122,123,127,128,131,132,137,138,139,147,148,155,156,162,163,168,169,173,174,177,178,181,182,184");
});

test("results are memoised per type", () => {
  assert.equal(kronosFxGraphs(11), kronosFxGraphs(11));
});
