import { test } from "node:test";
import assert from "node:assert/strict";
import { edgePoints, type RouteGraph, type RouteNode } from "./routing.ts";

const n = (id: string, x: number, y: number, w: number, h: number): RouteNode => ({ id, x, y, w, h, label: id });
const g = (nodes: RouteNode[], edges: RouteGraph["edges"]): RouteGraph => ({ w: 800, h: 400, nodes, edges });

function assertOrthogonal(pts: [number, number][]) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    assert.ok(ax === bx || ay === by, `segment ${i} is diagonal: ${JSON.stringify(pts)}`);
  }
}

test("chain edge leaves right-middle of from, runs out past both right edges, enters right-middle of to", () => {
  const a = n("a", 440, 6, 230, 17);
  const b = n("b", 440, 25, 230, 17);
  const gr = g([a, b], [{ from: "a", to: "b", kind: "chain" }]);
  const pts = edgePoints(gr, gr.edges[0]);
  assert.deepEqual(pts, [[670, 14.5], [680, 14.5], [680, 33.5], [670, 33.5]]);
  assertOrthogonal(pts);
});

test("source below target: up from top-middle of from, then into left-middle of to", () => {
  const src = n("src", 10, 246, 110, 18);
  const ifx = n("ifx1", 440, 6, 230, 17);
  const gr = g([src, ifx], [{ from: "src", to: "ifx1", kind: "main" }]);
  const pts = edgePoints(gr, gr.edges[0]);
  assert.deepEqual(pts, [[65, 246], [65, 14.5], [440, 14.5]]);
  assertOrthogonal(pts);
});

test("backward edge loops below both nodes between the two columns", () => {
  const a = n("a", 100, 0, 50, 20);
  const b = n("b", 0, 100, 50, 20);
  const gr = g([a, b], [{ from: "a", to: "b", kind: "dim" }]);
  const pts = edgePoints(gr, gr.edges[0]);
  assert.deepEqual(pts, [[150, 10], [170, 10], [170, 92], [-20, 92], [-20, 110], [0, 110]]);
  assertOrthogonal(pts);
});

test("default edge: horizontal run to the midpoint x, then vertical, then into left-middle of to", () => {
  const a = n("a", 0, 40, 60, 16);
  const b = n("b", 100, 20, 280, 50);
  const gr = g([a, b], [{ from: "a", to: "b", kind: "main" }]);
  const pts = edgePoints(gr, gr.edges[0]);
  assert.deepEqual(pts, [[60, 48], [80, 48], [80, 45], [100, 45]]);
  assertOrthogonal(pts);
});

test("every rule starts on the from border and ends on the to border", () => {
  const a = n("a", 0, 40, 60, 16);
  const b = n("b", 100, 20, 280, 50);
  const edge = { from: "a", to: "b", kind: "main" as const };
  const pts = edgePoints(g([a, b], [edge]), edge);
  assert.deepEqual(pts[0], [a.x + a.w, a.y + a.h / 2]);
  assert.deepEqual(pts[pts.length - 1], [b.x, b.y + b.h / 2]);
});
