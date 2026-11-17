// Style A panel view: which real parameter sits on which card. Pure: no DOM.
// A card names its controls by table group and parameter name. Whatever no card names goes to `other`, grouped as the List view groups it, so nothing becomes unreachable.
import type { Row } from "../params/params.ts";
import { keyOf } from "./view.ts";

export type CardKind = "dial" | "fader" | "toggle" | "pick";
// pan: the value is a pan position, drawn with its centre as the arc origin.
export type CardCell = { group: string; name: string; kind: CardKind; label?: string; pan?: boolean };
// w: the card's share of its row; the panel view packs the cards three to a row, in this order.
export type CardSpec = { id: string; title: string; w: number; cells: CardCell[] };
export type Card = Omit<CardSpec, "cells"> & { cells: (CardCell & { row: Row })[] };
export type ListRow = { r: Row; group: string };
export type CardSet = { cards: Card[]; other: { group: string; rows: Row[] }[]; placed: number; total: number };

const c = (kind: CardKind) => (group: string, name: string, label?: string, pan?: boolean): CardCell => ({ group, name, kind, label, pan });
const dial = c("dial"), fader = c("fader"), toggle = c("toggle"), pick = c("pick");

function oscCards(n: 1 | 2): CardSpec[] {
  const O = `OSC${n}`, F = `${O} Filter A`;
  return [
    { id: `osc${n}`, title: O, w: 1, cells: [dial(`${O} Output`, "Patch Level", "Level"), dial(`${O} Pitch`, "Tune"), dial(`${O} Pitch`, "Octave"), dial(`${O} Pitch`, "Pitch Slope", "Slope"), dial(`${O} Pitch`, "Transpose"), dial(`${O} Pitch`, "Pitch EG Intensity", "EG int.")] },
    { id: `filter${n}`, title: `Filter${n}`, w: 1, cells: [pick(F, "Filter Type", "Type"), dial(F, "Cutoff"), dial(F, "Resonance", "Resonance"), dial(F, "EG Intensity", "EG int."), dial(F, "Keyboard Track", "Key track"), dial(F, "Velocity EG Intensity", "Velocity"), dial(`${O} Drive`, "Boost")] },
    { id: `amp${n}`, title: `Amp${n}`, w: 1.36, cells: [dial(`${O} Amplifier`, "Level"), dial(`${O} Output`, "Panpot", "Pan", true), fader(`${O} Amplifier EG`, "Attack Time", "Attack"), fader(`${O} Amplifier EG`, "Decay Time", "Decay"), fader(`${O} Amplifier EG`, "Slope Time", "Slope"), fader(`${O} Amplifier EG`, "Sustain Level", "Sustain"), fader(`${O} Amplifier EG`, "Release Time", "Release")] },
  ];
}

function exiCards(n: 1 | 2): CardSpec[] {
  const O = `EXi${n} Output`;
  return [{ id: `exi${n}`, title: `EXi${n}`, w: 1, cells: [dial(O, "Patch Level", "Level"), dial(O, "Panpot", "Pan", true), dial(O, "Send1"), dial(O, "Send2"), dial(`EXi${n} Common`, "Transpose"), toggle(O, "Mute")] }];
}

