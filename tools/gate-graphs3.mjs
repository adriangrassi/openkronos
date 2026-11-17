// Acceptance gate for the filter response, Keyboard Track and Vector graphs. Owned by the architect: builders must not edit it.
//
// PURE EXPORTS of src/core/params/shapes.ts (Row = a params.json row, Write = { row: Row, value: number } as in graphs.ts):
//   findFilters(rows: Row[]): { group: string, type: Row, cutoff: Row, resonance: Row }[]
//       every group that has Filter Type, Cutoff and Resonance (non-continuation rows), in table order.
//   filterCurve(type: number, cutoff: number, resonance: number, n: number): number[]
//       n points, low to high frequency on a log-like axis, each in [0,1] (1 = loudest). type: 0 Low Pass, 1 High Pass, 2 Band Pass, 3 Band Reject.
//       cutoff and resonance are raw values 0..99; out of range or NaN inputs are clamped, never NaN. The knee/peak sits at
//       index round(cutoff / 99 * (n - 1)). Same inputs give the same output.
//   filterFromPointer(f: {cutoff: Row, resonance: Row}, cur: {cutoff: number, resonance: number}, fx: number, fy: number): Write[]
//       fx, fy are 0..1 across the plot (fx 0 = left, fy 0 = top). cutoff = round(fx * rawMax), resonance = round((1 - fy) * rawMax),
//       both clamped to the row's range. Returns only the writes whose value differs from cur (empty when nothing changes).
//   findKeyTracks(rows: Row[]): { group, lowKey, centerKey, highKey, lowRamp, centerLowRamp, centerHighRamp, highRamp: Row, intensity: Row | null }[]
//       every group that has Low Ramp, Center Low Ramp, Center High Ramp and High Ramp. intensity is the "Keyboard Track" row of
//       "<OSCn> Filter A" for a group named "<OSCn> Filter Keyboard Track" and null for every other group (null counts as 99).
//   keyTrackCurve(p: { lowKey, centerKey, highKey, lowRamp, centerLowRamp, centerHighRamp, highRamp, intensity: number }, n?: number): number[]
//       n defaults to 88: index 0 is MIDI note 21 (A0), index 87 is note 108 (C8). Value at note m: linear from (lowKey, lowRamp) to
//       (centerKey, centerLowRamp) for lowKey <= m < centerKey; linear from (centerKey, centerHighRamp) to (highKey, highRamp) for
//       centerKey <= m <= highKey; flat at lowRamp below lowKey and at highRamp above highKey; all multiplied by intensity / 99.
//   findVector(rows: Row[]): { group: string, points: { x: Row, y: Row }[] } | null
//       the "Vector Control" group's five points, from "(0) Position X" / "(0) Position Y" up to (4); null if the rows have no such group.
//   vectorUnit(raw: number): number
//       -127..127 maps to 0..1, clamped.
//   vectorFromPointer(v: {points: {x: Row, y: Row}[]}, index: number, ux: number, uy: number): Write[]
//       ux, uy 0..1 (ux 0 = left, uy 0 = bottom, i.e. +Y is up). raw = round(u * 254 - 127), clamped to -127..127.
//       Returns the two writes for that point (X then Y); throws on an index outside 0..4.
//
// data-testid names (all in the parameter editor, shown above the parameter list of the matching group, in the style of lfo-graph):
//   graphs3-filter            filter response graph, shown on a group that findFilters returns (e.g. "OSC1 Filter A")
//   graphs3-filter-curve      the curve; its "points" or "d" attribute changes when cutoff, resonance or type change
//   graphs3-filter-handle     the draggable handle at (cutoff, resonance); right = higher cutoff, up = more resonance
//   graphs3-filter-caption    text containing "shape, not a measurement"
//   graphs3-keytrack          Keyboard Track curve, shown on a group findKeyTracks returns
//   graphs3-keytrack-line     the line across 88 keys; "points" or "d" attribute changes with the ramps
//   graphs3-keytrack-caption  text containing "shape, not a measurement"
//   graphs3-vector            XY view, shown on the "Vector Control" group
//   graphs3-vector-point-0 .. graphs3-vector-point-4   draggable points; right = +X, up = +Y
//   graphs3-vector-caption    text containing "shape, not a measurement"
// Test-only env vars: none beyond the ones launch() in gate-kit.mjs already sets (KRONOS_E2E, KRONOS_E2E_OPEN, KRONOS_E2E_SAVE, KRONOS_E2E_BACKUP_DIR).
import assert from "node:assert/strict";
import { gate, core, launch, load, onlyBits, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("GRAPHS3"), { check, finish } = g, C = await core(g), { T, P, L, Q, raw, parsed } = C;
let S; try { S = await load("src/core/params/shapes.ts"); } catch (e) { g.fails.push(`cannot load shapes.ts: ${e.message}`); await finish(); }
const f = parsed(), rows = T.programHd1, near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);
const groups = (need) => { const m = new Map(); for (const r of rows) if (!r.continuation) { if (!m.has(r.group)) m.set(r.group, new Set()); m.get(r.group).add(r.name); } return [...m].filter(([, s]) => need.every((n) => s.has(n))).map(([k]) => k); };
const FILT = groups(["Filter Type", "Cutoff", "Resonance"]), KT = groups(["Low Ramp", "Center Low Ramp", "Center High Ramp", "High Ramp"]);
const argmax = (a) => a.indexOf(Math.max(...a)), argmin = (a) => a.indexOf(Math.min(...a));
const knee = (a) => a.findIndex((y) => y < a[0] - 0.15);
const nm = (w) => Object.fromEntries(w.map(({ row, value }) => [row.name, value]));

