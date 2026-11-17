// Parses KORG's text tables (research/korg-sysex, KORG's files, included for building) into src/generated/params.json.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ParamTables, Row } from "../src/core/params/params.ts";

const root = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(root, "research/korg-sysex/midiimp/MIDI implementation");
const doc = (name: string) => readFileSync(path.join(DOCS, name), "latin1");

// A data row has a number or blank in OFS. "*" rows are undocumented and skipped.
const cellsOf = (l: string) => l.split("|").map((x) => x.trim());
const isRow = (l: string) => {
  if (!/^\|\s*\d*\s*\|/.test(l) || /^\|\s*\|\s*\|\s*\|/.test(l)) return false;
  const c = cellsOf(l);
  return c[2] !== "*" && c[3] !== "*";
};

const hexOf = (s: string) => parseInt(s, 16);
const signed = (v: number, bits: number) => (v >= 2 ** (bits - 1) ? v - 2 ** bits : v);
const numOrNull = (s: string | undefined) => {
  const m = /^\s*(\d+)/.exec(s ?? "");
  return m ? Number(m[1]) : null;
};
// A bit cell "5~0" or "6": [high, low]; blank = whole byte (null).
const bitsOf = (s: string): [number, number] | null => {
  const m = /^(\d)(?:~(\d))?$/.exec(s);
  if (!m) return null;
  if (m[2] === undefined) return [Number(m[1]), Number(m[1])];
  // "0~1" is written low to high in some rows; the field is the same either way
  return [Math.max(Number(m[1]), Number(m[2])), Math.min(Number(m[1]), Number(m[2]))];
};

type Data = { fixed: boolean; rawMin: number; rawMax: number; signed: boolean };
function dataOf(d: string): Data {
  if (d === "" || d === "*") return { fixed: false, rawMin: 0, rawMax: 0xff, signed: false };
  const fixed = /^([0-9A-F]+)\(fixed\)$/.exec(d);
  if (fixed) {
    const v = hexOf(fixed[1]);
    return { fixed: true, rawMin: v, rawMax: v, signed: false };
  }
  // shortcut: the Start Seed cell "80000000~7FFF" is truncated in KORG's text; read as full signed 32-bit, -2^31..2^31-1
  if (d === "80000000~7FFF") return { fixed: false, rawMin: -2147483648, rawMax: 2147483647, signed: true };
  // shortcut: UUID cells (sample-bank IDs, all zero in the factory data) have no range in KORG's text; read as one byte 0..255 and never edited
  if (/^[0-9A-F]{13}$/.test(d)) return { fixed: false, rawMin: 0, rawMax: 0xff, signed: false };
  const m = /^([0-9A-F]+)~([0-9A-F]+)(?:, ([0-9A-F]+))?$/.exec(d);
  // shortcut: the one textual data cell (Global 24699, "0:Works Within~, 1:Transposes~") is a 1-bit choice, so it is taken as 0..1
  if (!m) {
    if (d.startsWith("0:") && d.includes("1:")) return { fixed: false, rawMin: 0, rawMax: 1, signed: false };
    throw new Error(`unknown data(hex) cell "${d}"`);
  }
  const lo = hexOf(m[1]);
  const hi = hexOf(m[2]);
  const extra = m[3] === undefined ? hi : Math.max(hi, hexOf(m[3]));
  // a low hex above the high hex wraps around: two's complement in the field's width (whole bytes)
  if (lo > hi) {
    const bits = Math.ceil(m[1].length / 2) * 8;
    const a = signed(lo, bits);
    const b = signed(hi, bits);
    // shortcut: a wrap that inverts after sign conversion (Global "FF~F7", Note/CC#) is not one interval; it is read unsigned as 0..FF
    if (a > b) return { fixed: false, rawMin: 0, rawMax: 2 ** bits - 1, signed: false };
    return { fixed: false, rawMin: a, rawMax: b, signed: true };
  }
  // shortcut: a list cell "00~7F, FF" is read as one range 00..FF (the listed extra value widens it; the 0x80..0xFE gap is not enforced)
  return { fixed: false, rawMin: lo, rawMax: extra, signed: false };
}

