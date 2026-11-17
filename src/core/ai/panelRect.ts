// Geometry of the floating AI window. Pure: the viewport comes in as numbers.
export type Rect = { x: number; y: number; w: number; h: number };
export const MIN_W = 320, MIN_H = 300;
// The default size: about 37% of the width and 71% of the height (520 x 640 at 1400 x 900), within these bounds.
export const DEFAULT_MIN_W = 360, DEFAULT_MIN_H = 420, DEFAULT_MAX_W = 760;

// Forces a rect to be at least MIN size (or the viewport if smaller), no larger than the viewport, and fully on screen, so the header can always be reached.
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = Math.max(Math.min(MIN_W, vw), Math.min(Math.round(r.w) || MIN_W, vw));
  const h = Math.max(Math.min(MIN_H, vh), Math.min(Math.round(r.h) || MIN_H, vh));
  return { w, h, x: Math.max(0, Math.min(Math.round(r.x) || 0, vw - w)), y: Math.max(0, Math.min(Math.round(r.y) || 0, vh - h)) };
}

// Screen bands the app's main controls live in: the top bar, the bank column on the left, the main area (its right edge) and the dock at the bottom.
export type Reserved = { top: number; left: number; right: number; bottom: number };

// Where an unmoved window sits: flush right, under the top bar and above the dock, never over the bank column. It may cover the main editor area; the owner drags it anywhere.
export function defaultRect(vw: number, vh: number, r: Reserved = { top: 88, left: 0, right: vw, bottom: vh }): Rect {
  const y = r.top + 8;
  const w = Math.min(Math.max(Math.round(vw * 0.37), DEFAULT_MIN_W), DEFAULT_MAX_W, Math.max(MIN_W, vw - r.left - 8));
  const room = r.bottom - y - 8;
  const h = Math.min(Math.max(Math.round(vh * 0.71), DEFAULT_MIN_H), Math.round(vh * 0.9), Math.max(MIN_H, room));
  const c = clampRect({ x: vw - w - 8, y, w, h }, vw, vh);
  return { ...c, x: Math.max(c.x, Math.min(r.left, vw - c.w)) };
}

// Drags edges: dir holds any of n, s, e, w. The opposite edge stays put and the size stops at the minimum.
export function resizeRect(r: Rect, dir: string, dx: number, dy: number, vw: number, vh: number): Rect {
  let { x, y, w, h } = r;
  if (dir.includes("e")) w = Math.min(r.w + dx, vw - r.x);
  if (dir.includes("s")) h = Math.min(r.h + dy, vh - r.y);
  if (dir.includes("w")) { const nx = Math.max(0, Math.min(r.x + dx, r.x + r.w - Math.min(MIN_W, vw))); w = r.x + r.w - nx; x = nx; }
  if (dir.includes("n")) { const ny = Math.max(0, Math.min(r.y + dy, r.y + r.h - Math.min(MIN_H, vh))); h = r.y + r.h - ny; y = ny; }
  if (w < MIN_W) { if (dir.includes("w")) x = r.x + r.w - MIN_W; w = MIN_W; }
  if (h < MIN_H) { if (dir.includes("n")) y = r.y + r.h - MIN_H; h = MIN_H; }
  return clampRect({ x, y, w, h }, vw, vh);
}
