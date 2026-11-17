// Per-track channel volume (levels) for the MIDI player. No DOM or Node imports.

import type { PlayEvent } from "./player.ts";

export const DEFAULT_LEVEL = 100; // General MIDI default channel volume

// Drops the file's own Controller 7 on channels with an owner-set level; returns a new array; the input is untouched.
export function applyLevels(events: PlayEvent[], levels: Record<number, number>): PlayEvent[] {
  return events.filter(({ data }) => !((data[0] & 0xf0) === 0xb0 && data[1] === 7 && (data[0] & 0x0f) in levels));
}

// Controller 7 (channel volume) on channel 0..15. The value is clamped to 0..127 and rounded.
export function levelBytes(channel: number, value: number): Uint8Array {
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new RangeError(`channel ${channel} is out of range`);
  return Uint8Array.of(0xb0 | channel, 7, Math.min(127, Math.max(0, Math.round(value))));
}

// Owner-set levels from a stored map. Only valid non-default entries are kept, so a corrupt store is ignored.
export function parseLevels(raw: string | null): Record<number, number> {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? "null");
  } catch {
    return {};
  }
  const out: Record<number, number> = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [key, value] of Object.entries(data)) {
    const ch = Number(key);
    if (Number.isInteger(ch) && ch >= 0 && ch <= 15 && typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 127 && value !== DEFAULT_LEVEL) out[ch] = value;
  }
  return out;
}
