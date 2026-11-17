// Moves banks between a Kronos (through KronosClient) and a .PCG library. Only objectSize bytes of each slot travel.
import { KronosError, type KronosClient } from "./client.ts";
import type { SimulatedKronos } from "./simulator.ts";
import { getEntry, getGlobal, listBanks, setEntry, type BankInfo } from "../pcg/library.ts";
import { leafBlocks, parsePcg, PcgError, updateChecksum, type PcgFile } from "../pcg/pcg.ts";
import { buildDiv1, buildSetListCompanion, COMPANION_SIZE, SET_LIST_SIZE } from "./backup.ts";

export { buildDiv1, buildSetListCompanion } from "./backup.ts";

export type SyncOptions = { onProgress?: (done: number, total: number) => void; signal?: AbortSignal };

const SET_LIST_OBJ = 0x0d;
const GLOBAL_OBJ = 0x03;
const GLOBAL_VERSION = 2;

type UsbKind = Exclude<BankInfo["kind"], "setlist">;
const OBJ_TYPE: Record<UsbKind, number> = { program: 0, combi: 1, drumkit: 4, waveseq: 5 };
const BANK_VERSION: Record<UsbKind, number> = { program: 5, combi: 3, drumkit: 3, waveseq: 1 };
const ENTRY_SIZE: Record<UsbKind, number> = { program: 4960, combi: 7810, drumkit: 38424, waveseq: 2216 };
const HD1_OBJECT = 3706;
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const USER = range(0x40, 0x4d);

function abortError(): Error {
  const e = new Error("sync aborted");
  e.name = "AbortError";
  return e;
}

function checkAbort(opts: SyncOptions): void {
  if (opts.signal?.aborted) throw abortError();
}

// Resolves a bank that can move over USB. Set lists and banks without a USB address are refused.
function usbTarget(file: PcgFile, key: string): { obj: number; bank: number; info: BankInfo } {
  const info = listBanks(file).find((b) => b.key === key);
  if (!info) throw new PcgError(`no bank ${key}`);
  if (info.kind === "setlist" || info.sysexBank === null) throw new PcgError(`${key} cannot move over USB`);
  return { obj: OBJ_TYPE[info.kind], bank: info.sysexBank, info };
}

export function seedSimulator(sim: SimulatedKronos, file: PcgFile): void {
  for (const info of listBanks(file)) {
    if (info.kind === "setlist") {
      for (let i = 0; i < info.count; i++) sim.seedObject(SET_LIST_OBJ, 0, i, info.version, getEntry(file, info.key, i).subarray(0, info.objectSize));
      continue;
    }
    if (info.sysexBank === null) continue;
    for (let i = 0; i < info.count; i++) {
      sim.seedObject(OBJ_TYPE[info.kind], info.sysexBank, i, info.version, getEntry(file, info.key, i).subarray(0, info.objectSize));
    }
  }
  const global = getGlobal(file);
  if (global) sim.seedObject(GLOBAL_OBJ, 0, 0, GLOBAL_VERSION, global);
}

export async function pullBank(client: KronosClient, file: PcgFile, key: string, opts: SyncOptions = {}): Promise<void> {
  const { obj, bank, info } = usbTarget(file, key);
  const objects: Uint8Array[] = [];
  for (let i = 0; i < info.count; i++) {
    checkAbort(opts);
    const reply = await client.requestObject(obj, bank, i);
    if (reply.data.length !== info.objectSize) throw new PcgError(`${key} object ${i} is ${reply.data.length} bytes, expected ${info.objectSize}`);
    objects.push(reply.data);
    opts.onProgress?.(i + 1, info.count);
  }
  // Nothing is written until every object has arrived, so an abort or error above leaves the file alone.
  checkAbort(opts);
  for (let i = 0; i < info.count; i++) {
    const entry = getEntry(file, key, i);
    entry.set(objects[i], 0);
    setEntry(file, key, i, entry);
  }
}

