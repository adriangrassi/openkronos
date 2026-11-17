// Finds the Parameter Guide entry for a parameter row, from help.json (generated at build time, private to the owner). Pure: no DOM, no node: imports.
// A wrong description is worse than none, so every step that is not an exact name match must end in one description, or the answer is null.
import type { ParamType, Row } from "../params/params.ts";
import type { HelpData, HelpEntry, HelpMode } from "./helpParse.ts";
import pageMap from "./pages.json" with { type: "json" };
import type { PageMap } from "./view.ts";

export type Help = { text: string; page: number; label: string };
export type HelpModeArg = ParamType | HelpMode;
export type HelpFinder = (mode: HelpModeArg, tabId: string | undefined, row: Pick<Row, "group" | "name">, cellLabel?: string) => Help | null;

const MODES: Record<HelpModeArg, HelpMode> = { hd1: "program", program: "program", exi: "exi", combi: "combi", global: "global", drumkit: "global", waveseq: "global" };
const STOP = new Set(["to", "of", "the", "and", "for"]);

// Case, punctuation, "Filter 1" and "Filter1", "Mod." and "Modulation", and the numbered LFO/oscillator/AMS names (the guide says LFO2 is identical to LFO1) all fold together.
export function norm(s: string, notes = false): string {
  return (notes ? s : s.replace(/\(.*?\)/g, " "))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z]) (\d)\b/g, "$1$2")
    .replace(/\b(lfo|osc|eg|filter|amp|knob|timbre|mixer|mod)\d+\b/g, "$1")
    .replace(/\bmod\b/g, "modulation")
    .replace(/\s+/g, " ")
    .trim();
}
const tokens = (s: string, notes = false): string[] => norm(s, notes).split(" ").filter((w) => w !== "" && !STOP.has(w));
const stripColon = (s: string): string => s.replace(/\s*:\s*$/, "");

// Words that say little alone: for these a "(Drive)" note is a qualifier ("AMS (Drive)" is not the Drive control), not another name.
const GENERIC = new Set(["ams", "intensity", "source", "time", "level", "mode", "type", "x", "y", "a", "b"]);
type Name = { n: string; note: string[] };

// Every spelling of an entry's own name. A note in brackets ("Intensity to A (LFO1)") must also be in the row when only the plain label matched.
function entryNames(label: string): Name[] {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(label);
  // "AMS2 and AMS3" describes both; the screens drop the "Enable" the guide puts before a checkbox
  if (!m) return [...new Set([norm(label), ...label.split(/\s+and\s+|,\s*/).map((x) => norm(x)), norm(label.replace(/^Enable\s+/i, ""))].filter(Boolean))].map((n) => ({ n, note: [] }));
  const note = tokens(m[2]);
  const base = norm(m[1]);
  const out: Name[] = [{ n: base, note }, { n: norm(label, true), note: [] }];
  if (!GENERIC.has(base)) out.push({ n: norm(m[2]), note: [] });
  return out.filter((x) => x.n !== "");
}

// ctx: the heading words to try, each alone and both together (the guide's own headings are not always the screen's)
type Idx = { e: HelpEntry; names: Name[]; ctx: string[][] };

// The tab of each row of pages.json, by "mode|group/name" and "mode|group" (first tab that takes it), for the views that have no tab of their own.
function tabIndex(): Map<string, string> {
  const m = new Map<string, string>();
  const map = pageMap as PageMap;
  const add = (mode: HelpMode, pages: { tabs: { id: string; groups?: string[]; params?: string[] }[] }[]) => {
    for (const p of pages) for (const t of p.tabs) {
      for (const g of t.groups ?? []) if (!m.has(`${mode}|${g}`)) m.set(`${mode}|${g}`, t.id);
      for (const q of t.params ?? []) if (!m.has(`${mode}|${q}`)) m.set(`${mode}|${q}`, t.id);
    }
  };
  add("program", map.program.hd1);
  add("combi", map.combi);
  return m;
}

