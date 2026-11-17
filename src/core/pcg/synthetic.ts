// Builds small PCG byte arrays in code for the unit tests. Contains no KORG data.
const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const u32 = (v: number): Uint8Array => Uint8Array.of(v >>> 24, v >>> 16, v >>> 8, v);

const block = (tag: string, data: Uint8Array, word: number): Uint8Array => concat(enc(tag), u32(data.length), u32(word), data);

const sum = (d: Uint8Array): number => d.reduce((s, b) => (s + b) & 0xff, 0);

export const raw = (tag: string, data: Uint8Array, word: number): Uint8Array => block(tag, data, word);
export const leaf = (tag: string, data: Uint8Array): Uint8Array => block(tag, data, 0x500 | sum(data));
export const container = (tag: string, ...children: Uint8Array[]): Uint8Array => block(tag, concat(...children), 0x400);

export function file(root: Uint8Array): Uint8Array {
  return concat(enc("KORG"), new Uint8Array(12), root);
}

// A bank leaf: count, entrySize, id, then the entries (each padded with zeros to entrySize).
export function bank(tag: string, entrySize: number, id: number, entries: Uint8Array[]): Uint8Array {
  const body = entries.map((e) => {
    const p = new Uint8Array(entrySize);
    p.set(e);
    return p;
  });
  return leaf(tag, concat(u32(entries.length), u32(entrySize), u32(id), ...body));
}

// An entry whose first 24 bytes hold the name, NUL-padded; bytes after that are `fill`.
export function entry(name: string, entrySize: number, fill = 0): Uint8Array {
  const e = new Uint8Array(entrySize);
  e.set(enc(name));
  e.fill(fill, 24);
  return e;
}