export async function pushEntries(client: KronosClient, file: PcgFile, key: string, indices: number[], opts: SyncOptions = {}): Promise<void> {
  const { obj, bank, info } = usbTarget(file, key);
  // Read every slot first, so a bad index is refused before anything is sent.
  const entries = indices.map((i) => getEntry(file, key, i).subarray(0, info.objectSize));
  for (let n = 0; n < indices.length; n++) {
    checkAbort(opts);
    await client.sendObject(obj, bank, indices[n], info.version, entries[n]);
    opts.onProgress?.(n + 1, indices.length);
  }
}

// Live editing: the slot's bytes become the keyboard's edit buffer for its object type. Never stored.
export async function pushCurrent(client: KronosClient, file: PcgFile, key: string, index: number): Promise<void> {
  await pushCurrentBytes(client, file, key, getEntry(file, key, index));
}

// The same edit-buffer send for bytes that are not in the file, such as a sound's state before an edit (A/B compare).
export async function pushCurrentBytes(client: KronosClient, file: PcgFile, key: string, bytes: Uint8Array): Promise<void> {
  const { obj, info } = usbTarget(file, key);
  await client.sendCurrentObject(obj, info.version, bytes.subarray(0, info.objectSize));
}

// Read-only: the keyboard's edit buffer for the bank's object type, cut to one entry.
export async function readCurrentBytes(client: KronosClient, file: PcgFile, key: string): Promise<Uint8Array> {
  const { obj, info } = usbTarget(file, key);
  return (await client.requestCurrentObject(obj)).data.subarray(0, info.objectSize);
}

export async function storeBank(client: KronosClient, file: PcgFile, key: string): Promise<void> {
  const { obj, bank } = usbTarget(file, key);
  await client.storeBank(obj, bank);
}

type Probe = { kind: UsbKind; bank: number; count: number };
const probes = (kind: UsbKind, banks: number[], count: number): Probe[] => banks.map((bank) => ({ kind, bank, count }));
const PROBES: Probe[] = [
  ...probes("program", [0, 1, 2, 3, 4, 5, ...USER], 128),
  ...probes("combi", [0, 1, 2, 3, 4, 5, 6, ...USER.slice(0, 7)], 128),
  ...probes("drumkit", [0], 40),
  ...probes("drumkit", USER, 16),
  ...probes("waveseq", [0], 150),
  ...probes("waveseq", USER, 32),
];

// Bank id per library.ts: INT-A..E = 0..4, INT-F = 0x8000 (program), user bank n = 0x20000 + n.
function bankId(kind: UsbKind, bank: number): number {
  if (bank >= 0x40) return 0x20000 + bank - 0x40;
  if (kind === "program" && bank === 5) return 0x8000;
  return bank;
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const block = (tag: string, word: number, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i);
  dv.setUint32(4, data.length);
  dv.setUint32(8, word);
  out.set(data, 12);
  return out;
};

type BuiltBank = { kind: UsbKind; tag: string; id: number; entries: Uint8Array[] };

