import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "./agent.ts";
import { layerFrom, layerPoint, stepWrites, type LayerPlan } from "./layer.ts";
import type { Row } from "../params/params.ts";

const row = (group: string, name: string, ofs: number, p: Partial<Row> = {}): Row => ({ ofs, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax: 127, fixed: false, valueText: "", signed: false, continuation: false, parts: [[ofs, 7, 0]], typ: null, soc: null, sub: null, pid: 0, idx: 0, ...p } as Row);
const rows = [row("Timbre2", "Program Number", 10), row("Timbre2", "Bank Number", 11), row("Timbre2", "Status", 12, { rawMax: 4 }), row("Timbre2", "MIDI Channel", 13, { rawMax: 16 }), row("Timbre2", "Transpose", 14, { rawMin: -60, rawMax: 60 }), row("Timbre2", "Volume", 15), row("Timbre2", "Key Window Bottom", 16), row("Timbre2", "Key Window Top", 17), row("Timbre1", "Key Window Top", 27), row("Timbre2", "Vel.Window Low", 18), row("Timbre2", "Vel.Window High", 19)];
const by = (n: string) => rows.find((r) => r.group === "Timbre2" && r.name === n)!;
const names = (w: [Row, number][]) => w.map(([r, v]) => `${r.name}=${v}`);

test("a Combi program step also writes bank, status, channel and transpose; a level step writes only its row", () => {
  const prog = { id: "10.0", note: "", kind: "combi-timbre" as const, timbre: 2, field: "program" as const, suggest: 5, bank: 18, transpose: -12 };
  assert.deepEqual(names(stepWrites(rows, prog, by("Program Number"))), ["Program Number=5", "Bank Number=18", "Status=1", "MIDI Channel=16", "Transpose=-12"]);
  assert.deepEqual(names(stepWrites(rows, { ...prog, field: "level", suggest: 80 }, by("Volume"))), ["Volume=80"]);
});

test("range steps write both ends, on their own timbre only", () => {
  const k = { id: "16.0", note: "", kind: "combi-timbre" as const, timbre: 2, field: "keyrange" as const, suggest: 48, to: 96 };
  assert.deepEqual(names(stepWrites(rows, k, by("Key Window Bottom"))), ["Key Window Bottom=48", "Key Window Top=96"]);
  assert.deepEqual(names(stepWrites(rows, { ...k, field: "velrange", suggest: 20, to: 100 }, by("Vel.Window Low"))), ["Vel.Window Low=20", "Vel.Window High=100"]);
});

test("a plain step writes its suggestion, and a step with no suggestion or no row writes nothing", () => {
  assert.deepEqual(names(stepWrites(rows, { id: "15.0", note: "", suggest: 9 }, by("Volume"))), ["Volume=9"]);
  assert.deepEqual(stepWrites(rows, { id: "15.0", note: "" }, by("Volume")), []);
  assert.deepEqual(stepWrites(rows, { id: "15.0", note: "", suggest: 9 }, undefined), []);
});

const plan: LayerPlan = { method: "combi", base: { key: "program:INT-A", index: 0, name: "Grand", engine: "SGX-2" }, add: { role: "strings", chosen: null, candidates: [] }, slot: { key: "combi:INT-F", index: 100 }, steps: [
  { n: 1, kind: "note", key: "combi:INT-F", index: 100, id: "note-1", name: "Plan", note: "Pick a slot" },
  { n: 2, kind: "combi-timbre", key: "combi:INT-F", index: 100, id: "10.0", name: "Timbre 2 program", note: "Set it", suggest: 5, timbre: 2, field: "program" },
] };

test("layerFrom reads the last successful propose_layer of a run, and layerPoint makes one pointer on the plan's sound", () => {
  const call = (id: string) => ({ id, name: "propose_layer", arguments: {} });
  const msgs: Message[] = [
    { role: "assistant", content: "", toolCalls: [call("a"), call("b")] },
    { role: "tool", toolCallId: "a", content: JSON.stringify({ ok: false, error: "no" }) },
    { role: "tool", toolCallId: "b", content: JSON.stringify({ ok: true, ...plan }) },
  ];
  assert.equal(layerFrom(msgs)?.steps.length, 2);
  assert.equal(layerFrom(msgs.slice(0, 2)), null);
  const p = layerPoint(plan);
  assert.deepEqual([p.key, p.index, p.ids, p.names, p.steps![1].timbre, "n" in p.steps![0]], ["combi:INT-F", 100, ["note-1", "10.0"], ["Plan", "Timbre 2 program"], 2, false]);
});
