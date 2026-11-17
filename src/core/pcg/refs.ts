// Who uses which Program or Combi slot: the Combi timbres, Drum Tracks and Set List slots that point at it.
// A swap moves the slots and rewrites every pointer to either one. No node: imports, so it also runs in the renderer.
import { checkSwappable, commitBank, listBanks, swapEntries, viewEntry } from "./library.ts";
import { PcgError, type PcgFile } from "./pcg.ts";

export type Ref = { kind: "timbre" | "drum-track" | "setlist"; fromKey: string; fromIndex: number; part: number };
export type Slot = { key: string; index: number };

const LETTERS = "ABCDEFG";

// Bank columns a pointer can hold. Program: 0..5 INT-A..F, 17..23 U-A..G, 24..30 U-AA..GG. Anything else
// (6..16 are GM banks) is not tracked and never rewritten.
export function programKey(col: number): string | null {
  if (col <= 5) return `program:INT-${LETTERS[col]}`;
  if (col >= 17 && col <= 23) return `program:U-${LETTERS[col - 17]}`;
  if (col >= 24 && col <= 30) return `program:U-${LETTERS[col - 24].repeat(2)}`;
  return null;
}

// shortcut: KORG's table for user combi banks is inconsistent, so only INT combi banks (0..5) are tracked from Set Lists.
export function columnOf(key: string): number {
  if (key.startsWith("combi:")) return LETTERS.indexOf(key.slice("combi:INT-".length));
  for (let c = 0; c <= 30; c++) if (programKey(c) === key) return c;
  throw new PcgError(`${key} is not a tracked bank`);
}

type Pointer = { ref: Ref; to: "program" | "combi"; entry: Uint8Array; numAt: number; bankAt: number; mask: number };

// Visits every pointer in the file. Entries are viewed, not copied, so this stays cheap enough to run on each selection.
function scan(f: PcgFile, visit: (p: Pointer) => void, only?: string): void {
  for (const b of listBanks(f)) {
    if (only !== undefined && b.key !== only) continue;
    for (let i = 0; i < b.count; i++) {
      const e = viewEntry(f, b.key, i);
      const from = { fromKey: b.key, fromIndex: i };
      if (b.kind === "combi" && e.length > 4803 + 188 * 15) {
        for (let t = 0; t < 16; t++) visit({ ref: { kind: "timbre", ...from, part: t }, to: "program", entry: e, numAt: 4802 + 188 * t, bankAt: 4803 + 188 * t, mask: 255 });
      } else if (b.kind === "program" && e.length > 2689) {
        visit({ ref: { kind: "drum-track", ...from, part: 0 }, to: "program", entry: e, numAt: 2688, bankAt: 2689, mask: 255 });
      } else if (b.kind === "setlist") {
        for (let s = 0; s < 128; s++) {
          const o = 24 + 542 * s;
          const type = e[o + 24] & 3; // 0 = Combi, 1 = Program; the other types are not tracked
          if (type !== 0 && type !== 1) continue;
          visit({ ref: { kind: "setlist", ...from, part: s }, to: type === 1 ? "program" : "combi", entry: e, numAt: o + 26, bankAt: o + 25, mask: 31 });
        }
      }
    }
  }
}

// The slot a pointer names, or null when its bank column is not tracked or its target bank is not in this file.
function targetOf(p: Pointer, have: Set<string>): Slot | null {
  const col = p.entry[p.bankAt] & p.mask;
  const key = p.to === "program" ? programKey(col) : col <= 5 ? `combi:INT-${LETTERS[col]}` : null;
  return key !== null && have.has(key) ? { key, index: p.entry[p.numAt] } : null;
}

const keysOf = (f: PcgFile): Set<string> => new Set(listBanks(f).map((b) => b.key));

