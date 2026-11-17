// .PCG container layer: parse and serialize without changing a byte we do not edit.
// Layout: a 16-byte "KORG" header, then one PCG1 block. A block is a 4-byte ASCII tag, a u32 BE data size,
// a u32 BE word, then `size` bytes of data. Leaf checksum = low byte of the word = 8-bit sum of the data.

export class PcgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PcgError";
  }
}

export interface PcgBlock {
  readonly tag: string;
  readonly offset: number; // start of the 12-byte block header
  readonly size: number; // data bytes
  readonly parent: PcgBlock | null;
  readonly children: PcgBlock[]; // only containers have children
}

// bytes is the file's own copy. Edit it only through library.ts; callers get copies back.
export interface PcgFile {
  readonly bytes: Uint8Array;
  readonly root: PcgBlock;
}

export const BLOCK_HEADER = 12;
const HEADER = 16;
const MAGIC = "KORG";
const NAME_LEN = 24;
const MAX_DEPTH = 8; // the real files nest 3 levels deep
const CONTAINERS = new Set(["PCG1", "PRG1", "CMB1", "DKT1", "WSQ1", "SLS1", "SLD1", "STL1", "DPI1", "DPS1"]);
const BANK_TAGS = new Set(["MBK1", "PBK1", "CBK1", "DBK1", "WBK1", "SBK1", "SDB1"]);

export function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function tagAt(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function parseRange(bytes: Uint8Array, start: number, end: number, parent: PcgBlock | null, depth: number, into: PcgBlock[]): void {
  if (depth > MAX_DEPTH) throw new PcgError(`containers nested deeper than ${MAX_DEPTH}`);
  let o = start;
  while (o < end) {
    if (end - o < BLOCK_HEADER) throw new PcgError(`block header at ${o} runs past its parent`);
    const tag = tagAt(bytes, o);
    const size = readU32(bytes, o + 4);
    if (size > end - o - BLOCK_HEADER) throw new PcgError(`${tag} @${o} runs past its parent's end`);
    const block: PcgBlock = { tag, offset: o, size, parent, children: [] };
    into.push(block);
    if (CONTAINERS.has(tag)) parseRange(bytes, o + BLOCK_HEADER, o + BLOCK_HEADER + size, block, depth + 1, block.children);
    o += BLOCK_HEADER + size;
  }
}

function checkBank(bytes: Uint8Array, b: PcgBlock): void {
  if (b.size < 12) throw new PcgError(`${b.tag} @${b.offset} is too small for a bank header`);
  const count = readU32(bytes, b.offset + 12);
  const entrySize = readU32(bytes, b.offset + 16);
  // Names live in the first 24 bytes of each entry, so an entry must be at least that big.
  if (entrySize < NAME_LEN || 12 + count * entrySize !== b.size) {
    throw new PcgError(`${b.tag} @${b.offset}: bank header (${count} x ${entrySize}) does not match its size ${b.size}`);
  }
}

export function parsePcg(input: Uint8Array): PcgFile {
  if (input.length < HEADER + BLOCK_HEADER) throw new PcgError(`file too short: ${input.length} bytes`);
  const bytes = new Uint8Array(input);
  if (tagAt(bytes, 0) !== MAGIC) throw new PcgError("not a KORG file: bad magic");
  const top: PcgBlock[] = [];
  parseRange(bytes, HEADER, bytes.length, null, 0, top);
  if (top.length !== 1 || top[0].tag !== "PCG1") throw new PcgError("expected exactly one PCG1 block after the header");
  const f: PcgFile = { bytes, root: top[0] };
  for (const b of leafBlocks(f)) if (BANK_TAGS.has(b.tag)) checkBank(bytes, b);
  return f;
}

export function serializePcg(f: PcgFile): Uint8Array {
  return new Uint8Array(f.bytes);
}

// Leaves in file order (depth-first).
export function leafBlocks(f: PcgFile): PcgBlock[] {
  const out: PcgBlock[] = [];
  const walk = (b: PcgBlock): void => {
    if (CONTAINERS.has(b.tag)) for (const c of b.children) walk(c);
    else out.push(b);
  };
  walk(f.root);
  return out;
}

function leafSum(bytes: Uint8Array, b: PcgBlock): number {
  let s = 0;
  for (let i = b.offset + BLOCK_HEADER; i < b.offset + BLOCK_HEADER + b.size; i++) s += bytes[i];
  return s & 0xff;
}

// Recompute the checksum of one leaf after its data changed. The word's upper three bytes stay as they were.
export function updateChecksum(f: PcgFile, b: PcgBlock): void {
  f.bytes[b.offset + 11] = leafSum(f.bytes, b);
}

export function verifyChecksums(f: PcgFile): string[] {
  const bad: string[] = [];
  for (const b of leafBlocks(f)) {
    if (b.tag === "DIV1") continue; // the only leaf with no checksum
    if (f.bytes[b.offset + 11] !== leafSum(f.bytes, b)) bad.push(`${b.tag} @${b.offset}`);
  }
  return bad;
}
