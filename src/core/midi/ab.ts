// A/B compare: which phrase to play for a sound, the same for both states. Pure: no DOM or Node imports.
import { phrase, PHRASE_KINDS, PHRASE_VARIANTS, type PhraseKind } from "./phrases.ts";
import type { PlayEvent } from "./player.ts";

export type AbChoice = "auto" | PhraseKind;
export const AB_CHOICES: readonly AbChoice[] = ["auto", ...PHRASE_KINDS];
export type AbPlan = { kind: PhraseKind; variant: number; events: PlayEvent[]; length: number; tempo: number };

// Checked in this order on the name, then the category. shortcut: plain substring hints; refine if a real sound lands wrong.
const HINTS: [PhraseKind, RegExp][] = [
  ["bass", /bass(?!oon)/i],
  ["drums", /drum|kit|perc/i],
  ["lead", /lead|solo|brass|horn|trumpet|trombone|sax|flute|reed|oboe|clarinet|whistle/i],
  ["arpeggio", /arp|seq|pluck|guitar|harp|bell|mallet|vibe|marimba|xylo|kalimba/i],
  ["chord", /pad|string|organ|piano|grand|\bep\b|keys|choir|vocal|clav/i],
];
const PIANO = /piano|grand|\bep\b|rhodes|wurli|clav|keyboard/i;

export const nextVariant = (v: number): number => (v + 1) % PHRASE_VARIANTS;

export function abPlan(o: { name: string; category?: string; engine?: string | null; kind?: AbChoice; variant?: number; channel?: number }): AbPlan {
  let kind: PhraseKind | undefined = o.kind && o.kind !== "auto" ? o.kind : undefined;
  for (const s of [o.name, o.category ?? ""]) kind ??= HINTS.find(([, re]) => re.test(s))?.[0];
  kind ??= o.engine === "STR-1" ? "arpeggio" : "chord";
  // A piano gets the chord with a short melody on top unless the caller asked for a specific variant.
  const variant = (o.variant ?? (kind === "chord" && (PIANO.test(o.name) || PIANO.test(o.category ?? "")) ? 1 : 0)) % PHRASE_VARIANTS;
  const events = phrase(kind, o.channel ?? 0, variant);
  return { kind, variant, events, length: events.at(-1)?.ms ?? 0, tempo: 1 };
}
