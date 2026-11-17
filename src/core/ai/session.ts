// The safe actions a model may take on a sound library: find, read, set named settings, copy, and build Combis.
// Imports only the library and the parameter tables. Every write goes through writeParam on a copy of the entry,
// and a whole entry is written back only when the call is accepted.
import { getEntry, listBanks, setEntry, type BankInfo } from "../pcg/library.ts";
import { applyMultisample, msLabel, readZones, type MsRef } from "../pcg/multisamples.ts";
import type { PcgFile } from "../pcg/pcg.ts";
import { referencedSlots } from "../pcg/refs.ts";
import { exiEngines, formatValue, isEditable, paramsFor, readParam, writeParam, type ParamTables, type Row } from "../params/params.ts";
import { changeEffectType, effectRowsAt } from "../params/effects.ts";
import type { LayerPlan, LayerStep } from "./layer.ts";
import { engineIn, engineSummary, lookupParamDoc } from "./paramDocs.ts";

export type Slot = { key: string; index: number };
export type Kind = "program" | "combi";
export type SoundInfo = { key: string; index: number; name: string; kind: Kind; type: "exi" | "hd1" | null; engines: string[]; used: boolean };
export type Change = { id?: string; value?: number; ms?: { osc: number; zone: number; id: number } }; // ms: a multisample by its list_multisamples id
export type Part = { key: string; index: number; keyBottom: number; keyTop: number; velLow?: number; velHigh?: number; transpose?: number; volume?: number; channel?: number; keyBottomSlope?: number; keyTopSlope?: number; velLowSlope?: number; velHighSlope?: number };
export type TrackSound = { track: number; key: string; index: number }; // track 1..16: the song channel this Program plays
// What a connected keyboard is known to hold: a bank is "match" when it read back byte for byte equal to the file, "differs" when it did not. A bank not listed was not read.
export type KeyboardFacts = { banks: Record<string, "match" | "differs"> };
export type ToolResult = { ok: boolean; [k: string]: unknown };
export type KarmaModule = { module: "A" | "B" | "C" | "D"; ge?: number; channel?: number; keyBottom?: number; keyTop?: number; transpose?: number; inputChannel?: number; plays?: number; run?: boolean; useGch?: boolean; chordTrigger?: number; noteTrigger?: number; startSeed?: number };
export type ConfigureReq = {
  key: string;
  index: number;
  tempo?: number;
  drumTrack?: { on: boolean; pattern?: number; bank?: "preset" | "user"; channel?: number; keyBottom?: number; keyTop?: number };
  karma?: { modules?: KarmaModule[]; scene?: { select: number } };
};
export type Written = { name: string; value: number; text: string };
export type LayerReq = {
  base: Slot;
  add: { role: string; find?: string; program?: Slot; transpose?: number; keyBottom?: number; keyTop?: number; velLow?: number; velHigh?: number };
  method: "combi" | "osc2";
  notes?: string;
};

export class SessionError extends Error {}
type PartPlan = { bank: number; index: number; keyBottom: number; keyTop: number; velLow: number; velHigh: number; transpose?: number; volume?: number; channel: number; keyBottomSlope?: number; keyTopSlope?: number; velLowSlope?: number; velHighSlope?: number };

const NAME_RE = /^[ -~]{1,24}$/;
const LETTERS = "ABCDEFG";
const MAX_CHANGES = 200;
const MAX_PARTS = 16;
const MAX_GROUPS = 8;
const MAX_SHOWN = 4;
const MODULES = ["A", "B", "C", "D"];
const GE_COUNT = 3584; // GE Number range when the tables carry no GE names
const DRUM_FIELDS = { pattern: "Pattern Number", bank: "Pattern Bank", channel: "Output MIDI Channel", keyBottom: "Trigger Key Zone Bottom", keyTop: "Trigger Key Zone Top" };
const MODULE_FIELDS = { ge: "GE Number", channel: "Output MIDI Channel", keyBottom: "Key Zone Bottom", keyTop: "Key Zone Top", transpose: "Transpose" };
// Search words, starting level and attack for the instruments a layer can add; other words in a name (a piano, a guitar) push a candidate down.
// Module settings with a plain integer range: the tool field, its Combi row, and the range.
const MODULE_RANGES: Record<string, [string, number, number]> = { inputChannel: ["Input MIDI Channel", 0, 16], chordTrigger: ["Clock Advance Chord Trigger", 0, 4], noteTrigger: ["Note Trigger Mode", 0, 3], startSeed: ["Start Seed", -2147483648, 2147483647] };
const MODULE_FLAGS = { run: "Run GE", useGch: "Use Gch Also" };
const SLOPE_ROWS = { keyBottomSlope: "Key Window Bottom Slope", keyTopSlope: "Key Window Top Slope", velLowSlope: "Vel.Window Low Slope", velHighSlope: "Vel.Window High Slope" } as const;
const ROLE_WORDS: Record<string, string[]> = { strings: ["string", "orch", "ensemble"], pad: ["pad"], bass: ["bass"], brass: ["brass", "horn", "trumpet"], choir: ["choir", "voice", "vox"], organ: ["organ"] };
const ROLE_LEVEL: Record<string, number> = { strings: 85, pad: 80, choir: 80, brass: 90, organ: 85, bass: 90 };
const ROLE_ATTACK: Record<string, number> = { strings: 55, pad: 60, choir: 55 };
const OTHER_WORDS = ["piano", "grand", "guitar", "steel", "drum", "kit", "lead", "split", "celesta", "bell", "bass", "brass", "organ", "pad", "choir"];
const GLOBAL_CHANNEL = 16; // the raw value for "Global": a timbre on any other channel doesn't hear the Kronos's own keys

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const idOf = (r: Row): string => `${r.ofs}.${r.bitLo ?? 0}`;
const slotId = (s: Slot): string => `${s.key}/${s.index}`;
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const labelOf = (r: Row): string => (r.group ? `${r.group} / ${r.name}` : r.name);

// Rejects any key of a tool argument that is not listed, so a made-up setting is an error, not a silent no-op.
function onlyKeys(o: unknown, allowed: string[], where: string): Record<string, any> {
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new SessionError(`${where} must be an object`);
  const bad = Object.keys(o).find((k) => !allowed.includes(k));
  if (bad !== undefined) throw new SessionError(`${where}: unknown field ${JSON.stringify(bad)}; allowed: ${allowed.join(", ")}`);
  return o;
}

function checkName(name: unknown): string {
  if (typeof name !== "string" || !NAME_RE.test(name) || name !== name.trimEnd()) {
    throw new SessionError(`bad name ${JSON.stringify(name)}: 1 to 24 printable ASCII characters, no trailing space`);
  }
  return name;
}

export function nameOf(e: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 24; i++) s += String.fromCharCode(e[i]);
  return s.replace(/[\0 ]+$/, "");
}

function putName(e: Uint8Array, name: string): void {
  e.fill(0, 0, 24);
  for (let i = 0; i < name.length; i++) e[i] = name.charCodeAt(i);
}

export const isFreeName = (name: string): boolean => name.trim() === "" || /^init/i.test(name.trim());

// Reference bank number a Combi timbre uses for a Program bank: INT-A..F 0..5, U-A..G 17..23, U-AA..GG 24..30.
export function bankNumberOf(key: string): number | null {
  const label = key.slice("program:".length);
  if (label.startsWith("INT-") && label.length === 5) {
    const i = LETTERS.indexOf(label[4]);
    return i >= 0 && i <= 5 ? i : null;
  }
  if (label.startsWith("U-") && label.length === 3 && LETTERS.includes(label[2])) return 17 + LETTERS.indexOf(label[2]);
  if (label.startsWith("U-") && label.length === 4 && label[2] === label[3] && LETTERS.includes(label[2])) return 24 + LETTERS.indexOf(label[2]);
  return null;
}

// The inverse of bankNumberOf, for a Program bank: null for GM, the factory banks and anything else a Combi timbre can name.
export function bankKeyOf(n: number): string | null {
  const label = n >= 0 && n <= 5 ? `INT-${LETTERS[n]}` : n >= 17 && n <= 23 ? `U-${LETTERS[n - 17]}` : n >= 24 && n <= 30 ? `U-${LETTERS[n - 24]}${LETTERS[n - 24]}` : null;
  return label ? `program:${label}` : null;
}

function engineList(tables: ParamTables, b: BankInfo, entry: Uint8Array): string[] {
  if (b.kind !== "program") return [];
  if (b.type === "hd1") return ["HD-1"];
  return exiEngines(tables, entry).filter((n) => n !== "Off");
}

// The one word that says what a sound is built on: HD-1, an EXi engine (SGX-2, AL-1, ...) or Combi.
const KIND_LABEL: Partial<Record<BankInfo["kind"], string>> = { combi: "Combi", drumkit: "Drum Kit", waveseq: "Wave Sequence" };
export const engineOf = (tables: ParamTables, b: BankInfo, entry: Uint8Array): string => KIND_LABEL[b.kind] ?? engineList(tables, b, entry)[0] ?? "Off";