export function createHelp(data: HelpData): HelpFinder {
  const all: Idx[] = (data.entries ?? []).map((e) => ({ e, names: entryNames(e.label), ctx: [...new Set([tokens(e.sub).join(" "), tokens(e.section).join(" "), tokens(`${e.sub} ${e.section}`).join(" ")])].map((c) => (c === "" ? [] : c.split(" "))) }));
  if (all.length === 0) return () => null;
  const alias = new Map((data.aliases ?? []).map((a) => [`${a.mode}|${a.from}`, a.to]));
  const tabs = tabIndex();
  const memo = new Map<string, Help | null>();

  const one = (c: Idx[]): Help | null => {
    if (c.length === 0 || new Set(c.map((x) => x.e.text)).size !== 1) return null;
    return { text: c[0].e.text, page: c[0].e.page, label: c[0].e.label };
  };

  // How an entry fits a row's name, or null. The entry's own words must all be in the row's name (or be the control's caption). near: words of the row that neither label nor
  // heading explain, plus twice the heading words the row lacks (lower is closer). said: how much of a heading the row spells out, when it spells out all of it (higher is surer).
  function fit(x: Idx, row: string[], cell: string): { near: number; said: number } | null {
    const have = new Set(row);
    let near: number | null = null;
    let said = -1;
    for (const { n, note } of x.names) {
      const l = n.split(" ").filter((w) => !STOP.has(w));
      if (l.length === 0 || !(n === cell || l.every((w) => have.has(w))) || !note.every((w) => have.has(w))) continue;
      for (const ctx of x.ctx) {
        const known = new Set([...l, ...ctx]);
        const missing = ctx.filter((w) => !have.has(w)).length;
        const c = [...have].filter((w) => !known.has(w)).length + 2 * missing;
        if (near === null || c < near) near = c;
        // a heading that ends the row's name counts a little more ("Attack Level", "Attack Time EG Curve")
        const closes = ctx.length > 0 && ctx.every((w, i) => row[row.length - ctx.length + i] === w);
        if (missing === 0 && ctx.length > 0) said = Math.max(said, ctx.length + (closes ? 0.5 : 0));
      }
    }
    return near === null ? null : { near, said };
  }

  // A caption such as "Intensity" or "AMS" sits on many controls; its entry describes one of them, so the row has to spell out the heading too.
  const vague = (x: Idx): boolean => x.names.every((y) => y.note.length === 0 && GENERIC.has(y.n));

  // Candidates in one pool: the exact name first, then the near ones. Different descriptions for the name: the one whose heading the row spells out most, if that is clear, else nothing.
  function find(pool: Idx[], rowName: string, row: string[], cell: string): Help | null {
    const named = pool.filter((x) => x.names.some((y) => y.n === rowName));
    if (named.length > 0 && one(named)) return one(named);
    const exact = named.length > 0 ? named : cell === "" ? [] : pool.filter((x) => x.names.some((y) => y.n === cell));
    const near = (exact.length > 0 ? exact : pool).map((x) => ({ x, f: fit(x, row, cell) })).filter((s): s is { x: Idx; f: { near: number; said: number } } => s.f !== null && s.f.near <= 3 && (!vague(s.x) || s.f.said >= 1.5));
    if (near.length === 0) return null;
    if (one(near.map((s) => s.x))) return one(near.map((s) => s.x));
    const top = Math.max(...near.map((s) => s.f.said));
    return top < 1.5 ? null : one(near.filter((s) => s.f.said === top).map((s) => s.x));
  }

  return (modeArg, tabId, row, cellLabel) => {
    const mode = MODES[modeArg];
    if (!mode) return null;
    const key = `${mode}|${tabId ?? ""}|${row.group}|${row.name}|${cellLabel ?? ""}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const rowName = norm(row.name, true);
    const rt = tokens(row.name, true);
    const cell = norm(stripColon(cellLabel ?? ""));
    const engine = mode === "exi" ? /^EXi\d (\S+):/.exec(row.group)?.[1] : undefined;
    const inMode = all.filter((x) => x.e.mode === mode && (engine === undefined || x.e.engine === undefined || x.e.engine === engine));
    const tab0 = tabId ?? tabs.get(`${mode}|${row.group}/${row.name}`) ?? tabs.get(`${mode}|${row.group}`);
    const tab = tab0 === undefined ? undefined : (alias.get(`${mode}|${tab0}`) ?? tab0);
    let out = tab === undefined ? null : find(inMode.filter((x) => x.e.tab === tab), rowName, rt, cell);
    // no tab to go by at all: the exact name alone, if every entry of that name agrees
    if (out === null && tab === undefined) out = one(inMode.filter((x) => x.names.some((y) => y.n === rowName)));
    memo.set(key, out);
    return out;
  };
}

let current: HelpFinder = () => null;
// The renderer loads help.json once and hands it here; until then (or with an empty file) there is no help.
export function setHelpData(data: HelpData | null | undefined): void {
  current = createHelp(data ?? {});
}
export const helpFor: HelpFinder = (mode, tabId, row, cellLabel) => current(mode, tabId, row, cellLabel);
