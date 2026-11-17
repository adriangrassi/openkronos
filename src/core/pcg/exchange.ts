// .ksound packs: export slots to JSON, and import an untrusted pack into compatible slots. No node: imports, so it also runs in the renderer.
import { getEntry, getName, listBanks, setEntry } from "./library.ts";
import { PcgError, type PcgFile } from "./pcg.ts";
import { programKey } from "./refs.ts";

export const MAX_PACK_BYTES = 32 * 1048576;
const MAX_SOUNDS = 4096;
const TYPES = ["program", "combi", "drumkit", "waveseq"] as const;
// Entry size per type. Programs are the same size on both engines.
const SIZES: Record<(typeof TYPES)[number], number> = { program: 4960, combi: 7810, drumkit: 38424, waveseq: 2216 };

export type PackSound = { type: (typeof TYPES)[number]; engine: "exi" | "hd1" | null; name: string; data: string; sha256: string };
export type SoundPack = { format: "kronos-sounds"; version: 1; name: string; sounds: PackSound[]; programs: PackSound[] };
export type ImportRow = { index: number; key: string; slot: number; incoming: string; existing: string; overwrite: boolean; error: string | null; warning: string | null };
type Slot = { key: string; index: number };

// Plain SHA-256 so the same code runs in the renderer (no node:crypto) and in node.
const K: number[] = [];
for (let c = 2; K.length < 64; c++) {
  let prime = true;
  for (let d = 2; d * d <= c; d++) if (c % d === 0) prime = false;
  if (prime) K.push(Math.floor((Math.cbrt(c) % 1) * 2 ** 32));
}
function sha256(data: Uint8Array): string {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const len = data.length, total = ((len + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(len / 2 ** 29));
  dv.setUint32(total - 4, (len << 3) >>> 0);
  const w = new Uint32Array(64);
  const rr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rr(b, 17) ^ rr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  return H.map((v) => v.toString(16).padStart(8, "0")).join("");
}

function toB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new PcgError("data is not valid base64");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function sound(f: PcgFile, key: string, index: number): PackSound {
  const bank = listBanks(f).find((b) => b.key === key);
  if (!bank) throw new PcgError(`no bank ${key}`);
  if (bank.kind === "setlist") throw new PcgError("Set Lists cannot be exported as sounds");
  const data = getEntry(f, key, index);
  return { type: bank.kind, engine: bank.kind === "program" ? bank.type : null, name: getName(f, key, index), data: toB64(data), sha256: sha256(data) };
}

// The Programs a Combi's 16 timbres point at.
function referenced(f: PcgFile, key: string, index: number): Slot[] {
  const e = getEntry(f, key, index), out: Slot[] = [], have = new Map(listBanks(f).map((b) => [b.key, b.count]));
  if (e.length <= 4803 + 188 * 15) return out;
  for (let t = 0; t < 16; t++) {
    const k = programKey(e[4803 + 188 * t]), i = e[4802 + 188 * t];
    if (k !== null && i < (have.get(k) ?? 0)) out.push({ key: k, index: i });
  }
  return out;
}

export function exportPack(file: PcgFile, slots: Slot[], name: string): string {
  const sounds = slots.map((s) => sound(file, s.key, s.index)), programs = new Map<string, PackSound>();
  for (const s of slots) {
    if (!s.key.startsWith("combi:")) continue;
    for (const r of referenced(file, s.key, s.index)) {
      const p = sound(file, r.key, r.index);
      programs.set(p.sha256, p);
    }
  }
  const pack: SoundPack = { format: "kronos-sounds", version: 1, name, sounds, programs: [...programs.values()] };
  return JSON.stringify(pack);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Builds a fresh object from known fields only, so no key of the input (such as __proto__) is ever copied.
function checkSound(v: unknown, where: string): PackSound {
  if (!isObj(v)) throw new PcgError(`${where} is not an object`);
  const { type, engine, name, data, sha256: hash } = v;
  if (typeof type !== "string" || !(TYPES as readonly string[]).includes(type)) throw new PcgError(`${where}: unknown type`);
  const t = type as PackSound["type"];
  if (t === "program" ? engine !== "exi" && engine !== "hd1" : engine !== null) throw new PcgError(`${where}: bad engine for a ${t}`);
  if (typeof name !== "string" || name.length < 1 || name.length > 64) throw new PcgError(`${where}: bad name`);
  if (typeof data !== "string" || typeof hash !== "string") throw new PcgError(`${where}: data and sha256 must be text`);
  if (data.length > SIZES[t] * 2) throw new PcgError(`${where}: data is too large (size)`);
  const bytes = fromB64(data);
  if (bytes.length !== SIZES[t]) throw new PcgError(`${where}: a ${t} is ${SIZES[t]} bytes, this has ${bytes.length} (size mismatch)`);
  if (!/^[0-9a-f]{64}$/.test(hash) || sha256(bytes) !== hash) throw new PcgError(`${where}: sha256 does not match the data`);
  return { type: t, engine: engine as PackSound["engine"], name, data, sha256: hash };
}

export function parsePack(input: string | Uint8Array): SoundPack {
  if ((typeof input === "string" ? input.length : input.byteLength) > MAX_PACK_BYTES) throw new PcgError(`pack is too large (limit ${MAX_PACK_BYTES} bytes)`);
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PcgError("not a JSON file");
  }
  if (!isObj(raw) || raw.format !== "kronos-sounds") throw new PcgError("not a Kronos sound pack");
  if (raw.version !== 1) throw new PcgError(`unsupported pack version ${String(raw.version)}`);
  if (typeof raw.name !== "string" || raw.name.length > 200) throw new PcgError("bad pack name");
  if (!Array.isArray(raw.sounds) || !Array.isArray(raw.programs)) throw new PcgError("sounds and programs must be lists");
  if (raw.sounds.length > MAX_SOUNDS || raw.programs.length > MAX_SOUNDS) throw new PcgError("too many sounds");
  return {
    format: "kronos-sounds",
    version: 1,
    name: raw.name,
    sounds: raw.sounds.map((s, i) => checkSound(s, `sound ${i + 1}`)),
    programs: raw.programs.map((s, i) => checkSound(s, `program ${i + 1}`)),
  };
}

export function planImport(file: PcgFile, pack: SoundPack, targets: Slot[]): ImportRow[] {
  const banks = listBanks(file);
  return pack.sounds.map((s, index) => {
    const t = targets[index], bank = t && banks.find((b) => b.key === t.key);
    const row = { index, key: t?.key ?? "", slot: t?.index ?? -1, incoming: s.name, existing: "", overwrite: false, error: null as string | null, warning: null as string | null };
    if (!t || !bank) return { ...row, error: "no target slot" };
    if (!Number.isInteger(t.index) || t.index < 0 || t.index >= bank.count) return { ...row, error: "target slot does not exist" };
    row.existing = getName(file, t.key, t.index);
    if (bank.kind !== s.type) row.error = `incompatible: a ${s.type} cannot go into a ${bank.kind} bank`;
    else if (bank.type !== (s.type === "program" ? s.engine : null)) row.error = `incompatible: ${s.engine ?? "?"} Program into a ${bank.type ?? "?"} bank`;
    else if (bank.entrySize !== SIZES[s.type]) row.error = "incompatible: size differs";
    else row.overwrite = true;
    // shortcut: referenced Programs in a pack are not imported, only warned about; upgrade by importing them and remapping the timbres.
    if (row.overwrite && s.type === "combi" && pack.programs.length > 0) row.warning = "timbre Program references are kept as they are and may point at other Programs here";
    return row;
  });
}

export function applyImport(file: PcgFile, pack: SoundPack, targets: Slot[]): void {
  const rows = planImport(file, pack, targets), bad = rows.find((r) => r.error);
  if (bad) throw new PcgError(`slot ${bad.index + 1}: ${bad.error}`);
  const data = pack.sounds.map((s) => fromB64(s.data));
  rows.forEach((r, i) => setEntry(file, r.key, r.slot, data[i]));
}
