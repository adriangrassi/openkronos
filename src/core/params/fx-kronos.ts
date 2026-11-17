// Kronos names for the generic effect descriptors: value lists, number scales and the type picker categories.
import effects from "../../generated/effects.json" with { type: "json" };
import type { ParamDesc } from "../fx/desc.ts";
import type { FxCategory } from "../fx/graphs.ts";

export type { FxCategory } from "../fx/graphs.ts";

type Def = { pid: number; name: string; rawMin: number; rawMax: number; fixed: boolean; valueText: string };
const types = effects.types as { id: number; name: string; params: Def[] | null }[];

// Order from the Dynamic Modulation Source List in the parameter guide (two-column PDF text: names confirmed, order not).
export const KRONOS_DMOD_SOURCES: readonly string[] = [
  "Off", "Gate1", "Gate1+Damper", "Gate2", "Gate2+Damper", "Note Number", "Velocity", "Exponential Velocity",
  "After Touch", "JS X", "JS+Y (CC#01)", "JS-Y (CC#02)", "Foot Pedal (CC#04)", "FX Control1 (CC#12)",
  "FX Control2 (CC#13)", "Ribbon (CC#16)", "Value Slider (CC#18)", "Knob Mod.5 (CC#17)", "Knob Mod.6 (CC#19)",
  "Knob Mod.7 (CC#20)", "Knob Mod.8 (CC#21)", "Knob Mod.5 [+]", "Knob Mod.6 [+]", "Knob Mod.7 [+]",
  "Knob Mod.8 [+]", "Damper (CC#64)", "Porta. SW (CC#65)", "Sostenuto (CC#66)", "Soft (CC#67)",
  "SW1 Mod. (CC#80)", "SW2 Mod. (CC#81)", "Foot Switch (CC#82)", "Controller (CC#83)", "VJS +X Mod. (CC#85)",
  "VJS -X Mod. (CC#86)", "VJS +Y Mod. (CC#87)", "VJS -Y Mod. (CC#88)", "Tempo",
];
export const KRONOS_BASE_NOTES: readonly string[] = ["1/32", "1/24", "1/16", "1/12", "1/8", "1/6", "1/4", "1/3", "1/2", "1/1"];

const LISTS = new Map<string, string[]>([
  [`Off~Tempo|38`, [...KRONOS_DMOD_SOURCES]],
  [`1/32~1/1|10`, [...KRONOS_BASE_NOTES]],
  [`1/32~1/2|9`, KRONOS_BASE_NOTES.slice(0, 9)],
  [`Individual~Effect LFO2|3`, ["Individual", "Effect LFO1", "Effect LFO2"]],
  [`Input~FX Control2|3`, ["Input", "FX Control1", "FX Control2"]],
  [`Low Pass~Band Reject|4`, ["Low Pass", "High Pass", "Band Pass", "Band Reject"]],
]);

const pad3 = (n: number) => String(n).padStart(3, "0");
const clean = (s: string) => s.replace(/\s*\[[^\]]*\]/g, "").trim();
const NUM = /^([+-]?)(\d+(?:\.\d+)?)(k?)$/;

function parseNum(s: string): { v: number; dec: number; k: boolean; plus: boolean } | null {
  const m = NUM.exec(clean(s));
  if (!m) return null;
  return {
    v: (m[1] === "-" ? -1 : 1) * Number(m[2]) * (m[3] ? 1000 : 1),
    dec: m[2].includes(".") ? m[2].split(".")[1].length : 0,
    k: m[3] === "k",
    plus: m[1] === "+",
  };
}

