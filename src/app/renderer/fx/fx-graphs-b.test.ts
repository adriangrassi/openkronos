import { test } from "node:test";
import assert from "node:assert/strict";
import { decayPoints, tapsPoints, lfoPoints } from "./fx-time-points.ts";
import type { FxGet, FxVal } from "../../../core/fx/graphs.ts";

const v = (raw: number, n: number | null, t: number, text = String(raw)): FxVal => ({ raw, n, t, text });
const getOf = (m: Record<string, FxVal>): FxGet => (name) => m[name];
const finite = (pts: [number, number][]) => pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

test("decay: finite points, damp and early optional", () => {
  const get = getOf({ T: v(20, 2, 0.2), P: v(10, 50, 0.1), D: v(5, null, 0.5) });
  const a = decayPoints({ graph: "decay", section: "S", time: "T", preDelay: "P" }, get, 64);
  assert.ok(a.curve.length > 10 && finite(a.curve));
  assert.equal(a.damp, undefined);
  assert.equal(a.spikes.length, 0);
  const b = decayPoints({ graph: "decay", section: "S", time: "T", damp: "D", early: true }, get, 64);
  assert.ok(b.damp && finite(b.damp));
  assert.equal(b.spikes.length, 8);
});

test("taps: one line per tap, 3 echoes only with feedback", () => {
  const spec = { graph: "taps" as const, section: "S", taps: [{ label: "L", time: "L" }, { label: "R", time: "R", level: "RL" }], feedback: "F" };
  const m = { L: v(1, 200, 0.2), R: v(2, 400, 0.4), RL: v(50, null, 0.5), F: v(30, null, 0.3) };
  const a = tapsPoints(spec, getOf(m));
  assert.equal(a.lines.length, 2);
  assert.equal(a.echoes.length, 3);
  assert.ok(a.echoes.every((e) => e.x > a.lines[1].x));
  assert.equal(tapsPoints(spec, getOf({ ...m, F: v(0, null, 0) })).echoes.length, 0);
  assert.equal(tapsPoints({ ...spec, feedback: undefined }, getOf(m)).echoes.length, 0);
});

test("taps: BPM MIDI uses tempo, else its own value", () => {
  const spec = { graph: "taps" as const, section: "S", taps: [{ label: "T1", note: "N", times: "X" }], bpm: "B" };
  const get = (b: FxVal) => getOf({ N: v(6, null, 0.6, "1/4"), X: v(1, 1, 0), B: b });
  const ms = (b: FxVal, tempo?: number) => tapsPoints(spec, get(b), tempo).lines[0].ms;
  assert.equal(ms(v(3999, null, 0, "MIDI"), 120), 500);
  assert.equal(ms(v(6000, 60, 0, "60.00"), 120), 1000);
  assert.equal(tapsPoints(spec, get(v(3999, null, 0, "MIDI")), 120).lines[0].caption, "1/4 x1");
});

test("lfo: second curve only with phase", () => {
  const get = getOf({ W: v(0, null, 0, "Triangle"), Sh: v(0, 0, 0.5), Ph: v(90, 90, 0.25), F: v(5, null, 0.1, "1.20") });
  const a = lfoPoints({ graph: "lfo", section: "S", wave: "W", shape: "Sh", freq: "F" }, get, 64);
  assert.ok(finite(a.main) && a.main.length === 64);
  assert.equal(a.second, undefined);
  assert.equal(a.caption, "1.20");
  const b = lfoPoints({ graph: "lfo", section: "S", wave: "W", phase: "Ph" }, get, 64);
  assert.ok(b.second && finite(b.second));
  assert.notDeepEqual(b.second, b.main);
  const s = lfoPoints({ graph: "lfo", section: "S", wave: "W", sync: "Sy", note: "N", times: "X" },
    getOf({ W: v(0, null, 0, "Sine"), Sy: v(1, null, 1, "On"), N: v(6, null, 0, "1/8"), X: v(3, 3, 0) }), 8);
  assert.equal(s.caption, "Sync: 1/8 x3");
});

test("taps: echo height follows the signed feedback's magnitude", () => {
  const spec = { graph: "taps" as const, section: "S", taps: [{ label: "L", time: "L" }], feedback: "F" };
  const echo = (f: FxVal) => tapsPoints(spec, getOf({ L: v(1, 200, 0.2), F: f })).echoes.map((e) => e.y1);
  // -100..+100 row: raw -100 sits at t 0, +100 at t 1, +50 at 0.75, -50 at 0.25
  assert.deepEqual(echo(v(-100, -100, 0)), echo(v(100, 100, 1)));
  assert.deepEqual(echo(v(-50, -50, 0.25)), echo(v(50, 50, 0.75)));
  const [a, b] = [echo(v(50, 50, 0.75)), echo(v(100, 100, 1))];
  assert.ok(a[0] > b[0], "half feedback gives a shorter first echo (smaller y1 is taller)");
});

test("decay: a freshly reset type (time 0) still gives finite points", () => {
  const a = decayPoints({ graph: "decay", section: "S", time: "T" }, getOf({ T: v(0, 0, 0) }), 64);
  assert.ok(finite(a.curve) && Number.isFinite(a.xMax));
});
