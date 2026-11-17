// Select Set List `set` slot `slot` (both 0..127): Bank Select MSB 0, LSB = set, Program Change = slot (KORG MIDI implementation, "MIDI In: Set List").
export function setListSelectBytes(set: number, slot: number, channel: number): Uint8Array[] {
  for (const [v, hi, what] of [[set, 127, "set"], [slot, 127, "slot"], [channel, 15, "channel"]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > hi) throw new RangeError(`${what} must be a whole number from 0 to ${hi}`);
  }
  return [Uint8Array.of(0xb0 | channel, 0x00, 0x00), Uint8Array.of(0xb0 | channel, 0x20, set), Uint8Array.of(0xc0 | channel, slot)];
}
