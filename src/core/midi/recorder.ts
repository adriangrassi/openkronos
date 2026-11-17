// Collects played MIDI events for a take. No DOM or Node imports.

export const MAX_RECORD_EVENTS = 500000;

// Channel voice messages only: not clock, Active Sensing, sysex or other system messages.
export function isRecordable(data: readonly number[]): boolean {
  const s = data[0];
  if (!(s >= 0x80 && s <= 0xef)) return false;
  const need = s >= 0xc0 && s < 0xe0 ? 2 : 3;
  return data.length === need && data.slice(1).every((b) => b >= 0 && b < 128);
}

export class MidiRecorder {
  readonly events: { ms: number; data: number[] }[] = [];
  noteCount = 0;
  private t0 = 0;
  private readonly max: number;

  constructor(max: number = MAX_RECORD_EVENTS) {
    this.max = max;
  }

  get lengthMs(): number {
    return this.events.length ? this.events[this.events.length - 1].ms : 0;
  }

  get full(): boolean {
    return this.events.length >= this.max;
  }

  add(data: readonly number[], nowMs: number): boolean {
    if (this.full || !isRecordable(data)) return false;
    if (!this.events.length) this.t0 = nowMs;
    this.events.push({ ms: nowMs - this.t0, data: [...data] });
    if ((data[0] & 0xf0) === 0x90 && data[2] > 0) this.noteCount++;
    return true;
  }
}

// A take cut off mid-note (Stop, event limit, link drop) has note-ons with no note-off and maybe a held pedal.
// These messages close them; the panel sends them after playback so nothing keeps sounding on the keyboard.
export function closingMessages(events: readonly { data: readonly number[] }[]): Uint8Array[] {
  const held = new Set<number>(), pedal = new Set<number>();
  for (const { data: [s, a, b] } of events) {
    const k = s & 0xf0, ch = s & 15;
    if (k === 0x90 && b > 0) held.add(ch * 128 + a);
    else if (k === 0x80 || k === 0x90) held.delete(ch * 128 + a);
    else if (k === 0xb0 && a === 64) (b >= 64 ? pedal.add(ch) : pedal.delete(ch));
  }
  return [...held].map((h) => Uint8Array.of(0x80 | (h >> 7), h & 127, 0)).concat([...pedal].map((c) => Uint8Array.of(0xb0 | c, 64, 0)));
}
