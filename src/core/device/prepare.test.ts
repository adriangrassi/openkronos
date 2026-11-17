import assert from "node:assert/strict";
import { test } from "node:test";
import { bank, container, entry, file, raw } from "../pcg/synthetic.ts";
import { getName, setEntry, getEntry } from "../pcg/library.ts";
import { parsePcg, type PcgFile } from "../pcg/pcg.ts";
import type { ParamTables, Row } from "../params/params.ts";
import { KronosError, KronosClient } from "./client.ts";
import { SimulatedKronos } from "./simulator.ts";
import { seedSimulator } from "./sync.ts";
import { combiNeeds, extraChannels, needLine, prepareErrorText, putOnKeyboard, readNeeds, targetsOf } from "./prepare.ts";

// Synthetic data only: made-up Combi rows at the real timbre offsets.
const row = (p: Partial<Row>): Row => ({ ofs: 0, bitHi: null, bitLo: null, group: "", name: "", rawMin: 0, rawMax: 127, fixed: false, valueText: "", signed: false, continuation: false, parts: [[0, 7, 0]], ...p }) as Row;
const timbre = (t: number): Row[] => {
  const b = 4802 + 188 * (t - 1), g = `Timbre${t}`;
  return [
    row({ group: g, name: "Program Number", ofs: b, parts: [[b, 7, 0]] }),
    row({ group: g, name: "Bank Number", ofs: b + 1, parts: [[b + 1, 7, 0]], rawMax: 30 }),
    row({ group: g, name: "Status", ofs: b + 2, parts: [[b + 2, 2, 0]], rawMax: 4 }),
    row({ group: g, name: "MIDI Channel", ofs: b + 2, bitHi: 7, bitLo: 3, parts: [[b + 2, 7, 3]], rawMax: 16 }),
  ];
};
const T = { combi: Array.from({ length: 16 }, (_, i) => timbre(i + 1)).flat() } as unknown as ParamTables;
const EXI = 4960, COMBI = 7810;

// Timbre n: [program, bank number, channel]; the others are off.
const combi = (name: string, timbres: Record<number, [number, number, number]>): Uint8Array => {
  const e = entry(name, COMBI);
  for (const [t, [p, b, ch]] of Object.entries(timbres)) {
    const o = 4802 + 188 * (Number(t) - 1);
    e[o] = p; e[o + 1] = b; e[o + 2] = 1 | (ch << 3);
  }
  return e;
};
const lib = (ff: string, intE: string): PcgFile =>
  parsePcg(file(container("PCG1", raw("DIV1", new Uint8Array(44), 0x10000),
    container("PRG1", bank("MBK1", EXI, 0, [entry("Berlin Grand", EXI, 7)]), bank("MBK1", EXI, 0x20000 + 12, [entry(ff, EXI, 9)])),
    container("CMB1", bank("CBK1", COMBI, 4, [combi(intE, { 1: [0, 0, 16], 2: [0, 29, 3] })])))));

const FILE = lib("Berlin Soft Pad", "Berlin Grand + Soft Pad");
const rig = (kb: PcgFile) => {
  const sim = new SimulatedKronos({ latencyMs: 0 });
  seedSimulator(sim, kb);
  return { sim, client: new KronosClient(sim, { timeoutMs: 2000 }) };
};

test("combiNeeds lists the active timbres' Programs by bank key, and says why a bank is not supported", () => {
  const f = lib("Berlin Soft Pad", "x");
  const e = getEntry(f, "combi:INT-E", 0);
  const o = 4802 + 188 * 2; // timbre 3: a GM bank
  e[o] = 5; e[o + 1] = 7; e[o + 2] = 1;
  setEntry(f, "combi:INT-E", 0, e);
  const n = combiNeeds(T, f, "combi:INT-E", 0);
  assert.deepEqual(n.map((x) => [x.timbre, x.key, x.index, x.label, x.supported]), [[1, "program:INT-A", 0, "INT-A 000", true], [2, "program:U-FF", 0, "U-FF 000", true], [3, null, 5, "bank 7 005", false]]);
  assert.equal(n[1].name, "Berlin Soft Pad");
  assert.match(needLine({ ...n[2], state: "unsupported" }), /not supported/);
});

