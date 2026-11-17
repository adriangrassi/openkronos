// Reads and writes fields of KORG object dumps, using the row tables generated from KORG's documents.
// No node: imports, so it also runs in the renderer.

export type Row = {
  ofs: number;
  bitHi: number | null;
  bitLo: number | null;
  group: string;
  name: string;
  rawMin: number;
  rawMax: number;
  fixed: boolean;
  valueText: string;
  signed: boolean;
  // Blank-name rows: the rest of a multi-byte or multi-part field, never editable on their own.
  continuation: boolean;
  // Where the field's bits live, least significant first: [ofs, bitHi, bitLo].
  parts: [number, number, number][];
  typ: number | null;
  soc: number | null;
  sub: number | null;
  pid: number | null;
  idx: number | null;
  // Name of a valueLists entry: this row's values are that list's indices (set only when both end words match it).
  list?: string;
};

export type ParamTables = {
  effectTypes: string[]; // Effect.txt names, indexed by Effect Type value (0..197)
  valueLists: Record<string, string[]>; // "<engine> AMS Sources": modulation source names by value
  programHd1: Row[];
  programExiCommon: Row[];
  combi: Row[];
  global: Row[];
  drumkit: Row[];
  waveseq: Row[];
  engines: { "AL-1": Row[]; "CX-3": Row[]; "STR-1": Row[]; "MS-20EX": Row[]; PolysixEX: Row[]; "MOD-7": Row[]; "SGX-2": Row[]; "EP-1": Row[] };
};

// Engine names by Algorithm Type value (00~09, the numbering at the top of each Prog_EXi.txt section).
export const ENGINE_NAMES = ["Off", "HD-1", "AL-1", "CX-3", "STR-1", "MS-20EX", "PolysixEX", "MOD-7", "SGX-2", "EP-1"];
// Offset of each EXi's engine block in the 4960-byte EXi object: directly after that EXi's Mod.Mixer2 rows (EXi1 ends at 2907, EXi2 at 3959).
const ENGINE_BASE = [2908, 3960];

const signExtend = (v: number, bits: number) => (v >= 2 ** (bits - 1) ? v - 2 ** bits : v);
const widthOf = (r: Row) => r.parts.reduce((a, [, h, l]) => a + h - l + 1, 0);

// Effect Type and Algorithm Type change how a whole block of other bytes is read, so they stay read-only until the block can be reinitialised.
export function isEditable(r: Row): boolean {
  return !r.continuation && !r.fixed && r.name !== "Name" && !/UUID/.test(r.name) && r.name !== "Effect Type" && r.name !== "Algorithm Type";
}

// Assembles the field from its parts, least significant part first.
export function readParam(entry: Uint8Array, r: Row): number {
  let raw = 0;
  let shift = 0;
  for (const [ofs, hi, lo] of r.parts) {
    const w = hi - lo + 1;
    raw += ((entry[ofs] >> lo) & ((1 << w) - 1)) * 2 ** shift;
    shift += w;
  }
  return r.signed && shift > 0 ? signExtend(raw, shift) : raw;
}

// Changes only the bits the field's parts cover; every other bit of every byte is kept.
export function writeParam(entry: Uint8Array, r: Row, value: number): void {
  if (!Number.isInteger(value) || value < r.rawMin || value > r.rawMax) {
    throw new RangeError(`${r.name}: ${value} is outside ${r.rawMin}..${r.rawMax}`);
  }
  const u = value < 0 ? value + 2 ** widthOf(r) : value;
  let shift = 0;
  for (const [ofs, hi, lo] of r.parts) {
    const w = hi - lo + 1;
    const bits = Math.floor(u / 2 ** shift) % 2 ** w;
    const mask = ((1 << w) - 1) << lo;
    entry[ofs] = (entry[ofs] & ~mask) | ((bits << lo) & mask);
    shift += w;
  }
}

const NUM = /^([+-]?)(\d+(?:\.\d+)?)$/;
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const note = (v: number) => `${NOTES[v % 12]}${Math.floor(v / 12) - 1}`;
const UNIT = /\[[^\]]*\]$/;
const PREFIXED = /^([A-Za-z])(\d+)$/;