const SHAPING: CardSpec[] = [
  { id: "pitch", title: "Pitch EG / LFO", w: 1.36, cells: [pick("Common LFO", "Waveform", "Wave"), fader("Pitch EG", "Attack Time", "EG attack"), fader("Pitch EG", "Decay Time", "EG decay"), fader("Pitch EG", "Release Time", "EG release"), dial("Common LFO", "Frequency", "LFO rate"), dial("Common LFO", "Shape"), dial("Common LFO", "Offset")] },
  { id: "eq", title: "3 Band EQ", w: 1, cells: [toggle("Track EQ", "Bypass"), fader("Track EQ", "Low Gain", "Low"), fader("Track EQ", "Mid Gain", "Mid"), fader("Track EQ", "High Gain", "High"), dial("Track EQ", "Mid Frequency", "Mid freq"), dial("Track EQ", "Trim")] },
  { id: "karma", title: "KARMA", w: 1, cells: [toggle("KARMA Common", "KARMA Fx Switch", "Karma"), toggle("KARMA Common", "Latch Switch", "Latch"), toggle("KARMA Common", "Pad Mode", "Pad mode"), dial("KARMA Common", "Tempo")] },
  { id: "insert", title: "Insert effects", w: 1.36, cells: Array.from({ length: 12 }, (_, i) => toggle(`Insert Effect${i + 1}`, "Switch", `Ins ${i + 1}`)) },
];
const VOICE: CardSpec[] = [
  { id: "voice", title: "Voice", w: 1.36, cells: [pick("Common", "Oscillator Mode", "Mode"), pick("Common", "Key Priority", "Priority"), toggle("Common", "Hold"), toggle("Common", "Unison"), toggle("Common", "Legato"), toggle("Common", "Single Trigger", "Single trig."), toggle("Common", "Poly Legato", "Poly legato"), dial("Common", "Unison Detune", "Detune"), dial("Common", "Stereo Spread", "Spread"), dial("Common", "Max # of Notes", "Max notes")] },
];

// An EXi's engine card: the first few numeric rows of its engine group, in the order the table lists them.
const ENGINE_SKIP = /Type|Mode|Source|Assign|Switch|Enable|On$/;
function engineCard(n: 1 | 2, rows: ListRow[]): { spec: CardSpec; title: string } | null {
  const g = rows.map((x) => x.group).find((x) => x.startsWith(`EXi${n} `) && !/^EXi\d (Common|Output|Input|Mod)/.test(x));
  if (!g) return null;
  const cells = rows.filter((x) => x.group === g && x.r.rawMax - x.r.rawMin >= 3 && x.r.rawMax - x.r.rawMin <= 255 && !ENGINE_SKIP.test(x.r.name)).slice(0, 6).map((x) => dial(g, x.r.name));
  return cells.length ? { spec: { id: `engine${n}`, title: g.split(":")[0], w: 1, cells }, title: g.split(":")[0] } : null;
}

export function cardsFor(rows: ListRow[], type: "hd1" | "exi"): CardSet {
  const index = new Map<string, ListRow[]>();
  for (const x of rows) { const k = `${x.group}/${x.r.name}`; const l = index.get(k); if (l) l.push(x); else index.set(k, [x]); }
  const used = new Set<string>();
  // The panel's own order: what shapes the sound first, then the engine's pages, and Other (outside this list) last.
  const specs: CardSpec[] = type === "hd1" ? [...oscCards(1), ...oscCards(2), ...SHAPING, ...VOICE] : [...SHAPING, ...VOICE];
  if (type === "exi") for (const n of [1, 2] as const) { specs.push(...exiCards(n)); const e = engineCard(n, rows); if (e) specs.push(e.spec); }
  const cards: Card[] = [];
  for (const s of specs) {
    const cells: Card["cells"] = [];
    for (const cell of s.cells) {
      const hit = index.get(`${cell.group}/${cell.name}`)?.find((x) => !used.has(keyOf(x.r)));
      if (!hit) continue;
      used.add(keyOf(hit.r));
      cells.push({ ...cell, row: hit.r });
    }
    if (cells.length) cards.push({ ...s, title: s.id === "pitch" && !cells.some((x) => x.group === "Pitch EG") ? "LFO" : s.title, cells });
  }
  const left = new Map<string, Row[]>();
  for (const x of rows) if (!used.has(keyOf(x.r))) { const l = left.get(x.group); if (l) l.push(x.r); else left.set(x.group, [x.r]); }
  const other = [...left].map(([group, r]) => ({ group, rows: r }));
  return { cards, other, placed: used.size, total: rows.length };
}
