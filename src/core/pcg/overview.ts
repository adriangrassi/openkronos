// File Overview: counts and category histograms over a .PCG. Pure, no DOM, no node imports.
import { buildCatalog, type Kind, type Sound } from "./catalog.ts";
import { getName, listBanks } from "./library.ts";
import type { PcgFile } from "./pcg.ts";
import type { ParamTables } from "../params/params.ts";

export type SlotRef = { key: string; index: number };
type PerKind = { program: number; combi: number; drumkit: number; waveseq: number; setlist: number };
export type Overview = {
  banks: PerKind;
  slots: PerKind;
  engines: { hd1: number; exi: number };
  categories: { program: number[]; combi: number[] };
  edited: number;
  empty: number;
  setLists: { index: number; name: string }[];
};

const INIT = /^(init|empty)\b/i;
const zero = (): PerKind => ({ program: 0, combi: 0, drumkit: 0, waveseq: 0, setlist: 0 });

export function buildOverview(f: PcgFile, tables: ParamTables, edited: SlotRef[] = []): Overview {
  const o: Overview = { banks: zero(), slots: zero(), engines: { hd1: 0, exi: 0 }, categories: { program: Array(18).fill(0), combi: Array(18).fill(0) }, edited: 0, empty: 0, setLists: [] };
  for (const b of listBanks(f)) {
    o.banks[b.kind]++;
    o.slots[b.kind] += b.count;
    if (b.kind === "program" && b.type) o.engines[b.type] += b.count;
    if (b.kind === "setlist") {
      for (let i = 0; i < b.count; i++) {
        const name = getName(f, b.key, i);
        if (!INIT.test(name)) o.setLists.push({ index: i, name });
      }
    }
  }
  for (const s of buildCatalog(f, tables)) {
    if (s.category >= 0 && s.category < 18) o.categories[s.kind][s.category]++;
    if (INIT.test(s.name)) o.empty++;
  }
  o.edited = new Set(edited.filter((e) => e.key !== "global" && e.index >= 0).map((e) => `${e.key}\0${e.index}`)).size;
  return o;
}

export function soundsInCategory(f: PcgFile, tables: ParamTables, kind: Kind, category: number): Sound[] {
  if (!Number.isInteger(category) || category < 0 || category > 17) return [];
  return buildCatalog(f, tables).filter((s) => s.kind === kind && s.category === category);
}