// Bits a field needs to hold its range.
function bitsNeeded(d: Data): number {
  let w = 1;
  if (d.signed) {
    while (d.rawMin < -(2 ** (w - 1)) || d.rawMax > 2 ** (w - 1) - 1) w++;
  } else {
    while (2 ** w - 1 < d.rawMax) w++;
  }
  return w;
}

type Layout = { ofs: number; bit: number; group: number; name: number; data: number; value: number; typ: number; soc: number; sub: number; pid: number; idx: number };
// Layouts (cell index after split on "|"): two-column tables, one-column Prog_EXi, DrumKit, WaveSequence.
const TWO: Layout = { ofs: 1, bit: 2, group: 3, name: 4, data: 5, value: 6, typ: 7, soc: 8, sub: 9, pid: 10, idx: 11 };
const ONE: Layout = { ofs: 1, bit: 2, group: -1, name: 3, data: 4, value: 5, typ: 6, soc: 7, sub: 8, pid: 9, idx: 10 };
const DRUM: Layout = { ofs: 1, bit: 2, group: 3, name: 4, data: 5, value: 6, typ: -1, soc: -1, sub: -1, pid: 8, idx: -1 };
const WAVE: Layout = { ofs: 1, bit: 2, group: 3, name: 4, data: 5, value: 6, typ: -1, soc: -1, sub: -1, pid: 8, idx: 7 };

type Bits = [number, number];
// Builds the Rows of one table. A named row owns its bits, then absorbs the blank-name rows after it
// only until it holds what its range needs; the rest of those blank rows are padding and own nothing.
function parseTable(text: string, L: Layout): Row[] {
  const raw: { row: Row; bits: Bits | null }[] = [];
  let ofs = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!isRow(line)) continue;
    const c = cellsOf(line);
    if (c[L.ofs] !== "") ofs = Number(c[L.ofs]); // a blank OFS continues the previous row
    const bits = bitsOf(c[L.bit]);
    const d = dataOf(c[L.data]);
    let group = L.group < 0 ? "" : c[L.group];
    let name = c[L.name];
    if (L.group < 0) {
      // Prog_EXi writes "[Group] Name" in one column
      const m = /^\[([^\]]*)\]\s*(.*)$/.exec(name);
      if (m) [group, name] = [m[1], m[2]];
    }
    const num = (i: number) => (i < 0 ? null : numOrNull(c[i]));
    const row: Row = {
      ofs,
      bitHi: bits ? bits[0] : null,
      bitLo: bits ? bits[1] : null,
      group,
      name,
      rawMin: d.rawMin,
      rawMax: d.rawMax,
      fixed: d.fixed,
      valueText: c[L.value] ?? "",
      signed: d.signed,
      continuation: name === "",
      parts: [],
      typ: num(L.typ),
      soc: num(L.soc),
      sub: num(L.sub),
      pid: num(L.pid),
      idx: num(L.idx),
    };
    raw.push({ row, bits });
  }
  return raw.map(({ row, bits }, i) => {
    if (row.continuation) return row;
    const own: Bits = bits ?? [7, 0];
    const parts: [number, number, number][] = [[row.ofs, own[0], own[1]]];
    let width = own[0] - own[1] + 1;
    const need = bitsNeeded(row);
    for (let j = i + 1; j < raw.length && raw[j].row.continuation && width < need; j++) {
      const b: Bits = raw[j].bits ?? [7, 0];
      parts.push([raw[j].row.ofs, b[0], b[1]]);
      width += b[0] - b[1] + 1;
    }
    return { ...row, parts };
  });
}

// VoiceModels/*.txt: each "<engine> AMS Sources" table lists modulation sources as "src  name", numbered from 0.
function parseLists(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const dir = path.join(DOCS, "SysExParams/VoiceModels");
  for (const file of readdirSync(dir)) {
    const lines = readFileSync(path.join(dir, file), "latin1").split(/\r?\n/);
    lines.forEach((title, i) => {
      const m = /^(.+) AMS Sources\s*$/.exec(title);
      if (!m) return;
      const list: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const r = /^\s*(\d+)\s+(.*?)\s*$/.exec(lines[j]);
        if (!r) {
          if (list.length) break;
          continue;
        }
        if (Number(r[1]) !== list.length) throw new Error(`${file}: ${m[1]} AMS Sources row ${r[1]} is out of order`);
        list.push(r[2]);
      }
      out[`${m[1]} AMS Sources`] = list;
    });
  }
  return out;
}

