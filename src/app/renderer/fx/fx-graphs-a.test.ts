import { test } from "node:test";
import assert from "node:assert/strict";
import { peqPoints, geqBars, dynPoints, drivePoints } from "./fx-graphs-a.ts";
import type { FxGet, FxVal, FxGraphSpec } from "../../../core/fx/graphs.ts";

const v = (n: number, t = 0.5, text = String(n)): FxVal => ({ raw: n, n, t, text });
const getOf = (m: Record<string, FxVal>): FxGet => (name) => m[name];
const finite = (ps: { x: number; y: number }[]) => ps.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

type Peq = Extract<FxGraphSpec, { graph: "peq" }>;
const peqSpec: Peq = {
  graph: "peq", section: "P4EQ",
  bands: [
    { hz: "B1 Hz", gain: "B1 G", shape: "lowshelf", shapeRow: "B1 Type" },
    { hz: "B2 Hz", q: "B2 Q", gain: "B2 G", shape: "peak" },
  ],
};

test("peqPoints: finite, n points, highest at a positive band centre", () => {
  const get = getOf({ "B1 Hz": v(100), "B1 G": v(0), "B1 Type": v(0, 0, "Peaking"), "B2 Hz": v(1000), "B2 Q": v(2), "B2 G": v(12) });
  const { curve, dots } = peqPoints(peqSpec, get, 96);
  assert.equal(curve.length, 96);
  assert.ok(finite(curve) && finite(dots));
  const top = curve.reduce((a, b) => (b.y < a.y ? b : a)); // svg y grows downward
  const mid = dots[1];
  assert.ok(Math.abs(top.x - mid.x) < 4);
  assert.ok(Math.abs(top.y - mid.y) < 1.5);
});

test("peqPoints: shapeRow other than Shelving turns a shelf into a peak", () => {
  const m = { "B1 Hz": v(100), "B1 G": v(12), "B1 Type": v(0, 0, "Peaking"), "B2 Hz": v(1000), "B2 Q": v(2), "B2 G": v(0) };
  const peak = peqPoints(peqSpec, getOf(m), 96).curve;
  const shelf = peqPoints(peqSpec, getOf({ ...m, "B1 Type": v(1, 1, "Shelving") }), 96).curve;
  assert.ok(shelf[0].y < peak[0].y); // shelf still lifts 20 Hz more than a 100 Hz peak does
  assert.ok(shelf[0].y !== peak[0].y);
});

test("peqPoints: bands with missing values are skipped, still non-empty", () => {
  const { curve, dots } = peqPoints(peqSpec, getOf({}), 8);
  assert.equal(curve.length, 8);
  assert.equal(dots.length, 0);
});

test("geqBars: one bar per gain, zero line to gain", () => {
  const spec: Extract<FxGraphSpec, { graph: "geq" }> = { graph: "geq", section: "G", gains: ["a", "b", "c"] };
  const bars = geqBars(spec, getOf({ a: v(6), b: v(-6), c: v(0) }));
  assert.equal(bars.length, 3);
  assert.ok(bars[0].y1 < bars[0].y0 && bars[1].y1 > bars[1].y0 && bars[2].y1 === bars[2].y0);
  assert.ok(bars.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y1)));
});

type Dyn = Extract<FxGraphSpec, { graph: "dyn" }>;
test("dynPoints comp: finite, never above the 1:1 line", () => {
  const spec: Dyn = { graph: "dyn", section: "S", mode: "comp", threshold: "T", ratio: "R", knee: "K" };
  const { curve, diag, thr } = dynPoints(spec, getOf({ T: v(-24), R: v(4), K: v(6) }), 64);
  assert.equal(curve.length, 64);
  assert.ok(finite(curve) && finite(diag) && Number.isFinite(thr));
  curve.forEach((p, i) => assert.ok(p.y >= diag[i].y - 1e-9)); // svg y: larger = lower output
});

test("dynPoints limit without ratio: flat above the ceiling", () => {
  const spec: Dyn = { graph: "dyn", section: "S", mode: "limit", threshold: "T", ceiling: "C" };
  const { curve } = dynPoints(spec, getOf({ T: v(-20), C: v(-6) }), 64);
  const last = curve[curve.length - 1];
  const ceilY = dynPoints(spec, getOf({ T: v(-20), C: v(-6) }), 2).curve[1].y;
  assert.equal(last.y, ceilY);
  assert.ok(finite(curve));
});

test("dynPoints: ratio falls back to approxRatio(t) when n is null", () => {
  const spec: Dyn = { graph: "dyn", section: "S", mode: "comp", threshold: "T", ratio: "R" };
  const a = dynPoints(spec, getOf({ T: v(-30), R: { raw: 3, n: null, t: 0.5, text: "3" } }), 32).curve;
  const b = dynPoints(spec, getOf({ T: v(-30), R: v(2) }), 32).curve;
  assert.deepEqual(a, b); // approxRatio(0.5) = 2
});

test("drivePoints: finite, odd, monotonic", () => {
  const { curve } = drivePoints({ graph: "drive", section: "S", drive: "D" }, getOf({ D: v(50, 0.6) }), 41);
  assert.equal(curve.length, 41);
  assert.ok(finite(curve));
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].y <= curve[i - 1].y); // svg y falls as x rises
  const c = curve.length >> 1;
  assert.ok(Math.abs(curve[c - 5].y + curve[c + 5].y - 2 * curve[c].y) < 1e-9);
});
