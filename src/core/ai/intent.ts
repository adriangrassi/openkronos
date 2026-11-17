// Tells a Refine request that nudges one sound from one that ADDS to it (layers, splits, KARMA), which needs a Combination. Pure text rules, no model.
export type Intent = { kind: "tweak" | "build-layer"; why: string };

const ROLE = /\b(pads?|strings?|synths?|bass|lead|leads|brass|horns?|choir|vox|vocals?|organ|plucks?|textures?|sub|piano|keys|rhodes|bells?|flute|guitar|drums?|percussion|orchestra|ensemble)\b/i;
const ADD = /\b(add|layer|layers|layered|layering|stack|stacked|double|doubled|another|new sound|on top|over|under|underneath|beneath|alongside|along with|plus|together with)\b|\bwith (a|an|some)\b/i;
// "add more bass", "add a bit of chorus" turn an amount up; they do not add an instrument.
const AMOUNT = /\badd(ing)?\s+(some\s+|a\s+)?(more|extra|less|a bit|a little|bit more)\b/i;
const EXPLICIT = /\b(layer|over|under|on top|another|new sound|split|zone)\b/i;
const SPLIT = /\b(splits?|zones?|(left|right)[- ]hand|velocity[- ]switch(ed|ing)?|cross-?fade|(upper|lower) (half|part|zone|keys|register)|(below|above) [a-g][#b]?-?\d)\b/i;
const KARMA = /\b(karma|arps?|arpeggios?|arpeggiator|patterns?|grooves?|drum track|chord trigger)\b/i;
const START = /\b(add|put|give|set ?up|create|build|want|need|use|with|include|bring|start|run)\b/i;

export function classifyIntent(text: string): Intent {
  const t = text.trim();
  if (SPLIT.test(t)) return { kind: "build-layer", why: "a split or zone needs separate parts" };
  if (KARMA.test(t) && START.test(t)) return { kind: "build-layer", why: "KARMA modules belong to a Combination" };
  if (ROLE.test(t) && ADD.test(t) && !(AMOUNT.test(t) && !EXPLICIT.test(t))) return { kind: "build-layer", why: "adds an instrument to the sound" };
  return { kind: "tweak", why: "changes the open sound" };
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Kronos numbering: C-1 = 0, so middle C is C4 = 60 and G9 = 127.
export const noteName = (n: number): string => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export type OpenSound = { key: string; index: number; name: string; engine: string; bank: string };

// The first message of a Refine that was promoted to a build: the base stays untouched as part 1.
export function promotedPrompt(open: OpenSound, request: string): string {
  return `Open sound: Program ${open.bank} ${String(open.index).padStart(3, "0")} "${open.name}" (${open.key} ${open.index}), engine ${open.engine}. Request: ${request}
This request ADDS to that sound, so build a Combination, not a tweak. The open sound is part 1 exactly as it is: never set_params it, copy over it or rename it. Put each new sound in a free slot (search_sounds, or copy_sound an HD-1 Program and configure the copy), call build_combi early with the open sound first and the new sounds after it (levels, key ranges and velocity ranges that fit the request), then configure each new part, its effects, and any KARMA module with configure_combi. Finish by naming the Combination and its slot, each part's sound, key range and level, and what the owner does next: select the Combination on the keyboard, and nothing is stored until Store.`;
}
