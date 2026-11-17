// What the loaded MIDI file says, as text for the model, and the picks its Combi implies for the file's tracks. Pure: no DOM or Node imports.
import type { SmfChannelFacts } from "../midi/smf.ts";
import { gmInstrument } from "../midi/match.ts";
import type { TrackSound } from "./session.ts";

// The facts the MIDI panel already holds for a loaded file. Only the fields used here.
export type SongFacts = {
  name: string;
  analysis: { tempoMap: { bpm: number }[]; timeSignature: { num: number; den: number }; key: { name: string } | null };
  facts: SmfChannelFacts[];
};
export type SongPick = { channel: number; key: string; index: number }; // channel 0..15, as in the file's facts

const MAX_CHANNELS = 16;
const MAX_NAME = 24;
const HEADER = "Loaded song (ground truth, trust it over your memory of the song):";

export function describeSong(file: SongFacts | null): string {
  if (!file) return "";
  const { analysis: a } = file;
  const bpm = `${Math.round(a.tempoMap[0]?.bpm ?? 120)} bpm${a.tempoMap.length > 1 ? " (tempo changes)" : ""}`;
  const key = a.key ? `, key ${a.key.name}` : "";
  const head = `Loaded MIDI file: "${file.name.trim()}", ${bpm}, ${a.timeSignature.num}/${a.timeSignature.den}${key}.`;
  const lines = file.facts.slice(0, MAX_CHANNELS).map((c) => {
    const name = c.trackName ? ` "${c.trackName.slice(0, MAX_NAME)}"` : "";
    const gm = c.program !== null && c.channel !== 9 ? ` GM ${gmInstrument(c.program).name}` : "";
    const notes = c.notes > 0 ? `${c.notes} notes` : "EMPTY (0 notes)";
    return `ch ${c.channel + 1}${name}${gm}, ${notes}`;
  });
  const more = file.facts.length > MAX_CHANNELS ? `; and ${file.facts.length - MAX_CHANNELS} more` : "";
  const tracks = lines.length > 0 ? `Tracks: ${lines.join("; ")}${more}.` : "Tracks: none.";
  return `${head}\n${tracks}\nChannel numbers are 1 to 16; trackSounds use these numbers.`;
}

// The first user message of a request: the owner's sentence, after the song block when a file is loaded.
export function openingMessage(prompt: string, file: SongFacts | null): string {
  const block = describeSong(file);
  return block ? `${HEADER}\n${block}\n\n${prompt}` : prompt;
}

// A trackSound names the Program for a song track (1-based); it becomes that track's sound when the file has the channel.
export function picksFromTracks(tracks: TrackSound[], file: SongFacts | null): SongPick[] {
  if (!file) return [];
  const channels = new Set(file.facts.map((c) => c.channel));
  return tracks.flatMap((t) => (channels.has(t.track - 1) ? [{ channel: t.track - 1, key: t.key, index: t.index }] : []));
}
