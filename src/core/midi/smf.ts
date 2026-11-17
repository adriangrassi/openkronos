// Standard MIDI File reader for the player. Formats 0 and 1, PPQ timing only. Only channel voice messages come out.

export class SmfError extends Error {
  name = "SmfError";
}

export interface SmfEvent {
  ms: number;
  data: number[];
}

export interface SmfChannel {
  channel: number;
  name: string;
  notes: number;
}

export interface Smf {
  format: number;
  division: number;
  events: SmfEvent[];
  durationMs: number;
  channels: SmfChannel[];
}

const DEFAULT_TEMPO = 500000; // microseconds per quarter note (120 BPM)
const MAX_VLQ_BYTES = 4;

class Reader {
  readonly bytes: Uint8Array;
  readonly end: number;
  pos: number;

  constructor(bytes: Uint8Array, start: number, end: number) {
    this.bytes = bytes;
    this.pos = start;
    this.end = end;
  }

  more(): boolean {
    return this.pos < this.end;
  }

  u8(): number {
    if (this.pos >= this.end) throw new SmfError("unexpected end of data");
    return this.bytes[this.pos++];
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return this.u8() * 0x1000000 + this.u8() * 0x10000 + this.u8() * 0x100 + this.u8();
  }

  take(n: number): Uint8Array {
    if (n > this.end - this.pos) throw new SmfError("length runs past the end of the file");
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  vlq(): number {
    let v = 0;
    for (let i = 0; i < MAX_VLQ_BYTES; i++) {
      const b = this.u8();
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new SmfError("variable-length number is too long");
  }
}

// Reads one "type, length, body" chunk, bounds-checked against the enclosing data.
function chunk(r: Reader): { id: string; body: Uint8Array } {
  const id = String.fromCharCode(...r.take(4));
  const body = r.take(r.u32());
  return { id, body };
}

interface Note {
  tick: number;
  track: number;
  seq: number;
  data: number[];
}

interface Tempo {
  tick: number;
  track: number;
  seq: number;
  us: number;
}

// What a track says about the channels it plays. Names are parsed once here and serve both Smf.channels and parseSmfChannels.
interface TrackFacts {
  name: string | undefined;
  notes: Map<number, number>; // channel -> note-on count
  programs: Map<number, { tick: number; program: number }>;
  chans: Set<number>; // every channel the track sends a voice message on, with or without notes
}

function parseTrack(body: Uint8Array, track: number, notes: Note[], tempos: Tempo[], facts: TrackFacts): number {
  const r = new Reader(body, 0, body.length);
  let tick = 0;
  let seq = 0;
  let status = 0;
  while (r.more()) {
    tick += r.vlq();
    const first = r.u8();
    if (first === 0xff) {
      const type = r.u8();
      const data = r.take(r.vlq());
      status = 0;
      if (type === 0x51) {
        if (data.length !== 3) throw new SmfError("tempo event has the wrong length");
        const us = (data[0] << 16) | (data[1] << 8) | data[2];
        if (us === 0) throw new SmfError("tempo of zero");
        tempos.push({ tick, track, seq: seq++, us });
      } else if (type === 0x03 && facts.name === undefined) {
        facts.name = Array.from(data, (b) => String.fromCharCode(b)).join("");
      } else if (type === 0x2f) {
        break;
      }
      continue;
    }
    if (first === 0xf0 || first === 0xf7) {
      r.take(r.vlq());
      status = 0;
      continue;
    }
    let s: number;
    let d1: number;
    if (first < 0x80) {
      // Running status: the byte is the first data byte of the previous status.
      if (!status) throw new SmfError("data byte with no status");
      s = status;
      d1 = first;
    } else {
      if (first > 0xef) throw new SmfError("system message in a file");
      s = first;
      status = s;
      d1 = r.u8();
    }
    const kind = s & 0xf0;
    const data = [s, d1];
    if (kind !== 0xc0 && kind !== 0xd0) data.push(r.u8());
    if (data.slice(1).some((b) => b > 0x7f)) throw new SmfError("data byte out of range");
    const ch = s & 0x0f;
    facts.chans.add(ch);
    if (kind === 0x90 && data[2] > 0) facts.notes.set(ch, (facts.notes.get(ch) ?? 0) + 1);
    if (kind === 0xc0 && !facts.programs.has(ch)) facts.programs.set(ch, { tick, program: d1 });
    notes.push({ tick, track, seq: seq++, data });
  }
  return tick;
}

function readSmf(bytes: Uint8Array): { smf: Smf; facts: TrackFacts[] } {
  const top = new Reader(bytes, 0, bytes.length);
  const head = chunk(top);
  if (head.id !== "MThd") throw new SmfError("not a MIDI file");
  if (head.body.length < 6) throw new SmfError("header is too short");
  const h = new Reader(head.body, 0, head.body.length);
  const format = h.u16();
  const ntrks = h.u16();
  const division = h.u16();
  if (format !== 0 && format !== 1) throw new SmfError(`format ${format} is not supported`);
  if (ntrks < 1 || (format === 0 && ntrks !== 1)) throw new SmfError("bad track count");
  if (division & 0x8000) throw new SmfError("SMPTE timing is not supported");
  if (division === 0) throw new SmfError("zero ticks per quarter note");

  const notes: Note[] = [];
  const tempos: Tempo[] = [];
  const facts: TrackFacts[] = [];
  let endTick = 0;
  for (let t = 0; t < ntrks; t++) {
    let c;
    do {
      if (!top.more()) throw new SmfError("missing track");
      c = chunk(top);
    } while (c.id !== "MTrk");
    const f: TrackFacts = { name: undefined, notes: new Map(), programs: new Map(), chans: new Set() };
    facts.push(f);
    endTick = Math.max(endTick, parseTrack(c.body, t, notes, tempos, f));
  }

  // Tempo map: segments of constant tempo, each starting at a tick and a millisecond time.
  const perTick = division * 1000;
  const map: { tick: number; ms: number; us: number }[] = [{ tick: 0, ms: 0, us: DEFAULT_TEMPO }];
  tempos.sort((a, b) => a.tick - b.tick || a.track - b.track || a.seq - b.seq);
  for (const t of tempos) {
    const last = map[map.length - 1];
    if (t.tick === last.tick) {
      last.us = t.us;
      continue;
    }
    map.push({ tick: t.tick, ms: last.ms + ((t.tick - last.tick) * last.us) / perTick, us: t.us });
  }
  const toMs = (tick: number): number => {
    let lo = 0;
    let hi = map.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (map[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    const seg = map[lo];
    return seg.ms + ((tick - seg.tick) * seg.us) / perTick;
  };

  notes.sort((a, b) => a.tick - b.tick || a.track - b.track || a.seq - b.seq);
  const events = notes.map((n) => ({ ms: toMs(n.tick), data: n.data }));
  // Channels with a note-on; the name is from the lowest-numbered track that plays the channel.
  const channels: SmfChannel[] = [];
  for (let channel = 0; channel < 16; channel++) {
    const players = facts.filter((f) => f.notes.has(channel));
    if (players.length === 0) continue;
    channels.push({ channel, name: players[0].name ?? "", notes: players.reduce((n, f) => n + f.notes.get(channel)!, 0) });
  }
  return { smf: { format, division, events, durationMs: toMs(endTick), channels }, facts };
}

export function parseSmf(bytes: Uint8Array): Smf {
  return readSmf(bytes).smf;
}

export interface SmfChannelFacts {
  channel: number;
  trackName: string | null;
  program: number | null;
  notes: number;
}

// Channels that have a note-on, or a named track that sends on them (an empty track: notes 0), ascending. The name is from the first track that plays the channel; the program is its earliest Program Change.
export function parseSmfChannels(bytes: Uint8Array): SmfChannelFacts[] {
  const { facts } = readSmf(bytes);
  const out: SmfChannelFacts[] = [];
  for (let ch = 0; ch < 16; ch++) {
    const players = facts.filter((f) => f.notes.has(ch));
    const named = facts.find((f) => f.chans.has(ch) && f.name?.trim());
    if (players.length === 0 && !named) continue;
    let first: { tick: number; program: number } | null = null;
    for (const f of facts) {
      const p = f.programs.get(ch);
      if (p && (!first || p.tick < first.tick)) first = p;
    }
    const notes = players.reduce((n, f) => n + (f.notes.get(ch) ?? 0), 0);
    out.push({ channel: ch, trackName: (players[0] ?? named)?.name?.trim() || null, program: first?.program ?? null, notes });
  }
  return out;
}
