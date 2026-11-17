// Writes a Standard MIDI File, type 0, 480 ppq, fixed 120 bpm (1 ms = 0.96 tick). Channel voice messages only. No DOM or Node imports.

export interface WriteEvent {
  ms: number;
  data: readonly number[];
}

const PPQ = 480;
const TICKS_PER_MS = PPQ / 500; // 500000 us per quarter note

const vlq = (n: number): number[] => {
  const out = [n & 127];
  while ((n = Math.floor(n / 128))) out.unshift((n & 127) | 128);
  return out;
};

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

export function writeSmf(events: readonly WriteEvent[]): Uint8Array {
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.ms - b.e.ms || a.i - b.i).map((x) => x.e);
  const body: number[] = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20];
  let last = 0;
  for (const { ms, data } of sorted) {
    const status = data[0];
    const need = status >= 0xc0 && status < 0xe0 ? 2 : 3;
    if (!(ms >= 0) || !Number.isFinite(ms)) throw new Error("bad event time");
    if (!(status >= 0x80 && status <= 0xef) || data.length !== need || data.slice(1).some((b) => !(b >= 0 && b < 128) || !Number.isInteger(b))) throw new Error("not a channel voice message");
    const tick = Math.round(ms * TICKS_PER_MS);
    body.push(...vlq(tick - last), ...data);
    last = tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, PPQ >> 8, PPQ & 255, 0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]);
}
