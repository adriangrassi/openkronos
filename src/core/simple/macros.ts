// Simple mode macros: eight named moves per sound, each a set of real settings and how far each one moves per unit.
// Pure: no node: imports, so it also runs in the renderer. Data tables are per engine and easy to tune.
import { isEditable, paramsFor, readParam, writeParam, type ParamTables, type ParamType, type Row } from "../params/params.ts";

export const MACRO_NAMES = ["Brightness", "Attack", "Release", "Body", "Drive", "Movement", "Space", "Width"] as const;
export type MacroName = (typeof MACRO_NAMES)[number];
export type Target = { row: Row; amount: number };
export type Macro = { name: MacroName; targets: Target[] };

// [group, setting name, amount]: the group is the row's group without the EXi prefix ("EXi1 AL-1: " is dropped).
// A move of 50 units changes each target by 50 x amount, rounded and clamped to the setting's range.
type Ref = [group: string, name: string, amount: number];
type Table = Partial<Record<MacroName, Ref[]>>;

// Keys: "HD-1" for Programs of the HD-1 type; the EXi engine names; "Common" for rows that are not part of any engine.
const TABLES: Record<string, Table> = {
  "HD-1": {
    Brightness: [["OSC1 Filter A", "Cutoff", 1], ["OSC2 Filter A", "Cutoff", 1], ["OSC1 Filter B", "Cutoff", 1], ["OSC2 Filter B", "Cutoff", 1]],
    Attack: [["OSC1 Amplifier EG", "Attack Time", 1], ["OSC2 Amplifier EG", "Attack Time", 1], ["OSC1 Filter EG", "Attack Time", 1], ["OSC2 Filter EG", "Attack Time", 1]],
    Release: [["OSC1 Amplifier EG", "Release Time", 1], ["OSC2 Amplifier EG", "Release Time", 1], ["OSC1 Filter EG", "Release Time", 1], ["OSC2 Filter EG", "Release Time", 1]],
    Body: [["OSC1 Amplifier", "Level", 1], ["OSC2 Amplifier", "Level", 1]],
    Drive: [["OSC1 Drive", "Drive", 1], ["OSC2 Drive", "Drive", 1], ["OSC1 Drive", "Boost", 1], ["OSC2 Drive", "Boost", 1]],
    Movement: [["OSC1 Pitch", "LFO1 Intensity", 1], ["OSC1 Filter A", "LFO1 Intensity", 1], ["OSC2 Filter A", "LFO1 Intensity", 1]],
    Space: [["Insert Effect1", "Send1", 1], ["Insert Effect1", "Send2", 1], ["OSC1 Output", "Send1", 1], ["OSC1 Output", "Send2", 1], ["OSC2 Output", "Send1", 1], ["OSC2 Output", "Send2", 1]],
    Width: [["OSC1 Output", "Panpot Mod.Intensity", 1], ["OSC2 Output", "Panpot Mod.Intensity", 1]],
  },
  Common: {
    Space: [["Insert Effect1", "Send1", 1], ["Insert Effect1", "Send2", 1], ["EXi1 Output", "Send1", 1], ["EXi1 Output", "Send2", 1], ["EXi2 Output", "Send1", 1], ["EXi2 Output", "Send2", 1]],
    Width: [["EXi1 Output", "Panpot Mod.Intensity", 1], ["EXi2 Output", "Panpot Mod.Intensity", 1]],
  },
  "AL-1": {
    Brightness: [["Filter A", "Cutoff", 1], ["Filter B", "Cutoff", 1]],
    Attack: [["Amplifier EG", "Attack Time", 1], ["EG1 (Filter)", "Attack Time", 1]],
    Release: [["Amplifier EG", "Release Time", 1], ["EG1 (Filter)", "Release Time", 1]],
    Body: [["OSC1", "Level", 1], ["OSC2", "Level", 1], ["Sub OSC", "Level", 1]],
    Drive: [["Drive", "Drive", 1], ["Drive", "Boost", 1]],
    Movement: [["Filter A", "LFO Intensity", 1], ["Common Pitch", "LFO Intensity", 1]],
  },
  "STR-1": {
    Brightness: [["Filter A", "Cutoff", 1], ["Filter B", "Cutoff", 1]],
    Attack: [["Amplifier EG", "Attack Time", 1], ["EG1 (Filter)", "Attack Time", 1]],
    Release: [["Amplifier EG", "Release Time", 1], ["EG1 (Filter)", "Release Time", 1]],
    Movement: [["Filter A", "LFO Intensity", 1]],
  },
  "MS-20EX": {
    Brightness: [["LPF", "Cutoff", 1], ["HPF", "Cutoff", 1]],
    Attack: [["EG3", "Attack Time", 1], ["EG4", "Attack Time", 1]],
    Release: [["EG3", "Release Time", 1], ["EG4", "Release Time", 1]],
    Body: [["VCO1", "Level", 1], ["VCO2", "Level", 1]],
    Drive: [["LPF", "Resonance", 1]],
  },
  PolysixEX: {
    Brightness: [["Filter", "Cutoff", 10]],
    Attack: [["EG", "Attack Time", 10], ["EG2", "Attack Time", 1]],
    Release: [["EG", "Release Time", 10], ["EG2", "Release Time", 1]],
    Body: [["VCA", "Volume", 10]],
    Movement: [["VCO", "PWM Speed", 10]],
  },
  "MOD-7": {
    Brightness: [["Filter A", "Cutoff", 1], ["Filter B", "Cutoff", 1]],
    Attack: [["Amplifier EG", "Attack Time", 1], ["EG1", "Attack Time", 1]],
    Release: [["Amplifier EG", "Release Time", 1], ["EG1", "Release Time", 1]],
    Movement: [["Filter A", "LFO Intensity", 1]],
  },
  "CX-3": {
    Brightness: [["Drawbar", "Upper Drawbar2 Level", 0.1], ["Drawbar", "Upper Drawbar3 Level", 0.1]],
    Body: [["Basic", "Overtone Level", 1], ["Basic", "Leakage Level", 1]],
    Drive: [["Amplifier", "Amp Gain", 1]],
    Movement: [["Vibrato/Chorus", "Depth", 1], ["Vibrato/Chorus", "Mix", 1]],
  },
  "SGX-2": {
    Brightness: [["User Param", "Lid Position", 1]],
    Body: [["User Param", "String Resonance Depth", 1]],
    Release: [["User Param", "Release Time", 1]],
  },
  "EP-1": {
    Body: [["Osc", "Osc Level", 1], ["EP Amp", "Level", 1]],
    Movement: [["IFX Orange Black Phaser", "Depth", 1], ["IFX Vintage Chorus", "Depth", 1]],
  },
};