// Set Lists: SLS1 holds SLD1/SDB1 (the companion names) and STL1/SBK1 (the set lists). Global is GLB1, last.
function buildPcg(banks: BuiltBank[], extra: { setLists?: Uint8Array[]; global?: Uint8Array } = {}): PcgFile {
  const bankLeaf = (b: BuiltBank): Uint8Array => {
    const entrySize = ENTRY_SIZE[b.kind];
    const body = new Uint8Array(12 + b.entries.length * entrySize);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, b.entries.length);
    dv.setUint32(4, entrySize);
    dv.setUint32(8, b.id);
    b.entries.forEach((e, i) => body.set(e, 12 + i * entrySize));
    // The checksum byte is 0 here and filled in by updateChecksum below.
    return block(b.tag, BANK_VERSION[b.kind] << 16, body);
  };
  const inContainer = (tags: string[]): Uint8Array => concat(banks.filter((b) => tags.includes(b.tag)).map(bankLeaf));
  const plainLeaf = (tag: string, entrySize: number, entries: Uint8Array[]): Uint8Array => {
    const body = new Uint8Array(12 + entries.length * entrySize);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, entries.length);
    dv.setUint32(4, entrySize);
    entries.forEach((e, i) => body.set(e, 12 + i * entrySize));
    return block(tag, 0x100, body);
  };
  const setLists = extra.setLists
    ? block("SLS1", 0x400, concat([
        block("SLD1", 0x400, plainLeaf("SDB1", COMPANION_SIZE, extra.setLists.map(buildSetListCompanion))),
        block("STL1", 0x400, plainLeaf("SBK1", SET_LIST_SIZE, extra.setLists)),
      ]))
    : new Uint8Array(0);
  const global = extra.global ? block("GLB1", GLOBAL_VERSION << 16, extra.global) : new Uint8Array(0);
  const root = block("PCG1", 0x400, concat([
    block("DIV1", 0x00010000, new Uint8Array(44)),
    setLists,
    block("PRG1", 0x400, inContainer(["MBK1", "PBK1"])),
    block("CMB1", 0x30400, inContainer(["CBK1"])),
    block("DKT1", 0x30400, inContainer(["DBK1"])),
    block("WSQ1", 0x10400, inContainer(["WBK1"])),
    global,
  ]));
  const header = Uint8Array.from([0x4b, 0x4f, 0x52, 0x47, 0x68, 0x00, 0x02, 0x02, 0x01, 0, 0, 0, 0, 0, 0, 0]);
  const file = parsePcg(concat([header, root]));
  // DIV1 is filled in once the banks are parsed, because it lists them.
  const div1 = leafBlocks(file).find((b) => b.tag === "DIV1");
  if (div1) file.bytes.set(buildDiv1(listBanks(file)), div1.offset + 12);
  for (const b of leafBlocks(file)) if (b.tag !== "DIV1") updateChecksum(file, b);
  return file;
}

export type KeyboardBank = { key: string; kind: UsbKind; label: string; sysexBank: number; count: number };

const LETTERS = "ABCDEFG";
// User bank n (0..13) is U-A..U-G, then U-AA..U-GG, the same labels library.ts gives the file.
const userLabel = (n: number): string => (n < 7 ? `U-${LETTERS[n]}` : `U-${LETTERS[n - 7]}${LETTERS[n - 7]}`);

// Every bank a Kronos has, with the label library.ts gives it (so a pulled bank's key matches its file key).
export function keyboardBanks(): KeyboardBank[] {
  const out: KeyboardBank[] = [];
  const add = (kind: UsbKind, label: string, sysexBank: number, count: number) => out.push({ key: `${kind}:${label}`, kind, label, sysexBank, count });
  for (let b = 0; b <= 5; b++) add("program", `INT-${LETTERS[b]}`, b, 128);
  for (let n = 0; n < 14; n++) add("program", userLabel(n), 0x40 + n, 128);
  for (let b = 0; b <= 6; b++) add("combi", `INT-${LETTERS[b]}`, b, 128);
  for (let n = 0; n < 7; n++) add("combi", userLabel(n), 0x40 + n, 128);
  add("drumkit", "INT", 0, 40);
  for (let n = 0; n < 14; n++) add("drumkit", userLabel(n), 0x40 + n, 16);
  add("waveseq", "INT", 0, 150);
  for (let n = 0; n < 14; n++) add("waveseq", userLabel(n), 0x40 + n, 32);
  return out;
}

type Found = Probe & { tag: string; objectSize: number; objects: Uint8Array[] };

// Object 0 of a program bank says which engine it holds: 3706 bytes = HD-1 (PBK1), 4960 = EXi (MBK1).
function tagOf(p: Probe, first: Uint8Array): { tag: string; objectSize: number } {
  if (p.kind === "program") {
    if (first.length === HD1_OBJECT) return { tag: "PBK1", objectSize: HD1_OBJECT };
    if (first.length === ENTRY_SIZE.program) return { tag: "MBK1", objectSize: ENTRY_SIZE.program };
    throw new PcgError(`program bank ${p.bank} object 0 is ${first.length} bytes, expected 3706 or 4960`);
  }
  const tag = { combi: "CBK1", drumkit: "DBK1", waveseq: "WBK1" }[p.kind];
  if (first.length !== ENTRY_SIZE[p.kind]) throw new PcgError(`${p.kind} bank ${p.bank} object 0 is ${first.length} bytes, expected ${ENTRY_SIZE[p.kind]}`);
  return { tag, objectSize: ENTRY_SIZE[p.kind] };
}

