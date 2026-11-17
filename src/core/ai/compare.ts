// Candidates for the A/B model comparison: each run's touched slots are parked as bytes, so the library can show A, B or neither.
import { getEntry, setEntry } from "../pcg/library.ts";
import type { PcgFile } from "../pcg/pcg.ts";
import type { RunStatus } from "./agent.ts";
import type { Slot, TrackSound } from "./session.ts";
import type { Usage } from "./usage.ts";

export type Candidate = {
  id: "A" | "B";
  provider: "cloud" | "claude" | "local";
  model: string;
  seconds: number;
  steps: number;
  usage?: Usage;
  status: RunStatus;
  slots: Slot[];
  bytes: Uint8Array[]; // the slots' bytes after the run, parallel to slots
  items: string[]; // one readable line per slot
  tracks: TrackSound[];
  runId: string;
};

export const parkSlots = (file: PcgFile, slots: Slot[]): Uint8Array[] => slots.map((s) => getEntry(file, s.key, s.index));

export function unionSlots(cs: Candidate[]): Slot[] {
  const seen = new Map<string, Slot>();
  for (const c of cs) for (const s of c.slots) seen.set(`${s.key}/${s.index}`, s);
  return [...seen.values()];
}

// Puts the library's slots back to base, then writes one candidate over them (null leaves base as it was).
export function showCandidate(file: PcgFile, base: PcgFile, all: Slot[], c: Candidate | null): void {
  for (const s of all) setEntry(file, s.key, s.index, getEntry(base, s.key, s.index));
  c?.slots.forEach((s, i) => setEntry(file, s.key, s.index, c.bytes[i]));
}
