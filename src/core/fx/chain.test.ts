import { test } from "node:test";
import assert from "node:assert/strict";
import { chainPaths } from "./chain.ts";

const G = { rows: 12, top: 20, pitch: 30, x: 10, step: 4 };
const ys = (p: [number, number][]) => p.map((q) => q[1]);

test("adjacent link: row 1 to row 2 hooks out and back at the row centres", () => {
  const [l] = chainPaths([{ from: 1, to: 2, on: true }], G);
  assert.deepEqual(l.points, [[10, 35], [14, 35], [14, 65], [10, 65]]);
  assert.equal(l.pointsAttr, "10,35 14,35 14,65 10,65");
});

test("links that are off, out of range or point backwards are dropped", () => {
  const links = [{ from: 1, to: 2, on: false }, { from: 0, to: 2, on: true }, { from: 3, to: 13, on: true }, { from: 5, to: 4, on: true }, { from: 6, to: 6, on: true }];
  assert.deepEqual(chainPaths(links, G), []);
});

test("a longer span bulges further out so nested links do not overlap", () => {
  const [a, b] = chainPaths([{ from: 1, to: 2, on: true }, { from: 1, to: 4, on: true }], G);
  assert.equal(a.points[1][0], 14);
  assert.equal(b.points[1][0], 22);
  assert.deepEqual(ys(b.points), [35, 35, 125, 125]);
});

test("every segment is horizontal or vertical", () => {
  for (const l of chainPaths([{ from: 2, to: 9, on: true }], G)) for (let i = 1; i < l.points.length; i++) assert.ok(l.points[i][0] === l.points[i - 1][0] || l.points[i][1] === l.points[i - 1][1]);
});
