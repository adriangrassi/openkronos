// Assigns Programs to a file's channels by name: each track gets the Program whose name, minus the filter word, shares the most words with its instrument and track name. Pure: no DOM or Node imports.

import { gmInstrument, type SoundIndex } from "./match.ts";
import type { SmfChannelFacts } from "./smf.ts";

export interface NamePick { channel: number; key: string; index: number; name: string }
export interface NameAssign { picks: NamePick[]; unmatched: number[] }

const FILLER = new Set(["gm", "midi", "program", "the", "of"]);
const DRUM_CHANNEL = 9; // channel 10 on the owner's 1-based list
const DRUM_NAME = /\b(drum|kit)/;

// Lower-case words, filler dropped.
function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z]+/).filter((t) => t && !FILLER.has(t));
}

// Equal words, or one a prefix of the other (clav/clavinet). Short prefixes are too loose, so three letters minimum.
function same(a: string, b: string): boolean {
  return a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

interface Cand { key: string; index: number; name: string; lower: string; toks: string[] }

function channelTokens(c: SmfChannelFacts): string[] {
  const gm = c.channel === DRUM_CHANNEL || c.program === null ? [] : tokens(gmInstrument(c.program).name);
  return [...gm, ...tokens(c.trackName ?? "")];
}

// Share of the candidate's words the channel also has. Drum channels take any Program named Drum or Kit first.
function scoreOf(c: SmfChannelFacts, kt: string[], cand: Cand): number {
  if (c.channel === DRUM_CHANNEL && DRUM_NAME.test(cand.lower)) return 1;
  if (cand.toks.length === 0) return 0;
  const shared = cand.toks.filter((t) => kt.some((k) => same(t, k))).length;
  return shared / cand.toks.length;
}

const SUGGEST_STOP = new Set(["midi", "mid", "the", "and", "feat", "version", "remix", "karaoke", "full", "song"]);
const SUGGEST_MIN = 3; // user Programs that must carry the word
const SUGGEST_MAX = 40; // more than this is a generic word, not the owner's set

// The file-name word that names the most user-bank Programs (3 to 40 of them), or null.
export function suggestWord(fileName: string, sounds: SoundIndex["entries"]): { word: string; count: number } | null {
  const words = new Set(fileName.replace(/\.[^.]*$/, "").toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 4 && !SUGGEST_STOP.has(t)));
  const names = sounds
    .filter(({ ref }) => ref.kind === "program" && ref.key.startsWith("program:U-") && !ref.name.startsWith("Init"))
    .map(({ ref }) => new Set(ref.name.toLowerCase().split(/[^a-z]+/)));
  let best: { word: string; count: number } | null = null;
  for (const word of words) {
    const count = names.filter((toks) => toks.has(word)).length;
    if (count < SUGGEST_MIN || count > SUGGEST_MAX) continue;
    const beats = !best || count > best.count || (count === best.count && (word.length > best.word.length || (word.length === best.word.length && word < best.word)));
    if (beats) best = { word, count };
  }
  return best;
}

export function assignByName(channels: SmfChannelFacts[], sounds: SoundIndex["entries"], word: string): NameAssign {
  const w = word.trim().toLowerCase();
  const live = channels.filter((c) => c.notes > 0);
  if (!w) return { picks: [], unmatched: live.map((c) => c.channel).sort((a, b) => a - b) };
  const filter = new Set(tokens(w));
  const cands: Cand[] = [];
  for (const e of sounds) {
    const { ref } = e;
    if (ref.kind !== "program" || !ref.name.toLowerCase().includes(w)) continue;
    cands.push({ key: ref.key, index: ref.index, name: ref.name, lower: ref.name.toLowerCase(), toks: tokens(ref.name).filter((t) => !filter.has(t)) });
  }

  const pairs: { score: number; channel: number; slot: number; cand: Cand }[] = [];
  for (const c of live) {
    const kt = channelTokens(c);
    for (const cand of cands) {
      const score = scoreOf(c, kt, cand);
      if (score > 0) pairs.push({ score, channel: c.channel, slot: cand.index, cand });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.channel - b.channel || a.slot - b.slot);

  const usedCh = new Set<number>();
  const usedCand = new Set<Cand>();
  const picks: NamePick[] = [];
  for (const p of pairs) {
    if (usedCh.has(p.channel) || usedCand.has(p.cand)) continue;
    usedCh.add(p.channel);
    usedCand.add(p.cand);
    picks.push({ channel: p.channel, key: p.cand.key, index: p.cand.index, name: p.cand.name });
  }
  picks.sort((a, b) => a.channel - b.channel);
  const unmatched = live.map((c) => c.channel).filter((ch) => !usedCh.has(ch)).sort((a, b) => a - b);
  return { picks, unmatched };
}