function valuesFor(vt: string, min: number, n: number, a: string, b: string): string[] | undefined {
  const list = LISTS.get(`${vt}|${n}`);
  if (list) return list;
  const at = (f: (v: number) => string) => Array.from({ length: n }, (_, i) => f(min + i));
  if (vt === "Dry~Wet" && n === 101) return at((v) => (v === 0 ? "Dry" : v === 100 ? "Wet" : `${v}:${100 - v}`));
  if (vt === "-Wet~+Wet" && n === 201) return at((v) => (v === 0 ? "Dry" : v === -100 ? "-Wet" : v === 100 ? "+Wet" : `${v < 0 ? "-" : "+"}${Math.abs(v)}:${100 - Math.abs(v)}`));
  if (vt === "L000~R127" && n === 128) return at((v) => (v < 64 ? `L${pad3(v)}` : v === 64 ? "C064" : `R${pad3(v)}`));
  if (n === 2 && !parseNum(a) && !parseNum(b)) return [clean(a), clean(b)];
  return undefined;
}

function descOf(d: Def): ParamDesc {
  const base = { key: String(d.pid), name: d.name, min: d.rawMin, max: d.rawMax };
  if (d.fixed) return { ...base, kind: "fixed" };
  const n = d.rawMax - d.rawMin + 1;
  const [a = "", b = ""] = clean(d.valueText).split("~");
  const values = valuesFor(d.valueText, d.rawMin, n, a, b);
  if (values) {
    const kind = values.length === 2 && values[0] === "Off" && values[1] === "On" ? "check" : n <= 64 ? "pick" : "box";
    return { ...base, kind, values, ends: [clean(a), clean(b)] };
  }
  const ends: [string, string] = [clean(a), clean(b)];
  const pa = parseNum(a), pb = parseNum(b);
  if (a === "-Inf" && pb) {
    return { ...base, kind: "box", texts: { [d.rawMin]: "-Inf" }, scale: { lo: d.rawMin, hi: d.rawMax, decimals: 0, plus: pb.plus, exact: true }, ends };
  }
  if (a === "MIDI" && pb) {
    return { ...base, kind: "box", texts: { [d.rawMin]: "MIDI" }, scale: { lo: d.rawMin / 100, hi: pb.v, decimals: pb.dec, plus: pb.plus, exact: true }, ends };
  }
  if (pa && pb) {
    const decimals = Math.max(pa.k ? 0 : pa.dec, pb.k ? 0 : pb.dec);
    const kUnder10k = pa.k || pb.k ? (pa.k ? pa.dec : 2) : undefined;
    const step = d.rawMax > d.rawMin ? (pb.v - pa.v) / (d.rawMax - d.rawMin) : 0;
    const scaled = step * 10 ** decimals;
    const exact = d.rawMax > d.rawMin && Math.abs(scaled - Math.round(scaled)) < 1e-6;
    return { ...base, kind: "box", scale: { lo: pa.v, hi: pb.v, decimals, plus: pb.plus, kUnder10k, exact }, ends };
  }
  // Ends only: the middle names are unknown, so a list shows the two ends and a number shows raw steps.
  return { ...base, kind: n <= 64 && !pa && !pb ? "pick" : "box", ends };
}

const descMemo = new Map<number, ParamDesc[]>();

export function kronosFxDescs(typeId: number): ParamDesc[] {
  const hit = descMemo.get(typeId);
  if (hit) return hit;
  const defs = Number.isInteger(typeId) && typeId > 0 && typeId < types.length ? types[typeId].params ?? [] : [];
  const out = defs.map(descOf);
  descMemo.set(typeId, out);
  return out;
}

// Ranges from the type picker (Dynamics and Cho/Fln/Phs verified on the screens; the rest from the names).
const RANGES: [string, number, number][] = [
  ["Dynamics", 0, 10], ["EQ/Filter", 11, 26], ["OD/Amp/Mic", 27, 39], ["Cho/Fln/Phs", 40, 54],
  ["Mod/P.Shift", 55, 76], ["Delay", 77, 99], ["Reverb/ER", 100, 108], ["Mono-Mono", 109, 140],
  ["Mono/Mono", 141, 185], ["Vintage", 186, 197],
];

export function kronosFxCategories(): FxCategory[] {
  return RANGES.map(([name, lo, hi]) => ({
    name,
    items: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((id) => ({ id, label: `${pad3(id)}: ${types[id].name}` })),
  }));
}