// A row takes a list only when both end words are that list's entries at its own rawMin and rawMax.
function withList(rows: Row[], lists: Record<string, string[]>, name: string): Row[] {
  const list = lists[name];
  if (!list) throw new Error(`no ${name} table`);
  return rows.map((r) => {
    const [a, b] = r.valueText.split("~");
    return !r.continuation && b !== undefined && list[r.rawMin] === a.trim() && list[r.rawMax] === b.trim() ? { ...r, list: name } : r;
  });
}

// Prog_EXi.txt: one table per engine, numbered as the algorithm list. Offsets are relative to the engine block.
const ENGINE_SECTIONS = ["AL-1", "CX-3", "STR-1", "MS-20EX", "PolysixEX", "MOD-7", "SGX-2", "EP-1"] as const;
function parseEngines(lists: Record<string, string[]>): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  const sections = new Map<string, string[]>();
  let cur: string | null = null;
  for (const line of doc("Prog_EXi.txt").split(/\r?\n/)) {
    const m = /^\d+:([A-Za-z0-9.-]+)/.exec(line);
    if (m) {
      cur = m[1];
      sections.set(cur, []);
    } else if (cur) sections.get(cur)!.push(line);
  }
  for (const name of ENGINE_SECTIONS) {
    // SGX-2 has no table of its own; KORG's SGX-1 sources apply to it.
    const list = name === "SGX-2" ? "SGX-1" : name;
    out[name] = withList(parseTable((sections.get(name) ?? []).join("\n"), ONE), lists, `${list} AMS Sources`);
  }
  return out;
}

// Effect.txt: one "NNN:Name" header per effect, numbered 0..197 in order.
function parseEffects(): string[] {
  const names = doc("Effect.txt")
    .split(/\r?\n/)
    .map((l) => /^(\d+):(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), m[2]] as const);
  names.forEach(([n], i) => {
    if (n !== i) throw new Error(`Effect.txt header ${n} is out of order at ${i}`);
  });
  return names.map(([, name]) => name);
}

// KARMA Preset GE Names.txt: "Category: X" headings, then "<number>: <name>" lines numbered from 0. Numbers are GE Number values.
function parseGe(): { names: string[]; categories: string[] } {
  const lines = readFileSync(path.join(root, "research/korg-sysex/sysex/SysExEnums/KARMA Preset GE Names.txt"), "latin1").split(/\r?\n/);
  const names: string[] = [];
  const categories: string[] = [];
  let category = "";
  for (const l of lines) {
    const c = /^Category: (.+?)\s*$/.exec(l);
    if (c) category = c[1];
    const m = /^(\d+): (.+?)\s*$/.exec(l);
    if (!m) continue;
    if (Number(m[1]) !== names.length) throw new Error(`GE name ${m[1]} is out of order at ${names.length}`);
    names.push(m[2]);
    categories.push(category);
  }
  return { names, categories };
}

const ge = parseGe();
const valueLists = { ...parseLists(), "KARMA GE": ge.names, "KARMA GE Category": ge.categories };
const tables: ParamTables = {
  effectTypes: parseEffects(),
  valueLists,
  programHd1: withList(parseTable(doc("Prog_HD-1.txt"), TWO), valueLists, "HD-1 AMS Sources"),
  programExiCommon: parseTable(doc("Prog_EXi_Common.txt"), TWO),
  combi: parseTable(doc("CombiAndSongTimbreSet.txt"), TWO).map((r) => (r.name === "GE Number" ? { ...r, list: "KARMA GE" } : r)),
  global: parseTable(doc("Global.txt"), TWO),
  drumkit: parseTable(doc("DrumKit.txt"), DRUM),
  waveseq: parseTable(doc("WaveSequence.txt"), WAVE),
  engines: parseEngines(valueLists),
};

const outDir = path.join(root, "src/generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "params.json"), JSON.stringify(tables));
console.log(Object.entries(tables).map(([k, v]) => (Array.isArray(v) ? `${k} ${v.length}` : `${k} ${Object.values(v).map((x) => x.length).join("/")}`)).join("\n"));
