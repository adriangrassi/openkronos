// Bank view of a .PCG file: list banks, and read or edit entries (names, whole entries, copy, swap).
import { BLOCK_HEADER, PcgError, leafBlocks, readU32, updateChecksum, type PcgBlock, type PcgFile } from "./pcg.ts";

export type BankInfo = {
  key: string;
  kind: "program" | "combi" | "drumkit" | "waveseq" | "setlist";
  type: "exi" | "hd1" | null;
  id: number;
  label: string;
  sysexBank: number | null;
  count: number;
  entrySize: number;
  version: number; // bank leaf word >>> 16
  objectSize: number; // bytes that travel over USB per object
};

// A bank plus, for set lists, the SDB1 block that holds the same set lists.
type Bank = { info: BankInfo; leaf: PcgBlock; companion: PcgBlock | null };

const NAME_LEN = 24;
const NAME_RE = /^[ -~]{1,24}$/;
const LETTERS = "ABCDEFG";
const KIND = new Map<string, BankInfo["kind"]>([
  ["MBK1", "program"],
  ["PBK1", "program"],
  ["CBK1", "combi"],
  ["DBK1", "drumkit"],
  ["WBK1", "waveseq"],
  ["SBK1", "setlist"],
]);

function userLabel(low: number): string {
  return low < 7 ? `U-${LETTERS[low]}` : `U-${LETTERS[low - 7]}${LETTERS[low - 7]}`;
}

function labelOf(kind: BankInfo["kind"], id: number): { label: string; sysexBank: number | null } {
  const hi = Math.floor(id / 0x10000);
  const lo = id % 0x10000;
  if (kind === "setlist") return { label: "SET", sysexBank: null };
  if (kind === "program" && hi === 0 && lo <= 4) return { label: `INT-${LETTERS[lo]}`, sysexBank: lo };
  if (kind === "program" && id === 0x8000) return { label: "INT-F", sysexBank: 5 };
  if (kind === "combi" && hi === 0 && lo <= 6) return { label: `INT-${LETTERS[lo]}`, sysexBank: lo };
  // shortcut: drum-kit and wave-seq internal sysexBank taken from protocol-notes section 4 (INT = 0); the 0x71 request uses a linear map, unconfirmed on hardware
  if ((kind === "drumkit" || kind === "waveseq") && id === 0) return { label: "INT", sysexBank: 0 };
  // user banks: sysexBank 0x40+n per section 4, same shortcut as above for drum kits and wave seqs
  if (hi === 2 && lo < 14) return { label: userLabel(lo), sysexBank: 0x40 + lo };
  return { label: `ID-${id.toString(16).padStart(8, "0")}`, sysexBank: null };
}

function ancestor(b: PcgBlock, tag: string): PcgBlock | null {
  for (let p = b.parent; p; p = p.parent) if (p.tag === tag) return p;
  return null;
}

// Bank headers never change under an edit (only entry bytes do), so the list is read once per file; a replaced byte array rebuilds it.
const banksCache = new WeakMap<PcgFile, { bytes: Uint8Array; banks: Bank[]; byKey: Map<string, Bank> }>();

function cachedBanks(f: PcgFile): { banks: Bank[]; byKey: Map<string, Bank> } {
  const hit = banksCache.get(f);
  if (hit && hit.bytes === f.bytes) return hit;
  const banks = banksOf(f);
  const made = { bytes: f.bytes, banks, byKey: new Map(banks.map((b) => [b.info.key, b])) };
  banksCache.set(f, made);
  return made;
}

function banksOf(f: PcgFile): Bank[] {
  const leaves = leafBlocks(f);
  const out: Bank[] = [];
  for (const leaf of leaves) {
    const kind = KIND.get(leaf.tag);
    if (kind === undefined) continue;
    const { bytes } = f;
    const count = readU32(bytes, leaf.offset + 12);
    const entrySize = readU32(bytes, leaf.offset + 16);
    const id = readU32(bytes, leaf.offset + 20);
    const { label, sysexBank } = labelOf(kind, id);
    const type = leaf.tag === "MBK1" ? "exi" : leaf.tag === "PBK1" ? "hd1" : null;
    let companion: PcgBlock | null = null;
    if (kind === "setlist") {
      const set = ancestor(leaf, "SLS1");
      companion = leaves.find((b) => b.tag === "SDB1" && set !== null && ancestor(b, "SLS1") === set) ?? null;
      if (companion === null || readU32(bytes, companion.offset + 12) !== count) {
        throw new PcgError(`set list block @${leaf.offset} has no matching SDB1 block`);
      }
    }
    const version = readU32(bytes, leaf.offset + 8) >>> 16;
    // shortcut: HD-1 objects are 3706 bytes per KORG's document, not the 4960-byte slot; confirm on the real keyboard
    const objectSize = type === "hd1" ? 3706 : entrySize;
    out.push({ info: { key: `${kind}:${label}`, kind, type, id, label, sysexBank, count, entrySize, version, objectSize }, leaf, companion });
  }
  return out;
}

