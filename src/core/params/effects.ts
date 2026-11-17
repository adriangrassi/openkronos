// Per-effect parameter pages: the 16 effect slots of a program or combination and the named rows of the chosen effect type.
// No node: imports, so it also runs in the renderer.
import effects from "../../generated/effects.json" with { type: "json" };
import { readParam, writeParam, type ParamTables, type Row } from "./params.ts";
import type { Write } from "./graphs.ts";

export type EffectKind = "program" | "combi";
export type EffectSlot = { id: string; label: string; typeOfs: number };

type Def = { pid: number; name: string; ofs: number; bitHi: number; bitLo: number; rawMin: number; rawMax: number; signed: boolean; fixed: boolean; valueText: string; parts: [number, number, number][] };
const types = effects.types as { id: number; name: string; params: Def[] | null }[];

const SLOTS = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `ifx${i + 1}`, label: `Insert Effect ${i + 1}`, group: `Insert Effect${i + 1}` })),
  ...[1, 2].map((n) => ({ id: `mfx${n}`, label: `Master Effect ${n}`, group: `Master Effect${n}` })),
  ...[1, 2].map((n) => ({ id: `tfx${n}`, label: `Total Effect ${n}`, group: `Total Effect${n}` })),
];

export function effectSlots(tables: ParamTables, kind: EffectKind): EffectSlot[] {
  const rows = kind === "program" ? tables.programHd1 : tables.combi;
  return SLOTS.map((s) => {
    const r = rows.find((x) => x.group === s.group && x.name === "Effect Type");
    if (!r) throw new Error(`no Effect Type row in ${s.group}`);
    return { id: s.id, label: s.label, typeOfs: r.ofs };
  });
}

export function effectTypeName(tables: ParamTables, id: number): string {
  return tables.effectTypes[id] ?? "";
}

// Each slot's 64-byte parameter block sits right before its Effect Type byte. Every factory Program and Combi confirms it: every value in range, every fixed value matching.
const BLOCK_BYTES = 64;

// Memoised so the same Row objects come back: the renderer caches per Row.
const rowsMemo = new Map<string, Row[] | null>();

export function effectRowsAt(typeOfs: number, typeId: number, group: string): Row[] | null {
  const key = `${typeOfs}|${typeId}|${group}`;
  if (rowsMemo.has(key)) return rowsMemo.get(key)!;
  let rows: Row[] | null = null;
  const defs = Number.isInteger(typeId) && typeId >= 0 && typeId < types.length ? types[typeId].params : null;
  if (defs) {
    const base = typeOfs - BLOCK_BYTES;
    rows = defs.map((d) => ({
      ofs: base + d.ofs, bitHi: d.bitHi, bitLo: d.bitLo, group, name: d.name,
      rawMin: d.rawMin, rawMax: d.rawMax, fixed: d.fixed, valueText: d.valueText, signed: d.signed, continuation: false,
      parts: d.parts.map(([o, h, l]) => [base + o, h, l] as [number, number, number]),
      typ: null, soc: null, sub: null, pid: d.pid, idx: null,
    }));
  }
  rowsMemo.set(key, rows);
  return rows;
}

// The writes that change a slot's type: the Effect Type byte, then each leftover of the old type that is out of the new type's range.
export function effectTypeWrites(entry: Uint8Array, typeOfs: number, id: number): Write[] {
  const typeRow: Row = {
    ofs: typeOfs, bitHi: 7, bitLo: 0, group: "", name: "Effect Type", rawMin: 0, rawMax: types.length - 1,
    fixed: false, valueText: "", signed: false, continuation: false, parts: [[typeOfs, 7, 0]],
    typ: null, soc: null, sub: null, pid: null, idx: null,
  };
  const out: Write[] = [{ row: typeRow, value: id }];
  for (const r of effectRowsAt(typeOfs, id, "") ?? []) {
    const v = readParam(entry, r);
    if (v < r.rawMin || v > r.rawMax) out.push({ row: r, value: r.rawMin });
  }
  return out;
}

export function effectParamRows(tables: ParamTables, kind: EffectKind, slotId: string, typeId: number): Row[] | null {
  const slot = effectSlots(tables, kind).find((s) => s.id === slotId);
  return slot ? effectRowsAt(slot.typeOfs, typeId, slot.label) : null;
}

// Leftover bytes of the old type that are out of the new type's range are reset to its lowest legal value (fixed rows get their fixed value); in-range leftovers are kept.
// shortcut: the lowest legal value, not the Kronos's own default for that type; upgrade when a defaults table exists
export function changeEffectType(e: Uint8Array, typeOfs: number, id: number): void {
  for (const w of effectTypeWrites(e, typeOfs, id)) writeParam(e, w.row, w.value);
}
