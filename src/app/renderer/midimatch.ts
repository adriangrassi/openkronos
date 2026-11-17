// Renderer helpers for matching MIDI files to sounds: the sound index for the open file, and the label every match shows.
import { buildIndex, type Match, type SoundIndex, type SoundRef } from "../../core/midi/match.ts";
import type { Workspace } from "./document.ts";

// Every Program and Combi name in the open file. App rebuilds it when the file or any edit changes.
// shortcut: rebuilt on every edit (about 4,000 names, a few ms), upgrade to per-name tracking if that ever shows
export function midiSoundIndex(w: Workspace): SoundIndex {
  const refs: SoundRef[] = [];
  for (const b of w.banks()) {
    if (b.kind !== "program" && b.kind !== "combi") continue;
    for (let i = 0; i < b.count; i++) refs.push({ key: b.key, index: i, name: w.nameOf(b.key, i), kind: b.kind });
  }
  return buildIndex(refs);
}

// "U-AA 078 Jump": the same text the Match buttons and the song line show.
export function soundLabel(m: Pick<Match, "key" | "index" | "name">): string {
  return `${m.key.slice(m.key.indexOf(":") + 1)} ${String(m.index).padStart(3, "0")} ${m.name}`;
}
