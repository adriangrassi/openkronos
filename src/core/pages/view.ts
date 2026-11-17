// Turns the page map and a sound's rows into the screens the keyboard view draws. Pure: no DOM, no node: imports.
import { exiEngines, isEditable, paramsFor, type ParamTables, type ParamType, type Row } from "../params/params.ts";

// except: "group/name" rows that a groups entry does not take (they sit on another tab); params still name them.
export type Tab = { id: string; title: string; groups?: string[]; params?: string[]; except?: string[] };
export type Page = { page: string; title: string; tabs: Tab[] };
export type PageMap = { program: { hd1: Page[]; exiCommon: Page[]; engines: Record<string, Page[]> }; combi: Page[] };
export type Screen = { page: string; title: string; engine?: string; slot?: number; tabs: { id: string; title: string; rows: Row[] }[] };

// Rows that a tab may show: editable settings, plus the two named rows whose value names a block.
const named = (r: Row): boolean => r.name === "Effect Type" || r.name === "Algorithm Type";
export const shown = (r: Row): boolean => !r.continuation && (isEditable(r) || named(r));
export const keyOf = (r: Row): string => `${r.ofs}.${r.bitLo ?? 0}`;

type Index = { byGroup: Map<string, Row[]>; byParam: Map<string, Row[]> };

export function indexRows(rows: Row[]): Index {
  const byGroup = new Map<string, Row[]>();
  const byParam = new Map<string, Row[]>();
  const add = (m: Map<string, Row[]>, k: string, r: Row) => {
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  };
  for (const r of rows) {
    add(byGroup, r.group, r);
    add(byParam, `${r.group}/${r.name}`, r);
  }
  return { byGroup, byParam };
}

// Engine pages name groups without the "EXi<n> <engine>: " prefix that paramsFor adds to the rows.
export function build(pages: Page[], index: Index, claimed: Set<string>, prefix: string, extra: { engine?: string; slot?: number }): Screen[] {
  const out: Screen[] = [];
  for (const p of pages) {
    const tabs = p.tabs.map((t) => {
      const seen = new Set<string>();
      const rows: Row[] = [];
      const take = (r: Row) => {
        const k = keyOf(r);
        if (!shown(r) || seen.has(k)) return;
        seen.add(k);
        claimed.add(k);
        rows.push(r);
      };
      const skip = new Set((t.except ?? []).map((q) => prefix + q));
      for (const g of t.groups ?? []) for (const r of index.byGroup.get(prefix + g) ?? []) if (!skip.has(`${r.group}/${r.name}`)) take(r);
      for (const q of t.params ?? []) for (const r of index.byParam.get(prefix + q) ?? []) take(r);
      return { id: t.id, title: t.title, rows };
    }).filter((t) => t.rows.length > 0);
    // A page with no rows (an engine's Play page, or a page whose tables are not in KORG's text) has nothing to draw.
    if (tabs.length === 0) continue;
    out.push({ page: p.page, title: p.title, ...extra, tabs });
  }
  return out;
}

// Keyboard screens for a sound, or null when the keyboard view does not cover this kind of object.
export function screensFor(pages: PageMap, tables: ParamTables, type: ParamType, entry: Uint8Array): Screen[] | null {
  if (type !== "hd1" && type !== "exi" && type !== "combi") return null;
  const rows = paramsFor(tables, type, entry);
  const index = indexRows(rows);
  const claimed = new Set<string>();
  let screens: Screen[];
  if (type === "hd1") screens = build(pages.program.hd1, index, claimed, "", {});
  else if (type === "combi") screens = build(pages.combi, index, claimed, "", {});
  else {
    screens = build(pages.program.exiCommon, index, claimed, "", {});
    exiEngines(tables, entry).forEach((engine, i) => {
      const slot = i + 1;
      const engPages: Page[] | undefined = pages.program.engines[engine];
      if (engPages) screens.push(...build(engPages, index, claimed, `EXi${slot} ${engine}: `, { engine, slot }));
    });
  }
  // Editable settings that no tab shows go on a More tab at the end, so nothing is unreachable.
  const left = rows.filter((r) => isEditable(r) && !claimed.has(keyOf(r)));
  if (left.length > 0) {
    if (screens.length === 0) screens.push({ page: "P0", title: "More", tabs: [] });
    const last = screens[screens.length - 1];
    last.tabs.push({ id: "more", title: "More", rows: left });
  }
  return screens;
}
