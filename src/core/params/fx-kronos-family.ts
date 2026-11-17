// Effect type id -> graph specs. Families are fixed by type id; parameter names are bound by pattern inside each scope.
import { groupDescs, type FxSection, type ParamDesc } from "../fx/desc.ts";
import type { FxGraphSpec } from "../fx/graphs.ts";
import { kronosFxDescs } from "./fx-kronos.ts";

const PEQ = [11, 13, 109, 110, 111, 112, 113, 117, 121, 141, 142, 143, 144, 145, 146, 147, 148, 149];
const DYN: Record<number, "comp" | "expand" | "limit"> = { 2: "comp", 3: "expand", 5: "limit", 6: "limit", 7: "limit", 8: "limit" };
const DRIVE = [27, 28, 30, 31, 36, 37, 116, 130, 131, 132, 133, 145, 153, 160, 166, 171, 172, 173, 174, 175];
const DECAY = [100, 101, 102, 103, 104, 105, 106, 107, 108, 140];
const LFO_SECTIONS = ["Chorus/Flanger", "Phaser", "Tremolo"];
const TAP_SECTIONS = ["Multitap Delay", "Multitap BPM Delay"];

const PREFIX = /^\(([^)]+)\) (.*)$/;
const label = (d: ParamDesc) => PREFIX.exec(d.name)?.[2] ?? d.name;
const scopeKey = (d: ParamDesc) => PREFIX.exec(d.name)?.[1] ?? null;

type Scope = { key: string | null; descs: ParamDesc[] };
const scopesOf = (descs: ParamDesc[]): Scope[] => {
  const map = new Map<string | null, ParamDesc[]>();
  for (const d of descs) map.set(scopeKey(d), [...(map.get(scopeKey(d)) ?? []), d]);
  return [...map].map(([key, ds]) => ({ key, descs: ds }));
};
const find = (sc: Scope, want: string | RegExp): ParamDesc | undefined =>
  sc.descs.find((d) => (typeof want === "string" ? label(d) === want : want.test(label(d))));

function sectionOf(sections: FxSection[], name: string): string {
  for (const s of sections) {
    if (s.lines.some((l) => l.desc.name === name)) return s.title;
    if (s.table?.rows.some((r) => r.cells.some((c) => c?.desc.name === name))) return s.title;
  }
  throw new Error(`no section for "${name}"`);
}

const memo = new Map<number, FxGraphSpec[]>();

