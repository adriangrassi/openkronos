// Point builders for the decay, taps and lfo graphs: pure, pixel coordinates in the shared 280x130 plot (no DOM).
import { decayDb, lfoY, noteMs } from "../../../core/fx/curves.ts";
import type { FxGet, FxGraphSpec } from "../../../core/fx/graphs.ts";

export const W = 280;
export const H = 130;
export const PAD = 14;
const PW = W - 2 * PAD;
const PH = H - 2 * PAD;
type Spec<K extends FxGraphSpec["graph"]> = Extract<FxGraphSpec, { graph: K }>;
type Pt = [number, number];

const FLOOR = -60;
const SPIKE_AT = [0.05, 0.11, 0.18, 0.24, 0.33, 0.41, 0.52, 0.66];

export function decayPoints(spec: Spec<"decay">, get: FxGet, n: number) {
  const tv = get(spec.time);
  // shortcut: time unit is a guess (seconds; ER Time rows are ms); n is null when the value is only a ratio
  const timeSec = Math.max(0.05, tv ? (tv.n !== null ? (spec.early ? tv.n / 1000 : tv.n) : 0.2 + tv.t * 9.8) : 1);
  const pv = spec.preDelay ? get(spec.preDelay) : undefined;
  const pre = pv ? (pv.n ?? pv.t * 200) : 0;
  const xMax = pre + timeSec * 1000 * 1.1;
  const X = (ms: number) => PAD + (ms / xMax) * PW;
  const Y = (db: number) => PAD + (Math.min(0, Math.max(FLOOR, db)) / FLOOR) * PH;
  const line = (sec: number): Pt[] => {
    const pts: Pt[] = [[X(0), Y(FLOOR)], [X(pre), Y(FLOOR)], [X(pre), Y(0)]];
    for (let i = 1; i < n; i++) {
      const ms = pre + ((xMax - pre) * i) / (n - 1);
      pts.push([X(ms), Y(decayDb(ms, { preDelay: pre, timeSec: sec }))]);
    }
    return pts;
  };
  const dv = spec.damp ? get(spec.damp) : undefined;
  const spikes = spec.early
    ? SPIKE_AT.map((f, k) => ({ x: X(pre + f * timeSec * 1000), y0: Y(FLOOR), y1: Y(FLOOR * 0.1 * k) }))
    : [];
  return { curve: line(timeSec), damp: dv ? line(timeSec / (1 + 2 * dv.t)) : undefined, spikes, xMax };
}

export function tapsPoints(spec: Spec<"taps">, get: FxGet, tempo?: number) {
  const bv = spec.bpm ? get(spec.bpm) : undefined;
  const bpm = bv && bv.n !== null && bv.text !== "MIDI" ? bv.n : (tempo ?? 120);
  const taps = spec.taps.map((t) => {
    let ms = 0;
    let caption = t.label;
    const tv = t.time ? get(t.time) : undefined;
    const nv = t.note ? get(t.note) : undefined;
    if (nv) {
      const times = t.times ? get(t.times) : undefined;
      const k = times ? (times.n ?? times.raw) : 1;
      ms = noteMs(bpm, nv.text, k);
      caption = `${nv.text} x${k}`;
    } else if (tv) ms = tv.n ?? tv.t * 1000;
    if (!Number.isFinite(ms)) ms = 0;
    const lv = t.level ? get(t.level) : undefined;
    return { label: t.label, ms, caption, h: lv ? lv.t : 1 };
  });
  const longest = taps.reduce((a, t) => (t.ms > a.ms ? t : a), { label: "", ms: 0, caption: "", h: 1 });
  const xMax = Math.max(1, longest.ms) * 1.25;
  const X = (ms: number) => PAD + (ms / xMax) * PW;
  const Y = (h: number) => H - PAD - h * PH;
  const lines = taps.map((t) => ({ ...t, x: X(t.ms), y0: Y(0), y1: Y(t.h) }));
  const fv = spec.feedback ? get(spec.feedback) : undefined;
  // feedback rows run -100..+100 (t 0.5 = zero), so the echo size is the distance from the middle, not t itself
  const fb = fv ? Math.abs(2 * fv.t - 1) : 0;
  const echoes = fv && fv.raw !== 0
    ? [1, 2, 3].map((k) => ({ x: X(longest.ms * (1 + 0.08 * k)), y0: Y(0), y1: Y(longest.h * fb ** k) }))
    : [];
  return { lines, echoes, xMax };
}

export function lfoPoints(spec: Spec<"lfo">, get: FxGet, n: number) {
  const wave = get(spec.wave)?.text ?? "Sine";
  const sv = spec.shape ? get(spec.shape) : undefined;
  const shape = sv ? (sv.n ?? sv.raw) : 0;
  const pv = spec.phase ? get(spec.phase) : undefined;
  const curve = (deg: number): Pt[] =>
    Array.from({ length: n }, (_, i) => {
      const x = i / (n - 1);
      return [PAD + x * PW, PAD + ((1 - lfoY(wave, shape, deg, x)) / 2) * PH];
    });
  const note = spec.note ? get(spec.note) : undefined;
  const times = spec.times ? get(spec.times) : undefined;
  const sync = spec.sync ? get(spec.sync) : undefined;
  const fv = spec.freq ? get(spec.freq) : undefined;
  const caption = sync && sync.raw !== 0 && note ? `Sync: ${note.text} x${times ? (times.n ?? times.raw) : 1}` : (fv?.text ?? "");
  return { main: curve(0), second: pv ? curve(pv.n ?? pv.raw) : undefined, caption, wave };
}
