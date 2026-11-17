// Pure point builders for the EQ, dynamics and drive graphs (no DOM, no JSX, so node:test can load them).
// Kept in .ts because the test runner cannot parse .tsx; FxEqGraphs.tsx and FxDynGraphs.tsx re-export them.
import { logHz, peqDb, dynOut, approxRatio, driveY } from "../../../core/fx/curves.ts";
import type { FxGet, FxGraphSpec } from "../../../core/fx/graphs.ts";

export const W = 280;
export const H = 130;
export const PAD = 14;
export const EQ_RANGE = 18;
export const DYN_LO = -60;
export type Pt = { x: number; y: number };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const innerW = W - 2 * PAD;
const innerH = H - 2 * PAD;

// Position of a frequency on the 20 Hz..20 kHz axis, 0..1.
const hzPos = (f: number) => Math.log(f / 20) / Math.log(1000);
const eqX = (pos: number) => PAD + pos * innerW;
export const eqY = (db: number) => PAD + ((EQ_RANGE - clamp(db, -EQ_RANGE, EQ_RANGE)) / (2 * EQ_RANGE)) * innerH;

export function peqPoints(spec: Extract<FxGraphSpec, { graph: "peq" }>, get: FxGet, n: number): { curve: Pt[]; dots: Pt[] } {
  const bands = spec.bands.flatMap((b) => {
    const hz = get(b.hz)?.n;
    const gain = get(b.gain)?.n;
    if (hz == null || hz <= 0 || gain == null) return [];
    const q = (b.q ? get(b.q)?.n : null) ?? 1;
    const shape = b.shapeRow && get(b.shapeRow)?.text !== "Shelving" ? "peak" : b.shape;
    return [{ hz, q: Math.max(q, 0.05), gain, shape }];
  });
  const curve = Array.from({ length: n }, (_, i) => ({ x: eqX(i / (n - 1)), y: eqY(peqDb(bands, logHz(i, n))) }));
  const dots = bands.map((b) => ({ x: eqX(clamp(hzPos(b.hz), 0, 1)), y: eqY(peqDb(bands, b.hz)) }));
  return { curve, dots };
}

// One bar per gain; x is the bar centre, y0 the 0 dB line, y1 the gain.
export function geqBars(spec: Extract<FxGraphSpec, { graph: "geq" }>, get: FxGet): { x: number; y0: number; y1: number }[] {
  const k = spec.gains.length;
  return spec.gains.map((g, i) => ({ x: PAD + ((i + 0.5) / k) * innerW, y0: eqY(0), y1: eqY(get(g)?.n ?? 0) }));
}

// Square in/out plot, -60..0 dB both ways, drawn inside the W x H frame by the component.
const SIDE = innerH;
const dynX = (db: number) => PAD + ((clamp(db, DYN_LO, 0) - DYN_LO) / -DYN_LO) * SIDE;
const dynY = (db: number) => PAD + ((0 - clamp(db, DYN_LO, 0)) / -DYN_LO) * SIDE;

export function dynPoints(spec: Extract<FxGraphSpec, { graph: "dyn" }>, get: FxGet, n: number): { curve: Pt[]; diag: Pt[]; thr: number } {
  const ratioV = spec.ratio ? get(spec.ratio) : undefined;
  const threshold = get(spec.threshold)?.n ?? -24;
  const ratio = ratioV ? (ratioV.n ?? approxRatio(ratioV.t)) : spec.mode === "limit" ? Infinity : 1;
  const knee = (spec.knee ? get(spec.knee)?.n : null) ?? 0;
  const ceiling = (spec.ceiling ? get(spec.ceiling)?.n : null) ?? undefined;
  const ins = Array.from({ length: n }, (_, i) => DYN_LO + (i / (n - 1)) * -DYN_LO);
  return {
    curve: ins.map((d) => ({ x: dynX(d), y: dynY(dynOut(d, { threshold, ratio, knee, mode: spec.mode, ceiling })) })),
    diag: ins.map((d) => ({ x: dynX(d), y: dynY(d) })),
    thr: dynX(threshold),
  };
}

export function drivePoints(spec: Extract<FxGraphSpec, { graph: "drive" }>, get: FxGet, n: number): { curve: Pt[]; diag: Pt[] } {
  const d = get(spec.drive)?.t ?? 0.5;
  const cx = (x: number) => PAD + ((x + 1) / 2) * innerW;
  const cy = (y: number) => PAD + ((1 - y) / 2) * innerH;
  const xs = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
  return { curve: xs.map((x) => ({ x: cx(x), y: cy(driveY(x, d)) })), diag: xs.map((x) => ({ x: cx(x), y: cy(x) })) };
}

export const toStr = (ps: Pt[]) => ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