function bankFor(f: PcgFile, key: string): Bank {
  const bank = cachedBanks(f).byKey.get(key);
  if (!bank) throw new PcgError(`no bank ${key}`);
  return bank;
}

function checkIndex(bank: Bank, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= bank.info.count) {
    throw new PcgError(`index ${index} out of range for ${bank.info.key} (0..${bank.info.count - 1})`);
  }
}

// Set lists have two blocks that must change together. Everything else has one.
const targets = (b: Bank): PcgBlock[] => (b.companion ? [b.leaf, b.companion] : [b.leaf]);
const entrySizeOf = (f: PcgFile, block: PcgBlock): number => readU32(f.bytes, block.offset + 16);
const entryStart = (f: PcgFile, block: PcgBlock, index: number): number =>
  block.offset + BLOCK_HEADER + 12 + index * entrySizeOf(f, block);

function checkSame(a: BankInfo, b: BankInfo): void {
  if (a.kind !== b.kind || a.type !== b.type || a.entrySize !== b.entrySize) {
    throw new PcgError(`cannot mix ${a.key} and ${b.key}: kind, engine type or entry size differs`);
  }
}

export function listBanks(f: PcgFile): BankInfo[] {
  return cachedBanks(f).banks.map((b) => b.info);
}

export function getName(f: PcgFile, key: string, index: number): string {
  const bank = bankFor(f, key);
  checkIndex(bank, index);
  const start = entryStart(f, bank.leaf, index);
  let s = "";
  for (let i = 0; i < NAME_LEN; i++) s += String.fromCharCode(f.bytes[start + i]);
  return s.replace(/[\0 ]+$/, "");
}

// The refusal setName would make, or null. Shared so batch plans and setName agree.
export function nameError(name: string): string | null {
  // Trailing spaces would vanish on read, so refuse them rather than store a name that reads back differently.
  if (!NAME_RE.test(name) || name !== name.trimEnd()) {
    return `bad name ${JSON.stringify(name)}: 1 to 24 printable ASCII characters, no trailing space`;
  }
  return null;
}

export function setName(f: PcgFile, key: string, index: number, name: string): void {
  const err = nameError(name);
  if (err) throw new PcgError(err);
  const bank = bankFor(f, key);
  checkIndex(bank, index);
  for (const block of targets(bank)) {
    const start = entryStart(f, block, index);
    f.bytes.fill(0, start, start + NAME_LEN);
    for (let i = 0; i < name.length; i++) f.bytes[start + i] = name.charCodeAt(i);
    updateChecksum(f, block);
  }
}

export function getEntry(f: PcgFile, key: string, index: number): Uint8Array {
  const bank = bankFor(f, key);
  checkIndex(bank, index);
  const start = entryStart(f, bank.leaf, index);
  return f.bytes.slice(start, start + bank.info.entrySize);
}

export function setEntry(f: PcgFile, key: string, index: number, data: Uint8Array): void {
  const bank = bankFor(f, key);
  checkIndex(bank, index);
  // shortcut: a set list entry spans SBK1 and SDB1, so a single-block write would desync them; use setName, copyEntry or swapEntries instead
  if (bank.info.kind === "setlist") throw new PcgError("set list entries span two blocks: use setName, copyEntry or swapEntries");
  if (data.length !== bank.info.entrySize) {
    throw new PcgError(`entry is ${data.length} bytes, ${key} needs ${bank.info.entrySize}`);
  }
  f.bytes.set(data, entryStart(f, bank.leaf, index));
  updateChecksum(f, bank.leaf);
}

export function copyEntry(f: PcgFile, fromKey: string, fromIndex: number, toKey: string, toIndex: number): void {
  const from = bankFor(f, fromKey);
  const to = bankFor(f, toKey);
  checkIndex(from, fromIndex);
  checkIndex(to, toIndex);
  checkSame(from.info, to.info);
  const src = targets(from);
  const dst = targets(to);
  for (let i = 0; i < dst.length; i++) {
    const s = entryStart(f, src[i], fromIndex);
    const d = entryStart(f, dst[i], toIndex);
    f.bytes.copyWithin(d, s, s + entrySizeOf(f, src[i]));
    updateChecksum(f, dst[i]);
  }
}