test("the dependency line says not there yet, then ready", () => {
  const [, ff] = combiNeeds(T, FILE, "combi:INT-E", 0);
  assert.equal(needLine({ ...ff, state: "missing", keyboardName: "Drums" }), 'This Combination needs U-FF 000 "Berlin Soft Pad" on the keyboard: not there yet');
  assert.equal(needLine({ ...ff, state: "ready", keyboardName: "Berlin Soft Pad" }), 'This Combination needs U-FF 000 "Berlin Soft Pad" on the keyboard: ready');
});

test("extraChannels: the channels of active timbres other than the global one", () => {
  assert.deepEqual(extraChannels(T, FILE, "combi:INT-E", 0), [3]);
  assert.deepEqual(extraChannels(T, FILE, "program:INT-A", 0), []);
});

test("readNeeds reads the keyboard: a different U-FF and INT-E are missing and named, INT-A is ready", async () => {
  const { client } = rig(lib("Drums", "Owner Piano"));
  const r = await readNeeds(client, FILE, T, "combi:INT-E", 0);
  assert.deepEqual(r.needs.map((x) => [x.label, x.state, x.keyboardName]), [["INT-A 000", "ready", "Berlin Grand"], ["U-FF 000", "missing", "Drums"]]);
  assert.deepEqual([r.combi.state, r.combi.keyboardName], ["missing", "Owner Piano"]);
  assert.deepEqual(targetsOf(FILE, "combi:INT-E", 0, r).map((x) => [x.key, x.index, x.keyboardName]), [["program:U-FF", 0, "Drums"], ["combi:INT-E", 0, "Owner Piano"]]);
});

test("putOnKeyboard backs up each bank first, writes only the listed slots, stores, and verifies", async () => {
  const kb = lib("Drums", "Owner Piano");
  const { sim, client } = rig(kb);
  const r0 = await readNeeds(client, FILE, T, "combi:INT-E", 0);
  const before = sim.storedObject(0, 0x40 + 12, 1);
  const order: string[] = [];
  const r = await putOnKeyboard(client, FILE, T, "combi:INT-E", 0, targetsOf(FILE, "combi:INT-E", 0, r0), async (key) => { order.push(`backup ${key}`); });
  assert.deepEqual(order, ["backup program:U-FF", "backup combi:INT-E"]);
  assert.equal(r.combi.state, "ready");
  assert.ok(r.needs.every((x) => x.state === "ready"));
  assert.deepEqual([...sim.storedObject(0, 0x40 + 12, 0)!.data], [...getEntry(FILE, "program:U-FF", 0).subarray(0, EXI)]);
  assert.equal(getName(FILE, "program:U-FF", 0), "Berlin Soft Pad");
  assert.equal(before, undefined); // the bank has one slot only, so nothing else was written
});

test("a backup that fails stops the run before anything is written", async () => {
  const { sim, client } = rig(lib("Drums", "Owner Piano"));
  const r0 = await readNeeds(client, FILE, T, "combi:INT-E", 0);
  await assert.rejects(putOnKeyboard(client, FILE, T, "combi:INT-E", 0, targetsOf(FILE, "combi:INT-E", 0, r0), async () => { throw new Error("disk full"); }), /disk full/);
  assert.equal(getName(FILE, "program:U-FF", 0), "Berlin Soft Pad");
  assert.deepEqual([...sim.tempObject(0, 0x40 + 12, 0)!.data.subarray(0, 5)], [...entry("Drums", 24).subarray(0, 5)]);
});

test("prepareErrorText puts the keyboard's reply in plain words", () => {
  assert.match(prepareErrorText(new KronosError(65)), /Memory Protect/);
  assert.match(prepareErrorText(new KronosError(66)), /memory/i);
  assert.equal(prepareErrorText(new Error("boom")), "boom");
});
