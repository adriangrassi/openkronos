// Finds what KORG's Parameter Guide says about a control, for the model to answer from instead of guessing. Pure and deterministic: no DOM, no files.
// The data is src/generated/param-docs.json (tools/gen-param-docs.mjs, from the owner's private guide); the renderer hands it over with setParamDocs. Without it only the engine notes answer.
import { ENGINE_DESC, ENGINE_NOTES } from "./engineNotes.ts";

export type DocEntry = { mode: "program" | "exi" | "combi" | "global"; engine?: string; label: string; sub?: string; section?: string; tabTitle?: string; page: number; text: string };
export type DocData = { entries?: DocEntry[] };
export type DocQuery = { label: string; page?: string; group?: string; engine?: string; kind?: string };
export type DocHit = { excerpt: string; source: string };

export const MAX_EXCERPT = 1500;
const ENGINES = Object.keys(ENGINE_DESC);
// Other names for the same control or engine, already squashed (see squash).
const ALIASES: Record<string, string> = { polylegato: "polylegato", polyphoniclegato: "polylegato", legatooffset: "uselegatooffset", voices: "numberofvoices", unisonvoices: "numberofvoices", unisondetune: "detune" };

let entries: DocEntry[] = [];
let squashed: string[] = [];
export function setParamDocs(data: DocData | null | undefined): void {
  entries = Array.isArray(data?.entries) ? data!.entries! : [];
  squashed = entries.map((e) => squash(e.label));
}
export const hasParamDocs = (): boolean => entries.length > 0;

// Case, spaces, hyphens and brackets folded away: "Poly-Legato", "poly legato" and "POLY LEGATO (Poly mode)" all compare on letters and digits.
const squash = (s: string): string => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "");
const words = (s: string): string[] => s.toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const alias = (s: string): string => ALIASES[s] ?? s;

export function engineIn(text: string): string | undefined {
  const t = text.toLowerCase();
  return ENGINES.find((e) => t.includes(e.toLowerCase()));
}
// "AL-1+EP-1" (a two-engine Program) answers for the first engine that has a note.
const enginesOf = (engine: string | undefined): string[] => (engine ?? "").split(/[+,/]/).map((x) => engineIn(x.trim())).filter((x): x is string => !!x);

function modesFor(kind: string | undefined, engine: string | undefined): DocEntry["mode"][] {
  const k = (kind ?? "").toLowerCase();
  if (k.startsWith("combi")) return ["combi"];
  if (k.startsWith("drum") || k.startsWith("wave") || k === "global") return ["global", "program"];
  const exi = enginesOf(engine).some((e) => e !== "HD-1" && e !== "SGX-1");
  return exi ? ["exi", "program"] : ["program", "exi"];
}

function labelScore(q: string, qWords: string[], e: number): number {
  const s = squashed[e];
  if (s === "" || q === "") return 0;
  if (s === q) return 100;
  if (s.length >= 5 && q.includes(s)) return 50 + Math.min(s.length, 20); // the longer label wins: "Poly Legato" over "Legato"
  if (q.length >= 5 && s.includes(q)) return 55;
  const w = new Set(words(entries[e].label));
  if (w.size === 0 || qWords.length === 0) return 0;
  const common = qWords.filter((x) => w.has(x)).length;
  const j = common / (w.size + qWords.length - common);
  return j >= 0.6 ? 40 * j : 0;
}

function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)].map((m) => m.index + 1).filter((i) => i <= max);
  return ends.length > 0 && ends[ends.length - 1] > max / 3 ? head.slice(0, ends[ends.length - 1]).trim() : `${s.slice(0, max - 3).replace(/\s+\S*$/, "")}...`;
}

export function lookupParamDoc(q: DocQuery): DocHit | null {
  const label = squash(q.label ?? "");
  const want = alias(label);
  const ctx = `${q.group ?? ""} ${q.page ?? ""}`.toLowerCase();
  const engines = enginesOf(q.engine);
  const modes = modesFor(q.kind, q.engine);
  const qWords = words(q.label ?? "");

  let best = -1;
  let score = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const ls = Math.max(labelScore(want, qWords, i), labelScore(label, qWords, i));
    if (ls < 40) continue;
    const m = modes.indexOf(e.mode);
    let s = ls + (m === 0 ? 20 : m === 1 ? 5 : 0);
    if (e.engine && engines.length > 0) s += engines.includes(e.engine) ? 10 : -30;
    const where = [e.sub, e.section, e.tabTitle].filter(Boolean).map((x) => squash(x!));
    if (ctx.trim() && where.some((w) => w !== "" && ctx.replace(/[^a-z0-9]+/g, "").includes(w))) s += 10;
    if (s > score) [best, score] = [i, s]; // strictly greater: the first of equals wins, so the answer never depends on anything but the data order
  }

  const notes = engines.flatMap((e) => (ENGINE_NOTES[e] && ENGINE_NOTES[e].applies.some((a) => [label, want].some((l) => squash(a.label) === l || (squash(a.label).length >= 5 && l.includes(squash(a.label)))) && (!a.group || ctx.includes(a.group))) ? [{ e, n: ENGINE_NOTES[e] }] : []));
  const parts: string[] = [];
  const sources: string[] = [];
  for (const { e, n } of notes) {
    parts.push(`On the ${ENGINE_DESC[e]}: ${n.text}`);
    sources.push(`Parameter Guide p.${n.page}`);
  }
  if (best >= 0) {
    parts.push(entries[best].text);
    sources.push(`Parameter Guide p.${entries[best].page}`);
  }
  if (parts.length === 0) return null;
  return { excerpt: cut(parts.join("\n"), MAX_EXCERPT), source: [...new Set(sources)].join(", ") };
}

// What the engine is and what it leaves out, for a question that names an engine but no control (the tool's "SGX-2 voice assign").
export function engineSummary(engine: string): DocHit | null {
  const e = engineIn(engine);
  if (!e) return null;
  const n = ENGINE_NOTES[e];
  return { excerpt: `${ENGINE_DESC[e]}.${n ? ` ${n.text}` : ""}`, source: n ? `Parameter Guide p.${n.page}` : "KORG Kronos" };
}
