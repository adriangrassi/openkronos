export type ParamDesc = {
  key: string;                 // stable id within one effect page (Kronos: String(pid))
  name: string;                // full name as the device names it, prefix included
  min: number; max: number;    // raw range
  kind: "box" | "pick" | "check" | "fixed";
  values?: string[];           // one name per raw value min..max (complete lists only)
  texts?: Record<number, string>; // overrides for single raw values (3999 -> "MIDI", -39 -> "-Inf")
  scale?: { lo: number; hi: number; decimals: number; plus?: boolean; kUnder10k?: number; exact: boolean };
  ends?: [string, string];     // names of the two ends when nothing better is known
};

export type FxLine = { desc: ParamDesc; label: string; mods: ParamDesc[] };
export type FxTable = { title: string; cols: string[]; rows: { label: string; cells: (FxLine | null)[] }[] };
export type FxSection = { title: string; lines: FxLine[]; table?: FxTable };

const MOD = /^(.*?)\s*Mod\.(Source|Intensity)$/;
const PREFIX = /^\(([^)]+)\) (.*)$/;
const TABLE = /^(Band|Tap|Tube|LFO)(\d+) (.+)$/;

function scaleX(d: ParamDesc, s: NonNullable<ParamDesc["scale"]>, v: number): number {
  return d.max === d.min ? s.lo : s.lo + ((v - d.min) * (s.hi - s.lo)) / (d.max - d.min);
}

export function descText(d: ParamDesc, v: number): string {
  const t = d.texts?.[v];
  if (t !== undefined) return t;
  if (d.values && v >= d.min && v <= d.max && d.values[v - d.min] !== undefined) return d.values[v - d.min];
  if (d.scale?.exact) {
    const s = d.scale;
    const x = scaleX(d, s, v);
    let out = s.kUnder10k !== undefined && Math.abs(x) >= 1000
      ? (x / 1000).toFixed(Math.abs(x) >= 10000 ? 1 : s.kUnder10k) + "k"
      : x.toFixed(s.decimals);
    if (s.plus && x > 0) out = "+" + out;
    return out;
  }
  if (d.ends) {
    if (v === d.min) return d.ends[0];
    if (v === d.max) return d.ends[1];
  }
  return String(v);
}

export function descNumber(d: ParamDesc, v: number): number | null {
  return d.scale ? scaleX(d, d.scale, v) : null;
}

export function descPos(d: ParamDesc, v: number): number {
  return d.max === d.min ? 0 : (v - d.min) / (d.max - d.min);
}

function sectionOf(label: string): string {
  if (label.startsWith("Wet/Dry")) return "Output";
  if (label.startsWith("Input Trim")) return "Input";
  if (/^(LFO|Common LFO)/.test(label)) return "LFO";
  if (/^Pre (LEQ|HEQ|Low EQ|High EQ|EQ)/.test(label)) return "Pre EQ";
  if (label.startsWith("Side ")) return "Side Chain";
  if (label.startsWith("Envelope ")) return "Envelope";
  return "Parameters";
}

export function groupDescs(descs: ParamDesc[]): FxSection[] {
  const live = descs.filter((d) => d.kind !== "fixed");
  const isMod = (d: ParamDesc) => MOD.test(d.name);
  const hosts = live.filter((d) => !isMod(d));
  const hasPrefix = hosts.some((d) => PREFIX.test(d.name));

  const lineOf = new Map<ParamDesc, FxLine>();
  const sectionOrder: string[] = [];
  const bySection = new Map<string, FxLine[]>();
  for (const d of hosts) {
    const p = PREFIX.exec(d.name);
    let section: string;
    let label: string;
    if (p) {
      section = p[1];
      label = p[2];
    } else {
      label = d.name;
      section = hasPrefix
        ? label.startsWith("Wet/Dry") ? "Output" : label.startsWith("Input Trim") ? "Input" : "Common"
        : sectionOf(label);
    }
    const line: FxLine = { desc: d, label, mods: [] };
    lineOf.set(d, line);
    if (!bySection.has(section)) {
      bySection.set(section, []);
      sectionOrder.push(section);
    }
    bySection.get(section)!.push(line);
  }

  // A mod with no host (no earlier non-mod row) stays a plain line so no row is lost.
  for (const d of live) {
    const m = MOD.exec(d.name);
    if (!m) continue;
    let host = hosts.find((h) => h.name === m[1]);
    if (!host) {
      const before = hosts.filter((h) => live.indexOf(h) < live.indexOf(d));
      host = before[before.length - 1];
    }
    if (host) lineOf.get(host)!.mods.push(d);
    else {
      const line: FxLine = { desc: d, label: d.name, mods: [] };
      if (!bySection.has("Parameters")) {
        bySection.set("Parameters", []);
        sectionOrder.push("Parameters");
      }
      bySection.get("Parameters")!.push(line);
    }
  }

  const out: FxSection[] = [];
  for (const title of sectionOrder) {
    const lines = bySection.get(title)!;
    const sec: FxSection = { title, lines: [...lines] };
    const tables = new Map<string, FxLine[]>();
    for (const l of lines) {
      const t = TABLE.exec(l.label);
      if (t) tables.set(t[1], [...(tables.get(t[1]) ?? []), l]);
    }
    let token: string | undefined;
    for (const [name, ls] of tables) {
      const nums = new Set(ls.map((l) => TABLE.exec(l.label)![2]));
      if (nums.size >= 2) { token = name; break; }
    }
    if (token !== undefined) {
      const hits = tables.get(token)!;
      const cols: string[] = [];
      const numbers: number[] = [];
      for (const l of hits) {
        const [, , num, suffix] = TABLE.exec(l.label)!;
        if (!cols.includes(suffix)) cols.push(suffix);
        if (!numbers.includes(Number(num))) numbers.push(Number(num));
      }
      numbers.sort((a, b) => a - b);
      const rows = numbers.map((n) => ({
        label: `${token}${n}`,
        cells: cols.map((c) => hits.find((l) => {
          const m = TABLE.exec(l.label)!;
          return m[1] === token && Number(m[2]) === n && m[3] === c;
        }) ?? null),
      }));
      sec.table = { title: token, cols, rows };
      sec.lines = lines.filter((l) => !hits.includes(l));
    }
    if (sec.lines.length || sec.table) out.push(sec);
  }

  const rank = (t: string) => (t === "Input" ? 0 : t === "Output" ? 2 : 1);
  return out.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.title) - rank(b.s.title) || a.i - b.i).map((x) => x.s);
}
