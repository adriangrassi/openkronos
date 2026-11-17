// Multisamples of HD-1 programs: each OSC has 8 zones of 22 bytes, [type, 17 bank UUID bytes, number LE16, level, offset].
import { getEntry, getName, listBanks } from "./library.ts";
import type { PcgFile } from "./pcg.ts";

export const MS_ZONES = 8;
export type MsRef = { bank: string; number: number };
export type Zone = { osc: 1 | 2; zone: number; type: number; ref: MsRef };

const OSC_BASE = { 1: 2774, 2: 3240 } as const;
const STRIDE = 22;
const MAX_NUMBER = 16382;
const HEX = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function readZones(entry: Uint8Array): Zone[] {
  const out: Zone[] = [];
  for (const osc of [1, 2] as const) {
    for (let zone = 1; zone <= MS_ZONES; zone++) {
      const o = OSC_BASE[osc] + (zone - 1) * STRIDE;
      out.push({ osc, zone, type: entry[o] & 3, ref: { bank: HEX(entry.subarray(o + 1, o + 18)), number: entry[o + 18] | (entry[o + 19] << 8) } });
    }
  }
  return out;
}

const cmp = (a: MsRef, b: MsRef): number => (a.bank < b.bank ? -1 : a.bank > b.bank ? 1 : a.number - b.number);

// Every HD-1 program of the file, in bank and slot order.
function* programs(f: PcgFile): Generator<{ key: string; index: number; entry: Uint8Array }> {
  for (const b of listBanks(f)) {
    if (b.kind !== "program" || b.type !== "hd1") continue;
    for (let index = 0; index < b.count; index++) yield { key: b.key, index, entry: getEntry(f, b.key, index) };
  }
}

export function listMultisamples(f: PcgFile): MsRef[] {
  const seen = new Map<string, MsRef>();
  for (const p of programs(f)) for (const z of readZones(p.entry)) if (z.type === 1) seen.set(`${z.ref.bank}:${z.ref.number}`, z.ref);
  return [...seen.values()].sort(cmp);
}

export function bankLabel(bank: string): string {
  if (bank.startsWith("4b4f524700000000000000004d53") && bank.slice(28, 30) === "00" && bank.slice(32) === "00" && bank.length === 34) return `KORG MS ${parseInt(bank.slice(30, 32), 16)}`;
  return `Bank ${bank.slice(0, 8)}-${bank.slice(28)}`;
}

export const msLabel = (ref: MsRef): string => `${bankLabel(ref.bank)} #${ref.number}`;

export function groupMultisamples(refs: MsRef[]): { bank: string; label: string; items: MsRef[] }[] {
  const groups = new Map<string, { bank: string; label: string; items: MsRef[] }>();
  for (const r of refs) {
    let g = groups.get(r.bank);
    if (!g) groups.set(r.bank, (g = { bank: r.bank, label: bankLabel(r.bank), items: [] }));
    g.items.push(r);
  }
  return [...groups.values()];
}

export function searchMultisamples(refs: MsRef[], query: string): MsRef[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return refs.filter((r) => {
    // Words with digits match a whole token ("#8" is not "#80"); other words match a token start, so "korg ms 4 #" lists a bank.
    const tokens = msLabel(r).toLowerCase().split(/[\s-]+/);
    return words.every((w) => tokens.some((t) => t === w || (!/\d/.test(w) && t.startsWith(w))));
  });
}

export function whoUses(f: PcgFile, ref: MsRef): { key: string; index: number; name: string; zones: { osc: 1 | 2; zone: number }[] }[] {
  const out = [];
  for (const p of programs(f)) {
    const zones = readZones(p.entry).filter((z) => z.type === 1 && z.ref.bank === ref.bank && z.ref.number === ref.number).map((z) => ({ osc: z.osc, zone: z.zone }));
    if (zones.length) out.push({ key: p.key, index: p.index, name: getName(f, p.key, p.index), zones });
  }
  return out;
}

export function applyMultisample(entry: Uint8Array, osc: 1 | 2, zone: number, ref: MsRef): Uint8Array {
  if (osc !== 1 && osc !== 2) throw new Error(`bad osc ${osc}`);
  if (!Number.isInteger(zone) || zone < 1 || zone > MS_ZONES) throw new Error(`bad zone ${zone}`);
  if (!/^[0-9a-f]{34}$/i.test(ref.bank)) throw new Error("bank must be 34 hex characters");
  if (!Number.isInteger(ref.number) || ref.number < 0 || ref.number > MAX_NUMBER) throw new Error(`bad multisample number ${ref.number}`);
  const out = Uint8Array.from(entry);
  const o = OSC_BASE[osc] + (zone - 1) * STRIDE;
  out[o] = (out[o] & 0xfc) | 1;
  for (let i = 0; i < 17; i++) out[o + 1 + i] = parseInt(ref.bank.slice(i * 2, i * 2 + 2), 16);
  out[o + 18] = ref.number & 255;
  out[o + 19] = ref.number >> 8;
  return out;
}