// Lookup from "engine|group|name" to every macro that names that setting.
const INDEX = new Map<string, { macro: MacroName; amount: number }[]>();
for (const [engine, table] of Object.entries(TABLES)) {
  for (const macro of MACRO_NAMES) {
    for (const [group, name, amount] of table[macro] ?? []) {
      const k = `${engine}|${group}|${name}`;
      INDEX.set(k, [...(INDEX.get(k) ?? []), { macro, amount }]);
    }
  }
}

const ENGINES = ["AL-1", "CX-3", "STR-1", "MS-20EX", "PolysixEX", "MOD-7", "SGX-2", "EP-1"];

// Which table and which group a row belongs to. EXi engine rows are "EXi<n> <engine>: <group>" or "EXi<n> <engine>".
function locate(type: ParamType, r: Row): { engine: string; group: string } {
  if (type === "hd1") return { engine: "HD-1", group: r.group };
  const m = /^EXi\d (.*)$/.exec(r.group);
  if (m) {
    const engine = ENGINES.find((e) => m[1] === e || m[1].startsWith(`${e}: `));
    if (engine) return { engine, group: m[1].slice(engine.length).replace(/^: /, "") };
  }
  return { engine: "Common", group: r.group };
}

// The eight macros for one Program, with the real rows each one moves. Rows that are not editable never appear.
export function macrosFor(tables: ParamTables, type: Exclude<ParamType, "combi" | "global" | "drumkit" | "waveseq">, entry: Uint8Array): Macro[] {
  const targets = new Map<MacroName, Target[]>(MACRO_NAMES.map((n) => [n, []]));
  for (const r of paramsFor(tables, type, entry)) {
    if (!isEditable(r) || r.rawMax <= r.rawMin) continue;
    const { engine, group } = locate(type, r);
    for (const hit of INDEX.get(`${engine}|${group}|${r.name}`) ?? []) targets.get(hit.macro)!.push({ row: r, amount: hit.amount });
  }
  return MACRO_NAMES.map((name) => ({ name, targets: targets.get(name)! }));
}

// Applies several macro moves at once. Every target is read from the input, so the moves do not compound.
export function applyMacros(entry: Uint8Array, moves: { macro: Macro; delta: number }[]): Uint8Array {
  const out = Uint8Array.from(entry);
  for (const { macro, delta } of moves) {
    for (const t of macro.targets) {
      const v = Math.min(t.row.rawMax, Math.max(t.row.rawMin, readParam(entry, t.row) + Math.round(delta * t.amount)));
      writeParam(out, t.row, v);
    }
  }
  return out;
}

export function applyMacro(entry: Uint8Array, macro: Macro, delta: number): Uint8Array {
  return applyMacros(entry, [{ macro, delta }]);
}

// Names of the settings whose value differs between two versions of one sound, for the "changed" list.
export function changedSettings(before: Uint8Array, after: Uint8Array, macros: Macro[]): string[] {
  const seen = new Set<string>();
  for (const m of macros) {
    for (const t of m.targets) {
      if (readParam(before, t.row) !== readParam(after, t.row)) seen.add([t.row.group, t.row.name].filter((s) => s !== "").join(" / "));
    }
  }
  return [...seen];
}