function checkTarget(f: PcgFile, key: string, index: number): void {
  const bank = listBanks(f).find((b) => b.key === key);
  if (!bank) throw new PcgError(`no bank ${key}`);
  if (bank.kind !== "program" && bank.kind !== "combi") throw new PcgError(`${key} is not a Program or Combi bank`);
  if (!Number.isInteger(index) || index < 0 || index >= bank.count) throw new PcgError(`index ${index} out of range for ${key}`);
}

export function refsTo(f: PcgFile, key: string, index: number): Ref[] {
  checkTarget(f, key, index);
  const have = keysOf(f);
  const out: Ref[] = [];
  scan(f, (p) => {
    const t = targetOf(p, have);
    if (t && t.key === key && t.index === index) out.push(p.ref);
  });
  return out;
}

// The pointers one bank holds, by the slot they name ("key/index"), in slot order.
export type BankRefs = Map<string, Ref[]>;

export function refsFrom(f: PcgFile, key: string): BankRefs {
  const have = keysOf(f);
  const out: BankRefs = new Map();
  scan(f, (p) => {
    const t = targetOf(p, have);
    if (!t) return;
    const k = `${t.key}/${t.index}`;
    const list = out.get(k);
    if (list) list.push(p.ref);
    else out.set(k, [p.ref]);
  }, key);
  return out;
}

// refsTo from per-bank pointer lists kept in `cache`, so a caller that drops a bank's entry after editing it rescans that bank only.
export function refsToCached(f: PcgFile, key: string, index: number, cache: Map<string, BankRefs>): Ref[] {
  checkTarget(f, key, index);
  const out: Ref[] = [];
  for (const b of listBanks(f)) {
    let m = cache.get(b.key);
    if (!m) cache.set(b.key, (m = refsFrom(f, b.key)));
    const hit = m.get(`${key}/${index}`);
    if (hit) out.push(...hit);
  }
  return out;
}

const same = (s: Slot, key: string, index: number): boolean => s.key === key && s.index === index;

// Every slot a swap changes: both slots, and each slot holding a pointer to either one (pointers move with their slot).
export function slotsTouchedBySwap(f: PcgFile, keyA: string, ia: number, keyB: string, ib: number): Slot[] {
  checkSwappable(f, keyA, ia, keyB, ib);
  const have = keysOf(f);
  const out = new Map<string, Slot>();
  const add = (s: Slot) => out.set(`${s.key}/${s.index}`, s);
  add({ key: keyA, index: ia });
  add({ key: keyB, index: ib });
  scan(f, (p) => {
    const t = targetOf(p, have);
    if (t && (same(t, keyA, ia) || same(t, keyB, ib))) add({ key: p.ref.fromKey, index: p.ref.fromIndex });
  });
  return [...out.values()];
}

// Swaps two slots of the same kind, then rewrites every pointer to A to point at B and the reverse.
// Applying it twice restores the file byte for byte.
export function swapWithRefs(f: PcgFile, keyA: string, ia: number, keyB: string, ib: number): Slot[] {
  const touched = slotsTouchedBySwap(f, keyA, ia, keyB, ib);
  swapEntries(f, keyA, ia, keyB, ib);
  const have = keysOf(f);
  const other = (t: Slot): Slot | null => (same(t, keyA, ia) ? { key: keyB, index: ib } : same(t, keyB, ib) ? { key: keyA, index: ia } : null);
  const banks = new Set<string>([keyA, keyB]);
  scan(f, (p) => {
    const t = targetOf(p, have);
    const n = t ? other(t) : null;
    if (!n) return;
    p.entry[p.numAt] = n.index;
    p.entry[p.bankAt] = (p.entry[p.bankAt] & ~p.mask) | columnOf(n.key);
    banks.add(p.ref.fromKey);
  });
  for (const key of banks) commitBank(f, key);
  return touched;
}

// Every Program or Combi slot that some pointer names, as "key/index", from one pass over the file.
export function referencedSlots(f: PcgFile): Set<string> {
  const have = keysOf(f);
  const out = new Set<string>();
  scan(f, (p) => {
    const t = targetOf(p, have);
    if (t) out.add(`${t.key}/${t.index}`);
  });
  return out;
}
