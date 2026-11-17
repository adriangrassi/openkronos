// Groups a tab's rows into panels: one per row group, or a compact table when three or more groups repeat the same settings. Pure: no DOM.
import type { Row } from "../params/params.ts";

export type RowsPanel = { kind: "rows"; title: string; rows: Row[] };
export type TablePanel = { kind: "table"; title: string; cols: string[]; lines: { label: string; rows: Row[] }[] };
export type PanelSpec = RowsPanel | TablePanel;

const MIN_LINES = 3;
const MIN_COLS = 3;

export function panelsOf(rows: Row[]): PanelSpec[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = groups.get(r.group);
    if (g) g.push(r);
    else groups.set(r.group, [r]);
  }
  const sig = (rs: Row[]): string => rs.map((r) => r.name).join("\u0000");
  const count = new Map<string, number>();
  for (const rs of groups.values()) count.set(sig(rs), (count.get(sig(rs)) ?? 0) + 1);
  const out: PanelSpec[] = [];
  const tables = new Map<string, TablePanel>();
  for (const [title, rs] of groups) {
    const s = sig(rs);
    if (rs.length >= MIN_COLS && (count.get(s) ?? 0) >= MIN_LINES) {
      let t = tables.get(s);
      if (!t) {
        t = { kind: "table", title: title.replace(/\s*\d+$/, ""), cols: rs.map((r) => r.name), lines: [] };
        tables.set(s, t);
        out.push(t);
      }
      t.lines.push({ label: title, rows: rs });
    } else out.push({ kind: "rows", title, rows: rs });
  }
  return out;
}