// Progress for a pull whose size is only known as it goes: plan() adds work, step() finishes some and reports.
class Progress {
  private done = 0;
  private total = 0;
  private readonly cb?: (done: number, total: number) => void;
  constructor(cb?: (done: number, total: number) => void) {
    this.cb = cb;
  }
  plan(n: number): void {
    this.total += n;
  }
  step(n = 1): void {
    this.done += n;
    this.cb?.(this.done, this.total);
  }
}

// Reads every object of each bank. skipMissing lets a whole keyboard pull pass over banks the model does not have.
async function readBanks(client: KronosClient, probes: Probe[], opts: SyncOptions, skipMissing: boolean, prog: Progress): Promise<Found[]> {
  const found: Found[] = [];
  for (const p of probes) {
    checkAbort(opts);
    let first: { data: Uint8Array };
    try {
      first = await client.requestObject(OBJ_TYPE[p.kind], p.bank, 0);
    } catch (e) {
      if (skipMissing && e instanceof KronosError && e.code === 4) continue; // this bank does not exist on the keyboard
      throw e;
    }
    const f: Found = { ...p, ...tagOf(p, first.data), objects: [first.data] };
    found.push(f);
    prog.plan(f.count);
    prog.step();
  }
  for (const f of found) {
    for (let i = 1; i < f.count; i++) {
      checkAbort(opts);
      const reply = await client.requestObject(OBJ_TYPE[f.kind], f.bank, i);
      if (reply.data.length !== f.objectSize) throw new PcgError(`${f.kind} bank ${f.bank} object ${i} is ${reply.data.length} bytes, expected ${f.objectSize}`);
      f.objects.push(reply.data);
      prog.step();
    }
  }
  checkAbort(opts);
  return found;
}

// A short HD-1 object is padded with zeros to the 4960-byte slot, as in the file.
function bankOf(f: Found): BuiltBank {
  const entries = f.objects.map((o) => {
    const e = new Uint8Array(ENTRY_SIZE[f.kind]);
    e.set(o);
    return e;
  });
  return { kind: f.kind, tag: f.tag, id: bankId(f.kind, f.bank), entries };
}

const FILE_ORDER: Record<UsbKind, number> = { program: 0, combi: 1, drumkit: 2, waveseq: 3 };

// The banks of a library that was pulled from the keyboard, with their keys. Set lists and banks with no USB address cannot be kept.
function keptBanks(file: PcgFile): { key: string; bank: BuiltBank }[] {
  return listBanks(file).map((info) => {
    if (info.kind === "setlist" || info.sysexBank === null) throw new PcgError(`${info.key} cannot be kept in a keyboard library`);
    if (info.entrySize !== ENTRY_SIZE[info.kind]) throw new PcgError(`${info.key} has ${info.entrySize}-byte entries, expected ${ENTRY_SIZE[info.kind]}`);
    const tag = info.kind === "program" ? (info.type === "exi" ? "MBK1" : "PBK1") : { combi: "CBK1", drumkit: "DBK1", waveseq: "WBK1" }[info.kind];
    const entries = Array.from({ length: info.count }, (_, i) => getEntry(file, info.key, i));
    return { key: info.key, bank: { kind: info.kind, tag, id: info.id, entries } };
  });
}

export async function pullKeyboard(client: KronosClient, opts: SyncOptions = {}): Promise<PcgFile> {
  const found = await readBanks(client, PROBES, opts, true, new Progress(opts.onProgress));
  return buildPcg(found.map(bankOf));
}

export type ObjectDump = { obj: number; bank: number; index: number; version: number; data: Uint8Array };
export type FullPull = {
  pcg: PcgFile;
  objects: ObjectDump[];
  report: { notIncluded: string[]; failed: string[] };
};

