// Compare two .PCG files: which slots differ, copies of chosen slots from the compare file, and parameter diffs of two sounds.
// Pure logic, no node: imports, so it also runs in the renderer. The compare file is only ever read.
import { getEntry, getName, getSetList, listBanks, setEntry, setSetList, type BankInfo } from "./library.ts";
import { PcgError, type PcgFile } from "./pcg.ts";
import { ENGINE_NAMES, formatValue, isEditable, paramsFor, readParam, type ParamTables, type ParamType, type Row } from "../params/params.ts";

export type SlotRef = { key: string; index: number };
export type CopyItem = { from: SlotRef; to: SlotRef };
export type BankDiff = { key: string; label: string; count: number; differing: number };
export type SlotDiff = { index: number; nameA: string; nameB: string; differs: boolean };
export type ParamDiff = { group: string; name: string; a: string; b: string };

const bankOf = (f: PcgFile, key: string): BankInfo | undefined => listBanks(f).find((b) => b.key === key);
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// A slot's bytes. A Set List slot is its SBK1 entry and SDB1 companion together.
function slotBytes(f: PcgFile, info: BankInfo, index: number): Uint8Array {
  if (info.kind !== "setlist") return getEntry(f, info.key, index);
  const p = getSetList(f, index);
  const out = new Uint8Array(p.entry.length + p.companion.length);
  out.set(p.entry);
  out.set(p.companion, p.entry.length);
  return out;
}

export function compareBanks(a: PcgFile, b: PcgFile): BankDiff[] {
  const out: BankDiff[] = [];
  for (const info of listBanks(a)) {
    const other = bankOf(b, info.key);
    if (!other || other.count !== info.count) continue;
    let differing = 0;
    for (let i = 0; i < info.count; i++) if (!same(slotBytes(a, info, i), slotBytes(b, other, i))) differing++;
    out.push({ key: info.key, label: info.label, count: info.count, differing });
  }
  return out;
}

export function compareSlots(a: PcgFile, b: PcgFile, key: string, differingOnly = false): SlotDiff[] {
  const ia = bankOf(a, key);
  const ib = bankOf(b, key);
  if (!ia || !ib || ia.count !== ib.count) throw new PcgError(`${key} is not in both files with the same size`);
  const out: SlotDiff[] = [];
  for (let i = 0; i < ia.count; i++) {
    const differs = !same(slotBytes(a, ia, i), slotBytes(b, ib, i));
    if (differingOnly && !differs) continue;
    out.push({ index: i, nameA: getName(a, key, i), nameB: getName(b, key, i), differs });
  }
  return out;
}

// The copy rules: same kind, engine type and entry size, and both slots inside their banks. Returns the reason, or null.
export function copyBlocker(dst: PcgFile, src: PcgFile, item: CopyItem): string | null {
  const s = bankOf(src, item.from.key);
  const d = bankOf(dst, item.to.key);
  if (!s) return `${item.from.key} is not a bank in the compare file`;
  if (!d) return `${item.to.key} is not a bank in the open file`;
  if (s.kind !== d.kind || s.type !== d.type || s.entrySize !== d.entrySize) {
    return `cannot copy ${s.label} to ${d.label}: kind, engine type or entry size differs`;
  }
  if (!Number.isInteger(item.from.index) || item.from.index < 0 || item.from.index >= s.count) {
    return `slot ${item.from.index} is out of range for ${s.label} in the compare file`;
  }
  if (!Number.isInteger(item.to.index) || item.to.index < 0 || item.to.index >= d.count) {
    return `slot ${item.to.index} is out of range for ${d.label} in the open file`;
  }
  return null;
}

// All-or-nothing: every item is checked before the first write. The compare file is never changed.
// shortcut: a Set List copy writes the SBK1 and SDB1 pair in two calls, so a bad companion size could still stop midway; the blocker checks the entry size only
export function copyFromCompare(dst: PcgFile, src: PcgFile, items: CopyItem[]): void {
  for (const item of items) {
    const why = copyBlocker(dst, src, item);
    if (why !== null) throw new PcgError(why);
  }
  for (const item of items) {
    if (bankOf(dst, item.to.key)!.kind === "setlist") {
      setSetList(dst, item.to.index, getSetList(src, item.from.index));
    } else {
      setEntry(dst, item.to.key, item.to.index, getEntry(src, item.from.key, item.from.index));
    }
  }
}

// Items whose target differs from the same slot in the last-saved file. A target the saved file does not have counts as changed.
export function changedTargets(current: PcgFile, saved: PcgFile, items: CopyItem[]): CopyItem[] {
  return items.filter((item) => {
    const info = bankOf(current, item.to.key);
    const old = bankOf(saved, item.to.key);
    if (!info || !old || item.to.index >= old.count) return true;
    return !same(slotBytes(current, info, item.to.index), slotBytes(saved, old, item.to.index));
  });
}

const keyOf = (r: Row): string => `${r.ofs}.${r.bitLo ?? 0}`;
const shown = (r: Row): boolean => isEditable(r) || r.name === "Effect Type" || r.name === "Algorithm Type";

// Shows a value the way the editor does: Effect Type and Algorithm Type by name, the rest by formatValue.
function text(tables: ParamTables, r: Row, v: number): string {
  if (r.name === "Effect Type") return tables.effectTypes[v] ?? String(v);
  if (r.name === "Algorithm Type") return ENGINE_NAMES[v] ?? String(v);
  return formatValue(r, v, tables);
}

// Rows of both sounds, A's layout first. A row only B has is read from B's bytes at its offset.
export function diffSounds(
  tables: ParamTables,
  a: { type: ParamType; entry: Uint8Array },
  b: { type: ParamType; entry: Uint8Array },
): ParamDiff[] {
  const ra = paramsFor(tables, a.type, a.entry).filter(shown);
  const rb = paramsFor(tables, b.type, b.entry).filter(shown);
  const seen = new Set(ra.map(keyOf));
  // KORG's tables leave the group blank on rows that continue the group above, so those rows take the last group named.
  let group = "General";
  const rows: { group: string; r: Row }[] = [];
  for (const r of [...ra, ...rb.filter((r) => !seen.has(keyOf(r)))]) {
    if (r.group.trim() !== "") group = r.group;
    rows.push({ group, r });
  }
  // Each group stays in one block, in the order it first appears (B-only rows can share a group name with A's).
  const rank = new Map<string, number>();
  for (const x of rows) if (!rank.has(x.group)) rank.set(x.group, rank.size);
  rows.sort((p, q) => rank.get(p.group)! - rank.get(q.group)!);
  const out: ParamDiff[] = [];
  for (const { group: g, r } of rows) {
    const va = readParam(a.entry, r);
    const vb = readParam(b.entry, r);
    if (va !== vb) out.push({ group: g, name: r.name, a: text(tables, r, va), b: text(tables, r, vb) });
  }
  return out;
}
