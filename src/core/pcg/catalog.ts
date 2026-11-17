// Sound Browser core: one list of every Program and Combi in a .PCG, the filters and sorts over it, and the
// favorites, tags and notes library (kept outside the .PCG). No DOM, no node imports.
import { getEntry, getGlobal, getName, listBanks } from "./library.ts";
import type { PcgFile } from "./pcg.ts";
import { readParam, type ParamTables, type Row } from "../params/params.ts";

export type Engine = "HD-1" | "EXi";
export type Kind = "program" | "combi";

export type Sound = {
  order: number;
  key: string;
  index: number;
  bank: string;
  kind: Kind;
  engine: Engine | null;
  name: string;
  category: number;
};

export type Meta = { favorite?: true; tags?: string[]; note?: string };
export type LibraryData = { version: 1; sounds: Record<string, Meta> };
export type Filter = { kind?: Kind; engine?: Engine; category?: number; favoritesOnly?: boolean; tag?: string; text?: string };

const CATEGORY_COUNT = 18;
const SOUND_KEY = /^[ -~]{1,24}\|(HD-1|EXi|Combi)$/;

const emptyLibrary = (): LibraryData => ({ version: 1, sounds: {} });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function categoryRow(tables: ParamTables, kind: Kind, engine: Engine | null): Row {
  const rows = kind === "combi" ? tables.combi : engine === "HD-1" ? tables.programHd1 : tables.programExiCommon;
  return rows.find((r) => r.name === "Category")!;
}

export function buildCatalog(f: PcgFile, tables: ParamTables): Sound[] {
  const out: Sound[] = [];
  for (const b of listBanks(f)) {
    if (b.kind !== "program" && b.kind !== "combi") continue;
    const kind: Kind = b.kind;
    const engine: Engine | null = kind === "combi" ? null : b.type === "hd1" ? "HD-1" : "EXi";
    const row = categoryRow(tables, kind, engine);
    for (let i = 0; i < b.count; i++) {
      out.push({ order: out.length, key: b.key, index: i, bank: b.label, kind, engine, name: getName(f, b.key, i), category: readParam(getEntry(f, b.key, i), row) });
    }
  }
  return out;
}

// The 24 Name rows of each "Program Category NN" or "Combi Category NN" group in the Global block, read as text.
// Empty where there is no Global block or the name is blank.
export function categoryNames(f: PcgFile, tables: ParamTables, kind: Kind): string[] {
  const names: string[] = Array.from({ length: CATEGORY_COUNT }, () => "");
  const g = getGlobal(f);
  if (!g) return names;
  const prefix = kind === "program" ? "Program Category " : "Combi Category ";
  const groups = new Map<string, Row[]>();
  for (const r of tables.global) {
    if (r.name !== "Name" || !r.group.startsWith(prefix)) continue;
    groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  }
  for (let n = 0; n < CATEGORY_COUNT; n++) {
    const rows = (groups.get(`${prefix}${String(n).padStart(2, "0")}`) ?? []).slice().sort((a, b) => a.ofs - b.ofs);
    const text = rows.map((r) => String.fromCharCode(readParam(g, r))).join("");
    names[n] = text.replace(/\0/g, "").slice(0, 24).trim();
  }
  return names;
}

export function categoryLabel(names: string[], n: number): string {
  return names[n] ? names[n] : String(n);
}

export function soundKey(s: { name: string; engine: Engine | null }): string {
  return `${s.name}|${s.engine ?? "Combi"}`;
}

export function filterSounds(list: Sound[], f: Filter, lib: LibraryData): Sound[] {
  const q = f.text?.trim().toLowerCase() ?? "";
  return list.filter((s) => {
    if (f.kind !== undefined && s.kind !== f.kind) return false;
    if (f.engine !== undefined && s.engine !== f.engine) return false;
    if (f.category !== undefined && s.category !== f.category) return false;
    const m = lib.sounds[soundKey(s)];
    if (f.favoritesOnly && m?.favorite !== true) return false;
    if (f.tag !== undefined && !(m?.tags ?? []).includes(f.tag)) return false;
    if (q && !(s.name.toLowerCase().includes(q) || (m?.note ?? "").toLowerCase().includes(q) || (m?.tags ?? []).some((t) => t.toLowerCase().includes(q)))) return false;
    return true;
  });
}

export function sortSounds(list: Sound[], by: "name" | "bank"): Sound[] {
  return list.slice().sort((a, b) => {
    if (by === "name") {
      const x = a.name.toLowerCase();
      const y = b.name.toLowerCase();
      if (x !== y) return x < y ? -1 : 1;
    }
    return a.order - b.order;
  });
}

function checkLibrary(v: unknown): LibraryData | null {
  if (!isObj(v) || v.version !== 1 || !isObj(v.sounds)) return null;
  const sounds: Record<string, Meta> = {};
  for (const [k, m] of Object.entries(v.sounds)) {
    if (!SOUND_KEY.test(k) || !isObj(m)) return null;
    const meta: Meta = {};
    if (m.favorite !== undefined) {
      if (m.favorite !== true) return null;
      meta.favorite = true;
    }
    if (m.tags !== undefined) {
      const tags = m.tags;
      if (!Array.isArray(tags) || tags.length > 12 || !tags.every((t) => typeof t === "string" && t.length >= 1 && t.length <= 24)) return null;
      meta.tags = [...(tags as string[])];
    }
    if (m.note !== undefined) {
      if (typeof m.note !== "string" || m.note.length > 200) return null;
      meta.note = m.note;
    }
    sounds[k] = meta;
  }
  return { version: 1, sounds };
}

export function parseLibrary(text: string | null): { data: LibraryData; corrupt: boolean } {
  if (text === null) return { data: emptyLibrary(), corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { data: emptyLibrary(), corrupt: true };
  }
  const data = checkLibrary(parsed);
  return data ? { data, corrupt: false } : { data: emptyLibrary(), corrupt: true };
}

// The text written to library.json: validated, and entries with no favorite, tag or note are left out. Throws on bad data.
export function encodeLibrary(input: unknown): string {
  const r = parseLibrary(JSON.stringify(input) ?? "null");
  if (r.corrupt) throw new Error("library data is not valid");
  const sounds: Record<string, Meta> = {};
  for (const [k, m] of Object.entries(r.data.sounds)) if (m.favorite || m.note || m.tags?.length) sounds[k] = m;
  return `${JSON.stringify({ version: 1, sounds }, null, 2)}\n`;
}
