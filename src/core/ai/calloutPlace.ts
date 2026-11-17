// Pure placement of the guide callout beside its target: a side that fits whole, clamped on the other axis, never over the target. No DOM.
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Side = "left" | "right" | "top" | "bottom";
export type Placed = { left: number; top: number; side: Side; arrow: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

export function placeCallout(t: Rect, box: { w: number; h: number }, vp: { w: number; h: number }, gap = 12, margin = 8, avoid: Rect[] = []): Placed {
  const cx = (t.left + t.right) / 2, cy = (t.top + t.bottom) / 2;
  const at = (side: Side): { p: Placed; room: number } => {
    const horiz = side === "left" || side === "right";
    const main = side === "right" ? t.right + gap : side === "left" ? t.left - gap - box.w : side === "bottom" ? t.bottom + gap : t.top - gap - box.h;
    const roomMain = side === "right" ? vp.w - margin - (t.right + gap) : side === "left" ? t.left - gap - margin : side === "bottom" ? vp.h - margin - (t.bottom + gap) : t.top - gap - margin;
    const cross = horiz ? clamp(cy - box.h / 2, margin, vp.h - box.h - margin) : clamp(cx - box.w / 2, margin, vp.w - box.w - margin);
    const m = horiz ? clamp(main, margin, vp.w - box.w - margin) : clamp(main, margin, vp.h - box.h - margin);
    const left = horiz ? m : cross, top = horiz ? cross : m;
    const arrow = clamp(horiz ? cy - top : cx - left, 14, (horiz ? box.h : box.w) - 14);
    return { p: { left, top, side, arrow }, room: roomMain - (horiz ? box.w : box.h) };
  };
  const wide = t.right - t.left > vp.w * 0.45;
  const order: Side[] = wide ? ["bottom", "top", "right", "left"] : ["right", "left", "bottom", "top"];
  const tries = order.map(at);
  const clear = (p: Placed) => avoid.every((a) => p.left >= a.right || a.left >= p.left + box.w || p.top >= a.bottom || a.top >= p.top + box.h);
  return (tries.find((x) => x.room >= 0 && clear(x.p)) ?? tries.find((x) => x.room >= 0) ?? tries.reduce((a, b) => (b.room > a.room ? b : a))).p;
}