export function swapEntries(f: PcgFile, keyA: string, indexA: number, keyB: string, indexB: number): void {
  const a = bankFor(f, keyA);
  const b = bankFor(f, keyB);
  checkIndex(a, indexA);
  checkIndex(b, indexB);
  checkSame(a.info, b.info);
  const ta = targets(a);
  const tb = targets(b);
  for (let i = 0; i < ta.length; i++) {
    const pa = entryStart(f, ta[i], indexA);
    const pb = entryStart(f, tb[i], indexB);
    const n = entrySizeOf(f, ta[i]);
    const tmp = f.bytes.slice(pa, pa + n);
    f.bytes.copyWithin(pa, pb, pb + n);
    f.bytes.set(tmp, pb);
    updateChecksum(f, ta[i]);
    updateChecksum(f, tb[i]);
  }
}

// The Global block (GLB1) is one leaf with a single object. Files without one, such as the KRS-* samples, return null.
function globalLeaf(f: PcgFile): PcgBlock | null {
  return leafBlocks(f).find((b) => b.tag === "GLB1") ?? null;
}

export function getGlobal(f: PcgFile): Uint8Array | null {
  const leaf = globalLeaf(f);
  return leaf ? f.bytes.slice(leaf.offset + BLOCK_HEADER, leaf.offset + BLOCK_HEADER + leaf.size) : null;
}

export function setGlobal(f: PcgFile, data: Uint8Array): void {
  const leaf = globalLeaf(f);
  if (!leaf) throw new PcgError("this file has no Global block");
  if (data.length !== leaf.size) throw new PcgError(`Global is ${data.length} bytes, the file needs ${leaf.size}`);
  f.bytes.set(data, leaf.offset + BLOCK_HEADER);
  updateChecksum(f, leaf);
}

// A live view of an entry's bytes, for reading, or for editing in place followed by commitBank. Not a copy.
export function viewEntry(f: PcgFile, key: string, index: number): Uint8Array {
  const bank = bankFor(f, key);
  checkIndex(bank, index);
  const start = entryStart(f, bank.leaf, index);
  return f.bytes.subarray(start, start + bank.info.entrySize);
}

// Recomputes the checksums of a bank after its bytes were edited through viewEntry.
export function commitBank(f: PcgFile, key: string): void {
  for (const block of targets(bankFor(f, key))) updateChecksum(f, block);
}

// The refusal swapEntries would make, checked without changing anything.
export function checkSwappable(f: PcgFile, keyA: string, indexA: number, keyB: string, indexB: number): void {
  const a = bankFor(f, keyA);
  const b = bankFor(f, keyB);
  checkIndex(a, indexA);
  checkIndex(b, indexB);
  checkSame(a.info, b.info);
}

// A Set List is one SBK1 entry plus the SDB1 entry beside it: they are read and written as one pair.
function setListBank(f: PcgFile): { bank: Bank; companion: PcgBlock } {
  const bank = cachedBanks(f).banks.find((b) => b.info.kind === "setlist");
  if (!bank?.companion) throw new PcgError("this file has no Set List bank");
  return { bank, companion: bank.companion };
}

export function getSetList(f: PcgFile, index: number): { entry: Uint8Array; companion: Uint8Array } {
  const { bank, companion } = setListBank(f);
  checkIndex(bank, index);
  const e = entryStart(f, bank.leaf, index);
  const c = entryStart(f, companion, index);
  return { entry: f.bytes.slice(e, e + bank.info.entrySize), companion: f.bytes.slice(c, c + entrySizeOf(f, companion)) };
}

export function setSetList(f: PcgFile, index: number, pair: { entry: Uint8Array; companion: Uint8Array }): void {
  const { bank, companion } = setListBank(f);
  checkIndex(bank, index);
  const companionSize = entrySizeOf(f, companion);
  if (pair.entry.length !== bank.info.entrySize || pair.companion.length !== companionSize) {
    throw new PcgError(`set list is ${bank.info.entrySize} + ${companionSize} bytes, got ${pair.entry.length} + ${pair.companion.length}`);
  }
  f.bytes.set(pair.entry, entryStart(f, bank.leaf, index));
  f.bytes.set(pair.companion, entryStart(f, companion, index));
  updateChecksum(f, bank.leaf);
  updateChecksum(f, companion);
}
