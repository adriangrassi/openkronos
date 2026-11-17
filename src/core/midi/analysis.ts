// Analysis of a Standard MIDI File: timing, notes, key and a chord per bar. Pure, no DOM or Node imports.
import { parseSmf } from "./smf.ts";

export interface MidiBar {
  index: number;
  startTick: number;
  startMs: number;
  endMs: number;
  chord: string | null;
}
export interface MidiAnalysis {
  durationMs: number;
  ppq: number;
  tempoMap: { tick: number; bpm: number; ms: number }[];
  timeSignature: { num: number; den: number };
  bars: MidiBar[];
  noteCounts: { channel: number; notes: number }[];
  peakPolyphony: number;
  key: { tonic: string; mode: "major" | "minor"; name: string } | null;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const CHORDS: [string, number[]][] = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["7", [0, 4, 7, 10]],
  ["maj7", [0, 4, 7, 11]],
  ["m7", [0, 3, 7, 10]],
];

interface Note {
  ch: number;
  note: number;
  start: number;
  end: number;
}

// parseSmf has already validated the file, so this reader trusts the structure. It only needs ticks, which parseSmf does not expose.
function readEvents(bytes: Uint8Array) {
  const notes: Note[] = [];
  const tempos: { tick: number; us: number }[] = [];
  // shortcut: only the first time signature sets the bar grid, later meter changes are ignored; upgrade if songs with mixed meters matter.
  let sig: { tick: number; num: number; den: number } | null = null;
  let endTick = 0;
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const ntrks = (bytes[10] << 8) | bytes[11];
  let p = 8 + u32(4);
  for (let t = 0; t < ntrks && p + 8 <= bytes.length; ) {
    const end = p + 8 + u32(p + 4);
    if (String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]) === "MTrk") {
      t++;
      const open = new Map<number, number>();
      let tick = 0;
      let status = 0;
      let i = p + 8;
      const vlq = () => {
        let v = 0;
        let b;
        do {
          b = bytes[i++];
          v = v * 128 + (b & 0x7f);
        } while (b & 0x80);
        return v;
      };
      const off = (ch: number, note: number) => {
        const k = ch * 128 + note;
        const s = open.get(k);
        if (s !== undefined) {
          notes.push({ ch, note, start: s, end: tick });
          open.delete(k);
        }
      };
      while (i < end) {
        tick += vlq();
        let first = bytes[i++];
        if (first === 0xff) {
          const type = bytes[i++];
          const n = vlq();
          if (type === 0x51 && n === 3) tempos.push({ tick, us: (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2] });
          else if (type === 0x58 && n >= 2 && (!sig || tick < sig.tick)) sig = { tick, num: bytes[i], den: 2 ** bytes[i + 1] };
          i += n;
          status = 0;
          if (type === 0x2f) break;
          continue;
        }
        if (first === 0xf0 || first === 0xf7) {
          i += vlq();
          status = 0;
          continue;
        }
        let d1: number;
        if (first < 0x80) {
          d1 = first;
          first = status;
        } else {
          status = first;
          d1 = bytes[i++];
        }
        const kind = first & 0xf0;
        const ch = first & 15;
        const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[i++];
        if (kind === 0x90 && d2 > 0) {
          off(ch, d1);
          open.set(ch * 128 + d1, tick);
        } else if (kind === 0x80 || kind === 0x90) off(ch, d1);
      }
      for (const [k, s] of open) notes.push({ ch: k >> 7, note: k & 127, start: s, end: Math.max(tick, s) });
      endTick = Math.max(endTick, tick);
    }
    p = end;
  }
  return { notes, tempos, sig: sig as { num: number; den: number } | null, endTick };
}

