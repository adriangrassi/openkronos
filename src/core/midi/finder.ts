// Ranks MIDI search results for "tell it a song": title match first, then how full the file looks. Pure, no DOM, Node or network imports.
import { analyzeMidi } from "./analysis.ts";
import { parseSmfChannels } from "./smf.ts";

export type Candidate = {
  title: string;
  site: string;
  durationMs: number;
  tempo: number;
  channelsWithNotes: number;
  hasDrums: boolean;
  emptyNamedTracks: number;
  ref: unknown; // whatever the caller needs to load the file again
};

const FILLER = new Set(["the", "midi", "by", "and", "feat", "with"]);
const SITE_NAMES: Record<string, string> = { bitmidi: "BitMidi", midiworld: "MIDIWorld", freemidi: "FreeMidi" };

const words = (s: string): string[] => (s.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !FILLER.has(w));

// Share of the query's words that the title has, 0 to 1.
export function titleShare(query: string, title: string): number {
  const want = [...new Set(words(query))];
  if (want.length === 0) return 0;
  const have = new Set(words(title));
  return want.filter((w) => have.has(w)).length / want.length;
}

function score(query: string, c: Candidate): number {
  const duration = c.durationMs >= 120_000 ? 2 : c.durationMs >= 60_000 ? 1 : 0;
  return 3 * titleShare(query, c.title) + duration + (2 * Math.min(c.channelsWithNotes, 12)) / 12 + (c.hasDrums ? 1 : 0) - 0.25 * c.emptyNamedTracks;
}

// Best first. Never changes the input array; a candidate with no channels with notes is dropped.
export function rankCandidates<T extends Candidate>(query: string, candidates: T[]): T[] {
  const scored = candidates
    .filter((c) => c.channelsWithNotes > 0)
    .map((c) => ({ c, s: score(query, c), t: titleShare(query, c.title) }));
  scored.sort((x, y) => {
    if (x.s !== y.s) return y.s - x.s;
    if (x.t !== y.t) return y.t - x.t;
    if (x.c.durationMs !== y.c.durationMs) return y.c.durationMs - x.c.durationMs;
    if (x.c.title !== y.c.title) return x.c.title < y.c.title ? -1 : 1;
    return x.c.site < y.c.site ? -1 : x.c.site > y.c.site ? 1 : 0;
  });
  return scored.map((x) => x.c);
}

export function describeCandidate(c: Candidate): string {
  const secs = Math.round(c.durationMs / 1000);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const tracks = c.channelsWithNotes === 1 ? "track" : "tracks";
  const short = c.durationMs < 60_000 ? " (short: probably a loop)" : "";
  const drums = c.hasDrums ? "" : " (no drums)";
  return `"${c.title}" (${SITE_NAMES[c.site] ?? c.site}), ${time}, ${Math.round(c.tempo)} bpm, ${c.channelsWithNotes} ${tracks} with notes, drums ${c.hasDrums ? "yes" : "no"}${short}${drums}`;
}

// The facts rankCandidates needs, read from the file's bytes (throws on a file that is not MIDI).
export function candidateFacts(bytes: Uint8Array): Pick<Candidate, "durationMs" | "tempo" | "channelsWithNotes" | "hasDrums" | "emptyNamedTracks"> {
  const a = analyzeMidi(bytes);
  const chans = parseSmfChannels(bytes);
  const sounding = chans.filter((c) => c.notes > 0);
  return {
    durationMs: Math.round(a.durationMs),
    tempo: a.tempoMap[0]?.bpm ?? 120,
    channelsWithNotes: sounding.length,
    hasDrums: sounding.some((c) => c.channel === 9),
    emptyNamedTracks: chans.length - sounding.length,
  };
}
