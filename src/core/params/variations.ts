// Sound variations for one Program: seeded mutation, morph between two Programs, and three candidates.
// No node: imports, so it also runs in the renderer.
import { exiEngines, isEditable, paramsFor, readParam, writeParam, type ParamTables, type Row } from "./params.ts";

export type ProgType = "hd1" | "exi";

export function engineOf(tables: ParamTables, type: ProgType, entry: Uint8Array): string {
  return type === "hd1" ? "HD-1" : exiEngines(tables, entry).join("+");
}

// An HD-1 and an EXi entry have the same length and no type marker, so an HD-1 morph also compares where an EXi keeps its engines.
// shortcut: relies on HD-1 Programs reading one value there, upgrade when KORG documents a type marker.
const sameKind = (t: ParamTables, type: ProgType, a: Uint8Array, b: Uint8Array): boolean =>
  engineOf(t, type, a) === engineOf(t, type, b) && (type === "exi" || exiEngines(t, a).join() === exiEngines(t, b).join());

export function isEnumerated(r: Row): boolean {
  return r.list !== undefined || r.rawMax - r.rawMin === 1;
}

// Sound-shaping rows by name; structural words win. shortcut: name matching on the KORG table text, upgrade to a curated row list if a sound-shaping row is missed.
const SOUND = /filter|\beg\b|envelope|lfo|send|cutoff|resonance/i;
const STRUCT = /midi|controller|assign|multisample|\bms\b|scale|oscillator mode|algorithm|effect type|routing|bus|source|\btype\b|mode/i;
const shaping = (r: Row): boolean => {
  const t = `${r.group} ${r.name}`;
  return isEditable(r) && !isEnumerated(r) && SOUND.test(t) && !STRUCT.test(t);
};

// mulberry32 over a uint32 seed.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mutate(tables: ParamTables, type: ProgType, entry: Uint8Array, strength: number, seed: number): Uint8Array {
  if (!(strength >= 0 && strength <= 1)) throw new RangeError(`strength ${strength} is outside 0..1`);
  const out = new Uint8Array(entry);
  if (strength === 0) return out;
  const rand = rng(seed);
  for (const r of paramsFor(tables, type, entry)) {
    if (!shaping(r) || r.rawMax <= r.rawMin) continue;
    // Both draws happen for every row, so a row's result does not depend on which rows before it were skipped.
    const pick = rand(), delta = rand() * 2 - 1;
    if (pick > 0.25 + 0.75 * strength) continue;
    const span = r.rawMax - r.rawMin;
    const v = Math.min(r.rawMax, Math.max(r.rawMin, Math.round(readParam(entry, r) + delta * span * strength * 0.5)));
    writeParam(out, r, v);
  }
  return out;
}

export function morph(tables: ParamTables, type: ProgType, a: Uint8Array, b: Uint8Array, amount: number): Uint8Array {
  if (!(amount >= 0 && amount <= 100)) throw new RangeError(`amount ${amount} is outside 0..100`);
  if (a.length !== b.length || !sameKind(tables, type, a, b)) throw new Error("morph needs two Programs of the same engine");
  const out = new Uint8Array(a);
  for (const r of paramsFor(tables, type, a)) {
    if (!isEditable(r)) continue;
    const x = readParam(a, r), y = readParam(b, r);
    if (x === y) continue;
    const v = isEnumerated(r) ? (amount >= 50 ? y : x) : Math.round(x + ((y - x) * amount) / 100);
    writeParam(out, r, Math.min(r.rawMax, Math.max(r.rawMin, v)));
  }
  return out;
}

export function candidates(tables: ParamTables, type: ProgType, entry: Uint8Array, strength: number, seed: number): [Uint8Array, Uint8Array, Uint8Array] {
  const s = (k: number) => (Math.imul(seed >>> 0, 3) + k * 0x9e3779b1) >>> 0;
  return [mutate(tables, type, entry, strength, s(1)), mutate(tables, type, entry, strength, s(2)), mutate(tables, type, entry, strength, s(3))];
}
