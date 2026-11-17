// Turns an AI answer (markdown plus the odd tool-trace line) into short plain-text chunks for a speech server. Pure: no Node or DOM imports.
export type SpeechLang = "en" | "pt";

export const MAX_CHUNK = 300;
export const MAX_TOTAL = 2500;
const PT_WORDS = new Set("de que o a e para com não uma é do da os em no na".split(" "));
const EN_WORDS = new Set("the and of to is it you for".split(" "));
// Counts stopwords: fewer than 3 hits, or no 2:1 majority, is "unknown" and counts as fine for both languages.
export function detectLang(text: string): SpeechLang | "unknown" {
  let p = 0, e = 0;
  for (const w of text.toLowerCase().match(/\p{L}+/gu) ?? []) { if (PT_WORDS.has(w)) p++; if (EN_WORDS.has(w)) e++; }
  return p + e < 3 ? "unknown" : e >= 2 * p ? "en" : p >= 2 * e ? "pt" : "unknown";
}
export const looksPortuguese = (text: string): boolean => detectLang(text) !== "en";
export const looksEnglish = (text: string): boolean => detectLang(text) !== "pt";
export const TRANSLATE_SYSTEM: Record<SpeechLang, string> = {
  pt: "Translate to Brazilian Portuguese; keep parameter names, bank names, numbers and note names exactly; output only the translation",
  en: "Translate to English; keep parameter names, bank names, numbers and note names exactly; output only the translation",
};
const REST: Record<SpeechLang, string> = { en: "The rest is on screen.", pt: "O resto está na tela." };
const BANK: Record<SpeechLang, { INT: string; U: string; sharp: string; flat: string }> = {
  en: { INT: "Internal", U: "User", sharp: "sharp", flat: "flat" },
  pt: { INT: "Interno", U: "Usuário", sharp: "sustenido", flat: "bemol" },
};

// A tool step the panel logs ("Read "Piano" INT-A 000", "list_effect_types: ok", "search_sounds refused: ...") is not part of an answer.
const TRACE = /^\s*(?:Read\s+["“]|Searched\b.*\bfound\s*$|[a-z]+(?:_[a-z]+)+(?:\s+refused)?\s*:\s*(?:ok|unreadable result|.*)?$|Model:\s*$)/;

// Short and readable beats exact: "INT-A 000" is spoken "Internal A 0", "U-AA 078" "User A A 78", "C4" "C 4", "F#3" "F sharp 3".
export function speakIds(text: string, lang: SpeechLang): string {
  const w = BANK[lang];
  return text
    .replace(/\b(INT|U)-([A-G]{1,2})(?:\s+(\d{1,3}))?\b/g, (_m, b: "INT" | "U", l: string, n?: string) => `${w[b]} ${l.split("").join(" ")}${n === undefined ? "" : ` ${Number(n)}`}`)
    .replace(/\b([A-G])([#♯b♭]?)(-?\d)\b/g, (_m, n: string, acc: string, o: string) => `${n}${acc === "#" || acc === "♯" ? ` ${w.sharp}` : acc ? ` ${w.flat}` : ""} ${o}`);
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .split("\n")
    .filter((l) => !TRACE.test(l))
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+•]\s+|\d+[.)]\s+)/, "").replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/, "").replace(/\|/g, ", ").trim())
    .map((l) => l.replace(/(\*\*|__|\*|_|~~|`)/g, "").replace(/\s{2,}/g, " ").trim())
    .filter((l) => l !== "")
    // A line with no end mark (a list item, a heading) is its own sentence.
    .map((l) => (/[.!?…:;]$/.test(l) ? l : `${l}.`))
    .join("\n");
}

function sentences(text: string): string[] {
  return text.split("\n").flatMap((line) => line.split(/(?<=[.!?…])\s+/)).map((s) => s.trim()).filter(Boolean);
}

// Cuts one over-long sentence at commas, then at spaces, so a chunk never exceeds the limit.
function cut(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    let at = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "));
    if (at < max / 3) at = head.lastIndexOf(" ");
    if (at <= 0) at = max;
    out.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// A model that slips and opens with the open sound's name ('For "Berlin Dark Grand," ...') or its bank slot must not have it read out. Start of the text only.
export function dropSoundOpener(text: string, soundName = ""): string {
  const slot = String.raw`(?:INT|U)-[A-G]{1,2}(?:\s+\d{1,3})?`;
  let t = text.replace(new RegExp(String.raw`^\s*${slot}\s*[,:;.—–-]?\s*`), "");
  const name = soundName.trim();
  if (name) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, String.raw`\s+`);
    const m = new RegExp(String.raw`^\s*(?<p>(?:for|in|on|about|with|para|em|no|na|sobre|com)\s+(?:(?:the|o|a)\s+)?)?(?<q>["“‘'])?${n}(?<y>[,:;]?)["”’']?(?:\s*\(${slot}\))?\s*(?<x>[,:;—–-])?\s*`, "iu").exec(t);
    if (m?.groups && (m.groups.q || (m.groups.p && (m.groups.x || m.groups.y)))) t = t.slice(m[0].length);
  }
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// max is the longest chunk: a speech server takes 300, the computer's own voices get shorter pieces because Chromium cuts a long utterance short on some platforms.
export function toSpeech(markdown: string, lang: SpeechLang, soundName = "", max = MAX_CHUNK): string[] {
  const text = speakIds(dropSoundOpener(stripMarkdown(markdown), soundName), lang).replace(/[ \t]+/g, " ");
  const parts = sentences(text).flatMap((s) => (s.length > max ? cut(s, max) : [s]));
  if (parts.length === 0) return [];
  const chunks: string[] = [];
  let total = 0;
  let capped = false;
  for (const p of parts) {
    if (total + p.length > MAX_TOTAL) { capped = true; break; }
    total += p.length + 1;
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last].length + 1 + p.length <= max) chunks[last] += ` ${p}`;
    else chunks.push(p);
  }
  if (capped) chunks.push(REST[lang]);
  return chunks;
}
