// Envelope and Combi keyboard maps as data: which rows make up an envelope, where its points sit, and what a drag writes.
// No DOM, no node: imports, so it also runs in the renderer.
import { isEditable, readParam, type ParamTables, type Row } from "./params.ts";

// Width of the sustain hold on the time axis. KORG's envelopes have no time for it, so it is drawn at a fixed width.
// shortcut: 40 is a drawing choice, not a value from KORG or the keyboard; upgrade only if a sustain time is ever found.
export const HOLD = 40;

const NEED = ["Start Level", "Attack Level", "Break Level", "Attack Time", "Decay Time", "Slope Time", "Release Time"] as const;

export type Envelope = {
  group: string;
  fields: {
    startLevel: Row;
    attackLevel: Row;
    breakLevel: Row;
    sustainLevel: Row | null;
    releaseLevel: Row | null;
    attackTime: Row;
    decayTime: Row;
    slopeTime: Row;
    releaseTime: Row;
  };
};

export type EnvelopeValues = {
  startLevel: number;
  attackLevel: number;
  breakLevel: number;
  sustainLevel: number;
  releaseLevel: number;
  attackTime: number;
  decayTime: number;
  slopeTime: number;
  releaseTime: number;
};

export type Point = { x: number; y: number };
export type Write = { row: Row; value: number };

// Any group that has all seven required rows. Sustain and release levels are optional and read as 0 when missing.
export function findEnvelopes(rows: Row[]): Envelope[] {
  const byGroup = new Map<string, Map<string, Row>>();
  for (const r of rows) {
    if (r.continuation) continue;
    let names = byGroup.get(r.group);
    if (!names) byGroup.set(r.group, (names = new Map()));
    if (!names.has(r.name)) names.set(r.name, r);
  }
  const out: Envelope[] = [];
  for (const [group, m] of byGroup) {
    if (!NEED.every((n) => m.has(n))) continue;
    out.push({
      group,
      fields: {
        startLevel: m.get("Start Level")!,
        attackLevel: m.get("Attack Level")!,
        breakLevel: m.get("Break Level")!,
        sustainLevel: m.get("Sustain Level") ?? null,
        releaseLevel: m.get("Release Level") ?? null,
        attackTime: m.get("Attack Time")!,
        decayTime: m.get("Decay Time")!,
        slopeTime: m.get("Slope Time")!,
        releaseTime: m.get("Release Time")!,
      },
    });
  }
  return out;
}

export function readEnvelope(env: Envelope, entry: Uint8Array): EnvelopeValues {
  const f = env.fields;
  const val = (r: Row | null) => (r ? readParam(entry, r) : 0);
  return {
    startLevel: val(f.startLevel),
    attackLevel: val(f.attackLevel),
    breakLevel: val(f.breakLevel),
    sustainLevel: val(f.sustainLevel),
    releaseLevel: val(f.releaseLevel),
    attackTime: val(f.attackTime),
    decayTime: val(f.decayTime),
    slopeTime: val(f.slopeTime),
    releaseTime: val(f.releaseTime),
  };
}

// The six points of the shape: x is relative time, y is the level. Points 3 and 4 bound the sustain hold.
export function envelopePoints(v: EnvelopeValues): Point[] {
  const x1 = v.attackTime;
  const x2 = x1 + v.decayTime;
  const x3 = x2 + v.slopeTime;
  const x4 = x3 + HOLD;
  const x5 = x4 + v.releaseTime;
  return [
    { x: 0, y: v.startLevel },
    { x: x1, y: v.attackLevel },
    { x: x2, y: v.breakLevel },
    { x: x3, y: v.sustainLevel },
    { x: x4, y: v.sustainLevel },
    { x: x5, y: v.releaseLevel },
  ];
}

// The time axis runs from 0 to the sum of the largest times plus the hold, so it does not move while a point is dragged.
// Levels run from the lowest to the highest level row, so a bipolar envelope has its zero inside.
export function envelopeAxes(env: Envelope): { axisMax: number; levelMin: number; levelMax: number } {
  const f = env.fields;
  const times = [f.attackTime, f.decayTime, f.slopeTime, f.releaseTime];
  const levels = [f.startLevel, f.attackLevel, f.breakLevel, f.sustainLevel, f.releaseLevel].filter((r): r is Row => r !== null);
  return {
    axisMax: Math.max(1, times.reduce((a, r) => a + r.rawMax, 0) + HOLD),
    levelMin: Math.min(...levels.map((r) => r.rawMin)),
    levelMax: Math.max(...levels.map((r) => r.rawMax)),
  };
}

