// The saved-answer cache: finished AI answers kept on disk so the same question is never paid for twice. Pure: the main process reads and writes the file, this decides
// what the key is, what may be saved, what stays and what goes.

// Bump when the questions or the prompts change in a way that makes old answers wrong; every saved answer then stops matching.
export const CACHE_VERSION = 1;
export const MAX_ENTRIES = 2000;
export const MAX_BYTES = 2_000_000;
export const MAX_ANSWER = 20_000;
// Tools whose results never depend on the sound: an answer that read the sound, or pointed at it, is about that sound and is not saved.
const GENERAL_TOOLS = new Set(["lookup_param_help"]);
export const KEY_PATTERN = /^[0-9a-f]{28}$/;

export type Lang = "en" | "pt";
export type Length = "brief" | "normal" | "detailed";
export type KeyParts = {
  // "explain" for a Shift-click, "ask" for a typed question: the same words in each are not the same question.
  namespace: "explain" | "ask";
  // The question exactly as the model gets it. For explain it already holds the control, its page and group and the guide excerpt, and nothing of the sound or its value.
  question: string;
  // The sound's kind and engine, as in "Program" and "SGX-2": the same control on another engine can mean something else. Never the sound's name.
  kind?: string;
  engine?: string;
  lang: Lang;
  length: Length;
};

// cyrb53: two independent 53-bit hashes side by side, so a collision needs both to match.
function cyrb53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function cacheKey(p: KeyParts): string {
  const text = JSON.stringify([CACHE_VERSION, p.namespace, p.kind ?? "", p.engine ?? "", p.lang, p.length, p.question.replace(/\s+/g, " ").trim()]);
  return (cyrb53(text, 0) + cyrb53(text, 0x9e3779b1)).slice(0, 28);
}

const HEDGES = [
  /\b(?:i'?m|i am|i'?m really|i am really)\s+(?:not\s+(?:entirely\s+|completely\s+|totally\s+)?sure|unsure|uncertain)/i,
  /\bunsure\b/i,
  /\bnot\s+(?:entirely\s+|completely\s+|totally\s+|100%\s+)?(?:sure|certain)\b/i,
  /\b(?:i\s+(?:do\s*not|don'?t)\s+know|i\s+can'?t\s+(?:say|tell|confirm))\b/i,
  /\b(?:i\s+)?(?:couldn'?t|could not|cannot|can'?t)\s+(?:find|verify)\b/i,
  /n[aã]o\s+(?:tenho|estou)\s+(?:certeza|seguro|segura|certo|certa)|n[aã]o\s+sei\b|incerto|incerta/i,
  /no\s+tengo\s+(?:certeza|seguridad)|no\s+estoy\s+seguro|no\s+lo\s+s[eé]\b/i,
];
// An answer that admits it is guessing is not kept, so the next ask can do better.
export const isHedged = (text: string): boolean => HEDGES.some((r) => r.test(text));

export type RunFacts = {
  status: string;
  text: string;
  // True when the text is the app's own offline help instead of a model answer.
  fallback?: boolean;
  // The open sound's name: an answer that repeats it is about that sound, not about the control.
  soundName?: string;
  tools: string[];
};

export function shouldCache(r: RunFacts): boolean {
  const t = r.text.trim();
  if (r.status !== "done" || r.fallback || t.length < 20 || t.length > MAX_ANSWER || isHedged(t)) return false;
  if (r.tools.some((n) => !GENERAL_TOOLS.has(n))) return false;
  const name = (r.soundName ?? "").trim().toLowerCase();
  return !(name.length >= 3 && t.toLowerCase().includes(name));
}

export type Entry = { k: string; t: string; u: number };
export type Store = { clock: number; entries: Entry[] };

export const emptyStore = (): Store => ({ clock: 0, entries: [] });

const bytes = (s: string): number => new TextEncoder().encode(s).length;

// A damaged or older-version file reads as empty; one bad entry is dropped on its own.
export function parseStore(text: string | null | undefined): Store {
  if (!text) return emptyStore();
  try {
    const j = JSON.parse(text) as { v?: unknown; clock?: unknown; entries?: unknown };
    if (!j || j.v !== CACHE_VERSION || !Array.isArray(j.entries)) return emptyStore();
    const seen = new Set<string>();
    const entries = (j.entries as Entry[]).filter((e) => !!e && typeof e.k === "string" && KEY_PATTERN.test(e.k) && typeof e.t === "string" && e.t.trim() !== "" && e.t.length <= MAX_ANSWER && Number.isFinite(e.u) && !seen.has(e.k) && !!seen.add(e.k));
    const clock = Math.max(typeof j.clock === "number" && Number.isFinite(j.clock) ? j.clock : 0, ...entries.map((e) => e.u));
    return enforce({ clock, entries });
  } catch {
    return emptyStore();
  }
}

// Least recently used goes first, until the entry count and the file size are inside the caps.
export function enforce(s: Store): Store {
  const byUse = [...s.entries].sort((a, b) => b.u - a.u);
  const keep: Entry[] = [];
  let size = 64;
  for (const e of byUse) {
    const n = bytes(JSON.stringify(e)) + 1;
    if (keep.length >= MAX_ENTRIES || size + n > MAX_BYTES) break;
    keep.push(e);
    size += n;
  }
  s.entries = keep;
  return s;
}

export const serialize = (s: Store): string => JSON.stringify({ v: CACHE_VERSION, clock: s.clock, entries: enforce(s).entries });

// A hit counts as a use. The new order reaches the disk with the next save, not on every hit.
export function getAnswer(s: Store, key: string): string | null {
  const e = s.entries.find((x) => x.k === key);
  if (!e) return null;
  e.u = ++s.clock;
  return e.t;
}

export function putAnswer(s: Store, key: string, text: string): Store {
  const t = text.trim();
  if (!KEY_PATTERN.test(key) || t === "" || t.length > MAX_ANSWER || isHedged(t)) return s;
  const e = s.entries.find((x) => x.k === key);
  if (e) [e.t, e.u] = [t, ++s.clock];
  else s.entries.push({ k: key, t, u: ++s.clock });
  return enforce(s);
}

export const stats = (s: Store): { count: number; bytes: number } => ({ count: s.entries.length, bytes: bytes(serialize(s)) });
