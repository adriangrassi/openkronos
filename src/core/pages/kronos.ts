// The keyboard's pages and numbered tabs for a sound, as row keys. Pure: no DOM.
import { isEditable, type Row } from "../params/params.ts";
import pageMap from "./pages.json" with { type: "json" };
import { build, indexRows, keyOf, type Page, type PageMap } from "./view.ts";

export type KTab = { id: string; title: string; keys: string[] };
export type KPage = { key: string; page: string; title: string; engine?: string; slot?: number; tabs: KTab[] };
export type KronosPages = { pages: KPage[]; unmapped: string[] };

// engines: the EXi engine names per slot (slot 1 first); only used for kind "exi".
export function kronosPages(kind: "hd1" | "exi" | "combi", rows: Row[], engines: string[] = []): KronosPages {
  const map = pageMap as PageMap;
  const index = indexRows(rows);
  const claimed = new Set<string>();
  const screens = build(kind === "combi" ? map.combi : kind === "hd1" ? map.program.hd1 : map.program.exiCommon, index, claimed, "", {});
  if (kind === "exi") {
    engines.forEach((engine, i) => {
      const pages: Page[] | undefined = map.program.engines[engine];
      if (pages) screens.push(...build(pages, index, claimed, `EXi${i + 1} ${engine}: `, { engine, slot: i + 1 }));
    });
  }
  const pages = screens.map((s) => ({
    key: `${s.slot ?? 0}-${s.page}`, page: s.page, title: s.title, engine: s.engine, slot: s.slot,
    tabs: s.tabs.map((t) => ({ id: t.id, title: t.title, keys: t.rows.map(keyOf) })),
  }));
  return { pages, unmapped: rows.filter((r) => isEditable(r) && !r.continuation && !claimed.has(keyOf(r))).map(keyOf) };
}

export function locateRow(pages: KPage[], rowKey: string): { page: string; tab: string } | null {
  for (const p of pages) for (const t of p.tabs) if (t.keys.includes(rowKey)) return { page: p.key, tab: t.id };
  return null;
}

// Pages plus a final Other page for rows no tab maps, so nothing is hidden.
export function withOther({ pages, unmapped }: KronosPages): KPage[] {
  return unmapped.length === 0 ? pages : [...pages, { key: "other", page: "", title: "Other", tabs: [{ id: "other", title: "Other", keys: unmapped }] }];
}

export type Spot = { page: string; tab: string };
const isAudioTab = (t: KTab): boolean => t.title.startsWith("Audio Input");

// HD-1 Programs get a virtual Main tab (id 0-1, no keys) first on the Play page: the one-screen dashboard. Other kinds are unchanged.
export function withPlay(pages: KPage[], kind: "hd1" | "exi" | "combi"): KPage[] {
  if (kind !== "hd1") return pages;
  const main: KTab = { id: "0-1", title: "Main", keys: [] };
  const p0 = pages.find((p) => p.page === "P0");
  if (!p0) return [{ key: "0-P0", page: "P0", title: "Play", tabs: [main] }, ...pages];
  return pages.map((p) => (p === p0 ? { ...p, tabs: [main, ...p.tabs] } : p));
}

// Where a Kronos view opens: the remembered spot if it still exists, else the first useful tab (never the Audio Input block).
export function defaultSpot(pages: KPage[], kind: "hd1" | "exi" | "combi", remembered?: Spot | null): Spot | null {
  if (remembered && pages.some((p) => p.key === remembered.page && p.tabs.some((t) => t.id === remembered.tab))) return remembered;
  const page = (kind === "exi" ? pages.find((p) => p.title.startsWith("Basic/Vector")) : undefined) ?? pages.find((p) => p.tabs.some((t) => !isAudioTab(t))) ?? pages[0];
  const tab = page?.tabs.find((t) => !isAudioTab(t)) ?? page?.tabs[0];
  return page && tab ? { page: page.key, tab: tab.id } : null;
}