await check("filters, key tracks and the vector group are found from the real tables", () => {
  assert.deepEqual(S.findFilters(rows).map((x) => x.group), FILT); for (const n of ["OSC1 Filter A", "OSC2 Filter B"]) assert.ok(FILT.includes(n), n);
  const a = S.findFilters(rows)[0]; assert.equal(a.type.name, "Filter Type"); assert.equal(a.cutoff.name, "Cutoff"); assert.equal(a.resonance.name, "Resonance");
  const k = S.findKeyTracks(rows); assert.deepEqual(k.map((x) => x.group), KT); assert.ok(KT.length >= 6);
  for (const x of k) { const fk = /^(OSC\d) Filter Keyboard Track$/.exec(x.group); if (fk) { assert.equal(x.intensity.group, `${fk[1]} Filter A`); assert.equal(x.intensity.name, "Keyboard Track"); } else assert.equal(x.intensity, null, x.group); }
  const v = S.findVector(rows); assert.equal(v.group, "Vector Control"); assert.equal(v.points.length, 5); assert.equal(v.points[3].y.name, "(3) Position Y"); assert.equal(S.findVector(T.combi).points.length, 5); /* combi tables also carry a Vector Control group */
});
await check("each filter type has its own shape", () => {
  const lp = S.filterCurve(0, 50, 50, 100), hp = S.filterCurve(1, 50, 50, 100), bp = S.filterCurve(2, 50, 50, 100), br = S.filterCurve(3, 50, 50, 100);
  for (const c of [lp, hp, bp, br]) { assert.equal(c.length, 100); assert.ok(c.every((y) => Number.isFinite(y) && y >= 0 && y <= 1)); }
  assert.ok(lp[0] > lp[99] + 0.3, "low pass falls"); assert.ok(hp[99] > hp[0] + 0.3, "high pass rises");
  assert.ok(Math.abs(argmax(bp) - 50) <= 3 && bp[50] > bp[0] + 0.2 && bp[50] > bp[99] + 0.2, "band pass peaks at the cutoff"); assert.ok(Math.abs(argmin(br) - 50) <= 3 && br[50] < br[0] - 0.2 && br[50] < br[99] - 0.2, "band reject dips at the cutoff");
});
await check("cutoff moves the knee and resonance raises the peak", () => {
  const a = knee(S.filterCurve(0, 30, 0, 100)), b = knee(S.filterCurve(0, 70, 0, 100)); assert.ok(a > 0 && b > a + 20, `knees ${a} ${b}`);
  assert.ok(S.filterCurve(0, 50, 99, 100)[50] > S.filterCurve(0, 50, 0, 100)[50] + 0.05, "resonance peak"); const hr = argmax(S.filterCurve(1, 40, 99, 100)); assert.ok(hr >= 35 && hr <= 45, `high pass peak at ${hr}`);
  assert.deepEqual(S.filterCurve(0, 33, 44, 64), S.filterCurve(0, 33, 44, 64)); assert.equal(S.filterCurve(2, 10, 10, 7).length, 7);
});
await check("odd inputs never give a broken curve", () => { for (const [t, c, r] of [[0, -5, 500], [1, 500, -9], [2, NaN, NaN], [3, 1e9, 1e9], [99, 50, 50], [-1, 50, 50]]) { const y = S.filterCurve(t, c, r, 50); assert.equal(y.length, 50); assert.ok(y.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `${t} ${c} ${r}`); } });
await check("every filter in the factory sounds can be drawn", () => {
  let n = 0; const fl = S.findFilters(rows);
  for (const b of L.listBanks(f).filter((x) => x.kind === "program" && x.type !== "exi")) for (let i = 0; i < b.count; i += 11) { const e = L.getEntry(f, b.key, i); for (const x of fl) { const y = S.filterCurve(Q.readParam(e, x.type), Q.readParam(e, x.cutoff), Q.readParam(e, x.resonance), 64); n++; assert.ok(y.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `${b.key}/${i} ${x.group}`); } }
  assert.ok(n > 100, `only ${n} curves`); return `${n} curves`;
});
await check("a pointer position becomes exactly the right cutoff and resonance", () => {
  const x = S.findFilters(rows)[0], cur = { cutoff: 10, resonance: 10 };
  assert.deepEqual(nm(S.filterFromPointer(x, cur, 0.5, 0.25)), { Cutoff: 50, Resonance: 74 }); assert.deepEqual(nm(S.filterFromPointer(x, cur, 2, -1)), { Cutoff: 99, Resonance: 99 }); assert.deepEqual(nm(S.filterFromPointer(x, { cutoff: 50, resonance: 50 }, -3, 9)), { Cutoff: 0, Resonance: 0 });
  assert.deepEqual(S.filterFromPointer(x, { cutoff: 50, resonance: 74 }, 0.5, 0.25), [], "nothing changed, nothing written"); assert.deepEqual(nm(S.filterFromPointer(x, { cutoff: 50, resonance: 20 }, 0.5, 0.25)), { Resonance: 74 });
});
await check("the Keyboard Track line follows ramps, keys and intensity", () => {
  const p = { lowKey: 36, centerKey: 60, highKey: 84, lowRamp: -100, centerLowRamp: 0, centerHighRamp: 0, highRamp: 100, intensity: 99 }, y = S.keyTrackCurve(p), at = (c, m) => c[m - 21];
  assert.equal(y.length, 88); near(at(y, 21), -100, "below low key"); near(at(y, 36), -100, "low key"); near(at(y, 48), -50, "halfway"); near(at(y, 60), 0, "center"); near(at(y, 84), 100, "high key"); near(at(y, 108), 100, "above high key");
  const s = S.keyTrackCurve({ ...p, centerLowRamp: -20, centerHighRamp: 40 }); near(at(s, 59), -100 + (23 / 24) * 80, "just below center"); near(at(s, 60), 40, "a step at the center key");
  assert.ok(S.keyTrackCurve({ ...p, intensity: 0 }).every((v) => v === 0), "no intensity, flat"); near(at(S.keyTrackCurve({ ...p, intensity: 50 }), 84), 100 * 50 / 99, "half intensity"); near(at(S.keyTrackCurve({ ...p, intensity: -99 }), 84), -100, "negative flips"); assert.equal(S.keyTrackCurve(p, 12).length, 12);
});
await check("Vector positions map to the XY square and back, clamped", () => {
  near(S.vectorUnit(-127), 0, "min"); near(S.vectorUnit(0), 0.5, "mid"); near(S.vectorUnit(127), 1, "max"); near(S.vectorUnit(999), 1, "clamp hi"); near(S.vectorUnit(-999), 0, "clamp lo");
  const v = S.findVector(rows); assert.deepEqual(nm(S.vectorFromPointer(v, 2, 1, 0)), { "(2) Position X": 127, "(2) Position Y": -127 }); assert.deepEqual(nm(S.vectorFromPointer(v, 4, 0.5, 0.5)), { "(4) Position X": 0, "(4) Position Y": 0 }); assert.deepEqual(nm(S.vectorFromPointer(v, 0, 9, -9)), { "(0) Position X": 127, "(0) Position Y": -127 });
  assert.deepEqual(S.vectorFromPointer(v, 1, 0.75, 0.25).map((x) => x.row.name), ["(1) Position X", "(1) Position Y"]); assert.throws(() => S.vectorFromPointer(v, 5, 0, 0)); assert.throws(() => S.vectorFromPointer(v, -1, 0, 0));
});
await testsAndTypes(g, ["core/params/shapes.test.ts"]);
if (g.fails.length) await finish();