export function analyzeMidi(bytes: Uint8Array): MidiAnalysis {
  const ppq = parseSmf(bytes).division; // validates the whole file, throws SmfError
  const { notes, tempos, sig, endTick } = readEvents(bytes);

  tempos.sort((a, b) => a.tick - b.tick);
  const map: { tick: number; us: number; ms: number }[] = [{ tick: 0, us: 500000, ms: 0 }];
  for (const t of tempos) {
    const last = map[map.length - 1];
    if (t.tick === last.tick) last.us = t.us;
    else map.push({ tick: t.tick, us: t.us, ms: last.ms + ((t.tick - last.tick) * last.us) / (ppq * 1000) });
  }
  const toMs = (tick: number) => {
    let s = map[0];
    for (const m of map) if (m.tick <= tick) s = m;
    return s.ms + ((tick - s.tick) * s.us) / (ppq * 1000);
  };

  const timeSignature = { num: sig?.num ?? 4, den: sig?.den ?? 4 };
  const barTicks = Math.max(1, (timeSignature.num * ppq * 4) / timeSignature.den);
  const durationMs = toMs(endTick);
  const count = Math.max(1, Math.ceil(endTick / barTicks));
  const bars: MidiBar[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * barTicks;
    const b = a + barTicks;
    const w = new Array<number>(12).fill(0);
    let low = 128;
    for (const n of notes) {
      if (n.ch === 9) continue;
      const o = Math.min(b, n.end) - Math.max(a, n.start);
      if (o > 0) {
        w[n.note % 12] += o;
        low = Math.min(low, n.note);
      }
    }
    bars.push({ index: i, startTick: a, startMs: toMs(a), endMs: i === count - 1 ? durationMs : toMs(b), chord: chordOf(w, low) });
  }

  const per = new Map<number, number>();
  for (const n of notes) per.set(n.ch, (per.get(n.ch) ?? 0) + 1);
  // Offs sort before ons on the same tick, so a hand-over is not counted as overlap.
  const ev = notes.flatMap((n) => [[n.start, 1], [n.end, -1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let peak = 0;
  for (const [, d] of ev) {
    cur += d;
    peak = Math.max(peak, cur);
  }

  const pc = new Array<number>(12).fill(0);
  for (const n of notes) if (n.ch !== 9) pc[n.note % 12] += n.end - n.start;
  return {
    durationMs,
    ppq,
    tempoMap: map.map((m) => ({ tick: m.tick, bpm: 60000000 / m.us, ms: m.ms })),
    timeSignature,
    bars,
    noteCounts: [...per].sort((x, y) => x[0] - y[0]).map(([channel, n]) => ({ channel, notes: n })),
    peakPolyphony: peak,
    key: keyOf(pc),
  };
}

function corr(x: number[], y: number[]): number {
  const mx = x.reduce((s, v) => s + v, 0) / 12;
  const my = y.reduce((s, v) => s + v, 0) / 12;
  let n = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 12; i++) {
    n += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
}

function keyOf(pc: number[]): MidiAnalysis["key"] {
  if (!pc.some((v) => v > 0)) return null;
  let best = -2;
  let out: MidiAnalysis["key"] = null;
  for (const mode of ["major", "minor"] as const) {
    for (let t = 0; t < 12; t++) {
      const r = corr(pc.map((_, i) => pc[(i + t) % 12]), mode === "major" ? MAJOR : MINOR);
      if (r > best) {
        best = r;
        out = { tonic: NAMES[t], mode, name: `${NAMES[t]} ${mode}` };
      }
    }
  }
  return out;
}

// Best template by sounding weight: chord tones count, other pitch classes and absent chord tones cost; a lowest-note root wins ties.
function chordOf(w: number[], low: number): string | null {
  const total = w.reduce((s, v) => s + v, 0);
  if (!total) return null;
  let best = -Infinity;
  let name: string | null = null;
  for (let r = 0; r < 12; r++) {
    for (const [suffix, iv] of CHORDS) {
      const set = new Set(iv.map((i) => (r + i) % 12));
      let inside = 0;
      let miss = 0;
      for (const p of set) {
        inside += w[p];
        if (!w[p]) miss++;
      }
      const score = inside - 2 * (total - inside) - 0.1 * total * miss + (r === low % 12 ? 0.01 * total : 0);
      if (score > best) {
        best = score;
        name = NAMES[r] + suffix;
      }
    }
  }
  return name;
}

export function barAtMs(a: MidiAnalysis, ms: number): number {
  if (!a.bars.length) return -1;
  let i = 0;
  for (const b of a.bars) if (b.startMs <= ms) i = b.index;
  return i;
}