const NOT_INCLUDED = ["Samples and multisamples: not available over USB. Use Disk mode on the keyboard to save them."];
// shortcut: Drum Track Pattern and Song are probed on bank 0 only, because KORG's document gives no bank table for them; confirm on the keyboard
// shortcut: max is a safety limit so a keyboard that never says "no more" can't loop forever; KARMA's 128 per bank is assumed, confirm on the keyboard
const OPTIONAL: { name: string; obj: number; banks: number[]; max: number }[] = [
  { name: "KARMA GE", obj: 6, banks: range(0, 0x0b), max: 128 },
  { name: "KARMA Template", obj: 7, banks: range(0, 3), max: 128 },
  { name: "Drum Track Pattern", obj: 0x0e, banks: [0], max: 1000 },
  { name: "Song", obj: 0x18, banks: [0], max: 200 },
];

// Everything USB can carry: the banks as pullKeyboard does, plus Set Lists and Global (required), and the optional raw objects.
export async function pullFull(client: KronosClient, opts: SyncOptions = {}): Promise<FullPull> {
  const prog = new Progress(opts.onProgress);
  const found = await readBanks(client, PROBES, opts, true, prog);
  const setLists: Uint8Array[] = [];
  prog.plan(128);
  for (let i = 0; i < 128; i++) {
    checkAbort(opts);
    const reply = await client.requestObject(SET_LIST_OBJ, 0, i);
    if (reply.data.length !== SET_LIST_SIZE) throw new PcgError(`set list ${i} is ${reply.data.length} bytes, expected ${SET_LIST_SIZE}`);
    setLists.push(reply.data);
    prog.step();
  }
  checkAbort(opts);
  prog.plan(1);
  const global = await client.requestObject(GLOBAL_OBJ, 0, 0);
  prog.step();

  const objects: ObjectDump[] = [];
  const failed: string[] = [];
  for (const t of OPTIONAL) {
    for (const bank of t.banks) {
      for (let index = 0; index <= t.max; index++) {
        checkAbort(opts);
        prog.plan(1);
        try {
          const r = await client.requestObject(t.obj, bank, index);
          if (index === t.max) {
            failed.push(`${t.name} bank ${bank}: more than ${t.max} items, the rest were not saved`);
            break;
          }
          objects.push({ obj: t.obj, bank, index, version: r.version, data: r.data });
        } catch (e) {
          // Code 4 is the end of this bank. Any other error is reported, and the pull goes on.
          if (!(e instanceof KronosError && e.code === 4)) failed.push(`${t.name} bank ${bank}, index ${index}: ${(e as Error).message}`);
          break;
        } finally {
          prog.step();
        }
      }
    }
  }
  checkAbort(opts);
  const pcg = buildPcg(found.map(bankOf), { setLists, global: global.data });
  return { pcg, objects, report: { notIncluded: NOT_INCLUDED, failed } };
}

// Pulls the named banks into a library. The banks already in `existing` are kept (names and all), and a pulled bank replaces the one with its key.
export async function pullBanks(client: KronosClient, keys: string[], opts: SyncOptions = {}, existing?: PcgFile): Promise<PcgFile> {
  const wanted = [...new Set(keys)].map((key) => {
    const b = keyboardBanks().find((x) => x.key === key);
    if (!b) throw new PcgError(`no keyboard bank ${key}`);
    return { key, kind: b.kind, bank: b.sysexBank, count: b.count };
  });
  const found = await readBanks(client, wanted, opts, false, new Progress(opts.onProgress));
  const pulled = found.map((f, i) => ({ key: wanted[i].key, bank: bankOf(f) }));
  const kept = (existing ? keptBanks(existing) : []).filter((k) => !wanted.some((w) => w.key === k.key));
  const all = [...kept, ...pulled].sort((a, b) => FILE_ORDER[a.bank.kind] - FILE_ORDER[b.bank.kind]);
  return buildPcg(all.map((x) => x.bank));
}