// A program with a mid-range filter and vector point 1 so that drags have room to move in both directions.
const fa = S.findFilters(rows).find((x) => x.group === "OSC1 Filter A"), vec = S.findVector(rows), KEY = "program:INT-B";
const room = (v, lo, hi) => v >= lo && v <= hi;
const ktg = S.findKeyTracks(rows).find((x) => x.group === "OSC1 Amplifier Keyboard Track");
// Point 1 must not sit under another point, or a drag grabs the wrong one. Looser tiers: no program in the factory file has every value mid-range, so fall back tier by tier. The keytrack line must not be flat.
const tiers = [[10, 60, 80], [5, 90, 100], [1, 98, 110], [1, 98, 120], [0, 98, 120]];
let SLOT = -1; for (const [lo, hi, vm] of tiers) { for (let i = 0; i < 128 && SLOT < 0; i++) { const e = L.getEntry(f, KEY, i); if (room(Q.readParam(e, fa.cutoff), lo, hi) && room(Q.readParam(e, fa.resonance), lo, hi) && room(Q.readParam(e, vec.points[1].x), -vm, vm) && room(Q.readParam(e, vec.points[1].y), -vm, vm) && vec.points.every((q, j) => j === 1 || Q.readParam(e, q.x) !== Q.readParam(e, vec.points[1].x) || Q.readParam(e, q.y) !== Q.readParam(e, vec.points[1].y)) && [ktg.lowRamp, ktg.centerLowRamp, ktg.centerHighRamp, ktg.highRamp].some((r) => Q.readParam(e, r) !== 0)) SLOT = i; } }
assert.ok(SLOT >= 0, "no usable fixture slot in program:INT-B");
const entry = L.getEntry(f, KEY, SLOT), kt = S.findKeyTracks(rows).find((x) => x.group === "OSC1 Amplifier Keyboard Track");
const ui = await launch(g, C), { win, X, seen, text, until, editSlot, closeEditor, saved, drag } = ui;
const back = async () => { await X("undo").click(); await new Promise((r) => setTimeout(r, 300)); assert.equal(sha(await saved()), sha(raw), "not back to the original"); };
const geom = (id) => X(id).evaluate((e) => e.getAttribute("points") ?? e.getAttribute("d")), pos = async (id) => { const b = await X(id).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const log = () => win.evaluate(() => window.__kronosE2E.midiLog()), CAP = /shape, not a measurement/i, rd = async (r) => Q.readParam(L.getEntry(P.parsePcg(await saved()), KEY, SLOT), r);
await ui.openFile();
await editSlot(KEY, SLOT);
await check("a filter page shows the response curve and says it is a shape", async () => { await X("group-OSC1 Filter A").click(); await seen("graphs3-filter"); await seen("graphs3-filter-curve"); await seen("graphs3-filter-handle"); assert.match(await text("graphs3-filter-caption"), CAP); assert.equal(await X("graphs3-keytrack").count(), 0); assert.equal(await X("graphs3-vector").count(), 0); });
await check("dragging the handle changes only cutoff and resonance, in one undo", async () => {
  const c0 = await geom("graphs3-filter-curve"), h0 = await pos("graphs3-filter-handle"); await drag("graphs3-filter-handle", 60, -30);
  const h1 = await pos("graphs3-filter-handle"); assert.ok(h1.x > h0.x && h1.y < h0.y, "handle did not follow"); assert.notEqual(await geom("graphs3-filter-curve"), c0, "curve did not change");
  const after = L.getEntry(P.parsePcg(await saved()), KEY, SLOT); assert.ok(Q.readParam(after, fa.cutoff) > Q.readParam(entry, fa.cutoff), "cutoff did not rise"); assert.ok(Q.readParam(after, fa.resonance) > Q.readParam(entry, fa.resonance), "resonance did not rise");
  onlyBits(after, entry, [...fa.cutoff.parts, ...fa.resonance.parts]); await back();
});
await check("dragging past the edge stops at the limits, and a plain click writes nothing", async () => {
  await drag("graphs3-filter-handle", 4000, -4000); assert.equal(await rd(fa.cutoff), fa.cutoff.rawMax); assert.equal(await rd(fa.resonance), fa.resonance.rawMax); await back();
  await drag("graphs3-filter-handle", 0, 0); assert.equal(sha(await saved()), sha(raw), "a click changed the file");
});
await check("the response follows a typed filter type", async () => {
  const k = `${fa.type.ofs}.${fa.type.bitLo ?? 0}`, was = await geom("graphs3-filter-curve"), cur = Q.readParam(entry, fa.type); await X(`input-${k}`).fill(String(cur === 1 ? 0 : 1)); await X(`input-${k}`).press("Enter"); await until(async () => (await geom("graphs3-filter-curve")) !== was, "curve changed"); await back();
});
await check("looking at the graphs sends nothing to a connected keyboard", async () => {
  await ui.connectSim(); await new Promise((r) => setTimeout(r, 300)); const n = (await log()).length;
  for (const gr of ["OSC1 Filter Keyboard Track", "Vector Control", "OSC1 Filter A"]) { await X(`group-${gr}`).click(); await new Promise((r) => setTimeout(r, 250)); }
  const h = await pos("graphs3-filter-handle"); await win.mouse.move(h.x, h.y); await win.mouse.move(h.x + 50, h.y - 20); await new Promise((r) => setTimeout(r, 300)); assert.equal((await log()).length, n, "messages were sent without a click");
});
await check("the Keyboard Track page draws the line across the keys", async () => {
  await X("group-OSC1 Amplifier Keyboard Track").click(); await seen("graphs3-keytrack"); await seen("graphs3-keytrack-line"); assert.match(await text("graphs3-keytrack-caption"), CAP); assert.equal(await X("graphs3-filter").count(), 0);
  const k = `${kt.lowRamp.ofs}.${kt.lowRamp.bitLo ?? 0}`, was = await geom("graphs3-keytrack-line"), cur = Q.readParam(entry, kt.lowRamp); await X(`input-${k}`).fill(String(cur > 0 ? -100 : 100)); await X(`input-${k}`).press("Enter");
  await until(async () => (await geom("graphs3-keytrack-line")) !== was, "line changed"); onlyBits(L.getEntry(P.parsePcg(await saved()), KEY, SLOT), entry, kt.lowRamp.parts); await back();
});
await check("the Vector page shows five points and dragging one changes only its X and Y", async () => {
  await X("group-Vector Control").click(); await seen("graphs3-vector"); for (let i = 0; i < 5; i++) await seen(`graphs3-vector-point-${i}`); assert.match(await text("graphs3-vector-caption"), CAP);
  const p0 = await pos("graphs3-vector-point-1"); await drag("graphs3-vector-point-1", 40, -40); const p1 = await pos("graphs3-vector-point-1"); assert.ok(p1.x > p0.x && p1.y < p0.y, "point did not follow");
  const after = L.getEntry(P.parsePcg(await saved()), KEY, SLOT), p = vec.points[1]; assert.ok(Q.readParam(after, p.x) > Q.readParam(entry, p.x), "X did not rise"); assert.ok(Q.readParam(after, p.y) > Q.readParam(entry, p.y), "Y did not rise (up is +Y)");
  onlyBits(after, entry, [...p.x.parts, ...p.y.parts]); await back();
});
await check("a page without these graphs shows none of them", async () => { await X("group-Insert Effect1").click(); await seen("group-Insert Effect1"); await new Promise((r) => setTimeout(r, 200)); for (const id of ["graphs3-filter", "graphs3-keytrack", "graphs3-vector"]) assert.equal(await X(id).count(), 0, id); await closeEditor(); });
await ui.noErrors();
await finish();
