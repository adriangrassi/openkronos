// LFO shapes, the Drum Kit note map and the Wave Sequence timeline as data. No DOM, no node: imports, so it also runs in the renderer.
import { paramsFor, readParam, type ParamTables, type Row } from "./params.ts";

// The 18 Waveform names in KORG's order, as the manual lists them.
export const LFO_WAVEFORMS: readonly string[] = [
  "Triangle", "Saw", "Square", "Sine", "Guitar", "Exponential Triangle", "Exponential Saw Down", "Exponential Saw Up",
  "Step Triangle-4", "Step Triangle-6", "Step Saw-4", "Step Saw-6",
  "Random1 (S/H)", "Random2 (S/H)", "Random3 (S/H)", "Random4 (Continuous)", "Random5 (Continuous)", "Random6 (Continuous)",
];

// Rows are looked up by group and name; the first row of each pair wins.
const indexCache = new WeakMap<Row[], Map<string, Row>>();
function indexRows(rows: Row[]): Map<string, Row> {
  let m = indexCache.get(rows);
  if (!m) {
    m = new Map();
    for (const r of rows) if (!r.continuation && !m.has(`${r.group}\u0000${r.name}`)) m.set(`${r.group}\u0000${r.name}`, r);
    indexCache.set(rows, m);
  }
  return m;
}
function need(m: Map<string, Row>, group: string, name: string): Row {
  const r = m.get(`${group}\u0000${name}`);
  if (!r) throw new Error(`no row ${name} in ${group}`);
  return r;
}

export type Lfo = { group: string; fields: { waveform: Row; frequency: Row; shape: Row | null } };

// Any group with a Waveform row and a Frequency row is an LFO. Shape is optional.
export function findLfos(rows: Row[]): Lfo[] {
  const byGroup = new Map<string, Map<string, Row>>();
  for (const r of rows) {
    if (r.continuation) continue;
    let names = byGroup.get(r.group);
    if (!names) byGroup.set(r.group, (names = new Map()));
    if (!names.has(r.name)) names.set(r.name, r);
  }
  const out: Lfo[] = [];
  for (const [group, m] of byGroup) {
    const waveform = m.get("Waveform");
    const frequency = m.get("Frequency");
    if (!waveform || !frequency) continue;
    out.push({ group, fields: { waveform, frequency, shape: m.get("Shape") ?? null } });
  }
  return out;
}

// Deterministic pseudo-random values in -1..1 (mulberry32), so a random wave draws the same every time.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2) - 1;
  };
}

const tri = (t: number) => (t < 0.5 ? -1 + 4 * t : 3 - 4 * t);
const saw = (t: number) => 2 * t - 1;
// Keeps the sign and squares the size, so the curve bends and stays in -1..1.
const bend = (x: number) => Math.sign(x) * x * x;
// Quantises a value in -1..1 to n equal levels.
const quant = (x: number, n: number) => (Math.min(n - 1, Math.floor(((x + 1) / 2) * n)) / (n - 1)) * 2 - 1;

// Holds vals[i] from times[i] until times[i+1]; times[0] is 0.
function held(vals: number[], times: number[]): (t: number) => number {
  return (t) => {
    let i = 0;
    while (i + 1 < times.length && times[i + 1] <= t) i++;
    return vals[i];
  };
}

// Linear interpolation between random knots that repeat over one cycle.
function smooth(knots: number[]): (t: number) => number {
  const n = knots.length;
  return (t) => {
    const x = t * n;
    const i = Math.floor(x);
    const f = x - i;
    return knots[i % n] * (1 - f) + knots[(i + 1) % n] * f;
  };
}