export type TimbreProgram = { timbres: number[]; key: string; index: number; name: string };
// The distinct Programs a Combi's active timbres play, with the timbre numbers on each. Bank numbers with no Program bank in the file (GM, factory banks) are left out: they cannot be written.
export function timbrePrograms(tables: ParamTables, file: PcgFile, combi: Uint8Array): TimbreProgram[] {
  const banks = listBanks(file);
  const out = new Map<string, TimbreProgram>();
  for (let t = 1; t <= 16; t++) {
    const cell = (name: string) => readParam(combi, tables.combi.find((r) => r.group === `Timbre${t}` && r.name === name)!);
    if (cell("Status") === 0) continue;
    const key = bankKeyOf(cell("Bank Number")), index = cell("Program Number");
    const b = key ? banks.find((x) => x.key === key && x.kind === "program") : undefined;
    if (!key || !b || index >= b.count) continue;
    const id = `${key}/${index}`;
    const hit = out.get(id);
    if (hit) hit.timbres.push(t);
    else out.set(id, { timbres: [t], key, index, name: nameOf(getEntry(file, key, index)) });
  }
  return [...out.values()];
}
const pad3 = (i: number): string => String(i).padStart(3, "0");

export class SoundSession {
  readonly #T: ParamTables;
  readonly #f: PcgFile;
  readonly #hidden: Set<string>;
  readonly #snaps = new Map<string, Slot & { bytes: Uint8Array }>();
  readonly #log: { action: string; key?: string; index?: number; detail: string }[] = [];

  readonly onlySlot?: Slot; // Refine: the open sound; set_params may write it and, for a Combi, the Programs its timbres play (fixed at the start)
  readonly #allowed = new Set<string>();
  readonly #allowedLabel: string;
  readonly ask: boolean; // Ask: read tools and show_param only
  readonly #protect: Set<string>; // sounds a build run must keep byte for byte: never written, never reused as free slots
  #ms: { ref: MsRef; users: string[] }[] | null = null;

  readonly #kb: KeyboardFacts | null; // null: no keyboard connected, free slots come from the file alone

  constructor(tables: ParamTables, file: PcgFile, opts: { hide?: Slot[]; onlySlot?: Slot; ask?: boolean; protect?: Slot[]; keyboard?: KeyboardFacts | null } = {}) {
    this.#kb = opts.keyboard ?? null;
    this.#protect = new Set((opts.protect ?? []).map(slotId));
    this.onlySlot = opts.onlySlot;
    this.ask = opts.ask ?? false;
    this.#T = tables;
    this.#f = file;
    this.#hidden = new Set((opts.hide ?? []).map(slotId));
    const allowed: Slot[] = opts.onlySlot ? [opts.onlySlot] : [];
    if (opts.onlySlot && listBanks(file).find((b) => b.key === opts.onlySlot!.key)?.kind === "combi") {
      for (const p of timbrePrograms(tables, file, getEntry(file, opts.onlySlot.key, opts.onlySlot.index))) allowed.push(p);
    }
    for (const s of allowed) this.#allowed.add(slotId(s));
    this.#allowedLabel = allowed.map((s) => `${s.key} ${s.index}`).join(", ");
  }

