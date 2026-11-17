// Universal realtime Master Volume, F0 7F 0g 04 01 vv mm F7 (KORG MIDI implementation 1-4-2): the digital level, not the front-panel knob.
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));

export function masterVolumeMessage(value14: number, channel: number): Uint8Array {
  const v = clamp(value14, 0, 16383);
  return Uint8Array.from([0xf0, 0x7f, channel === 0x7f ? 0x7f : clamp(channel, 0, 15), 0x04, 0x01, v & 0x7f, v >> 7, 0xf7]);
}

// Global MIDI Channel is raw 0..15 at byte 24576 of the Global block (params.json, "Global MIDI Channel").
export function globalMidiChannel(global: Uint8Array | null): number {
  return global && global.length > 24576 ? clamp(global[24576], 0, 15) : 0;
}

// The Settings choice ("file" or "1".."16") resolved to 0..15; anything else falls back to the file's channel.
export function effectiveGlobalChannel(setting: string, fileChannel: number): number {
  const n = Number(setting);
  return /^([1-9]|1[0-6])$/.test(setting) && Number.isInteger(n) ? n - 1 : fileChannel;
}

export function parseMasterVolume(b: ArrayLike<number>): number | null {
  return b.length === 8 && b[0] === 0xf0 && b[1] === 0x7f && b[3] === 0x04 && b[4] === 0x01 && b[7] === 0xf7 ? (b[6] << 7) | b[5] : null;
}

// Leading plus trailing throttle for a drag: the first value goes out at once, later ones at most once per window, and flush() sends the latest now.
export function coalescedSender(send: (v: number) => void, ms = 30) {
  let pending: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = (): void => {
    timer = null;
    if (pending === null) return;
    send(pending);
    pending = null;
    timer = setTimeout(tick, ms);
  };
  return {
    set(v: number): void {
      pending = v;
      if (!timer) tick();
    },
    flush(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending !== null) send(pending);
      pending = null;
    },
  };
}
