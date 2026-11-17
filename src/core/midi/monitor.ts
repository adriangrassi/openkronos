// MIDI monitor: decodes one message for the dock's table and keeps a bounded ring of recent traffic. Pure: no DOM, no Link.

export type Dir = "in" | "out";

export interface Decoded {
  type: string;
  channel: number | null; // 1..16, or null for system messages
  values: string;
}

export interface MonitorEntry {
  seq: number;
  time: number;
  dir: Dir;
  data: Uint8Array;
  type: string;
  channel: number | null;
  values: string;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHANNEL_TYPES: Record<number, string> = {
  0x80: "Note Off",
  0x90: "Note On",
  0xa0: "Poly Pressure",
  0xb0: "Control Change",
  0xc0: "Program Change",
  0xd0: "Channel Pressure",
  0xe0: "Pitch Bend",
};
const SYSTEM_TYPES: Record<number, string> = {
  0xf6: "Tune Request",
  0xf8: "Timing Clock",
  0xfa: "Start",
  0xfb: "Continue",
  0xfc: "Stop",
  0xfe: "Active Sensing",
  0xff: "System Reset",
};

export function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

const hexByte = (x: number): string => x.toString(16).toUpperCase().padStart(2, "0");

const unknown = (): Decoded => ({ type: "Unknown", channel: null, values: "" });

export function decodeMessage(data: ArrayLike<number>): Decoded {
  const n = data.length;
  if (n === 0) return unknown();
  const s = data[0];
  if (s === 0xf0) {
    const head: string[] = [];
    for (let i = 0; i < Math.min(n, 8); i++) head.push(hexByte(data[i]));
    return { type: "SysEx", channel: null, values: `${n} bytes ${head.join(" ")}${n > 8 ? " ..." : ""}` };
  }
  if (s < 0x80) return unknown(); // running status is not tracked
  if (s < 0xf0) {
    const kind = s & 0xf0;
    const channel = (s & 0x0f) + 1;
    const need = kind === 0xc0 || kind === 0xd0 ? 2 : 3;
    if (n < need) return unknown();
    const a = data[1];
    const b = need === 3 ? data[2] : 0;
    if (a >= 0x80 || b >= 0x80) return unknown();
    const type = kind === 0x90 && b === 0 ? "Note Off" : CHANNEL_TYPES[kind];
    let values: string;
    switch (kind) {
      case 0x80:
      case 0x90:
        values = `${noteName(a)} ${a} vel ${b}`;
        break;
      case 0xa0:
        values = `${noteName(a)} ${a} pressure ${b}`;
        break;
      case 0xb0:
        values = `cc ${a} = ${b}`;
        break;
      case 0xc0:
        values = `prog ${a}`;
        break;
      case 0xd0:
        values = `pressure ${a}`;
        break;
      default:
        values = `bend ${(b << 7 | a) - 8192}`;
    }
    return { type, channel, values };
  }
  if (s === 0xf2) {
    if (n < 3 || data[1] >= 0x80 || data[2] >= 0x80) return unknown();
    return { type: "Song Position", channel: null, values: `pos ${data[1] | (data[2] << 7)}` };
  }
  if (s === 0xf3) {
    if (n < 2 || data[1] >= 0x80) return unknown();
    return { type: "Song Select", channel: null, values: `song ${data[1]}` };
  }
  const type = SYSTEM_TYPES[s];
  return type ? { type, channel: null, values: "" } : unknown();
}

export class MonitorLog {
  readonly capacity: number;
  private items: MonitorEntry[] = [];
  private nextSeq = 0;

  constructor(capacity = 2000) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.items.length;
  }

  add(dir: Dir, data: ArrayLike<number>, time: number): MonitorEntry {
    const copy = Uint8Array.from(data);
    const d = decodeMessage(copy);
    const entry: MonitorEntry = { seq: this.nextSeq++, time, dir, data: copy, type: d.type, channel: d.channel, values: d.values };
    this.items.push(entry);
    // shortcut: a shift per add is O(capacity) at 2000 entries, fine for MIDI rates; upgrade to a true ring if the cap grows
    if (this.items.length > this.capacity) this.items.shift();
    return entry;
  }

  entries(): MonitorEntry[] {
    return this.items.slice();
  }

  // Keeps seq, so entries added after a clear still count up from where they left off.
  clear(): void {
    this.items = [];
  }
}

export function filterEntries(entries: readonly MonitorEntry[], query: string, showActiveSensing: boolean): MonitorEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (!showActiveSensing && e.type === "Active Sensing") return false;
    if (!q) return true;
    return `${e.dir === "in" ? "IN" : "OUT"} ${e.type} ${e.values}`.toLowerCase().includes(q);
  });
}

export function formatTime(ms: number): string {
  const whole = Math.floor(ms); // performance.now() is fractional
  const min = Math.floor(whole / 60000);
  const sec = Math.floor((whole % 60000) / 1000);
  const milli = whole % 1000;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

export function formatEntries(entries: readonly MonitorEntry[]): string {
  return entries
    .map((e) => [formatTime(e.time), e.dir === "in" ? "IN" : "OUT", e.channel === null ? "-" : String(e.channel), e.type, e.values].join("\t"))
    .join("\n");
}
