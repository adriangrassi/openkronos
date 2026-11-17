// How close one sound is to another, from the same settings the editor shows. 100 = identical settings.
// No Node or DOM imports.
import { exiEngines, isEditable, paramsFor, readParam, type ParamTables, type Row } from "../params/params.ts";

export type SoundType = "exi" | "hd1" | "combi";
export type Family = "engine" | "oscillators" | "filter" | "envelopes" | "lfo" | "effects" | "other";
export type Score = { total: number; parts: Record<Family, number | null> };

const FAMILIES: Family[] = ["engine", "oscillators", "filter", "envelopes", "lfo", "effects", "other"];
// Part weights in the total. A part absent from both sounds (null) is left out of the average.
const WEIGHT: Record<Family, number> = { engine: 30, oscillators: 20, filter: 15, envelopes: 20, lfo: 5, effects: 5, other: 5 };
// A different engine caps the total, so it reads as clearly different overall.
const DIFFERENT_ENGINE_CAP = 50;

// Each setting is grouped by its engine block name, not by EXi slot, so the same engine in another slot still lines up.
function familyOf(r: Row): Family {
  if (r.name === "Algorithm Type") return "engine";
  const g = r.group.replace(/^EXi\d [^:]*: /, "");
  if (/Effect|Master|Total/.test(g)) return "effects";
  if (/LFO/.test(g)) return "lfo";
  if (/EG|Envelope/.test(g)) return "envelopes";
  if (/Filter/.test(g)) return "filter";
  if (/OSC|Pitch|Sub|Ring|Noise/.test(g)) return "oscillators";
  return "other";
}

type Settings = { engines: string[] | null; families: Map<Family, Map<string, number>> };

// Values are scaled to 0..1 over each setting's raw range, so settings with different ranges weigh the same.
function settingsOf(tables: ParamTables, type: SoundType, entry: Uint8Array): Settings {
  const rows = paramsFor(tables, type === "combi" ? "combi" : type === "hd1" ? "hd1" : "exi", entry).filter(isEditable);
  const families = new Map<Family, Map<string, number>>();
  for (const r of rows) {
    const f = familyOf(r);
    const span = r.rawMax - r.rawMin;
    const v = span === 0 ? 0 : (readParam(entry, r) - r.rawMin) / span;
    const key = `${r.group.replace(/^EXi\d [^:]*: /, "")}|${r.name}`;
    if (!families.has(f)) families.set(f, new Map());
    families.get(f)!.set(key, v);
  }
  const engines = type === "combi" ? null : type === "hd1" ? ["HD-1"] : exiEngines(tables, entry).filter((n) => n !== "Off");
  return { engines, families };
}

// Share of settings the two sounds have in common, each counted by how close its value is (1 = same, 0 = far or missing).
function partScore(a: Map<string, number> | undefined, b: Map<string, number> | undefined): number | null {
  const keys = new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])]);
  if (keys.size === 0) return null;
  let sum = 0;
  for (const k of keys) {
    const x = a?.get(k);
    const y = b?.get(k);
    if (x !== undefined && y !== undefined) sum += 1 - Math.abs(x - y);
  }
  return (sum / keys.size) * 100;
}

function engineScore(a: string[] | null, b: string[] | null): number | null {
  if (a === null || b === null) return null;
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 100;
  const both = a.filter((n) => b.includes(n)).length;
  return (both / union.size) * 100;
}

export function scoreSound(tables: ParamTables, refType: SoundType, ref: Uint8Array, candType: SoundType, cand: Uint8Array): Score {
  const A = settingsOf(tables, refType, ref);
  const B = settingsOf(tables, candType, cand);
  const parts = { engine: engineScore(A.engines, B.engines) } as Record<Family, number | null>;
  for (const f of FAMILIES) if (f !== "engine") parts[f] = partScore(A.families.get(f), B.families.get(f));
  let num = 0;
  let den = 0;
  for (const f of FAMILIES) {
    const p = parts[f];
    if (p === null) continue;
    num += WEIGHT[f] * p;
    den += WEIGHT[f];
  }
  let total = den === 0 ? 0 : num / den;
  if (parts.engine !== null && parts.engine < 100) total = Math.min(total, DIFFERENT_ENGINE_CAP);
  // Identical only when every part is exact. Any difference stays below 100, even when it rounds to it.
  const exact = FAMILIES.every((f) => parts[f] === null || parts[f] === 100);
  total = exact ? 100 : Math.min(99.99, Math.round(total * 100) / 100);
  return { total, parts };
}
