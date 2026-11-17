import { test } from "node:test";
import assert from "node:assert/strict";
import { clampRect, resizeRect, defaultRect } from "./panelRect.ts";

test("clampRect keeps the window on screen and inside min and max size", () => {
  assert.deepEqual(clampRect({ x: -50, y: 9999, w: 100, h: 100 }, 1000, 700), { x: 0, y: 400, w: 320, h: 300 });
  assert.deepEqual(clampRect({ x: 900, y: 0, w: 5000, h: 5000 }, 1000, 700), { x: 0, y: 0, w: 1000, h: 700 });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: NaN, h: NaN }, 1000, 700), { x: 0, y: 0, w: 320, h: 300 });
});

test("resizeRect moves only the dragged edges and stops at the minimum", () => {
  const r = { x: 100, y: 100, w: 420, h: 500 };
  assert.deepEqual(resizeRect(r, "se", 50, 20, 1200, 800), { x: 100, y: 100, w: 470, h: 520 });
  assert.deepEqual(resizeRect(r, "w", -40, 0, 1200, 800), { x: 60, y: 100, w: 460, h: 500 });
  assert.deepEqual(resizeRect(r, "w", 400, 0, 1200, 800), { x: 200, y: 100, w: 320, h: 500 });
  assert.deepEqual(resizeRect(r, "n", 0, 500, 1200, 800), { x: 100, y: 300, w: 420, h: 300 });
  assert.equal(resizeRect(r, "e", 5000, 0, 1200, 800).w, 1100);
});

test("defaultRect fits a small window", () => {
  const d = defaultRect(500, 400);
  assert.ok(d.x >= 0 && d.y >= 0 && d.x + d.w <= 500 && d.y + d.h <= 400);
});

// The Style A bands at the sizes the app is run at: top bar 56 high, bank column 196 wide, side column 300 wide, dock 148 high.
const layout = (vw: number, vh: number) => ({ top: 56, left: 196, right: vw - 300, bottom: vh - 148 });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("defaultRect is about 520 x 640 at 1400 x 900, flush right, under the top bar and above the dock", () => {
  assert.deepEqual(defaultRect(1400, 900, layout(1400, 900)), { x: 874, y: 64, w: 518, h: 639 });
  assert.deepEqual(defaultRect(1064, 835, layout(1064, 835)), { x: 662, y: 64, w: 394, h: 593 });
  assert.deepEqual(defaultRect(1920, 1080, layout(1920, 1080)), { x: 1202, y: 64, w: 710, h: 767 });
  assert.deepEqual(defaultRect(2560, 1440, layout(2560, 1440)), { x: 1792, y: 64, w: 760, h: 1022 });
});

test("defaultRect never covers the top bar, the bank column or the dock, and stays on screen", () => {
  for (const [vw, vh] of [[1400, 900], [1064, 835], [1920, 1080], [2560, 1440], [1280, 720], [900, 700]]) {
    const r = defaultRect(vw, vh, layout(vw, vh)), l = layout(vw, vh);
    assert.ok(!overlaps(r, { x: 0, y: 0, w: vw, h: l.top }), `${vw}x${vh} covers the top bar`);
    assert.ok(!overlaps(r, { x: 0, y: 0, w: l.left, h: vh }), `${vw}x${vh} covers the bank column`);
    assert.ok(r.x + r.w <= vw && r.y + r.h <= l.bottom, `${vw}x${vh} leaves the screen or covers the dock`);
    assert.ok(r.w >= 320 && r.h >= 300, `${vw}x${vh} is below the minimum`);
  }
});

test("clampRect keeps the header reachable wherever the window is dragged", () => {
  const r = { x: 0, y: 0, w: 520, h: 640 };
  for (const [x, y] of [[-900, -900], [9000, 9000], [9000, -50], [-50, 9000]]) {
    const c = clampRect({ ...r, x, y }, 1400, 900);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1400 && c.y + c.h <= 900, `${x},${y} leaves the screen`);
  }
});

test("with no room beside the main area the window goes flush right but still clears the top bar and bank column", () => {
  const r = defaultRect(700, 800, { top: 56, left: 196, right: 700, bottom: 650 });
  assert.deepEqual(r, { x: 332, y: 64, w: 360, h: 568 });
  assert.equal(defaultRect(1400, 900, { top: 120, left: 0, right: 1100, bottom: 900 }).y, 128);
  assert.equal(defaultRect(1400, 900).y, 96);
});
