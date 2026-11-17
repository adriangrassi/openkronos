import { effectRowsAt } from "../params/effects.ts";
import type { Row } from "../params/params.ts";
// Pure helpers for "Ask & show": where a row sits in a list and where to scroll so it is visible. No DOM imports.
// One stop of a guided walkthrough: the setting, what to do to it, and the raw value to set when the AI gave one.
// kind "note" is an instruction with no control (its id is a placeholder); "combi-timbre" is a Combi timbre field, where bank, transpose and to (the top of a range) are written with the program or range.
export type PointStep = { id: string; note: string; suggest?: number; kind?: "note" | "combi-timbre" | "param"; timbre?: number; field?: "program" | "level" | "keyrange" | "velrange"; bank?: number; transpose?: number; to?: number };
// ids/notes/names are parallel to steps; a pointer without steps (older callers) is read as one step per id.
export type PointAt = { key: string; index: number; ids: string[]; notes: string[]; names: string[]; steps?: PointStep[] };

export const rowIndexIn = (ids: string[], id: string): number => ids.indexOf(id);

// Centres the row in the view, clamped to the scrollable range.
export function scrollOffsetFor(index: number, rowH: number, viewH: number, count: number): number {
  return Math.max(0, Math.min(index * rowH - (viewH - rowH) / 2, count * rowH - viewH));
}

// When the guide highlight goes away: only a deliberate move away from it, never the user's own edit of the pointed control.
export type PointEvent = "edit" | "page" | "sound" | "mode" | "ask" | "close";
export const clearsPointOn = (e: PointEvent): boolean => e !== "edit";

// Which group a pointed row lives in. Effect parameters are not List rows: they exist only on the Kronos view's effect pages.
export type PointTarget = { kind: "list" | "fx"; group: string } | null;
export function pointTarget(id: string, listRows: { id: string; group: string }[], fxRows: { id: string; group: string }[]): PointTarget {
  const l = listRows.find((r) => r.id === id);
  if (l) return { kind: "list", group: l.group };
  const f = fxRows.find((r) => r.id === id);
  return f ? { kind: "fx", group: f.group } : null;
}

// The Kronos-view tab (and Insert effect number) that shows an effect group; null when no effects page holds it (e.g. an Effect LFO).
export function fxSpot(group: string): { tab: string; ifx?: number } | null {
  const m = /^Insert Effect(\d+)$/.exec(group);
  if (m) return { tab: "8-7", ifx: Number(m[1]) };
  const tab = ({ "Master Effect1": "9-2", "Master Effect2": "9-3", "Total Effect1": "9-4", "Total Effect2": "9-5" } as Record<string, string>)[group];
  return tab ? { tab } : null;
}

// The effect-parameter rows of a sound (not List rows), each with its effect group, read from the Effect Type rows.
export function fxRowsOf(all: Row[], cur: Uint8Array): { id: string; group: string }[] {
  return all.filter((r) => r.name === "Effect Type").flatMap((t) => (effectRowsAt(t.ofs, cur[t.ofs], t.group) ?? []).filter((r) => !r.fixed).map((r) => ({ id: `${r.ofs}.${r.bitLo ?? 0}`, group: t.group })));
}

// Which editor UI a pointed row opens. Effect parameters open the Effects panel unless the Kronos view has an effect tab for them (HD-1 and Combi only).
export type PointUi = { ui: "list" | "effects"; group: string } | { ui: "kronos" } | null;
export function pointUi(id: string, o: { view: "list" | "kronos"; kronosFx: boolean; kronosHolds: boolean; listRows: { id: string; group: string }[]; fxRows: { id: string; group: string }[] }): PointUi {
  const t = pointTarget(id, o.listRows, o.fxRows);
  if (!t) return null;
  if (t.kind === "fx") return o.view === "kronos" && o.kronosFx && fxSpot(t.group) ? { ui: "kronos" } : { ui: "effects", group: t.group };
  return o.view === "kronos" && o.kronosHolds ? { ui: "kronos" } : { ui: "list", group: t.group };
}

// The row a pointer id names: a table row, or an effect parameter derived from its slot's Effect Type. Undefined when the sound has no such row now.
export function pointRow(all: Row[], cur: Uint8Array, id: string): Row | undefined {
  const idOf = (r: Row) => `${r.ofs}.${r.bitLo ?? 0}`;
  return all.find((r) => idOf(r) === id) ?? all.filter((r) => r.name === "Effect Type").flatMap((t) => effectRowsAt(t.ofs, cur[t.ofs], t.group) ?? []).find((r) => idOf(r) === id);
}