// KORG's exact value formats for notes, MIDI channels, controllers and numbered names. Anything else returns null.
function namedValue(r: Row, value: number): string | null {
  const { valueText: t, rawMin: lo, rawMax: hi } = r;
  if (t === "C-1~G9" && lo === 0 && hi === 127) return note(value);
  if (t === "Off~G9" && lo === -1 && hi === 127) return value === -1 ? "Off" : note(value);
  if (t === "C-1~G9, Remove" && lo === 0 && hi === 255) return value === 255 ? "Remove" : value <= 127 ? note(value) : null;
  if ((t === "1~Gch" || t === "1~Global") && lo === 0 && hi === 16) return value === 16 ? t.slice(2) : String(value + 1);
  const off = /^Off~(\D*)(\d+)$/.exec(t);
  if (off) {
    const n = Number(off[2]);
    if (n === hi) return value === lo ? "Off" : off[1] + String(value);
    if (lo === 0 && hi === 255 && value === 255) return "Off";
    if (lo === 0 && hi === 255 && value >= 0 && value <= n) return off[1] + String(value);
    return null;
  }
  const span = /^(\D*)(\d+)~(\D*)(\d+)$/.exec(t);
  if (span && span[1] === span[3] && Number(span[4]) - Number(span[2]) === hi - lo) {
    return span[1] + String(Number(span[2]) + value - lo).padStart(span[2].length, "0");
  }
  return null;
}

// Shows a raw value the way KORG's value column writes it; falls back to the raw number.
export function formatValue(r: Row, value: number, tables?: ParamTables): string {
  const raw = String(value);
  if (r.list && tables && value >= r.rawMin && value <= r.rawMax) {
    const name = tables.valueLists[r.list]?.[value];
    if (name !== undefined) return name;
  }
  if (value >= r.rawMin && value <= r.rawMax) {
    const named = namedValue(r, value);
    if (named !== null) return named;
  }
  const parts = r.valueText.split("~");
  if (parts.length !== 2) return raw;
  const lo = parts[0].trim();
  const hi = parts[1].trim();
  const span = r.rawMax - r.rawMin;
  const a = NUM.exec(lo.replace(UNIT, ""));
  const b = NUM.exec(hi.replace(UNIT, ""));
  if (a && b) {
    const x = Number(lo.replace(UNIT, ""));
    const y = Number(hi.replace(UNIT, ""));
    const decimals = (hi.replace(UNIT, "").split(".")[1] ?? "").length;
    const n = span === 0 ? x : x + ((value - r.rawMin) * (y - x)) / span;
    const text = n.toFixed(decimals);
    return hi.startsWith("+") && n > 0 ? `+${text}` : text;
  }
  const pa = PREFIXED.exec(lo);
  const pb = PREFIXED.exec(hi);
  if (pa && pb && span > 0) {
    const x = Number(pa[2]);
    const y = Number(pb[2]);
    const n = Math.round(x + ((value - r.rawMin) * (y - x)) / span);
    const nearHigh = value - r.rawMin > span / 2;
    const prefix = nearHigh ? pb[1] : pa[1];
    return prefix + String(n).padStart(pa[2].length, "0");
  }
  // Words name only the two ends of the range; anything between them is shown as a number.
  if (lo && hi) return value === r.rawMin ? lo : value === r.rawMax ? hi : raw;
  return raw;
}

function algorithmRow(tables: ParamTables, group: string): Row {
  const r = tables.programExiCommon.find((x) => x.group === group && x.name === "Algorithm Type");
  if (!r) throw new Error(`no Algorithm Type row in ${group}`);
  return r;
}

export function exiEngines(tables: ParamTables, entry: Uint8Array): [string, string] {
  return [
    ENGINE_NAMES[readParam(entry, algorithmRow(tables, "EXi1 Common"))] ?? "Off",
    ENGINE_NAMES[readParam(entry, algorithmRow(tables, "EXi2 Common"))] ?? "Off",
  ];
}