export function kronosFxGraphs(typeId: number): FxGraphSpec[] {
  const hit = memo.get(typeId);
  if (hit) return hit;
  const descs = kronosFxDescs(typeId);
  const sections = groupDescs(descs);
  const sec = (name: string) => sectionOf(sections, name);
  const scopes = scopesOf(descs);
  const whole: Scope = { key: null, descs };
  const out: FxGraphSpec[] = [];

  if (typeId === 13) {
    out.push({
      graph: "peq", section: sec("Low EQ Cutoff"),
      bands: [
        { hz: "Low EQ Cutoff", gain: "Low EQ Gain", shape: "lowshelf" },
        { hz: "Mid EQ Cutoff", q: "Mid EQ Q", gain: "Mid EQ Gain", shape: "peak" },
        { hz: "High EQ Cutoff", gain: "High EQ Gain", shape: "highshelf" },
      ],
    });
  } else if (PEQ.includes(typeId)) {
    for (const sc of scopes) {
      const bands: Extract<FxGraphSpec, { graph: "peq" }>["bands"] = [];
      for (let n = 1; n <= 4; n++) {
        const hz = find(sc, `Band${n} Cutoff`), gain = find(sc, `Band${n} Gain`);
        if (!hz || !gain) break;
        const shape = n === 1 ? "lowshelf" : n === 4 ? "highshelf" : "peak";
        const shapeRow = n === 1 || n === 4 ? find(sc, `Band${n} Type`)?.name : undefined;
        bands.push({ hz: hz.name, q: find(sc, `Band${n} Q`)?.name, gain: gain.name, shape, shapeRow });
      }
      if (bands.length === 4) out.push({ graph: "peq", section: sec(bands[0].hz), bands });
    }
  }

  if (typeId === 12) {
    const gains = Array.from({ length: 7 }, (_, i) => find(whole, `Band${i + 1} Gain`)?.name);
    if (gains.every((g): g is string => g !== undefined)) out.push({ graph: "geq", section: sec(gains[0]), gains });
  }

  const dyn = DYN[typeId];
  if (dyn) {
    const threshold = find(whole, "Threshold")?.name;
    if (threshold) {
      const ratio = find(whole, "Ratio")?.name, knee = find(whole, "Soft Knee Width")?.name, ceiling = find(whole, "Out Ceiling")?.name;
      out.push({ graph: "dyn", section: sec(threshold), mode: dyn, threshold, ratio, knee, ceiling });
    }
  }

  if (DRIVE.includes(typeId)) {
    const useLabel = typeId === 30 || typeId === 31 ? "Gain" : typeId === 36 || typeId === 37 ? "Tube1 Saturation" : "Drive";
    const pool = typeId === 30 || typeId === 31 ? scopes.filter((s) => s.key === "Guitar Amp Model") : scopes;
    for (const sc of pool) {
      const d = find(sc, useLabel);
      if (d) out.push({ graph: "drive", section: sec(d.name), drive: d.name });
    }
  }

  if (DECAY.includes(typeId)) {
    for (const sc of scopes) {
      const time = find(sc, "Reverb Time") ?? find(sc, "ER Time");
      if (!time) continue;
      const preDelay = find(sc, "Pre Delay")?.name;
      const early = typeId === 107 || typeId === 108;
      const damp = early ? undefined : (find(sc, "Damping") ?? find(sc, "High Damp"))?.name;
      out.push({ graph: "decay", section: sec(time.name), time: time.name, preDelay, damp, early: early || undefined });
    }
  }

  const tapScopes: Scope[] = [
    ...(typeId >= 77 && typeId <= 99 ? [whole] : []),
    ...scopes.filter((s) => s.key !== null && TAP_SECTIONS.includes(s.key)),
  ];
  for (const sc of tapScopes) {
    const taps: Extract<FxGraphSpec, { graph: "taps" }>["taps"] = [];
    for (const d of sc.descs) {
      const time = /^(L|C|R|Left|Right|Tap\d)( Delay)? Time$/.exec(label(d)), note = /^(L|C|R|Tap\d)( Delay)? Base Note$/.exec(label(d));
      if (time) {
        const p = time[1];
        taps.push({ label: p, time: d.name, level: find(sc, new RegExp(`^${p}( Delay)? Level$`))?.name });
      } else if (note) {
        const p = note[1];
        taps.push({ label: p, note: d.name, times: find(sc, new RegExp(`^${p}( Delay)? Times$`))?.name, level: find(sc, new RegExp(`^${p}( Delay)? Level$`))?.name });
      } else if (label(d) === "Delay Time") {
        taps.push({ label: "Delay", time: d.name });
      }
    }
    if (taps.length === 0) continue;
    const feedback = find(sc, "Feedback")?.name ?? find(sc, "L Feedback")?.name ?? find(sc, "Left Feedback")?.name;
    const bpm = find(sc, "BPM")?.name;
    const first = taps[0].time ?? taps[0].note ?? "";
    out.push({ graph: "taps", section: sec(first), taps, feedback, bpm });
  }

  const lfoScopes: Scope[] = [
    ...(typeId >= 40 && typeId <= 76 ? [whole] : []),
    ...scopes.filter((s) => s.key !== null && LFO_SECTIONS.includes(s.key)),
  ];
  for (const sc of lfoScopes) {
    const wave = find(sc, /^LFO( ?1)? Waveform$/), freq = find(sc, /^LFO( ?1)? Frequency$/);
    if (!wave || !freq) continue;
    out.push({
      graph: "lfo", section: sec(wave.name), wave: wave.name, freq: freq.name,
      shape: find(sc, "LFO Shape")?.name,
      phase: (find(sc, "Right LFO Phase") ?? find(sc, "LFO Phase"))?.name,
      sync: find(sc, "LFO BPM/MIDI Sync")?.name,
      note: find(sc, "LFO BPM Base Note")?.name,
      times: find(sc, "LFO BPM Times")?.name,
    });
  }

  memo.set(typeId, out);
  return out;
}