function waveFn(wave: number): (t: number) => number {
  const rnd = seeded(wave * 7919 + 1);
  const pool = (n: number) => Array.from({ length: n }, () => rnd());
  const even = (n: number) => Array.from({ length: n }, (_, i) => i / n);
  // Random sample-and-hold times: 0 plus seven sorted points inside the cycle.
  const times = () => [0, ...pool(7).map((x) => (x + 1) / 2).sort((a, b) => a - b)];
  switch (wave) {
    case 1: return saw;
    case 2: return (t) => (t < 0.5 ? 1 : -1);
    case 3: return (t) => Math.sin(2 * Math.PI * t);
    // shortcut: Guitar is a positive-going curve here, not KORG's tuned shape; upgrade if the real curve is published.
    case 4: return (t) => 2 * Math.sin(Math.PI * t) ** 2 - 1;
    case 5: return (t) => bend(tri(t));
    case 6: return (t) => bend(-saw(t));
    case 7: return (t) => bend(saw(t));
    case 8: return (t) => quant(tri(t), 4);
    case 9: return (t) => quant(tri(t), 6);
    case 10: return (t) => quant(saw(t), 4);
    case 11: return (t) => quant(saw(t), 6);
    case 12: return held(pool(8), even(8));
    case 13: { const ts = times(); return held(pool(8), ts); }
    case 14: { const ts = times(); return held(ts.map((_, i) => (i % 2 ? -1 : 1)), ts); }
    case 15: return smooth(pool(8));
    case 16: return smooth(pool(12));
    case 17: return smooth(pool(16));
    default: return tri;
  }
}

// n points over one cycle, each in -1..1. Shape bends the phase: 0 keeps the wave, -99 and 99 bend it either way.
// shortcut: an approximation, because KORG's exact curves are not published; shape here is a phase warp, not KORG's curve.
export function lfoPoints(wave: number, shape: number, n: number): number[] {
  const f = waveFn(wave);
  const k = 2 ** ((shape / 99) * 1.5);
  return Array.from({ length: n }, (_, i) => Math.max(-1, Math.min(1, f((i / n) ** k))));
}

export type DrumZone = { zone: number; on: boolean; sampleId: number; level: number };
export type DrumNote = { note: number; zones: DrumZone[] };

// All 128 notes, each with its 8 zones, read from the expanded kit rows.
export function drumMap(tables: ParamTables, entry: Uint8Array): DrumNote[] {
  const m = indexRows(paramsFor(tables, "drumkit", entry));
  return Array.from({ length: 128 }, (_, note) => ({
    note,
    zones: Array.from({ length: 8 }, (_, z) => {
      const g = `Note${note + 1} Zone${z + 1}`;
      return {
        zone: z + 1,
        on: readParam(entry, need(m, g, "Sample On/Off")) === 1,
        sampleId: readParam(entry, need(m, g, "Sample Id")),
        level: readParam(entry, need(m, g, "Level")),
      };
    }),
  }));
}

export type WaveStep = { index: number; type: number; level: number; duration: number; crossfade: number; durationRow: Row };
export type WaveTimeline = { startStep: number; endStep: number; loopStart: number; loopEnd: number; steps: WaveStep[] };

// The 64 steps with their Common settings. Steps are 0-based here; the UI shows them as 1..64.
export function waveSeqTimeline(tables: ParamTables, entry: Uint8Array): WaveTimeline {
  const m = indexRows(paramsFor(tables, "waveseq", entry));
  const common = (n: string) => readParam(entry, need(m, "Common", n));
  return {
    startStep: common("Start Step"),
    endStep: common("End Step"),
    loopStart: common("Loop Start"),
    loopEnd: common("Loop End"),
    steps: Array.from({ length: 64 }, (_, index) => {
      const g = `Step${index + 1}`;
      return {
        index,
        type: readParam(entry, need(m, g, "Step Type")),
        level: readParam(entry, need(m, g, "Level")),
        duration: readParam(entry, need(m, g, "Duration")),
        crossfade: readParam(entry, need(m, g, "Crossfade")),
        durationRow: need(m, g, "Duration"),
      };
    }),
  };
}

// Step indices from the start step to the end step in play order, wrapping past 63.
export function waveShown(tl: WaveTimeline): number[] {
  const count = ((tl.endStep - tl.startStep + 64) % 64) + 1;
  return Array.from({ length: count }, (_, k) => (tl.startStep + k) % 64);
}
