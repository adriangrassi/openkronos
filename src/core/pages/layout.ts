// Declarative screen layouts for the Kronos view: sections in a two column grid, rows of cells that name real parameters. Pure: no DOM.
// The data lives in layouts/*.ts; KronosLayout.tsx draws it. See layouts/README.md.
import { keyOf } from "./view.ts";
import type { Row } from "../params/params.ts";

// A parameter as the table names it. index picks one of several rows that share group and name.
export type Ref = { group: string; name: string; index?: number };

// pick is a pop-up list (look "radio": radio buttons), text the value read-only; the rest are what the real screens draw.
export type CellKind = "box" | "dial" | "fader" | "check" | "toggle" | "pick" | "text";
// label: caption left of the control; w: grid columns spanned; options: the product's names per value, lowest first; hz: EQ mid frequency text; h: a fader's height in px; fill: a numeric box takes its whole slot (long values such as a seed).
export type Cell = Ref & { kind: CellKind; label?: string; unit?: string; look?: "radio"; w?: number; options?: string[]; hz?: boolean; h?: number; fill?: boolean };
export type GraphKind = "env" | "filter" | "lfo" | "keytrack" | "vector" | "eq" | "zones" | "route" | "fxtype" | "chain" | "placeholder";
// group names the shape the finders return (for eq, the Track EQ group; for zones, "key" or "vel"; for route, "ifx" or "master"; for chain, "ifx", the drawn links down the 8-5 Chain column; for fxtype, an effect group such as "Insert Effect3", drawn as its type button). A placeholder is a labelled empty tile for a picture we have no component for.
export type GraphSlot = { graph: GraphKind; group: string; w?: number; label?: string };
// Fixed text in a row, such as a column heading; not a parameter.
// badge: drawn as the red module letter (A..D) the KARMA screens put over each module column.
export type Caption = { caption: string; w?: number; badge?: boolean };
// An array stacks its cells vertically in one grid slot (AMS over Intensity, or A over B); an empty array is a spacer.
export type Slot = Cell | Cell[] | GraphSlot | Caption;
// A row with a label and no cells is a heading line. when: draw the row only while the named parameter has one of these values (the AMS Mixer shows the part for its type).
// band: a centred caption on a line above the row, as the Combination screens title each timbre row.
export type LRow = { label?: string; cells: Slot[]; rule?: boolean; when?: Ref & { is: number[] }; band?: string };
export type Side = "left" | "right" | "full";
// cols: grid columns of the section's rows; default is the widest row.
// timbres: the rows are 16 timbre columns (cells name Timbre1..Timbre16); the view draws the numbered timbre strip on top and picks the narrow control style.
// pane: the section belongs to one entry of the vertical button list on the left (the KARMA GE and Name pages); sections without a pane show in every pane. labelW: width in px of the row label column (default 64).
export type Section = { title?: string; side: Side; rowSpan?: number; cols?: number; timbres?: boolean; pane?: string; labelW?: number; rows: LRow[] };
// A tab with no graph block just has a section without a title and one graph slot.
export type TabLayout = { blocks: Section[] };
export type LayoutSpec = Record<string, TabLayout>;

// The pane names of a tab in order of first use; a tab with none has no button list. Only the selected pane's sections are drawn.
export const panesOf = (t: TabLayout): string[] => [...new Set(t.blocks.flatMap((b) => (b.pane ? [b.pane] : [])))];
export const inPane = (t: TabLayout, pane: string | undefined): Section[] => t.blocks.filter((b) => !b.pane || b.pane === pane);

export const shows = (r: LRow, valueOf: (ref: Ref) => number | undefined): boolean => !r.when || r.when.is.includes(valueOf(r.when) ?? NaN);
export const isGraph = (s: Slot): s is GraphSlot => !Array.isArray(s) && "graph" in s;
export const isCaption = (s: Slot): s is Caption => !Array.isArray(s) && "caption" in s;
const slotCells = (s: Slot): Cell[] => (isGraph(s) || isCaption(s) ? [] : Array.isArray(s) ? s : [s]);
export const cellsOf = (t: TabLayout): Cell[] => t.blocks.flatMap((b) => b.rows.flatMap((r) => r.cells.flatMap(slotCells)));
export const graphsOf = (t: TabLayout): GraphSlot[] => t.blocks.flatMap((b) => b.rows.flatMap((r) => r.cells.filter(isGraph)));

// Rows by "group/name", repeats kept in table order. Continuation rows are not parameters.
export function refIndex(rows: Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.continuation) continue;
    const k = `${r.group}/${r.name}`;
    const l = m.get(k);
    if (l) l.push(r);
    else m.set(k, [r]);
  }
  return m;
}

// The one row a ref names: with no index there must be exactly one match.
export function resolve(index: Map<string, Row[]>, ref: Ref): Row | undefined {
  const hits = index.get(`${ref.group}/${ref.name}`) ?? [];
  return ref.index === undefined ? (hits.length === 1 ? hits[0] : undefined) : hits[ref.index];
}

// Rows of a mapped tab that the spec does not place; the view puts them in a final More section so no control is lost.
export function unplacedOf(t: TabLayout, tabRows: Row[], index: Map<string, Row[]>): Row[] {
  const placed = new Set<string>();
  for (const c of cellsOf(t)) {
    const r = resolve(index, c);
    if (r) placed.add(keyOf(r));
  }
  return tabRows.filter((r) => !placed.has(keyOf(r)));
}

export type Placed = { col: 1 | 2; colSpan: 1 | 2; row: number; rowSpan: number };
// Packs blocks in order: left and right fill their own column, full waits for the taller one. Rows and columns are 1-based.
export function placeBlocks(blocks: Pick<Section, "side" | "rowSpan">[]): Placed[] {
  const free = [1, 1];
  return blocks.map((b) => {
    const rowSpan = b.rowSpan ?? 1;
    if (b.side === "full") {
      const row = Math.max(free[0], free[1]);
      free[0] = free[1] = row + rowSpan;
      return { col: 1, colSpan: 2, row, rowSpan };
    }
    const i = b.side === "left" ? 0 : 1;
    const row = free[i];
    free[i] += rowSpan;
    return { col: (i + 1) as 1 | 2, colSpan: 1, row, rowSpan };
  });
}

// Grid columns a slot spans (a stack takes the width of its first cell).
export const slotW = (s: Slot): number => (Array.isArray(s) ? s[0]?.w : s.w) ?? 1;
// Columns of a section's rows: the declared count, else the widest row.
export const colsOf = (b: Section): number => b.cols ?? Math.max(1, ...b.rows.map((r) => r.cells.reduce((n, s) => n + slotW(s), 0)));

// The real screens write 2..3 digit numbers padded to the width of the range (+00, 07, 127), signed where the range is.
export function padNum(text: string, r: { rawMin: number; rawMax: number }): string {
  if (r.rawMax < 99 || !/^[+-]?\d+$/.test(text)) return text;
  const n = Number(text);
  return (r.rawMin < 0 ? (n < 0 ? "-" : "+") : "") + String(Math.abs(n)).padStart(r.rawMax <= 100 ? 2 : String(r.rawMax).length, "0");
}
