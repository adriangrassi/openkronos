import { test } from "node:test";
import assert from "node:assert/strict";
import { placeCallout, type Rect } from "./calloutPlace.ts";

const vp = { w: 1280, h: 720 }, box = { w: 280, h: 150 };
const rect = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h });
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const boxRect = (p: { left: number; top: number }): Rect => rect(p.left, p.top, box.w, box.h);
const inside = (r: Rect) => r.left >= 0 && r.top >= 0 && r.right <= vp.w && r.bottom <= vp.h;

test("a narrow target gets the callout on its right, centred on it, with the arrow on the target's middle", () => {
  const t = rect(300, 300, 200, 40);
  const p = placeCallout(t, box, vp);
  assert.equal(p.side, "right");
  assert.equal(p.left, 500 + 12);
  assert.equal(p.top, 320 - 75);
  assert.equal(p.arrow, 75);
});

test("it flips to the left when the right side has no room", () => {
  const t = rect(1000, 300, 200, 40);
  const p = placeCallout(t, box, vp);
  assert.equal(p.side, "left");
  assert.equal(p.left + box.w + 12, 1000);
});

test("a target as wide as the list gets the callout below it, or above when the bottom has no room", () => {
  assert.equal(placeCallout(rect(40, 200, 900, 32), box, vp).side, "bottom");
  const low = placeCallout(rect(40, 600, 900, 32), box, vp);
  assert.equal(low.side, "top");
  assert.equal(low.top + box.h + 12, 600);
});

test("it is clamped inside the viewport and the arrow follows the target", () => {
  const p = placeCallout(rect(300, 2, 200, 20), box, vp);
  assert.equal(p.top, 8);
  assert.ok(p.arrow >= 14 && p.arrow <= box.h - 14);
});

test("whenever a side fits, the callout is inside the viewport and never covers the target", () => {
  for (let x = 0; x <= 1100; x += 90) for (let y = 0; y <= 680; y += 70) for (const w of [60, 200, 420, 900]) {
    const t = rect(x, y, w, 36);
    if (t.right > vp.w) continue;
    const p = placeCallout(t, box, vp);
    assert.ok(inside(boxRect(p)), `${x},${y},${w} inside`);
    assert.ok(!overlaps(boxRect(p), t), `${x},${y},${w} overlap`);
  }
});

test("a side whose box would sit under a window to avoid is skipped", () => {
  const t = rect(300, 300, 200, 40), ai = rect(480, 100, 900, 600);
  const p = placeCallout(t, box, vp, 12, 8, [ai]);
  assert.equal(p.side, "left");
  assert.ok(!overlaps(boxRect(p), ai));
  assert.equal(placeCallout(t, box, vp, 12, 8, []).side, "right", "without it the right side is used");
});

test("in a viewport too small for any side it still stays inside and reports a side", () => {
  const p = placeCallout(rect(0, 0, 400, 300), { w: 380, h: 280 }, { w: 400, h: 300 });
  assert.ok(p.left >= 0 && p.top >= 0 && p.left + 380 <= 400 && p.top + 280 <= 300);
  assert.ok(["left", "right", "top", "bottom"].includes(p.side));
});
