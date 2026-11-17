// KORG 8-to-7 binary conversion and 21-bit signed values (KRONOS_MIDI_SysEx.txt L1128-1166).

export function sysExSize(n: number): number {
  return n + Math.ceil(n / 7);
}

export function binarySize(n: number): number {
  return Math.floor(n / 8) * 7 + (n % 8 ? n % 8 - 1 : 0);
}

export function encode7(bin: Uint8Array): Uint8Array {
  const out = new Uint8Array(sysExSize(bin.length));
  let o = 0;
  for (let g = 0; g < bin.length; g += 7) {
    const n = Math.min(7, bin.length - g);
    let ms = 0;
    for (let i = 0; i < n; i++) if (bin[g + i] & 0x80) ms |= 1 << i;
    out[o++] = ms;
    for (let i = 0; i < n; i++) out[o++] = bin[g + i] & 0x7f;
  }
  return out;
}

export function decode7(sys: Uint8Array): Uint8Array {
  // A length of 8k+1 would leave a lone MS byte with no data: not a valid encoding.
  if (sys.length % 8 === 1) throw new RangeError(`invalid 8-to-7 length ${sys.length}`);
  for (const b of sys) if (b > 0x7f) throw new RangeError("8-to-7 data byte above 7F");
  const out = new Uint8Array(binarySize(sys.length));
  let i = 0;
  let o = 0;
  while (i < sys.length) {
    const ms = sys[i++];
    const n = Math.min(7, sys.length - i);
    for (let j = 0; j < n; j++) out[o++] = sys[i + j] | (((ms >> j) & 1) << 7);
    i += n;
  }
  return out;
}

export function encodeSigned21(v: number): [number, number, number] {
  if (!Number.isInteger(v) || v < -1048576 || v > 1048575) {
    throw new RangeError(`signed 21-bit value out of range: ${v}`);
  }
  const u = v & 0x1fffff;
  return [(u >> 14) & 0x7f, (u >> 7) & 0x7f, u & 0x7f];
}

export function decodeSigned21(h: number, m: number, l: number): number {
  for (const b of [h, m, l]) if (!Number.isInteger(b) || b < 0 || b > 0x7f) throw new RangeError(`not a 7-bit byte: ${b}`);
  let v = (h << 14) | (m << 7) | l;
  if (v & 0x100000) v -= 0x200000;
  return v;
}
