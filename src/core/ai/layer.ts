// The layer plan an Ask run proposes ("add strings to this piano"): its steps, what Build it for me writes, and how the app reads it back from a run. Pure.
import type { Message } from "./agent.ts";
import type { PointAt, PointStep } from "./point.ts";
import type { Part } from "./session.ts";
import type { Row } from "../params/params.ts";

export type LayerStep = PointStep & { n: number; key: string; index: number; name: string };
export type LayerPlan = {
  method: "combi" | "osc2";
  base: { key: string; index: number; name: string; engine: string };
  add: { role: string; chosen: { key: string; index: number; name: string; engine: string } | null; candidates: { key: string; index: number; name: string; engine: string }[] };
  slot?: { key: string; index: number }; // the free Combi the steps point at (combi only)
  name?: string;
  notes?: string;
  parts?: Part[]; // exactly what build_combi gets (combi only)
  steps: LayerStep[];
};

// The rows one walkthrough step writes: the pointed row, plus for a Combi program step the bank, status, channel and transpose that make the timbre sound.
export function stepWrites(rows: Row[], step: PointStep, row: Row | undefined): [Row, number][] {
  if (!row || step.suggest === undefined) return [];
  if (step.kind !== "combi-timbre") return [[row, step.suggest]];
  const put = (name: string, v: number | undefined): [Row, number][] => {
    const r = rows.find((x) => x.group === `Timbre${step.timbre}` && x.name === name);
    return r && v !== undefined ? [[r, v]] : [];
  };
  if (step.field === "program") return [[row, step.suggest], ...put("Bank Number", step.bank), ...put("Status", 1), ...put("MIDI Channel", 16), ...put("Transpose", step.transpose)];
  if (step.field === "keyrange") return [[row, step.suggest], ...put("Key Window Top", step.to)];
  if (step.field === "velrange") return [[row, step.suggest], ...put("Vel.Window High", step.to)];
  return [[row, step.suggest]];
}

// The last propose_layer result of a run that succeeded.
export function layerFrom(msgs: Message[]): LayerPlan | null {
  let out: LayerPlan | null = null;
  for (const m of msgs) {
    if (m.role !== "tool") continue;
    const call = msgs.flatMap((x) => x.toolCalls ?? []).find((c) => c.id === m.toolCallId);
    if (call?.name !== "propose_layer") continue;
    const res = JSON.parse(m.content) as { ok?: boolean } & Partial<LayerPlan>;
    if (res.ok && res.steps && res.steps.length > 0) out = res as LayerPlan;
  }
  return out;
}

// The walkthrough for a plan: every step on the one sound it works in (the free Combi, or the base Program for osc2).
export function layerPoint(p: LayerPlan): PointAt {
  const s = p.steps;
  return { key: s[0].key, index: s[0].index, ids: s.map((x) => x.id), notes: s.map((x) => x.note), names: s.map((x) => x.name), steps: s.map(({ n: _n, key: _k, index: _i, name: _name, ...step }) => step) };
}