const clampRaw = (r: Row, v: number): number => Math.min(r.rawMax, Math.max(r.rawMin, Math.round(v)));

// Moves one point to (x, y) in envelope units and returns the editable rows it changes. A point's x sets the time that
// ends at it, and y sets its level. Fixed levels and the hold are never written.
export function dragEnvelope(env: Envelope, values: EnvelopeValues, point: number, x: number, y: number): Write[] {
  const f = env.fields;
  const out: Write[] = [];
  const put = (r: Row | null, v: number) => {
    if (r && isEditable(r)) out.push({ row: r, value: clampRaw(r, v) });
  };
  const x1 = values.attackTime;
  const x2 = x1 + values.decayTime;
  const x3 = x2 + values.slopeTime;
  const x4 = x3 + HOLD;
  switch (point) {
    case 0: put(f.startLevel, y); break;
    case 1: put(f.attackTime, x); put(f.attackLevel, y); break;
    case 2: put(f.decayTime, x - x1); put(f.breakLevel, y); break;
    case 3: put(f.slopeTime, x - x2); put(f.sustainLevel, y); break;
    case 4: put(f.sustainLevel, y); break;
    case 5: put(f.releaseTime, x - x4); put(f.releaseLevel, y); break;
  }
  return out;
}

export type ZoneRows = { status: Row; keyBottom: Row; keyTop: Row; velLow: Row; velHigh: Row; bank: Row; program: Row };
export type Zone = { timbre: number } & { status: number; keyBottom: number; keyTop: number; velLow: number; velHigh: number; bank: number; program: number };
export type Edge = "keyBottom" | "keyTop" | "velLow" | "velHigh";

const rowCache = new WeakMap<Row[], Map<string, Row>>();

// The Combi rows of one timbre (1..16). The table has one row per group and name, so the lookup is cached.
export function timbreRows(tables: ParamTables, t: number): ZoneRows {
  let byName = rowCache.get(tables.combi);
  if (!byName) {
    byName = new Map();
    for (const r of tables.combi) {
      const k = `${r.group}\u0000${r.name}`;
      if (!byName.has(k)) byName.set(k, r);
    }
    rowCache.set(tables.combi, byName);
  }
  const get = (name: string): Row => {
    const r = byName.get(`Timbre${t}\u0000${name}`);
    if (!r) throw new Error(`no Combi row ${name} for timbre ${t}`);
    return r;
  };
  return {
    status: get("Status"),
    keyBottom: get("Key Window Bottom"),
    keyTop: get("Key Window Top"),
    velLow: get("Vel.Window Low"),
    velHigh: get("Vel.Window High"),
    bank: get("Bank Number"),
    program: get("Program Number"),
  };
}

export function timbreZones(tables: ParamTables, entry: Uint8Array): Zone[] {
  const out: Zone[] = [];
  for (let t = 1; t <= 16; t++) {
    const r = timbreRows(tables, t);
    out.push({
      timbre: t,
      status: readParam(entry, r.status),
      keyBottom: readParam(entry, r.keyBottom),
      keyTop: readParam(entry, r.keyTop),
      velLow: readParam(entry, r.velLow),
      velHigh: readParam(entry, r.velHigh),
      bank: readParam(entry, r.bank),
      program: readParam(entry, r.program),
    });
  }
  return out;
}

// A zone's edges stay inside the keys and velocities, and never cross the opposite edge. Velocity starts at 1.
export function clampZoneEdge(zone: Pick<Zone, "keyBottom" | "keyTop" | "velLow" | "velHigh">, edge: Edge, value: number): number {
  const bounds: Record<Edge, [number, number]> = {
    keyBottom: [0, zone.keyTop],
    keyTop: [zone.keyBottom, 127],
    velLow: [1, zone.velHigh],
    velHigh: [zone.velLow, 127],
  };
  const [lo, hi] = bounds[edge];
  return Math.min(hi, Math.max(lo, Math.round(value)));
}
