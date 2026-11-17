// Parses KORG's Effect.txt (research/korg-sysex, licensed, not in git) into src/generated/effects.json: each effect type with its named parameters.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const text = readFileSync(path.join(root, "research/korg-sysex/midiimp/MIDI implementation/Effect.txt"), "latin1");
const names: string[] = JSON.parse(readFileSync(path.join(root, "src/generated/params.json"), "utf8")).effectTypes;

const hex = (s: string) => parseInt(s, 16);
const sg = (v: number, bits: number) => (v >= 2 ** (bits - 1) ? v - 2 ** bits : v);
const bitsOf = (s: string): [number, number] | null => {
  const m = /^(\d)(?:~(\d))?$/.exec(s);
  return m ? [Math.max(+m[1], +(m[2] ?? m[1])), Math.min(+m[1], +(m[2] ?? m[1]))] : null;
};
// Same reading of the DATA(hex) cell as gen-params.ts; null = a cell it can't read.
function dataOf(d: string) {
  const f = /^([0-9A-F]+)\(fixed\)$/.exec(d);
  if (f) return { fixed: true, rawMin: hex(f[1]), rawMax: hex(f[1]), signed: false };
  const m = /^([0-9A-F]+)~([0-9A-F]+)$/.exec(d);
  if (!m) return null;
  const lo = hex(m[1]), hi = hex(m[2]);
  if (lo <= hi) return { fixed: false, rawMin: lo, rawMax: hi, signed: false };
  const bits = Math.ceil(m[1].length / 2) * 8, a = sg(lo, bits), b = sg(hi, bits);
  // shortcut: a wrap that inverts after sign conversion is not one interval; the type is then undeterminable, so the page shows generic controls
  return a > b ? null : { fixed: false, rawMin: a, rawMax: b, signed: true };
}
function need(d: { rawMin: number; rawMax: number; signed: boolean }) {
  let w = 1;
  while (d.signed ? d.rawMin < -(2 ** (w - 1)) || d.rawMax > 2 ** (w - 1) - 1 : 2 ** w - 1 < d.rawMax) w++;
  return w;
}

type Cell = { ofs: number; bits: [number, number]; name: string; data: string; value: string; pid: string };
const types = names.map((name, id) => ({ id, name, params: null as unknown[] | null }));
const blocks = text.split(/\r?\n(?=\d{2,3}:)/);
for (const b of blocks) {
  const h = /^(\d{2,3}):(.*)/.exec(b);
  if (!h) continue;
  const t = types[Number(h[1])];
  if (!t || t.name !== h[2].trim()) throw new Error(`type ${h[1]} "${h[2]}" does not match params.json "${t?.name}"`);
  const cells: Cell[] = [];
  let ofs = 0;
  for (const line of b.split(/\r?\n/)) {
    if (!/^\|\s*\d*\s*\|/.test(line)) continue;
    const c = line.split("|").map((x) => x.trim());
    if (c[1] === "OFS") continue;
    if (c[1] !== "") ofs = Number(c[1]);
    cells.push({ ofs, bits: bitsOf(c[2]) ?? [7, 0], name: c[3], data: c[4], value: c[5], pid: c[6] });
  }
  if (cells.length === 0) { t.params = []; continue; }
  const params: unknown[] = [];
  let ok = true;
  cells.forEach((c, i) => {
    if (c.name === "") return;
    const d = dataOf(c.data);
    if (!d) { ok = false; return; }
    const parts: [number, number, number][] = [[c.ofs, c.bits[0], c.bits[1]]];
    let w = c.bits[0] - c.bits[1] + 1;
    for (let j = i + 1; j < cells.length && cells[j].name === "" && w < need(d); j++) {
      parts.push([cells[j].ofs, cells[j].bits[0], cells[j].bits[1]]);
      w += cells[j].bits[0] - cells[j].bits[1] + 1;
    }
    params.push({ pid: Number(c.pid), name: c.name, ofs: c.ofs, bitHi: c.bits[0], bitLo: c.bits[1], ...d, valueText: c.value, parts });
  });
  t.params = ok ? params : null;
}
mkdirSync(path.join(root, "src/generated"), { recursive: true });
writeFileSync(path.join(root, "src/generated/effects.json"), JSON.stringify({ types }));
console.log(`effects.json: ${types.length} types, ${types.filter((t) => t.params === null).length} undeterminable`);
