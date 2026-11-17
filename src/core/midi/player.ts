// Plays MIDI events through a send function on an injected clock, so tests run in virtual time. No DOM or Node imports.

export interface PlayClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface PlayEvent {
  ms: number;
  data: number[];
}

export type SendFn = (msg: Uint8Array) => void;

export interface PlayOpts {
  channel: number | null; // null keeps each event's own channel
  onEnd?: () => void;
  startMs?: number; // song position, clamped to 0..end
  tempo?: number; // scale: 1 normal, 2 twice as fast
  transpose?: number; // semitones, channel 10 excepted
  muted?: number[]; // 0-based channels, after the channel remap
  loop?: boolean; // restart at the last event; onEnd is not called while looping
}

const LOOKAHEAD_MS = 200;
const LETTERS = "ABCDEFG";
const DRUM_CHANNEL = 9;

// Transposes one note. Drums (channel 10) keep their note; null when the result leaves 0..127.
export function transposeNote(note: number, semitones: number, channel: number): number | null {
  if (channel === DRUM_CHANNEL) return note;
  const n = note + semitones;
  return n < 0 || n > 127 ? null : n;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class MidiPlayer {
  private readonly send: SendFn;
  private readonly clock: PlayClock;
  private timers = new Set<number>();
  // channel * 128 + note as the file sent it -> the note actually sounding (they differ after a transpose)
  private held = new Map<number, number>();
  private chans = new Set<number>(); // channels the current file uses, silenced on stop
  private active = false;
  private events: PlayEvent[] = [];
  private endMs = 0;
  private channelMap: number | null = null;
  private onEnd?: () => void;
  private tempo = 1;
  private transpose = 0;
  private muted = new Set<number>();
  private loop = false;
  private pos = 0; // song ms while stopped
  private anchorSong = 0; // song ms at anchorNow, while playing
  private anchorNow = 0;
  private next = 0; // index of the next event not yet scheduled

  constructor(send: SendFn, clock: PlayClock) {
    this.send = send;
    this.clock = clock;
  }

  get playing(): boolean {
    return this.active;
  }

  // Replaces whatever was playing.
  play(events: PlayEvent[], opts: PlayOpts): void {
    this.stop();
    const tempo = opts.tempo ?? 1;
    if (!(tempo > 0)) throw new RangeError("tempo must be above 0");
    this.events = events;
    this.endMs = events.length ? events[events.length - 1].ms : 0;
    this.channelMap = opts.channel;
    this.onEnd = opts.onEnd;
    this.tempo = tempo;
    this.transpose = opts.transpose ?? 0;
    this.muted = new Set(opts.muted ?? []);
    this.loop = opts.loop ?? false;
    this.chans = new Set(events.map((e) => (opts.channel === null ? e.data[0] & 0x0f : opts.channel)));
    this.pos = clamp(opts.startMs ?? 0, 0, this.endMs);
    this.active = true;
    if (!events.length) return this.finish();
    this.startAt(this.pos);
  }

  // Note-offs for held notes, then All Notes Off on each channel the file used.
  stop(): void {
    this.clearTimers();
    if (this.active) this.pos = clamp(this.songMs(), 0, this.endMs);
    this.active = false;
    this.releaseAll();
    // A file's sustain pedal would otherwise keep released notes ringing.
    for (const ch of this.chans) this.send(Uint8Array.of(0xb0 | ch, 64, 0));
    for (const ch of this.chans) this.send(Uint8Array.of(0xb0 | ch, 123, 0));
    this.chans.clear();
  }

  // shortcut: a tempo or transpose change restarts the schedule from the current position, with 200 ms of lookahead, until timed on the real Kronos
  setTempo(scale: number): void {
    if (!(scale > 0)) throw new RangeError("tempo must be above 0");
    this.change(() => (this.tempo = scale));
  }

  setTranspose(semitones: number): void {
    this.change(() => (this.transpose = semitones));
  }

  // Only the channels whose mute state changes are released, so muting one channel leaves the others sounding.
  setMuted(channels: number[]): void {
    const next = new Set(channels);
    const changed = [...new Set([...this.muted, ...next])].filter((ch) => this.muted.has(ch) !== next.has(ch));
    this.muted = next;
    if (!this.active) return;
    for (const [k, n] of [...this.held]) if (changed.includes(k >> 7)) this.noteOff(k, n);
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  // Past the end while playing ends the song and calls onEnd.
  seek(ms: number): void {
    if (this.active && ms >= this.endMs) {
      this.releaseAll();
      return this.finish();
    }
    const to = clamp(ms, 0, this.endMs);
    if (!this.active) {
      this.pos = to;
      return;
    }
    this.releaseAll();
    this.startAt(to);
  }

  positionMs(): number {
    return this.active ? this.songMs() : this.pos;
  }

  private songMs(): number {
    return this.anchorSong + (this.clock.now() - this.anchorNow) * this.tempo;
  }

  // Applies a change that alters timing or pitch: notes are released first, then the schedule restarts where the song is now.
  private change(apply: () => void): void {
    if (!this.active) return apply();
    const at = clamp(this.songMs(), 0, this.endMs);
    this.releaseAll();
    apply();
    this.startAt(at);
  }

  private startAt(ms: number): void {
    this.clearTimers();
    this.anchorSong = ms;
    this.anchorNow = this.clock.now();
    this.next = this.indexFrom(ms);
    this.pump();
  }

  // First event at or after ms (events are sorted by time).
  private indexFrom(ms: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].ms < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private pump(): void {
    const horizon = this.songMs() + LOOKAHEAD_MS * this.tempo;
    while (this.next < this.events.length && this.events[this.next].ms <= horizon) {
      const i = this.next++;
      this.at(() => this.emit(i), (this.events[i].ms - this.songMs()) / this.tempo);
    }
    if (this.next < this.events.length) this.at(() => this.pump(), LOOKAHEAD_MS / 2);
  }

  private clearTimers(): void {
    for (const id of this.timers) this.clock.clearTimeout(id);
    this.timers.clear();
  }

  private at(fn: () => void, delay: number): void {
    let id = 0;
    id = this.clock.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, Math.max(0, delay));
    this.timers.add(id);
  }

  private releaseAll(): void {
    for (const [k, n] of [...this.held]) this.noteOff(k, n);
  }

  private noteOff(k: number, n: number): void {
    this.held.delete(k);
    this.send(Uint8Array.of(0x80 | (k >> 7), n, 0));
  }

  // Song over: position left at the end, onEnd called once. A file's last note-off ends its notes; no extra messages.
  private finish(): void {
    this.clearTimers();
    this.pos = this.endMs;
    this.active = false;
    this.onEnd?.();
  }

  private emit(i: number): void {
    const ev = this.events[i];
    const ch = this.channelMap ?? ev.data[0] & 0x0f;
    const kind = ev.data[0] & 0xf0;
    const key = (ch << 7) | ev.data[1];
    if (kind === 0x90 && ev.data[2] > 0) {
      const n = transposeNote(ev.data[1], this.transpose, ch);
      if (n !== null && !this.muted.has(ch)) {
        const old = this.held.get(key);
        if (old !== undefined) this.noteOff(key, old);
        this.held.set(key, n);
        this.send(Uint8Array.of(0x90 | ch, n, ev.data[2]));
      }
    } else if (kind === 0x80 || kind === 0x90) {
      const n = this.held.get(key);
      if (n !== undefined) this.noteOff(key, n);
    } else {
      this.send(Uint8Array.of(kind | ch, ...ev.data.slice(1)));
    }
    if (i === this.events.length - 1) {
      if (this.loop) {
        this.releaseAll();
        this.startAt(0);
      } else this.finish();
    }
  }
}

// Bank Select LSB for a Program or Combi bank label, per KORG's default Bank Map.
function bankLsb(kind: "program" | "combi", label: string): number {
  const int = /^INT-([A-G])$/.exec(label);
  if (int && LETTERS.indexOf(int[1]) <= (kind === "program" ? 5 : 6)) return LETTERS.indexOf(int[1]);
  const user = /^U-([A-G])(\1)?$/.exec(label);
  if (user) return (user[2] ? 15 : 8) + LETTERS.indexOf(user[1]);
  throw new Error(`no MIDI bank for ${kind}:${label}`);
}

// Bank Select (MSB 0, LSB per the Bank Map), then Program Change. Channel is 0..15.
export function selectBytes(key: string, index: number, channel: number): Uint8Array[] {
  const [kind, label = ""] = key.split(":");
  if (kind !== "program" && kind !== "combi") throw new Error(`${key} is not a Program or Combi bank`);
  if (!Number.isInteger(index) || index < 0 || index > 127) throw new Error(`program ${index} is out of range`);
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error(`channel ${channel} is out of range`);
  const lsb = bankLsb(kind, label);
  return [Uint8Array.of(0xb0 | channel, 0, 0), Uint8Array.of(0xb0 | channel, 32, lsb), Uint8Array.of(0xc0 | channel, index)];
}

// KORG Mode Change: F0 42 3g 68 4E mode F7. Combination is mode 0, Program is mode 2.
export function modeBytes(kind: "program" | "combi", channel: number): Uint8Array {
  if (kind !== "program" && kind !== "combi") throw new Error(`no mode for ${String(kind)}`);
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error(`channel ${channel} is out of range`);
  const mode = kind === "program" ? 2 : 0;
  return Uint8Array.of(0xf0, 0x42, 0x30 | channel, 0x68, 0x4e, mode, 0xf7);
}

// An original pattern: a rising C major scale from C3 to C5, then four chords from low to high.
export function testPattern(): PlayEvent[] {
  const out: PlayEvent[] = [];
  const on = (t: number, n: number) => out.push({ ms: t, data: [0x90, n, 96] });
  const off = (t: number, n: number) => out.push({ ms: t, data: [0x80, n, 0] });
  const SCALE = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
  const CHORDS = [[36, 40, 43], [48, 52, 55], [60, 64, 67], [72, 76, 79, 84]];
  SCALE.forEach((n, i) => {
    on(i * 250, n);
    off(i * 250 + 220, n);
  });
  const chordStart = SCALE.length * 250;
  CHORDS.forEach((notes, i) => {
    const t = chordStart + i * 800;
    notes.forEach((n) => on(t, n));
    notes.forEach((n) => off(t + 700, n));
  });
  return out;
}

// For auditioning one sound: a file's own Bank Select and Program Change would switch the keyboard away from it.
// With channels, only those channels lose them (a track that plays its own chosen sound).
export function auditionEvents(events: readonly PlayEvent[], channels?: Set<number>): PlayEvent[] {
  return events.filter(({ data }) => {
    if (channels && !channels.has(data[0] & 0x0f)) return true;
    const type = data[0] & 0xf0;
    return type !== 0xc0 && !(type === 0xb0 && (data[1] === 0 || data[1] === 32));
  });
}

// KORG Mode Change to Sequencer (mode 4): each track then plays its own Program.
export function seqModeBytes(channel: number): Uint8Array {
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error(`channel ${channel} is out of range`);
  return Uint8Array.of(0xf0, 0x42, 0x30 | channel, 0x68, 0x4e, 4, 0xf7);
}

// All Stop: on every channel, release the pedal, then end all notes and cut all sound at once.
export function allStopMessages(): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let ch = 0; ch < 16; ch++) for (const cc of [64, 123, 120]) out.push(Uint8Array.of(0xb0 | ch, cc, 0));
  return out;
}

// Universal GM System On. The Kronos takes it in Sequencer mode and sets the song's tracks up for General MIDI.
export const GM_ON = Uint8Array.of(0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7);

// Selects a General MIDI sound under either Bank Map: G is bank 79,00 and the drum kits g(d) are 78,00. Channel index 9 is drums.
export function gmSelectBytes(channel: number, program: number): Uint8Array[] {
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error(`channel ${channel} is out of range`);
  if (!Number.isInteger(program) || program < 0 || program > 127) throw new Error(`program ${program} is out of range`);
  return [Uint8Array.of(0xb0 | channel, 0, channel === 9 ? 0x78 : 0x79), Uint8Array.of(0xb0 | channel, 32, 0), Uint8Array.of(0xc0 | channel, program)];
}

// A file's own Bank Select would move a track out of the General MIDI bank.
export function withoutBankSelect(events: readonly PlayEvent[]): PlayEvent[] {
  return events.filter(({ data }) => !((data[0] & 0xf0) === 0xb0 && (data[1] === 0 || data[1] === 32)));
}
