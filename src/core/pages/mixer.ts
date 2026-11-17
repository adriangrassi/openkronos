// Combi mixer and Program dashboard helpers: labels as the keyboard shows them, and the rows each timbre uses. Pure: no DOM.
import type { Row } from "../params/params.ts";

const pad = (n: number, w: number): string => String(n).padStart(w, "0");
const L = "ABCDEFG";

// Bank column of a Program pointer: 0..5 INT-A..F, 6..16 GM (g, g(1)..g(9), g(d)), 17..23 U-A..G, 24..30 U-AA..GG.
export function bankLabel(col: number): string {
  if (col >= 0 && col <= 5) return `I-${L[col]}`;
  if (col === 6) return "g";
  if (col >= 7 && col <= 15) return `g(${col - 6})`;
  if (col === 16) return "g(d)";
  if (col >= 17 && col <= 23) return `U-${L[col - 17]}`;
  if (col >= 24 && col <= 30) return `U-${L[col - 24].repeat(2)}`;
  return String(col);
}
export const programText = (bank: number, program: number): string => `${bankLabel(bank)}${pad(program, 3)}`;
export const nameTag = (index: number, name: string): string => `${pad(index, 3)}: ${name}`;
export const geText = (v: number, names: readonly string[] | undefined): string => `${pad(v, 4)}${names?.[v] ? `: ${names[v]}` : ""}`;

// Pan as the keyboard prints it: RND, L001..L063, c064, R065..R127.
export const panText = (v: number): string => (v === 0 ? "RND" : v < 64 ? `L${pad(v, 3)}` : v === 64 ? "c064" : `R${pad(v, 3)}`);

// Only Off (0) and INT (1) are named; KORG's table names the other values only as "External2" at the top end.
export const statusText = (v: number, fmt: string): string => (v === 0 ? "Off" : v === 1 ? "INT" : fmt);

export type MixerCell = { timbre: number; program: Row; bank: Row; status: Row; volume: Row; pan: Row; mute: Row };

// One cell per timbre that has all six rows; an incomplete table gives no cells at all.
export function mixerCells(rows: Row[]): MixerCell[] {
  const by = new Map<string, Row>();
  for (const r of rows) if (!r.continuation && !by.has(`${r.group}/${r.name}`)) by.set(`${r.group}/${r.name}`, r);
  const out: MixerCell[] = [];
  for (let t = 1; t <= 16; t++) {
    const g = (n: string) => by.get(`Timbre${t}/${n}`);
    const [program, bank, status, volume, pan, mute] = ["Program Number", "Bank Number", "Status", "Volume", "Pan", "Mute"].map(g);
    if (program && bank && status && volume && pan && mute) out.push({ timbre: t, program, bank, status, volume, pan, mute });
  }
  return out.length === 16 ? out : [];
}

// Mid Frequency raw value 0..rawMax spans 100 Hz to 10 kHz; shown as 970 or 5.20k.
export const eqHz = (raw: number, rawMax: number): number => 100 * 10 ** ((2 * raw) / (rawMax || 1));
export const hzText = (hz: number): string => (hz >= 1000 ? `${(hz / 1000).toFixed(2)}k` : String(Math.round(hz)));

// Track EQ response in dB at n log-spaced points from 24 Hz to 24 kHz.
// shortcut: the 80 Hz and 8 kHz shelf corners and the bell width are drawing choices, not KORG values; replace if the EQ's real response is published.
export function eqCurve(p: { low: number; mid: number; high: number; midHz: number }, n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const f = 24 * 1000 ** (i / (n - 1));
    const bell = Math.log2(f / p.midHz);
    return p.low / (1 + (f / 80) ** 2) + p.mid * Math.exp(-1.5 * bell * bell) + p.high / (1 + (8000 / f) ** 2);
  });
}

// Filter Type values 0..3, as the Program screen's badges print them.
export const FILTER_TYPES = ["LPF", "HPF", "BPF", "BRF"] as const;
