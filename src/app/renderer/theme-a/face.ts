// Geometry of the Style A hardware faces: tick marks around a dial, along a fader, and where a fader cap sits. Pure: no DOM.
import { SWEEP } from "../../../core/pages/dial.ts";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const r2 = (n: number): string => String(Math.round(n * 100) / 100);

export type Ticks = { short: string; long: string };

// n + 1 marks across the dial's sweep, 0 degrees straight up; every longEvery-th mark is long. Two path strings, so a dial costs two elements.
export function dialTicks(cx: number, cy: number, r0: number, n: number, longEvery: number, shortLen: number, longLen: number): Ticks {
  const out: Ticks = { short: "", long: "" };
  for (let i = 0; i <= n; i++) {
    const a = ((-SWEEP / 2 + (i / n) * SWEEP) * Math.PI) / 180;
    const len = i % longEvery === 0 ? longLen : shortLen;
    const [s, c] = [Math.sin(a), Math.cos(a)];
    const seg = `M${r2(cx + r0 * s)} ${r2(cy - r0 * c)}L${r2(cx + (r0 + len) * s)} ${r2(cy - (r0 + len) * c)}`;
    if (len === longLen) out.long += seg; else out.short += seg;
  }
  return out;
}

// Same marks along a vertical fader: from y0 (top, maximum) to y1 (bottom, minimum), growing leftwards from x.
export function faderTicks(x: number, y0: number, y1: number, n: number, longEvery: number, shortLen: number, longLen: number): Ticks {
  const out: Ticks = { short: "", long: "" };
  for (let i = 0; i <= n; i++) {
    const y = r2(y0 + ((y1 - y0) * i) / n);
    const len = i % longEvery === 0 ? longLen : shortLen;
    const seg = `M${r2(x - len)} ${y}L${x} ${y}`;
    if (len === longLen) out.long += seg; else out.short += seg;
  }
  return out;
}

// Top edge of a fader cap of height cap in a fader h tall, for a value at fraction f of its range. This is where the native range thumb sits, so the drawn cap and the input agree.
export const faderCapTop = (f: number, h: number, cap: number): number => Math.max(0, h - cap) * (1 - clamp01(f));

// Where the indicator of a mini encoder ends, for a value at fraction f: unit vector scaled by r.
export function encoderTip(cx: number, cy: number, r: number, f: number): [number, number] {
  const a = ((-SWEEP / 2 + clamp01(f) * SWEEP) * Math.PI) / 180;
  return [Number(r2(cx + r * Math.sin(a))), Number(r2(cy - r * Math.cos(a)))];
}

// n radial lines between r0 and r1 around (cx, cy): the knurled rim of a cap, as one path.
export function knurlPath(cx: number, cy: number, r0: number, r1: number, n: number): string {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, [s, c] = [Math.sin(a), Math.cos(a)];
    d += `M${r2(cx + r0 * s)} ${r2(cy - r0 * c)}L${r2(cx + r1 * s)} ${r2(cy - r1 * c)}`;
  }
  return d;
}

// A radial segment from r0 to r1 at fraction f of the dial's sweep: the indicator, and the detent marker of a bipolar dial.
export function radialAt(cx: number, cy: number, r0: number, r1: number, f: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = ((-SWEEP / 2 + clamp01(f) * SWEEP) * Math.PI) / 180, [s, c] = [Math.sin(a), Math.cos(a)];
  return { x1: Number(r2(cx + r0 * s)), y1: Number(r2(cy - r0 * c)), x2: Number(r2(cx + r1 * s)), y2: Number(r2(cy - r1 * c)) };
}

// Arc between two compass angles (0 = up, clockwise), for the light and shade edges of a cap.
export function arcDeg(cx: number, cy: number, r: number, from: number, to: number): string {
  const pt = (deg: number): string => `${r2(cx + r * Math.sin((deg * Math.PI) / 180))} ${r2(cy - r * Math.cos((deg * Math.PI) / 180))}`;
  return `M${pt(from)}A${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${pt(to)}`;
}

// A bipolar dial's arc starts at its zero; the marker sits there. null for a unipolar one.
export const detentOf = (centre: number | null): number | null => (centre === null ? null : clamp01(centre));