export type ParamType = "hd1" | "exi" | "combi" | "global" | "drumkit" | "waveseq";

// Drum kit and wave sequence tables spell out only some of their repeats. Each repeat is a copy of one template, shifted and relabelled.
const DRUM_NOTE0 = 24; // first note; bytes 0..23 are the kit name
const DRUM_NOTE_LEN = 300;
const DRUM_ZONE_LEN = 34;
const DRUM_VEL0 = 296; // absolute offset of the velocity groups in note 1
const DRUM_COMMON0 = 317; // absolute offset of the common rows in note 1 (relative 293..298)
const WAVE_STEP0 = 40;
const WAVE_STEP_LEN = 34;
const expanded = new WeakMap<ParamTables, Partial<Record<"drumkit" | "waveseq", Row[]>>>();

function repeat(template: Row[], base: number, label: string, rel: number): Row[] {
  return template.map((t) => ({ ...t, ofs: base + t.ofs - rel, parts: t.parts.map(([o, h, l]) => [base + o - rel, h, l] as [number, number, number]), group: label }));
}

function drumKitRows(tables: ParamTables): Row[] {
  const cached = expanded.get(tables)?.drumkit;
  if (cached) return cached;
  const inRange = (lo: number, hi: number) => tables.drumkit.filter((r) => r.ofs >= lo && r.ofs < hi);
  const names = inRange(0, DRUM_NOTE0);
  const zone = inRange(DRUM_NOTE0, DRUM_NOTE0 + DRUM_ZONE_LEN);
  const vel = inRange(DRUM_VEL0, DRUM_VEL0 + 21);
  const common = inRange(DRUM_COMMON0, DRUM_COMMON0 + 7);
  const out = [...names];
  for (let n = 1; n <= 128; n++) {
    const base = DRUM_NOTE0 + DRUM_NOTE_LEN * (n - 1);
    for (let z = 1; z <= 8; z++) out.push(...repeat(zone, base + DRUM_ZONE_LEN * (z - 1), `Note${n} Zone${z}`, DRUM_NOTE0));
    out.push(...repeat(vel, base, `Note${n} Velocity`, DRUM_NOTE0));
    out.push(...repeat(common, base, `Note${n} Common`, DRUM_NOTE0));
  }
  expanded.set(tables, { ...expanded.get(tables), drumkit: out });
  return out;
}

function waveSeqRows(tables: ParamTables): Row[] {
  const cached = expanded.get(tables)?.waveseq;
  if (cached) return cached;
  const common = tables.waveseq.filter((r) => r.ofs < WAVE_STEP0);
  const step = tables.waveseq.filter((r) => r.ofs >= WAVE_STEP0 && r.ofs < WAVE_STEP0 + WAVE_STEP_LEN);
  const out = [...common];
  for (let s = 1; s <= 64; s++) out.push(...repeat(step, WAVE_STEP0 + WAVE_STEP_LEN * (s - 1), `Step${s}`, WAVE_STEP0));
  expanded.set(tables, { ...expanded.get(tables), waveseq: out });
  return out;
}

export function paramsFor(tables: ParamTables, type: ParamType, entry: Uint8Array): Row[] {
  if (type === "hd1") return tables.programHd1;
  if (type === "combi") return tables.combi;
  if (type === "global") return tables.global;
  if (type === "drumkit") return drumKitRows(tables);
  if (type === "waveseq") return waveSeqRows(tables);
  const rows = [...tables.programExiCommon];
  const engines = exiEngines(tables, entry);
  engines.forEach((name, i) => {
    const block = tables.engines[name as keyof ParamTables["engines"]];
    if (!block) return; // "Off" and "HD-1" have no engine block in these tables
    const base = ENGINE_BASE[i];
    for (const r of block) {
      const label = `EXi${i + 1} ${name}`;
      rows.push({
        ...r,
        ofs: base + r.ofs,
        parts: r.parts.map(([o, h, l]) => [base + o, h, l]),
        group: r.group ? `${label}: ${r.group}` : label,
      });
    }
  });
  return rows;
}
