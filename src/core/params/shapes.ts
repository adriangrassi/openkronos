// Shape maths for the Filter, Keyboard Track and Vector graphs. Drawn as shapes, not measurements. No DOM, no node: imports, so it also runs in the renderer.
import type { Row } from "./params.ts";
import type { Write } from "./graphs.ts";

const clampTo = (x: number, lo: number, hi: number): number => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

// Rows are grouped by their group name, first row of each name wins, continuation rows skipped (as graphs.ts does).
function namesByGroup(rows: Row[]): Map<string, Map<string, Row>> {
  const byGroup = new Map<string, Map<string, Row>>();
  for (const r of rows) {
    if (r.continuation) continue;
    let names = byGroup.get(r.group);
    if (!names) byGroup.set(r.group, (names = new Map()));
    if (!names.has(r.name)) names.set(r.name, r);
  }
  return byGroup;
}

// ---- Filter response ----

export type Filter = { group: string; type: Row; cutoff: Row; resonance: Row };

export function findFilters(rows: Row[]): Filter[] {
  const out: Filter[] = [];
  for (const [group, m] of namesByGroup(rows)) {
    const type = m.get("Filter Type"), cutoff = m.get("Cutoff"), resonance = m.get("Resonance");
    if (type && cutoff && resonance) out.push({ group, type, cutoff, resonance });
  }
  return out;
}

// shortcut: 8 octaves across the whole curve is a drawing choice, not a KORG value; upgrade if KORG's filter response is published.
const OCTAVES = 8;
// Resonance 0 is Butterworth (Q 0.707), so the -3 dB point sits on the cutoff; resonance 99 raises Q to 10.
const Q_MIN = Math.SQRT1_2;
const Q_MAX = 10;

// n points, low to high frequency. Types: 0 Low Pass, 1 High Pass, 2 Band Pass, 3 Band Reject.
// The knee/peak sits at index round(cutoff / 99 * (n - 1)).
// shortcut: peaks are scaled down by sqrt(Q) so every value stays in 0..1, which lowers the passband at high resonance; upgrade with a real loudness model.
export function filterCurve(type: number, cutoff: number, resonance: number, n: number): number[] {
  const t = Math.round(clampTo(type, 0, 3));
  const uc = clampTo(cutoff, 0, 99) / 99;
  const q = Q_MIN + (clampTo(resonance, 0, 99) / 99) * (Q_MAX - Q_MIN);
  const d = Math.sqrt(Math.max(1, q));
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => {
    const u = n > 1 ? i / (n - 1) : 0;
    const r = 2 ** ((u - uc) * OCTAVES);
    const r2 = r * r;
    const den = Math.sqrt((1 - r2) ** 2 + (r / q) ** 2);
    const bp = r / q / den / d;
    if (t === 0) return Math.min(1, 1 / den / d);
    if (t === 1) return Math.min(1, r2 / den / d);
    if (t === 2) return bp;
    return 1 - bp;
  });
}

// fx, fy in 0..1 across the plot (fy 0 is the top). Returns only the writes that change a value.
export function filterFromPointer(f: { cutoff: Row; resonance: Row }, cur: { cutoff: number; resonance: number }, fx: number, fy: number): Write[] {
  const c = f.cutoff, r = f.resonance;
  const cutoff = clampTo(Math.round(fx * c.rawMax), c.rawMin, c.rawMax);
  const resonance = clampTo(Math.round((1 - fy) * r.rawMax), r.rawMin, r.rawMax);
  const out: Write[] = [];
  if (cutoff !== cur.cutoff) out.push({ row: c, value: cutoff });
  if (resonance !== cur.resonance) out.push({ row: r, value: resonance });
  return out;
}

// ---- Keyboard Track ----

export type KeyTrack = {
  group: string;
  lowKey: Row;
  centerKey: Row;
  highKey: Row;
  lowRamp: Row;
  centerLowRamp: Row;
  centerHighRamp: Row;
  highRamp: Row;
  intensity: Row | null;
};

export function findKeyTracks(rows: Row[]): KeyTrack[] {
  const byGroup = namesByGroup(rows);
  const out: KeyTrack[] = [];
  for (const [group, m] of byGroup) {
    const lowKey = m.get("Low Key"), centerKey = m.get("Center Key"), highKey = m.get("High Key");
    const lowRamp = m.get("Low Ramp"), centerLowRamp = m.get("Center Low Ramp"), centerHighRamp = m.get("Center High Ramp"), highRamp = m.get("High Ramp");
    if (!lowKey || !centerKey || !highKey || !lowRamp || !centerLowRamp || !centerHighRamp || !highRamp) continue;
    const fk = /^(OSC\d) Filter Keyboard Track$/.exec(group);
    const intensity = fk ? (byGroup.get(`${fk[1]} Filter A`)?.get("Keyboard Track") ?? null) : null;
    out.push({ group, lowKey, centerKey, highKey, lowRamp, centerLowRamp, centerHighRamp, highRamp, intensity });
  }
  return out;
}

export type KeyTrackValues = {
  lowKey: number;
  centerKey: number;
  highKey: number;
  lowRamp: number;
  centerLowRamp: number;
  centerHighRamp: number;
  highRamp: number;
  intensity: number;
};

// n keys from A0 (MIDI 21). Ramps are linear between the key points and flat outside them; intensity scales the result by intensity / 99.
export function keyTrackCurve(p: KeyTrackValues, n = 88): number[] {
  const k = p.intensity / 99;
  return Array.from({ length: n }, (_, i) => {
    const m = 21 + i;
    let v: number;
    if (m < p.lowKey) v = p.lowRamp;
    else if (m < p.centerKey) v = p.lowRamp + ((m - p.lowKey) / (p.centerKey - p.lowKey)) * (p.centerLowRamp - p.lowRamp);
    else if (m <= p.highKey) v = p.centerHighRamp + (p.highKey > p.centerKey ? (m - p.centerKey) / (p.highKey - p.centerKey) : 1) * (p.highRamp - p.centerHighRamp);
    else v = p.highRamp;
    return v * k;
  });
}

// ---- Vector ----

export type Vector = { group: string; points: { x: Row; y: Row }[] };

export function findVector(rows: Row[]): Vector | null {
  const m = namesByGroup(rows).get("Vector Control");
  if (!m) return null;
  const points: { x: Row; y: Row }[] = [];
  for (let i = 0; i < 5; i++) {
    const x = m.get(`(${i}) Position X`), y = m.get(`(${i}) Position Y`);
    if (!x || !y) return null;
    points.push({ x, y });
  }
  return { group: "Vector Control", points };
}

// -127..127 maps to 0..1.
export function vectorUnit(raw: number): number {
  return clampTo((raw + 127) / 254, 0, 1);
}

// ux, uy in 0..1 with uy 0 at the bottom (+Y is up). Returns the X write then the Y write for that point.
export function vectorFromPointer(v: { points: { x: Row; y: Row }[] }, index: number, ux: number, uy: number): Write[] {
  if (!Number.isInteger(index) || index < 0 || index >= v.points.length) throw new Error(`no vector point ${index}`);
  const p = v.points[index];
  const raw = (u: number) => clampTo(Math.round(clampTo(u, 0, 1) * 254 - 127), -127, 127);
  return [
    { row: p.x, value: raw(ux) },
    { row: p.y, value: raw(uy) },
  ];
}