  search(q: { text?: string; kind?: Kind; type?: "exi" | "hd1"; engine?: string; used?: boolean; limit?: number } = {}): SoundInfo[] {
    const limit = q.limit ?? 50;
    if (!isInt(limit, 1, 5000)) throw new SessionError("limit must be 1 to 5000");
    const text = (q.text ?? "").toLowerCase();
    const used = referencedSlots(this.#f);
    const out: SoundInfo[] = [];
    for (const b of this.#banks(q.kind)) {
      for (let i = 0; i < b.count && out.length < limit; i++) {
        if (this.#hidden.has(slotId({ key: b.key, index: i }))) continue;
        const s = this.#info(b, i, used);
        if (text && !s.name.toLowerCase().includes(text)) continue;
        if (q.type !== undefined && s.type !== q.type) continue;
        if (q.engine !== undefined && !s.engines.includes(q.engine)) continue;
        if (q.used !== undefined && s.used !== q.used) continue;
        out.push(s);
      }
    }
    return out;
  }

  // Without a group: the group names. With a group: its editable settings, with id, value and range. A list of groups gives one labelled read each.
  describe(key: string, index: number, group?: string | string[]): Record<string, unknown> {
    const b = this.#visible(key, index);
    const entry = getEntry(this.#f, key, index);
    const rows = this.#settings(b, entry);
    const groups = [...new Set(rows.map((r) => r.group).filter((g) => g !== ""))];
    // A Drum Kit has 1280 groups (128 notes x 10): name the patterns and list the notes that hold samples instead of every group.
    const shown = b.kind === "drumkit" ? [...new Set(groups.map((g) => g.replace(/\d+/g, "<n>")))] : groups;
    const extra: Record<string, unknown> = {};
    if (b.kind === "combi") extra.timbres = timbrePrograms(this.#T, this.#f, entry);
    if (b.kind === "drumkit") {
      extra.groupPatterns = "replace each <n> with a number: Note 1..128, Zone 1..8";
      extra.notesWithSamples = [...new Set(rows.filter((r) => r.name === "Sample On/Off" && readParam(entry, r) === 1).map((r) => Number(/^Note(\d+) /.exec(r.group)?.[1])))];
    }
    const head = { key, index, name: nameOf(entry), kind: b.kind, type: b.type, engine: engineOf(this.#T, b, entry), engines: engineList(this.#T, b, entry), groups: shown, ...extra };
    if (group === undefined) return head;
    if (Array.isArray(group) && (group.length < 1 || group.length > MAX_GROUPS)) throw new SessionError(`groups must be 1 to ${MAX_GROUPS} group names, got ${group.length}`);
    for (const g of Array.isArray(group) ? group : [group]) {
      if (!groups.includes(g)) throw new SessionError(`no group ${JSON.stringify(g)}; groups are: ${shown.join(", ")}`);
    }
    const read = (g: string) =>
      rows
        .filter((r) => r.group === g)
        .map((r) => {
          const value = readParam(entry, r);
          return { id: idOf(r), name: r.name, value, min: r.rawMin, max: r.rawMax, text: formatValue(r, value, this.#T) };
        });
    if (Array.isArray(group)) return { ...head, reads: group.map((g) => ({ group: g, params: read(g) })) };
    return { ...head, group, params: read(group) };
  }

  // Points at settings for the UI; reads only.
  showParam(key: string, index: number, ids: { id: string; note: string; suggest?: number }[]): { ok: true; shown: Record<string, unknown>[] } {
    const b = this.#visible(key, index);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_SHOWN) throw new SessionError(`ids must be a list of 1 to ${MAX_SHOWN} {id, note} items`);
    const entry = getEntry(this.#f, key, index);
    const byId = new Map(this.#settings(b, entry).map((r) => [idOf(r), r] as const));
    const shown = ids.map((x) => {
      const r = byId.get(String(x?.id));
      if (!r) throw new SessionError(`${x?.id}: no setting of ${key} ${index} has this id`);
      const value = readParam(entry, r);
      const out: Record<string, unknown> = { id: idOf(r), name: r.name, group: r.group, value, text: formatValue(r, value, this.#T), note: String(x.note ?? "") };
      if (x.suggest !== undefined) {
        if (!isInt(x.suggest, r.rawMin, r.rawMax)) throw new SessionError(`${idOf(r)}: suggest must be a whole number from ${r.rawMin} to ${r.rawMax} (the raw value, not the shown text), got ${JSON.stringify(x.suggest)}`);
        out.suggest = x.suggest;
        out.suggestText = formatValue(r, x.suggest, this.#T);
      }
      return out;
    });
    return { ok: true, shown };
  }

  // All-or-nothing: every change is checked on a copy first, and nothing is written if any is refused.
  setParams(key: string, index: number, changes: Change[]): { ok: true; engine: string; changed: Record<string, unknown>[]; warnings?: string[] } | { ok: false; errors: string[] } {
    if (this.onlySlot && !this.#allowed.has(slotId({ key, index }))) throw new SessionError(`Refine may change only ${this.#allowedLabel}`);
    const b = this.#visible(key, index);
    if (this.#protect.has(slotId({ key, index }))) throw new SessionError(`${key} ${index} is the owner's sound and must stay unchanged: copy_sound it into a free slot and edit the copy, or use it as a part in build_combi`);
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_CHANGES) {
      throw new SessionError(`changes must be a list of 1 to ${MAX_CHANGES} {id, value} items`);
    }
    const entry = getEntry(this.#f, key, index);
    const next = entry.slice();
    const errors: string[] = [];
    const changed: Record<string, unknown>[] = [];
    const engine = engineOf(this.#T, b, entry);
    let osc2Set = false;
    // Effect types go first, because a type decides which settings its slot has.
    const typeRows = new Map(this.#settings(b, entry).filter((r) => r.name === "Effect Type").map((r) => [idOf(r), r] as const));
    for (const c of changes) {
      const r = typeRows.get(String(c?.id));
      if (!r) continue;
      try {
        writeParam(next, r, (c.value as number));
        changeEffectType(next, r.ofs, (c.value as number));
      } catch (e) {
        errors.push(`${labelOf(r)}: ${msg(e)}`);
        continue;
      }
      changed.push({ id: idOf(r), name: labelOf(r), from: formatValue(r, readParam(entry, r), this.#T), to: formatValue(r, (c.value as number), this.#T) });
    }
    const byId = new Map(this.#settings(b, next).map((r) => [idOf(r), r] as const));
    for (const c of changes) {
      if (c?.ms !== undefined) {
        const m = c.ms;
        if (b.kind === "combi") errors.push("a Combination has no oscillators or multisamples: copy_sound an HD-1 Program, configure that, and use it as a part in build_combi");
        else if (b.kind !== "program") errors.push(`a ${engine} has no oscillators: only the listed settings can be changed`);
        else if (b.type !== "hd1") errors.push(`${engine} is a single-engine Program with no OSC1/OSC2 to set: use a Combination (build_combi) and make the part you configure an HD-1 Program`);
        else if (!isInt(m?.osc, 1, 2)) errors.push("ms.osc must be 1 or 2");
        else if (!isInt(m.zone, 1, 8)) errors.push("ms.zone must be 1 to 8");
        else if (!isInt(m.id, 0, this.#msIndex().length - 1)) errors.push(`ms.id ${m.id} is not a multisample id: call list_multisamples and use an id it returns`);
        else {
          const ref = this.#msIndex()[m.id].ref, old = readZones(next).find((z) => z.osc === m.osc && z.zone === m.zone)!;
          next.set(applyMultisample(next, m.osc as 1 | 2, m.zone, ref));
          if (m.osc === 2) osc2Set = true;
          changed.push({ id: `ms:osc${m.osc}.zone${m.zone}`, name: `OSC${m.osc} Zone${m.zone} multisample`, from: old.type === 1 ? msLabel(old.ref) : "none", to: msLabel(ref) });
        }
        continue;
      }
      const id = String(c?.id);
      if (typeRows.has(id)) continue;
      const r = byId.get(id);
      if (!r) {
        errors.push(`${id}: no editable setting has this id`);
        continue;
      }
      if (/^Zone\d MS (Number|Type)$/.test(r.name)) {
        errors.push(`${labelOf(r)}: a multisample number means nothing without its bank: use {ms:{osc,zone,id}} with an id from list_multisamples`);
        continue;
      }
      try {
        writeParam(next, r, (c.value as number));
      } catch (e) {
        errors.push(`${labelOf(r)}: ${msg(e)}`);
        continue;
      }
      changed.push({ id, name: labelOf(r), from: formatValue(r, readParam(entry, r), this.#T), to: formatValue(r, (c.value as number), this.#T) });
    }
    if (errors.length > 0) return { ok: false, errors };
    this.#write({ key, index }, next, "set_params", `${changed.length} setting(s)`);
    const warnings: string[] = [];
    if (b.type === "hd1" && b.kind === "program") {
      const modeRow = this.#rows(b, next).find((r) => r.group === "Common" && r.name === "Oscillator Mode");
      const mode = modeRow ? readParam(next, modeRow) : 0, osc2 = readZones(next).some((z) => z.osc === 2 && z.type === 1);
      if ((mode === 1 || mode === 3) && !osc2) warnings.push("Oscillator Mode is Double but OSC2 has no multisample, so OSC2 is silent: apply one with ms from list_multisamples");
      if ((mode === 0 || mode === 2) && osc2Set) warnings.push("OSC2 is not heard while Oscillator Mode is Single or Drums: set Oscillator Mode to Double (1)");
    }
    return { ok: true, engine, changed, ...(warnings.length ? { warnings } : {}) };
  }

  // The multisamples HD-1 Programs of this library already use, with the Programs that use them. Fixed at the first call so ids stay valid for the whole run.
  #msIndex(): { ref: MsRef; users: string[] }[] {
    if (this.#ms) return this.#ms;
    const all = new Map<string, { ref: MsRef; users: string[] }>();
    for (const b of this.#banks("program")) {
      if (b.type !== "hd1") continue;
      for (let i = 0; i < b.count; i++) {
        if (this.#hidden.has(slotId({ key: b.key, index: i }))) continue;
        const e = getEntry(this.#f, b.key, i), name = nameOf(e);
        for (const z of readZones(e)) {
          if (z.type !== 1) continue;
          const k = `${z.ref.bank}:${z.ref.number}`;
          let x = all.get(k);
          if (!x) all.set(k, (x = { ref: z.ref, users: [] }));
          if (!isFreeName(name) && x.users.length < 30 && !x.users.includes(name)) x.users.push(name);
        }
      }
    }
    return (this.#ms = [...all.values()].sort((a, b) => (a.ref.bank < b.ref.bank ? -1 : a.ref.bank > b.ref.bank ? 1 : a.ref.number - b.ref.number)));
  }

  listMultisamples(q: { query?: string; category?: string; limit?: number } = {}): { total: number; of: number; multisamples: Record<string, unknown>[]; note: string } {
    const limit = q.limit ?? 40;
    if (!isInt(limit, 1, 100)) throw new SessionError("limit must be 1 to 100");
    for (const k of [q.query, q.category]) if (k !== undefined && typeof k !== "string") throw new SessionError("query and category must be text");
    const words = `${q.query ?? ""} ${q.category ?? ""}`.toLowerCase().split(/\s+/).filter(Boolean);
    const all = this.#msIndex();
    const hit = all.map((x, id) => ({ id, ...x })).filter((x) => { const hay = `${msLabel(x.ref)} ${x.users.join(" ")}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
    const first = (users: string[]) => [...users].sort((a, b) => Number(words.some((w) => b.toLowerCase().includes(w))) - Number(words.some((w) => a.toLowerCase().includes(w)))).slice(0, 4);
    return {
      total: hit.length,
      of: all.length,
      multisamples: hit.slice(0, limit).map((x) => ({ id: x.id, name: msLabel(x.ref), bank: x.ref.bank, number: x.ref.number, usedBy: first(x.users) })),
      note: "id is the position in this list; apply it with set_params {ms:{osc,zone,id}}. The data has no sample names, only bank and number, so judge a multisample by the Programs in usedBy; query and category are matched against those Program names. Only multisamples that an HD-1 Program here already uses are listed.",
    };
  }

  freeSlots(kind: Kind, type?: "exi" | "hd1"): (Slot & { name: string; type: BankInfo["type"] })[] {
    return this.#free(kind, type).map((x) => ({ key: x.key, index: x.index, name: x.name, type: x.type }));
  }

  // Banks with an Init slot in the file that the keyboard is not known to match, each with the reason. Empty when no keyboard is connected.
  skippedBanks(kind: Kind, type?: "exi" | "hd1"): { key: string; label: string; why: string }[] {
    if (!this.#kb) return [];
    const out: { key: string; label: string; why: string }[] = [];
    const used = referencedSlots(this.#f);
    for (const b of this.#banks(kind)) {
      if (type !== undefined && b.type !== type) continue;
      const st = this.#kb.banks[b.key];
      if (st === "match" || !this.#freeIn(b, used).length) continue;
      out.push({ key: b.key, label: b.label, why: `${b.label} ${st === "differs" ? "differs from the keyboard" : "was not checked against the keyboard"}: pull it first` });
    }
    return out;
  }

  // The warning for a run that wrote a new sound while no keyboard was there to check the slot against.
  fileOnlyWarning(): string | null {
    return !this.#kb && this.#log.some((x) => x.action === "copy_sound" || x.action === "build_combi") ? "free slots chosen from the file only" : null;
  }

  copySound(req: { fromKey: string; fromIndex: number; name: string }): { key: string; index: number; name: string } {
    const b = this.#visible(req.fromKey, req.fromIndex);
    checkName(req.name);
    const kind = b.kind === "combi" ? "combi" : "program";
    const target = this.#free(kind, b.type ?? undefined)[0];
    if (!target) throw new SessionError(`no free ${kind} slot of type ${b.type ?? "combi"}: free one first${this.#whySkipped(kind, b.type ?? undefined)}`);
    const e = getEntry(this.#f, req.fromKey, req.fromIndex);
    putName(e, req.name);
    this.#write(target, e, "copy_sound", `from ${req.fromKey} ${req.fromIndex} as "${req.name}"`);
    return { key: target.key, index: target.index, name: req.name };
  }

  // The first free Combi slot is the base. Parts fill timbres 1..n in order; the other timbres are switched off.
  buildCombi(req: { name: string; parts: Part[]; trackSounds?: TrackSound[] }): { key: string; index: number; name: string; timbres: number; trackSounds: TrackSound[] } {
    checkName(req.name);
    if (!Array.isArray(req.parts) || req.parts.length < 1 || req.parts.length > MAX_PARTS) {
      throw new SessionError(`parts must be a list of 1 to ${MAX_PARTS} sounds`);
    }
    const plan = req.parts.map((p, n) => this.#partPlan(p, n + 1));
    this.#checkSplits(plan);
    const tracks = this.#trackSounds(req.trackSounds ?? []);
    const free = this.#free("combi")[0];
    if (!free) throw new SessionError(`no free Combi slot: free one first${this.#whySkipped("combi")}`);
    const e = getEntry(this.#f, free.key, free.index);
    try {
      for (let t = 1; t <= MAX_PARTS; t++) {
        const p = plan[t - 1];
        const cell = (name: string) => this.#cell(t, name);
        writeParam(e, cell("Status"), p ? 1 : 0);
        if (!p) continue;
        writeParam(e, cell("MIDI Channel"), p.channel);
        writeParam(e, cell("Bank Number"), p.bank);
        writeParam(e, cell("Program Number"), p.index);
        writeParam(e, cell("Key Window Bottom"), p.keyBottom);
        writeParam(e, cell("Key Window Top"), p.keyTop);
        writeParam(e, cell("Vel.Window Low"), p.velLow);
        writeParam(e, cell("Vel.Window High"), p.velHigh);
        if (p.transpose !== undefined) writeParam(e, cell("Transpose"), p.transpose);
        if (p.volume !== undefined) writeParam(e, cell("Volume"), p.volume);
        for (const [k, name] of Object.entries(SLOPE_ROWS)) if (p[k as keyof typeof SLOPE_ROWS] !== undefined) writeParam(e, cell(name), p[k as keyof typeof SLOPE_ROWS]!);
      }
    } catch (err) {
      throw new SessionError(`cannot build the Combi: ${msg(err)}`);
    }
    putName(e, req.name);
    this.#write(free, e, "build_combi", `"${req.name}", ${plan.length} timbre(s)`);
    return { key: free.key, index: free.index, name: req.name, timbres: plan.length, trackSounds: tracks };
  }

  // Read-only: finds the sound to add and returns the ordered steps the owner can follow, plus the exact build_combi parts for Build it for me. Nothing is written.
  proposeLayer(req: LayerReq): LayerPlan {
    const r = onlyKeys(req, ["base", "add", "method", "notes"], "propose_layer");
    if (r.method !== "combi" && r.method !== "osc2") throw new SessionError('method must be "combi" or "osc2"');
    const bk = onlyKeys(r.base ?? {}, ["key", "index"], "base");
    const bb = this.#visible(bk.key, bk.index);
    if (bb.kind !== "program") throw new SessionError("base must be a Program: a Combination is not layered this way");
    const baseEntry = getEntry(this.#f, bk.key, bk.index);
    const base = { key: bk.key as string, index: bk.index as number, name: nameOf(baseEntry), engine: engineOf(this.#T, bb, baseEntry) };
    if (r.method === "osc2" && base.engine !== "HD-1") {
      throw new SessionError(`method osc2 needs an HD-1 Program; ${base.name} is ${base.engine}, a single-engine sound with no second oscillator: use method "combi"`);
    }
    const a = onlyKeys(r.add, ["role", "find", "program", "transpose", "keyBottom", "keyTop", "velLow", "velHigh"], "add");
    if (typeof a.role !== "string" || a.role.trim() === "") throw new SessionError("add.role is required, such as strings, pad, bass, brass, choir or organ");
    const role = a.role.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 12).trim() || "layer";
    const candidates = this.#layerCandidates(a, role, base, r.method);
    const chosen = candidates[0];
    const spot = (key: string, index: number): string => `${this.#banks().find((x) => x.key === key)?.label ?? key} ${pad3(index)}`;
    const steps: LayerStep[] = [];
    const step = (s: Omit<LayerStep, "n">) => steps.push({ n: steps.length + 1, ...s });
    const note = (key: string, index: number, text: string) => step({ kind: "note", key, index, id: `note-${steps.length + 1}`, name: "Plan", note: text });
    const level = ROLE_LEVEL[role] ?? 85;
    const plan = { method: r.method as "combi" | "osc2", base, add: { role, chosen, candidates }, notes: String(r.notes ?? "") };
    if (r.method === "osc2") {
      const rows = this.#rows(bb, baseEntry);
      const hd = (group: string, name: string): string => {
        const x = rows.find((y) => y.group === group && y.name === name);
        if (!x) throw new SessionError(`no setting ${name} in ${group}`);
        return idOf(x);
      };
      const at = { key: base.key, index: base.index };
      note(at.key, at.index, `You are changing ${spot(base.key, base.index)} ${base.name} itself: nothing is kept until you Save, so copy it first if you want the original.`);
      step({ kind: "param", ...at, id: hd("Common", "Oscillator Mode"), name: "Oscillator Mode", note: "Set it to Double, so the sound has a second oscillator.", suggest: 1 });
      step({ kind: "param", ...at, id: hd("OSC2 Trigger", "Zone1 MS Number"), name: "OSC2 Zone1 Multisample", note: `Choose the multisample that ${chosen.name} (${spot(chosen.key, chosen.index)}) uses on its OSC1, so OSC2 plays the ${role}.` });
      step({ kind: "param", ...at, id: hd("OSC2 Amplifier", "Level"), name: "OSC2 Level", note: `Set it to ${level}, so the ${role} sit behind ${base.name}.`, suggest: level });
      step({ kind: "param", ...at, id: hd("OSC2 Amplifier EG", "Attack Time"), name: "OSC2 Attack Time", note: "Set the attack so the layer comes in softly.", suggest: ROLE_ATTACK[role] ?? 20 });
      return { ...plan, steps };
    }
    const free = this.#free("combi")[0];
    if (!free) throw new SessionError(`no free Combi slot: free one first, and tell the owner there is none${this.#whySkipped("combi")}`);
    const opt = (k: string) => (a[k] !== undefined ? { [k]: a[k] } : {});
    const parts: Part[] = [
      { key: base.key, index: base.index, keyBottom: 0, keyTop: 127, volume: 100 },
      { key: chosen.key, index: chosen.index, keyBottom: a.keyBottom ?? 0, keyTop: a.keyTop ?? 127, ...opt("velLow"), ...opt("velHigh"), ...opt("transpose"), volume: level },
    ];
    parts.forEach((p, n) => this.#partPlan(p, n + 1)); // the same checks build_combi makes
    const name = this.#layerName(base.name, role);
    const here = { key: free.key, index: free.index };
    const slotText = spot(free.key, free.index);
    const timbre = (t: number, field: "program" | "level" | "keyrange" | "velrange", rowName: string, label: string, text: string, extra: Partial<LayerStep> = {}) =>
      step({ kind: "combi-timbre", ...here, timbre: t, field, id: idOf(this.#cell(t, rowName)), name: `Timbre ${t} ${label}`, note: text, ...extra });
    note(here.key, here.index, `Open Combinations and pick the empty slot ${slotText} (${free.name}). Name it "${name}".`);
    timbre(1, "program", "Program Number", "program", `Set Timbre 1 to ${spot(base.key, base.index)} ${base.name}.`, { suggest: base.index, bank: bankNumberOf(base.key) ?? undefined });
    timbre(2, "program", "Program Number", "program", `Set Timbre 2 to ${spot(chosen.key, chosen.index)} ${chosen.name}.`, { suggest: chosen.index, bank: bankNumberOf(chosen.key) ?? undefined, ...(a.transpose !== undefined ? { transpose: a.transpose } : {}) });
    timbre(2, "level", "Volume", "level", `Set Timbre 2 Volume to ${level}, lower than Timbre 1, so the ${role} sit behind ${base.name}.`, { suggest: level });
    if (a.keyBottom !== undefined || a.keyTop !== undefined) timbre(2, "keyrange", "Key Window Bottom", "key range", `Limit Timbre 2 to the keys ${a.keyBottom ?? 0} to ${a.keyTop ?? 127}.`, { suggest: a.keyBottom ?? 0, to: a.keyTop ?? 127 });
    if (a.velLow !== undefined || a.velHigh !== undefined) timbre(2, "velrange", "Vel.Window Low", "velocity range", `Limit Timbre 2 to velocities ${a.velLow ?? 1} to ${a.velHigh ?? 127}.`, { suggest: a.velLow ?? 1, to: a.velHigh ?? 127 });
    note(here.key, here.index, `Play some chords: ${base.name} should sound with the ${role} under it. If they are too loud or too soft, change Timbre 2 Volume.`);
    return { ...plan, slot: here, name, parts, steps };
  }

  #layerCandidates(a: Record<string, any>, role: string, base: Slot, method: string): LayerPlan["base"][] {
    const info = (s: SoundInfo) => ({ key: s.key, index: s.index, name: s.name, engine: s.type === "hd1" ? "HD-1" : s.engines[0] ?? "Off" });
    if (a.program !== undefined) {
      const p = onlyKeys(a.program, ["key", "index"], "add.program");
      const b = this.#visible(p.key, p.index);
      if (b.kind !== "program") throw new SessionError("add.program must be a Program");
      if (method === "osc2" && b.type !== "hd1") throw new SessionError("with method osc2 the added Program must be an HD-1 Program");
      return [info(this.#info(b, p.index, new Set()))];
    }
    const terms = typeof a.find === "string" && a.find.trim() !== "" ? [a.find.trim().toLowerCase()] : ROLE_WORDS[role] ?? [role];
    const other = OTHER_WORDS.filter((w) => !terms.some((t) => t.includes(w) || w.includes(t)));
    const found = new Map<string, { s: SoundInfo; score: number }>();
    for (const t of terms) {
      for (const s of this.search({ text: t, kind: "program", limit: 100 })) {
        const id = slotId(s);
        if (found.has(id) || isFreeName(s.name) || id === slotId(base) || (method === "osc2" && s.type !== "hd1")) continue;
        const words = s.name.toLowerCase().split(/[^a-z0-9]+/);
        const own = words.some((w) => terms.some((x) => w.startsWith(x)));
        found.set(id, { s, score: (own ? 2 : 0) + (s.name.toLowerCase().startsWith(t) ? 1 : 0) - (words.some((w) => other.includes(w)) ? 3 : 0) - s.name.length / 100 });
      }
    }
    const out = [...found.values()].sort((x, y) => y.score - x.score).slice(0, 5).map((x) => info(x.s));
    if (out.length === 0) throw new SessionError(`no Program in the library matches ${JSON.stringify(terms)}: try another find word, or pass add.program from search_sounds`);
    return out;
  }

  // A Combi name no Combi has yet, such as "Grand + Strings".
  #layerName(baseName: string, role: string): string {
    const words = baseName.replace(/[^ -~]/g, "").trim().split(/\s+/);
    const word = words.find((w) => /^(piano|grand|keys|organ|rhodes|clav|synth|bass|lead|pad|brass|strings?)$/i.test(w)) ?? words[0] ?? "";
    const stem = `${word.slice(0, 10) || "Sound"} + ${role[0].toUpperCase()}${role.slice(1)}`.slice(0, 24).trimEnd();
    for (let n = 1; ; n++) {
      const nm = n === 1 ? stem : `${stem.slice(0, 23 - String(n).length).trimEnd()} ${n}`;
      if (!this.search({ kind: "combi", text: nm, limit: 50 }).some((x) => x.name.toLowerCase() === nm.toLowerCase())) return nm;
    }
  }

  // Writes nothing: the song track to Program map is only kept for MIDI playback.
  assignTracks(tracks: TrackSound[]): TrackSound[] {
    if (!Array.isArray(tracks) || tracks.length < 1) throw new SessionError(`trackSounds must be a list of 1 to ${MAX_PARTS} items`);
    return this.#trackSounds(tracks);
  }

  // Tempo, Drum Track and KARMA module settings of one Combi, checked first and written as one change so Undo restores it.
  configureCombi(req: ConfigureReq): { key: string; index: number; written: Written[] } {
    const r = onlyKeys(req, ["key", "index", "tempo", "drumTrack", "karma"], "configure_combi");
    if (this.#visible(r.key, r.index).kind !== "combi") throw new SessionError(`${r.key} is not a Combi`);
    const sets: [Row, number][] = [];
    const put = (group: string, name: string, value: number) => sets.push([this.#row(group, name), value]);
    const zone = (o: Record<string, any>, where: string) => {
      for (const k of ["keyBottom", "keyTop"]) if (o[k] !== undefined && !isInt(o[k], 0, 127)) throw new SessionError(`${where}: ${k} must be 0..127`);
      if (o.keyBottom > o.keyTop) throw new SessionError(`${where}: key zone needs keyBottom <= keyTop`);
    };
    if (r.tempo !== undefined) {
      if (typeof r.tempo !== "number" || !(r.tempo >= 40 && r.tempo <= 240)) throw new SessionError("tempo must be a number of beats per minute, 40 to 240");
      put("KARMA Common", "Tempo", Math.round(r.tempo * 100)); // the table stores hundredths of a bpm
    }
    if (r.drumTrack !== undefined) {
      const d = onlyKeys(r.drumTrack, ["on", ...Object.keys(DRUM_FIELDS)], "drumTrack");
      if (typeof d.on !== "boolean") throw new SessionError("drumTrack.on must be true or false");
      if (d.pattern !== undefined && !isInt(d.pattern, 0, 999)) throw new SessionError("drumTrack.pattern must be 0..999");
      if (d.bank !== undefined && d.bank !== "preset" && d.bank !== "user") throw new SessionError('drumTrack.bank must be "preset" or "user"');
      if (d.channel !== undefined && !isInt(d.channel, 0, GLOBAL_CHANNEL)) throw new SessionError("drumTrack.channel must be 0..16");
      zone(d, "drumTrack");
      put("Drum Track Common", "Drum Track On", d.on ? 1 : 0);
      for (const [k, name] of Object.entries(DRUM_FIELDS)) if (d[k] !== undefined) put("Drum Track Common", name, k === "bank" ? Number(d.bank === "user") : d[k]);
    }
    if (r.karma !== undefined) {
      const k = onlyKeys(r.karma, ["modules", "scene"], "karma");
      if (k.scene !== undefined) {
        const sc = onlyKeys(k.scene, ["select"], "karma.scene");
        if (!isInt(sc.select, 1, 8)) throw new SessionError("karma.scene.select must be 1..8");
        put("KARMA Common", "Scene Select", sc.select - 1);
      }
      const mods = k.modules ?? [];
      if (k.modules !== undefined || k.scene === undefined) if (!Array.isArray(mods) || mods.length < 1 || mods.length > MODULES.length) throw new SessionError("karma.modules must be a list of 1 to 4 modules");
      const seen = new Set<string>();
      const ges = this.#T.valueLists["KARMA GE"]?.length ?? GE_COUNT;
      for (const m of mods) {
        const o = onlyKeys(m, ["module", "plays", ...Object.keys(MODULE_FIELDS), ...Object.keys(MODULE_RANGES), ...Object.keys(MODULE_FLAGS)], "karma module");
        if (!MODULES.includes(o.module)) throw new SessionError("karma module must be A, B, C or D");
        if (seen.has(o.module)) throw new SessionError(`karma module ${o.module} is listed twice`);
        seen.add(o.module);
        const where = `KARMA ${o.module}`;
        if (o.ge !== undefined && !isInt(o.ge, 0, ges - 1)) throw new SessionError(`${where}: ge must be a preset GE number 0..${ges - 1} (see search_ge)`);
        if (o.channel !== undefined && !isInt(o.channel, 0, GLOBAL_CHANNEL)) throw new SessionError(`${where}: channel must be 0..16`);
        if (o.transpose !== undefined && !isInt(o.transpose, -36, 36)) throw new SessionError(`${where}: transpose must be -36..36`);
        zone(o, where);
        for (const [k, [name, lo, hi]] of Object.entries(MODULE_RANGES)) {
          if (o[k] === undefined) continue;
          if (!isInt(o[k], lo, hi)) throw new SessionError(`${where}: ${k} must be ${lo}..${hi}${k === "inputChannel" ? " (16 = the keyboard's channel)" : ""}`);
          put(`KARMA Module ${o.module}`, name, o[k]);
        }
        for (const [k, name] of Object.entries(MODULE_FLAGS)) {
          if (o[k] === undefined) continue;
          if (typeof o[k] !== "boolean") throw new SessionError(`${where}: ${k} must be true or false`);
          put(`KARMA Module ${o.module}`, name, o[k] ? 1 : 0);
        }
        if (o.plays !== undefined) {
          if (!isInt(o.plays, 1, MAX_PARTS)) throw new SessionError(`${where}: plays must be a timbre number 1..16`);
          if (o.channel !== undefined) throw new SessionError(`${where}: give plays or channel, not both`);
          const e = getEntry(this.#f, r.key, r.index);
          if (readParam(e, this.#cell(o.plays, "Status")) === 0) throw new SessionError(`${where}: timbre ${o.plays} is off: build it first with build_combi`);
          const ch = readParam(e, this.#cell(o.plays, "MIDI Channel"));
          if (ch === GLOBAL_CHANNEL) throw new SessionError(`${where}: timbre ${o.plays} hears the keyboard channel, so a module cannot play it alone: build that part with its own channel in build_combi (such as channel 2)`);
          put(`KARMA Module ${o.module}`, "Output MIDI Channel", ch);
        }
        for (const [k, name] of Object.entries(MODULE_FIELDS)) if (o[k] !== undefined) put(`KARMA Module ${o.module}`, name, o[k]);
      }
    }
    if (sets.length === 0) throw new SessionError("nothing to configure: give tempo, drumTrack or karma");
    const entry = getEntry(this.#f, r.key, r.index);
    const next = entry.slice();
    const written: Written[] = [];
    for (const [row, value] of sets) {
      try {
        writeParam(next, row, value);
      } catch (e) {
        throw new SessionError(`${labelOf(row)}: ${msg(e)}`);
      }
      written.push({ name: labelOf(row), value, text: formatValue(row, value, this.#T) });
    }
    this.#write({ key: r.key, index: r.index }, next, "configure_combi", `${written.length} setting(s)`);
    return { key: r.key, index: r.index, written };
  }

  // Preset KARMA Generated Effects whose category and name contain every word of the query.
  searchGe(query: string, limit = 15): { number: number; name: string; category: string }[] {
    const names = this.#T.valueLists["KARMA GE"];
    if (!names) throw new SessionError("this build has no GE names: regenerate the parameter tables");
    if (typeof query !== "string" || query.trim() === "") throw new SessionError("query must be a non-empty string");
    if (!isInt(limit, 1, 30)) throw new SessionError("limit must be 1 to 30");
    const cats = this.#T.valueLists["KARMA GE Category"] ?? [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out: { number: number; name: string; category: string }[] = [];
    for (let n = 0; n < names.length && out.length < limit; n++) {
      const hay = `${cats[n] ?? ""} ${names[n]}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push({ number: n, name: names[n], category: cats[n] ?? "" });
    }
    return out;
  }

  touched(): Slot[] {
    return [...this.#snaps.values()].map((s) => ({ key: s.key, index: s.index }));
  }

  log(): { action: string; key?: string; index?: number; detail: string }[] {
    return this.#log.map((x) => ({ ...x }));
  }

  // Puts back every slot this session changed, from the bytes kept before its first write.
  undoAll(): number {
    const n = this.#snaps.size;
    for (const s of this.#snaps.values()) setEntry(this.#f, s.key, s.index, s.bytes);
    this.#snaps.clear();
    if (n > 0) this.#log.push({ action: "undo_all", detail: `${n} slot(s) restored` });
    return n;
  }

  #banks(kind?: Kind): BankInfo[] {
    if (kind !== undefined && kind !== "program" && kind !== "combi") throw new SessionError(`kind must be "program" or "combi"`);
    return listBanks(this.#f).filter((b) => (b.kind === "program" || b.kind === "combi") && (kind === undefined || b.kind === kind));
  }

  // Unknown, out of range and hidden slots get the same answer, so a hidden sound cannot be detected.
  #visible(key: string, index: number): BankInfo {
    // Drum Kits and Wave Sequences are readable by Ask and writable by a Refine on them, never by a build run.
    const wide = this.ask || this.onlySlot !== undefined;
    const b = listBanks(this.#f).find((x) => x.key === key && (x.kind === "program" || x.kind === "combi" || (wide && (x.kind === "drumkit" || x.kind === "waveseq"))));
    if (!b || !isInt(index, 0, b.count - 1) || this.#hidden.has(slotId({ key, index }))) {
      throw new SessionError(`no sound at ${key} ${index}`);
    }
    return b;
  }

  #info(b: BankInfo, i: number, used: Set<string>): SoundInfo {
    const entry = getEntry(this.#f, b.key, i);
    return { key: b.key, index: i, name: nameOf(entry), kind: b.kind as Kind, type: b.type, engines: engineList(this.#T, b, entry), used: used.has(slotId({ key: b.key, index: i })) };
  }

  #rows(b: BankInfo, entry: Uint8Array): Row[] {
    if (b.kind === "combi" || b.kind === "drumkit" || b.kind === "waveseq") return paramsFor(this.#T, b.kind, entry);
    return paramsFor(this.#T, b.type === "hd1" ? "hd1" : "exi", entry);
  }

  // Everything a sound is made of, effects included. Only the name (copy_sound sets it) and the engine stay out: a new sound takes its engine from its starting point.
  #settings(b: BankInfo, entry: Uint8Array): Row[] {
    // A sample pick is a bank id plus a number: the number alone would point at the wrong sample, so those rows stay out (the bank UUID rows are already read-only).
    const rows = this.#rows(b, entry)
      .filter((r) => (isEditable(r) || r.name === "Effect Type") && !(b.kind !== "program" && b.kind !== "combi" && /^(Sample Id|Multisample Select)$/.test(r.name)))
      .map((r) => (r.name === "Effect Type" ? { ...r, rawMax: this.#T.effectTypes.length - 1 } : r));
    return rows.concat(rows.filter((r) => r.name === "Effect Type").flatMap((t) => (effectRowsAt(t.ofs, entry[t.ofs], t.group) ?? []).filter((r) => !r.fixed)));
  }

  effectTypes(): { id: number; name: string }[] {
    return this.#T.effectTypes.map((name, id) => ({ id, name }));
  }

  // Free means: an Init or blank name, not used by any pointer, not hidden, and not already changed in this session.
  // With a keyboard connected it must also sit in a bank the keyboard is known to match, or a Store would overwrite a sound only the keyboard has.
  #free(kind: Kind, type?: "exi" | "hd1"): (Slot & { name: string; type: BankInfo["type"] })[] {
    const used = referencedSlots(this.#f);
    return this.#banks(kind).filter((b) => (type === undefined || b.type === type) && (!this.#kb || this.#kb.banks[b.key] === "match")).flatMap((b) => this.#freeIn(b, used));
  }

  #freeIn(b: BankInfo, used: Set<string>): (Slot & { name: string; type: BankInfo["type"] })[] {
    const out: (Slot & { name: string; type: BankInfo["type"] })[] = [];
    for (let i = 0; i < b.count; i++) {
      const id = slotId({ key: b.key, index: i });
      if (this.#hidden.has(id) || this.#snaps.has(id) || used.has(id) || this.#protect.has(id)) continue;
      const name = nameOf(getEntry(this.#f, b.key, i));
      if (isFreeName(name)) out.push({ key: b.key, index: i, name, type: b.type });
    }
    return out;
  }

  #whySkipped(kind: Kind, type?: "exi" | "hd1"): string {
    const s = this.skippedBanks(kind, type);
    return s.length ? ` (${s.map((x) => x.why).join("; ")})` : "";
  }

  // Shared by build_combi and assign_tracks: each track 1..16 once, on a visible Program with a reference bank number.
  #trackSounds(tracks: unknown): TrackSound[] {
    if (!Array.isArray(tracks) || tracks.length > MAX_PARTS) throw new SessionError(`trackSounds must be a list of up to ${MAX_PARTS} items`);
    const seen = new Set<number>();
    for (const t of tracks as TrackSound[]) {
      const where = `trackSound for track ${t?.track}`;
      if (!isInt(t?.track, 1, MAX_PARTS)) throw new SessionError(`${where}: track must be 1..16`);
      if (seen.has(t.track)) throw new SessionError(`${where}: track ${t.track} is listed twice`);
      seen.add(t.track);
      if (typeof t.key !== "string") throw new SessionError(`${where}: needs a Program key`);
      if (this.#visible(t.key, t.index).kind !== "program") throw new SessionError(`${where}: ${t.key} is not a Program`);
      if (bankNumberOf(t.key) === null) throw new SessionError(`${where}: ${t.key} has no reference bank number`);
    }
    return tracks as TrackSound[];
  }

  #partPlan(p: Part, timbre: number): PartPlan {
    const where = `part ${timbre}`;
    if (!p || typeof p !== "object" || typeof p.key !== "string") throw new SessionError(`${where}: needs a Program key`);
    const b = this.#visible(p.key, p.index);
    if (b.kind !== "program") throw new SessionError(`${where}: ${p.key} is not a Program`);
    const bank = bankNumberOf(p.key);
    if (bank === null) throw new SessionError(`${where}: ${p.key} has no reference bank number`);
    const velLow = p.velLow ?? 1;
    const velHigh = p.velHigh ?? 127;
    if (!isInt(p.keyBottom, 0, 127) || !isInt(p.keyTop, 0, 127) || p.keyBottom > p.keyTop) throw new SessionError(`${where}: key window must be 0..127, bottom <= top`);
    if (!isInt(velLow, 1, 127) || !isInt(velHigh, 1, 127) || velLow > velHigh) throw new SessionError(`${where}: velocity window must be 1..127, low <= high`);
    if (p.transpose !== undefined && !isInt(p.transpose, -60, 60)) throw new SessionError(`${where}: transpose must be -60..60`);
    if (p.volume !== undefined && !isInt(p.volume, 0, 127)) throw new SessionError(`${where}: volume must be 0..127`);
    const channel = p.channel ?? GLOBAL_CHANNEL;
    if (!isInt(channel, 0, GLOBAL_CHANNEL)) throw new SessionError(`${where}: channel must be 0..16`);
    const slopes: Partial<Record<keyof typeof SLOPE_ROWS, number>> = {};
    for (const k of Object.keys(SLOPE_ROWS) as (keyof typeof SLOPE_ROWS)[]) {
      if (p[k] === undefined) continue;
      if (!isInt(p[k], 0, 15)) throw new SessionError(`${where}: ${k} is a slope, 0 (hard edge) to 15 (widest)`);
      slopes[k] = p[k];
    }
    return { bank, index: p.index, keyBottom: p.keyBottom, keyTop: p.keyTop, velLow, velHigh, transpose: p.transpose, volume: p.volume, channel, ...slopes };
  }

  // Two parts that can sound together must be exact layers (one range inside the other) unless a slope makes the overlap a crossfade.
  #checkSplits(plan: PartPlan[]): void {
    const inside = (a0: number, a1: number, b0: number, b1: number) => (a0 >= b0 && a1 <= b1) || (b0 >= a0 && b1 <= a1);
    for (let i = 0; i < plan.length; i++) {
      for (let j = i + 1; j < plan.length; j++) {
        const a = plan[i], b = plan[j];
        const k0 = Math.max(a.keyBottom, b.keyBottom), k1 = Math.min(a.keyTop, b.keyTop), v0 = Math.max(a.velLow, b.velLow), v1 = Math.min(a.velHigh, b.velHigh);
        if (k0 > k1 || v0 > v1) continue;
        const sloped = (...n: (number | undefined)[]) => n.some((x) => (x ?? 0) > 0);
        if (!inside(a.keyBottom, a.keyTop, b.keyBottom, b.keyTop) && !sloped(a.keyBottomSlope, a.keyTopSlope, b.keyBottomSlope, b.keyTopSlope)) {
          throw new SessionError(`parts ${i + 1} and ${j + 1} overlap on keys ${k0}..${k1} and neither contains the other: make them adjacent (a split below C3 is 0..47 and 48..127), or set keyTopSlope/keyBottomSlope (0..15) for a crossfade`);
        }
        if (!inside(a.velLow, a.velHigh, b.velLow, b.velHigh) && !sloped(a.velLowSlope, a.velHighSlope, b.velLowSlope, b.velHighSlope)) {
          throw new SessionError(`parts ${i + 1} and ${j + 1} overlap on velocity ${v0}..${v1} and neither contains the other: make the velocity ranges adjacent (such as 1..79 and 80..127), or set velHighSlope/velLowSlope (0..15) for a crossfade`);
        }
      }
    }
  }

  // The Combi row for one timbre field. Only rows that exist in the tables can be written.
  #cell(timbre: number, name: string): Row {
    return this.#row(`Timbre${timbre}`, name);
  }

  #row(group: string, name: string): Row {
    const r = this.#T.combi.find((x) => x.group === group && x.name === name);
    if (!r) throw new SessionError(`no Combi setting ${name} in ${group}`);
    return r;
  }

  #write(s: Slot, bytes: Uint8Array, action: string, detail: string): void {
    const id = slotId(s);
    if (!this.#snaps.has(id)) this.#snaps.set(id, { key: s.key, index: s.index, bytes: getEntry(this.#f, s.key, s.index) });
    setEntry(this.#f, s.key, s.index, bytes);
    this.#log.push({ action, key: s.key, index: s.index, detail });
  }
}

const S = { type: "string" } as const;
const I = (min: number, max: number, description?: string) => ({ type: "integer", minimum: min, maximum: max, ...(description ? { description } : {}) });
const KIND = { type: "string", enum: ["program", "combi"] } as const;
const ENGINE_TYPE = { type: "string", enum: ["exi", "hd1"], description: "exi = an EXi-engine Program; hd1 = an HD-1 Program" } as const;
const TRACK_SOUND = {
  type: "object",
  properties: { track: I(1, 16, "song track channel number, 1 to 16"), key: { ...S, description: "Program bank key, e.g. program:U-AA" }, index: I(0, 127) },
  required: ["track", "key", "index"],
} as const;

const REFINE_TOOLS = ["describe_sound", "set_params", "list_effect_types", "search_sounds"]; // search is read-only: a Combi Refine finds the Program to put in a timbre
const ASK_TOOLS = ["describe_sound", "search_sounds", "list_effect_types", "show_param", "propose_layer", "lookup_param_help"];
const ASK_ONLY = ["show_param", "propose_layer", "lookup_param_help"];
export type Mode = "build" | "refine" | "ask";

export function toolDefinitions(mode: Mode = "build"): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  const all = [
    {
      name: "lookup_param_help",
      description:
        "Read-only. Looks up what KORG's Parameter Guide says about one setting, and what an engine (SGX-2, EP-1, AL-1, CX-3, STR-1, MS-20EX, PolysixEX, MOD-7, HD-1) does or does not support. Call it before you say you are unsure about a parameter or an engine's behaviour. Returns the guide's text and its page, or found:false.",
      input_schema: {
        type: "object",
        properties: { query: { ...S, description: "The setting's name, with the engine when it matters, e.g. 'Poly Legato SGX-2'" }, engine: { ...S, description: "Optional engine name, e.g. SGX-2" } },
        required: ["query"],
      },
    },
    {
      name: "search_sounds",
      description:
        "Find Programs and Combis in the library by name, kind, engine type, engine (e.g. AL-1) and whether a pointer uses them. Hidden sounds never appear. Returns at most 100 results; narrow the search rather than paging.",
      input_schema: {
        type: "object",
        properties: { text: { ...S, description: "Part of the name, case-insensitive" }, kind: KIND, type: ENGINE_TYPE, engine: { ...S, description: "Engine name shown in engines, such as AL-1" }, used: { type: "boolean", description: "true = used by a Combi, Drum Track or Set List" }, limit: I(1, 100) },
      },
    },
    {
      name: "describe_sound",
      description:
        "Read one Program or Combi. With no group, returns its name, engines and setting group names. With a group, returns that group's editable settings with id, current value, range and the value as KORG writes it. With groups (up to 8), returns each group in one labelled result. Set values only through set_params, using these ids.",
      input_schema: {
        type: "object",
        properties: {
          key: { ...S, description: "Bank key from search_sounds, e.g. program:U-AA" },
          index: I(0, 127),
          group: { ...S, description: "Group name from the group list" },
          groups: { type: "array", minItems: 1, maxItems: MAX_GROUPS, items: S, description: "Several group names: read them all in one call, each labelled. Use this instead of group." },
        },
        required: ["key", "index"],
      },
    },
    {
      name: "set_params",
      description:
        "Set named settings of one Program or Combi by id (from describe_sound). Values are integers in the setting's raw range. All-or-nothing: if any change is refused (bad id, out of range, read-only setting), nothing is written and every error is returned. Only the bits of the named settings change. Do not use on a slot the owner has not chosen to change. A change is {id, value}, or {ms:{osc,zone,id}} to put a list_multisamples multisample on an HD-1 oscillator. OSC edits on EXi sounds (SGX-2, EP-1, AL-1, ...) or a Combi are refused: use a Combination. The result names the engine and warns about a silent OSC2.",
      input_schema: {
        type: "object",
        properties: {
          key: { ...S, description: "Bank key, e.g. program:U-AA" },
          index: I(0, 127),
          changes: { type: "array", minItems: 1, maxItems: MAX_CHANGES, items: { type: "object", properties: { id: S, value: { type: "integer" }, ms: { type: "object", properties: { osc: I(1, 2), zone: I(1, 8), id: I(0, 100000, "multisample id from list_multisamples") }, required: ["osc", "zone", "id"] } } } },
        },
        required: ["key", "index", "changes"],
      },
    },
    {
      name: "list_effect_types",
      description: "The Kronos's effect types, with the id to use as an Effect Type value in set_params. After changing a type, read that group again: the type decides its settings.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "free_slots",
      description:
        "List empty slots that a new sound can be written to: named Init or blank, not used by any Combi, Drum Track or Set List, and not hidden. Copies and Combis only ever go into these slots, so use this before proposing where a result will go.",
      input_schema: { type: "object", properties: { kind: KIND, type: ENGINE_TYPE }, required: ["kind"] },
    },
    {
      name: "copy_sound",
      description:
        "Copy a Program or Combi into the first free slot of the same engine type, under a new name. Never overwrites an occupied slot; fails with a 'free' error when none is left. Nothing is sent to the keyboard.",
      input_schema: {
        type: "object",
        properties: { fromKey: { ...S, description: "Bank key of the source" }, fromIndex: I(0, 127), name: { ...S, description: "1 to 24 printable ASCII characters, no trailing space" } },
        required: ["fromKey", "fromIndex", "name"],
      },
    },
    {
      name: "build_combi",
      description:
        "Write a new Combi into the first free Combi slot. Every part hears the keyboard, unless it is given its own channel (0 to 15), which a part played only by a KARMA module needs. Each part is a Program placed on a key range (keyBottom..keyTop) and velocity range (velLow..velHigh, default 1..127), with optional transpose and volume. Parts fill timbres 1..n; the rest are switched off. Max 16 parts. Splits use adjacent ranges (C3 = 48: below C3 is 0..47). Partly overlapping ranges are refused unless a slope (keyBottomSlope, keyTopSlope, velLowSlope, velHighSlope, 0..15) makes a crossfade. Optional trackSounds name the Program that plays each song track (track 1..16, as the loaded-song block numbers them); they are echoed back and NOT written into the Combi. Refused as a whole if any part or trackSound is invalid; only Programs the model can see may be used.",
      input_schema: {
        type: "object",
        properties: {
          name: { ...S, description: "Combi name, 1 to 24 printable ASCII characters" },
          trackSounds: { type: "array", maxItems: MAX_PARTS, description: "Optional: the sound each loaded song track should play for playback. Not written into the Combi.", items: TRACK_SOUND },
          parts: {
            type: "array",
            minItems: 1,
            maxItems: MAX_PARTS,
            items: {
              type: "object",
              properties: {
                key: { ...S, description: "Program bank key, e.g. program:U-AA" },
                index: I(0, 127),
                keyBottom: I(0, 127),
                keyTop: I(0, 127),
                velLow: I(1, 127),
                velHigh: I(1, 127),
                transpose: I(-60, 60),
                volume: I(0, 127),
                channel: I(0, 16),
                keyBottomSlope: I(0, 15),
                keyTopSlope: I(0, 15),
                velLowSlope: I(0, 15),
                velHighSlope: I(0, 15),
              },
              required: ["key", "index", "keyBottom", "keyTop"],
            },
          },
        },
        required: ["name", "parts"],
      },
    },
    {
      name: "assign_tracks",
      description: "Choose which Program each loaded song track plays during MIDI playback. Does not change any sound or Combi.",
      input_schema: {
        type: "object",
        properties: { trackSounds: { type: "array", minItems: 1, maxItems: MAX_PARTS, items: TRACK_SOUND, description: "One item per song track: track 1..16, a Program key and index" } },
        required: ["trackSounds"],
      },
    },
    {
      name: "configure_combi",
      description:
        "Set a Combi's KARMA tempo, Drum Track and KARMA modules (A to D). Only the fields you give are written; the Combi must be one you may change. tempo is beats per minute, 40 to 240. drumTrack.on switches the Drum Track on or off; pattern 0 to 999 (numbers only, no names are known), bank preset or user, channel 0 to 15 (16 = the keyboard's channel), and the trigger zone keyBottom..keyTop. Each module takes ge (a preset GE number from search_ge), channel 0 to 15 (16 = the keyboard's channel), a key zone keyBottom..keyTop (the keys that trigger it) and transpose -36 to 36. A module also takes plays (timbre 1..16, which needs its own channel: the module outputs there), inputChannel (16 = keyboard), useGch, run (false = off), chordTrigger 0..4, noteTrigger 0..3, startSeed. karma.scene.select 1..8. Not in the data: a KARMA master switch (the owner presses KARMA ON/OFF), the external tempo source, and what a GE's own sliders mean. Returns each setting written, as KORG shows it.",
      input_schema: {
        type: "object",
        properties: {
          key: { ...S, description: "Combi bank key, e.g. combi:INT-E" },
          index: I(0, 127),
          tempo: { type: "number", minimum: 40, maximum: 240 },
          drumTrack: {
            type: "object",
            properties: { on: { type: "boolean" }, pattern: I(0, 999), bank: { type: "string", enum: ["preset", "user"] }, channel: I(0, 16), keyBottom: I(0, 127), keyTop: I(0, 127) },
            required: ["on"],
          },
          karma: {
            type: "object",
            properties: {
              scene: { type: "object", properties: { select: I(1, 8) }, required: ["select"] },
              modules: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    module: { type: "string", enum: MODULES }, ge: I(0, 3583), channel: I(0, 16), keyBottom: I(0, 127), keyTop: I(0, 127), transpose: I(-36, 36),
                    plays: I(1, 16), inputChannel: I(0, 16), useGch: { type: "boolean" }, run: { type: "boolean" }, chordTrigger: I(0, 4), noteTrigger: I(0, 3), startSeed: I(-2147483648, 2147483647),
                  },
                  required: ["module"],
                },
              },
            },
          },
        },
        required: ["key", "index"],
      },
    },
    {
      name: "search_ge",
      description: "Find KARMA Generated Effects (the arpeggio, bass, chord and drum patterns a KARMA module plays) by words in their category or name, such as \"bass funk\" or \"drum rock\". Returns number, name and category; use the number as ge in configure_combi. Categories: Arpeggio, Melodic, Harmonic (Poly), Chord Rhythmic, Strumming, Pick, Bass Pattern, Gated, Drum, Wavesequence, CC, Real-Time.",
      input_schema: { type: "object", properties: { query: S, limit: I(1, 30, "default 15") }, required: ["query"] },
    },
    {
      name: "list_multisamples",
      description:
        "List multisamples (HD-1 oscillator waveforms) that HD-1 Programs here use, with the id for set_params {ms:{osc,zone,id}}. query/category words match the Programs that use it (strings, pad, brass). No sample names exist: judge by usedBy.",
      input_schema: { type: "object", properties: { query: S, category: S, limit: I(1, 100, "default 40") } },
    },
    {
      name: "show_param",
      description: "Point the owner's editor at 1 to 4 settings of a sound (opens the group, scrolls to the row, highlights it). Reads only, changes nothing. Use the ids describe_sound returns; note is a few words saying which way to move it, such as \"Raise this\"; suggest is the concrete raw value you recommend. List the settings in the order the owner should change them.",
      input_schema: {
        type: "object",
        properties: { key: { ...S, description: "Bank key, e.g. program:U-AA" }, index: I(0, 127), ids: { type: "array", minItems: 1, maxItems: MAX_SHOWN, items: { type: "object", properties: { id: S, note: S, suggest: I(-100000, 100000, "the raw value to set, a whole number inside the min..max describe_sound gives for this setting") }, required: ["id", "note"] } } },
        required: ["key", "index", "ids"],
      },
    },
    {
      name: "propose_layer",
      description:
        "Plan how to ADD or LAYER an instrument over a sound (strings under a piano, a pad, a bass an octave down). Reads only and changes nothing: it finds a suitable Program for add (or uses add.program), and returns candidates plus numbered steps the owner follows, shown as a guided walkthrough, and a Build it for me button. method combi (the default, and the only one for every EXi engine: SGX-2, AL-1, CX-3, STR-1, MS-20EX, PolysixEX, MOD-7, EP-1) plays two Programs together in a new Combination: Timbre 1 = base, Timbre 2 = the added sound, quieter. method osc2 works only when the base engine is HD-1: it turns on Double mode and uses the second oscillator inside that Program (refused for any other engine). Read the base sound first (describe_sound) so you know its engine.",
      input_schema: {
        type: "object",
        properties: {
          base: { type: "object", properties: { key: { ...S, description: "Program bank key of the sound to layer over" }, index: I(0, 127) }, required: ["key", "index"] },
          add: {
            type: "object",
            properties: {
              role: { ...S, description: "strings, pad, bass, brass, choir, organ or another instrument word" },
              find: { ...S, description: "Optional name word to search for the added sound, e.g. orchestra" },
              program: { type: "object", properties: { key: S, index: I(0, 127) }, required: ["key", "index"], description: "Optional: the exact Program to add, from search_sounds" },
              transpose: I(-60, 60, "semitones; -12 for an octave down"),
              keyBottom: I(0, 127), keyTop: I(0, 127), velLow: I(1, 127), velHigh: I(1, 127),
            },
            required: ["role"],
          },
          method: { type: "string", enum: ["combi", "osc2"] },
          notes: { ...S, description: "One line of why this method" },
        },
        required: ["base", "add", "method"],
      },
    },
  ];
  return mode === "ask" ? all.filter((d) => ASK_TOOLS.includes(d.name)) : mode === "refine" ? all.filter((d) => REFINE_TOOLS.includes(d.name)) : all.filter((d) => !ASK_ONLY.includes(d.name));
}

// Runs one tool call. Never throws: unknown tools and bad input come back as {ok:false, ...}.
export function runTool(s: SoundSession, name: string, input: unknown): ToolResult {
  try {
    if (s.ask && !ASK_TOOLS.includes(name)) throw new SessionError(`Ask may not use ${name}`);
    if (s.onlySlot && !REFINE_TOOLS.includes(name)) throw new SessionError(`Refine may not use ${name}`);
    const i = (input && typeof input === "object" ? input : {}) as Record<string, any>;
    switch (name) {
      case "search_sounds":
        return { ok: true, results: s.search({ text: i.text, kind: i.kind, type: i.type, engine: i.engine, used: i.used, limit: Math.min(i.limit ?? 25, 100) }) };
      case "describe_sound":
        if (i.group !== undefined && i.groups !== undefined) throw new SessionError("give group or groups, not both");
        return { ok: true, sound: s.describe(i.key, i.index, i.groups ?? i.group) };
      case "set_params":
        return s.setParams(i.key, i.index, i.changes);
      case "lookup_param_help": {
        const query = String(i.query ?? "").slice(0, 200);
        const engine = typeof i.engine === "string" ? i.engine : engineIn(query);
        const label = engine ? query.replace(new RegExp(engine.replace(/[^A-Za-z0-9]/g, "."), "ig"), " ").trim() : query;
        const hit = (label ? lookupParamDoc({ label, engine, kind: "Program" }) : null) ?? (engine && !label.replace(/[^A-Za-z0-9]/g, "") ? engineSummary(engine) : null);
        return hit ? { ok: true, found: true, ...hit } : { ok: true, found: false, note: "Nothing in the guide data matched. Say what you do know, and say it is general knowledge." };
      }
      case "show_param":
        return s.showParam(i.key, i.index, i.ids);
      case "propose_layer":
        return { ok: true, ...s.proposeLayer(i as LayerReq) };
      case "list_effect_types":
        return { ok: true, types: s.effectTypes() };
      case "free_slots": {
        const skipped = s.skippedBanks(i.kind, i.type).map((x) => x.why);
        return { ok: true, slots: s.freeSlots(i.kind, i.type), ...(skipped.length ? { skipped } : {}) };
      }
      case "copy_sound":
        return { ok: true, ...s.copySound({ fromKey: i.fromKey, fromIndex: i.fromIndex, name: i.name }) };
      case "build_combi":
        return { ok: true, ...s.buildCombi({ name: i.name, parts: i.parts, trackSounds: i.trackSounds }) };
      case "assign_tracks":
        return { ok: true, trackSounds: s.assignTracks(i.trackSounds) };
      case "configure_combi":
        return { ok: true, ...s.configureCombi(i as ConfigureReq) };
      case "search_ge":
        return { ok: true, results: s.searchGe(i.query, i.limit) };
      case "list_multisamples":
        return { ok: true, ...s.listMultisamples({ query: i.query, category: i.category, limit: i.limit }) };
      default:
        return { ok: false, error: `unknown tool ${JSON.stringify(name)}` };
    }
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
