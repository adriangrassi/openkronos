// Short audition phrases, built as events for the player. Pure: no DOM or Node imports.
import type { PlayEvent } from "./player.ts";

export type PhraseKind = "chord" | "arpeggio" | "bass" | "lead" | "drums";
export const PHRASE_KINDS: readonly PhraseKind[] = ["chord", "arpeggio", "bass", "lead", "drums"];

// [start ms, note, length ms, velocity]
type Step = [number, number, number, number];

const STEPS: Record<PhraseKind, Step[]> = {
  chord: [60, 64, 67, 72].map((n): Step => [0, n, 2000, 90]),
  arpeggio: [60, 64, 67, 72, 67, 64, 60, 64, 67, 72].map((n, i): Step => [i * 220, n, 200, 88]),
  bass: [36, 36, 43, 36, 41, 43, 46, 43].map((n, i): Step => [i * 300, n, 260, 100]),
  lead: [72, 67, 64, 67, 72, 67, 64, 67, 72, 76, 79, 84].map((n, i): Step => [i * 250, n, i === 11 ? 900 : 220, 96]),
  drums: Array.from({ length: 8 }, (_, i) => i).flatMap((i): Step[] => {
    const t = i * 250;
    const hit: Step[] = [[t, 42, 100, 70]];
    if (i % 4 === 0) hit.push([t, 36, 150, 110]);
    if (i % 4 === 2) hit.push([t, 38, 150, 100]);
    if (i === 7) hit.push([t, 49, 400, 100]);
    return hit;
  }),
};

// Variant 1 is a four-bar sample figure per kind (about 8 s at 120 bpm): original, small tables.
const bars = (n: number, f: (b: number) => Step[]): Step[] => Array.from({ length: n }, (_, b) => f(b)).flat();
const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
const MELODY = [[76, 72], [77, 72], [76, 79], [74, 71]];
const ROOTS = [33, 29, 36, 31];
const LEAD: [number, number, number][] = [[0, 69, 2], [2, 72, 2], [4, 76, 3], [7, 74, 1], [8, 72, 2], [10, 69, 2], [12, 67, 4], [16, 69, 2], [18, 72, 2], [20, 79, 3], [23, 76, 1], [24, 74, 2], [26, 72, 2], [28, 76, 4]];
const SAMPLE: Record<PhraseKind, Step[]> = {
  chord: bars(4, (b) => [...CHORDS[b].map((n): Step => [b * 2000, n, 1800, 86]), [b * 2000, MELODY[b][0], 900, 96], [b * 2000 + 1000, MELODY[b][1], 900, 92]]),
  arpeggio: bars(4, (b) => Array.from({ length: 16 }, (_, i): Step => [b * 2000 + i * 125, ROOTS[b] + 24 + [0, 12, 7, 12, 4, 12, 7, 12][i % 8] + (i >= 8 && i % 2 === 0 ? 3 : 0), 110, 84])),
  bass: bars(4, (b) => [0, 0, 12, 0, 7, 0, 10, 7].map((o, i): Step => [b * 2000 + i * 250, ROOTS[b] + o, 200, 100])),
  lead: LEAD.map(([i, n, len]): Step => [i * 250, n, len * 250 - 30, 96]),
  drums: bars(4, (b) => {
    const out: Step[] = [];
    for (let i = 0; i < 8; i++) {
      const t = b * 2000 + i * 250, fill = b === 3 && i >= 5;
      out.push([t, i === 3 ? 46 : 42, 100, i % 2 ? 60 : 76]);
      if (i === 0 || i === 3 || i === 4) out.push([t, 36, 150, 110]);
      if (i === 2 || i === 6 || fill) out.push([t, fill ? 45 + (i - 5) * 2 : 38, 150, 100]);
    }
    if (b === 0) out.push([0, 49, 400, 100]);
    return out;
  }),
};
export const PHRASE_VARIANTS = 2;

export function phrase(kind: PhraseKind, channel: number, variant = 0): PlayEvent[] {
  const out: PlayEvent[] = [];
  for (const [t, n, len, vel] of (variant % PHRASE_VARIANTS === 0 ? STEPS : SAMPLE)[kind]) {
    out.push({ ms: t, data: [0x90 | channel, n, vel] }, { ms: t + len, data: [0x80 | channel, n, 0] });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// Name hints win, then the category. shortcut: plain substring hints, "Bassoon" counts as bass; refine if it matters.
export function autoPhrase(name: string, category?: string): PhraseKind {
  for (const s of [name, category ?? ""]) {
    if (/bass/i.test(s)) return "bass";
    if (/drum|kit|perc/i.test(s)) return "drums";
    if (/lead|solo/i.test(s)) return "lead";
    if (/arp|seq/i.test(s)) return "arpeggio";
  }
  return "chord";
}
