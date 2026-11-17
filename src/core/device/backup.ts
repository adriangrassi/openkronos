// Pure builders for a complete backup: the DIV1 bank map and the SDB1 companion of a Set List. No node: imports.
import type { BankInfo } from "../pcg/library.ts";

export const SET_LIST_SIZE = 69416;
const SET_LIST_SLOT = 542;
export const COMPANION_SIZE = 3612;

// The bank map says which banks a file holds, as mask/version word pairs (see SPEC-editing.md, section A).
// Program bits: INT-A..E = 0..4, INT-F = 5, user bank n = 6 + n. Drum and wave: INT = bit 0, user n = 1 + n.
// shortcut: combi user banks take bit 7 + n (no factory sample to check against), confirm on the keyboard
export function buildDiv1(banks: BankInfo[]): Uint8Array {
  let program = 0, combi = 0, drum = 0, wave = 0, sets = false;
  for (const b of banks) {
    if (b.kind === "setlist") {
      sets = true;
      continue;
    }
    if (b.sysexBank === null) continue;
    const user = b.sysexBank >= 0x40 ? b.sysexBank - 0x40 : -1;
    if (b.kind === "program") program |= 1 << (user >= 0 ? 6 + user : b.sysexBank);
    else if (b.kind === "combi") combi |= 1 << (user >= 0 ? 7 + user : b.sysexBank);
    else if (b.kind === "drumkit") drum |= 1 << (user >= 0 ? 1 + user : 0);
    else wave |= 1 << (user >= 0 ? 1 + user : 0);
  }
  const out = new Uint8Array(44);
  const dv = new DataView(out.buffer);
  const words = [
    0, 0,
    program & 0xffff, 0x15, program >>> 16, 0x15,
    combi & 0xffff, 0x0e, combi >>> 16, 0x0e,
    drum & 0xffff, 0x0f, drum >>> 16, 0x0f,
    wave & 0xffff, 0x0f, wave >>> 16, 0x0f,
    sets ? 1 : 0, sets ? 1 : 0,
    0xffff, 0,
  ];
  words.forEach((w, i) => dv.setUint16(i * 2, w));
  return out;
}

// SDB1 companion of one Set List entry: the set name, its size word, then 128 slot names with their size words.
export function buildSetListCompanion(entry: Uint8Array): Uint8Array {
  const out = new Uint8Array(COMPANION_SIZE);
  const dv = new DataView(out.buffer);
  out.set(entry.subarray(0, 24), 0);
  dv.setUint32(24, SET_LIST_SIZE, true);
  for (let s = 0; s < 128; s++) {
    const at = 28 + s * 28;
    out.set(entry.subarray(24 + SET_LIST_SLOT * s, 24 + SET_LIST_SLOT * s + 24), at);
    dv.setUint32(at + 24, SET_LIST_SLOT, true);
  }
  return out;
}
