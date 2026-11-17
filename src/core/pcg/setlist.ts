// Set List pad-grid logic: 128 slots, 16 pads per page, 8 pages. Slot s of an SBK1 entry starts at 24 + 542*s. No node: imports.
import { getName, getSetList, listBanks, setSetList } from "./library.ts";
import { PcgError, type PcgFile } from "./pcg.ts";
import { columnOf, programKey } from "./refs.ts";

export const SLOTS = 128, PADS_PER_PAGE = 16, PAGES = 8;
export type SetSlot = { slot: number; name: string; refName: string; kind: "program" | "combi" | "other"; key: string | null; number: number; volume: number; transpose: number; color: number; comment: string };

const SIZE = 542, BASE = 24, COMMENT_MAX = 511;
// shortcut: the SDB1 companion layout (24-byte header, 28 bytes per slot) is inferred from the factory file, upgrade when KORG's SDB1 spec is confirmed.
const CBASE = 24, CSIZE = 28;
const off = (s: number): number => BASE + SIZE * s;
const latin1 = (b: Uint8Array): string => { let n = b.indexOf(0); if (n < 0) n = b.length; let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(b[i]); return s; };
const checkSlot = (s: number): void => { if (!Number.isInteger(s) || s < 0 || s >= SLOTS) throw new PcgError(`slot ${s} out of range`); };

export function slotAt(page: number, pad: number): number {
  if (!Number.isInteger(page) || page < 0 || page >= PAGES || !Number.isInteger(pad) || pad < 0 || pad >= PADS_PER_PAGE) throw new PcgError(`no pad ${pad} on page ${page}`);
  return page * PADS_PER_PAGE + pad;
}
export const padOf = (slot: number): { page: number; pad: number } => ({ page: Math.floor(slot / PADS_PER_PAGE), pad: slot % PADS_PER_PAGE });

// Next/Previous stop at the ends (slot 127 + 1 stays 127); pages follow the slot.
export const stepSlot = (slot: number, dir: 1 | -1): number => Math.min(SLOTS - 1, Math.max(0, slot + dir));

export function readSlot(f: PcgFile, setIndex: number, slot: number): SetSlot {
  checkSlot(slot);
  const e = getSetList(f, setIndex).entry, o = off(slot), t = e[o + 24] & 3;
  const kind = t === 1 ? "program" : t === 0 ? "combi" : "other";
  const col = e[o + 25] & 31, num = e[o + 26];
  const key = kind === "program" ? programKey(col) : kind === "combi" && col <= 5 ? `combi:INT-${"ABCDEF"[col]}` : null;
  const refName = key !== null && listBanks(f).some((b) => b.key === key && num < b.count) ? getName(f, key, num) : "";
  const own = latin1(e.subarray(o, o + 24)).trimEnd();
  return { slot, name: own !== "" ? own : refName, refName, kind, key, number: num, volume: e[o + 28], transpose: (e[o + 29] << 24) >> 24, color: e[o + 27], comment: latin1(e.subarray(o + 30, o + SIZE)) };
}

const write = (f: PcgFile, setIndex: number, fn: (e: Uint8Array, c: Uint8Array) => void): void => {
  const p = getSetList(f, setIndex);
  fn(p.entry, p.companion);
  setSetList(f, setIndex, p);
};
const int = (v: unknown, lo: number, hi: number, what: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new PcgError(`${what} must be a whole number from ${lo} to ${hi}`);
  return v;
};

export function editSlot(f: PcgFile, setIndex: number, slot: number, patch: Partial<{ volume: number; transpose: number; color: number; comment: string; name: string }>): void {
  checkSlot(slot);
  const o = off(slot);
  const volume = patch.volume === undefined ? undefined : int(patch.volume, 0, 127, "Volume");
  const transpose = patch.transpose === undefined ? undefined : int(patch.transpose, -12, 12, "Transpose");
  const color = patch.color === undefined ? undefined : int(patch.color, 0, 15, "Color");
  let comment: Uint8Array | undefined;
  if (patch.comment !== undefined) {
    if (typeof patch.comment !== "string" || patch.comment.length > COMMENT_MAX) throw new PcgError(`comment is at most ${COMMENT_MAX} characters`);
    comment = Uint8Array.from(patch.comment, (c) => (c.charCodeAt(0) > 255 ? 63 : c.charCodeAt(0)));
  }
  if (patch.name !== undefined && (typeof patch.name !== "string" || patch.name.length > 24)) throw new PcgError("name is at most 24 characters");
  const name = patch.name;
  write(f, setIndex, (e) => {
    if (name !== undefined) { e.fill(0, o, o + 24); for (let i = 0; i < name.length; i++) e[o + i] = name.charCodeAt(i) > 255 ? 63 : name.charCodeAt(i); }
    if (volume !== undefined) e[o + 28] = volume;
    if (transpose !== undefined) e[o + 29] = transpose & 255;
    if (color !== undefined) e[o + 27] = color;
    if (comment) { e.fill(0, o + 30, o + SIZE); e.set(comment, o + 30); }
  });
}

export function assignSound(f: PcgFile, setIndex: number, slot: number, key: string, index: number): void {
  checkSlot(slot);
  if (!key.startsWith("program:") && !key.startsWith("combi:")) throw new PcgError(`${key} is not a Program or Combi bank`);
  const col = columnOf(key); // throws for untracked banks
  const bank = listBanks(f).find((b) => b.key === key);
  if (!bank) throw new PcgError(`no bank ${key}`);
  if (!Number.isInteger(index) || index < 0 || index >= bank.count) throw new PcgError(`index ${index} out of range for ${key}`);
  const name = getName(f, key, index).slice(0, 24), o = off(slot);
  write(f, setIndex, (e) => {
    e[o + 24] = (e[o + 24] & ~3) | (key.startsWith("program:") ? 1 : 0);
    e[o + 25] = (e[o + 25] & ~31) | col;
    e[o + 26] = index;
    e.fill(0, o, o + 24);
    for (let i = 0; i < name.length; i++) e[o + i] = name.charCodeAt(i) & 255;
  });
}

export function swapSlots(f: PcgFile, setIndex: number, a: number, b: number): void {
  checkSlot(a); checkSlot(b);
  if (a === b) return;
  write(f, setIndex, (e, c) => {
    const swap = (u: Uint8Array, x: number, y: number, n: number) => { const t = u.slice(x, x + n); u.copyWithin(x, y, y + n); u.set(t, y); };
    swap(e, off(a), off(b), SIZE);
    swap(c, CBASE + CSIZE * a, CBASE + CSIZE * b, CSIZE);
  });
}

export function copySlot(f: PcgFile, setIndex: number, from: number, to: number): void {
  checkSlot(from); checkSlot(to);
  if (from === to) return;
  write(f, setIndex, (e, c) => {
    e.copyWithin(off(to), off(from), off(from) + SIZE);
    c.copyWithin(CBASE + CSIZE * to, CBASE + CSIZE * from, CBASE + CSIZE * from + CSIZE);
  });
}
