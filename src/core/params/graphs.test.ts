import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLD, clampZoneEdge, dragEnvelope, envelopeAxes, envelopePoints, findEnvelopes, readEnvelope, timbreZones, type Envelope } from "./graphs.ts";
import type { ParamTables, Row } from "./params.ts";

// Synthetic rows only: no KORG data. Offsets are arbitrary and each field is one byte.
const row = (p: Partial<Row> & Pick<Row, "name" | "ofs">): Row => ({
  bitHi: null, bitLo: null, group: "G", rawMin: 0, rawMax: 99, fixed: false, valueText: "0~99", signed: false,
  continuation: false, parts: [[p.ofs, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...p,
});

// An amplifier envelope in one group, plus a bipolar filter envelope and a pitch envelope with no sustain.
const amp: Row[] = [
  row({ group: "Amp EG", name: "Start Level", ofs: 0 }),
  row({ group: "Amp EG", name: "Attack Time", ofs: 1 }),
  row({ group: "Amp EG", name: "Attack Level", ofs: 2 }),
  row({ group: "Amp EG", name: "Decay Time", ofs: 3 }),
  row({ group: "Amp EG", name: "Break Level", ofs: 4 }),
  row({ group: "Amp EG", name: "Slope Time", ofs: 5 }),
  row({ group: "Amp EG", name: "Sustain Level", ofs: 6 }),
  row({ group: "Amp EG", name: "Release Time", ofs: 7 }),
  row({ group: "Amp EG", name: "Release Level", ofs: 8, fixed: true }),
];
const filter: Row[] = amp.slice(0, 8).map((r, i) => ({ ...r, group: "Filter EG", ofs: 10 + i, rawMin: r.name.endsWith("Level") ? -99 : 0, rawMax: 99, signed: r.name.endsWith("Level"), parts: [[10 + i, 7, 0]] }));
const pitch: Row[] = [
  row({ group: "Pitch EG", name: "Start Level", ofs: 20, rawMin: -99, signed: true }),
  row({ group: "Pitch EG", name: "Attack Time", ofs: 21 }),
  row({ group: "Pitch EG", name: "Attack Level", ofs: 22, rawMin: -99, signed: true }),
  row({ group: "Pitch EG", name: "Decay Time", ofs: 23 }),
  row({ group: "Pitch EG", name: "Break Level", ofs: 24, rawMin: -99, signed: true }),
  row({ group: "Pitch EG", name: "Slope Time", ofs: 25 }),
  row({ group: "Pitch EG", name: "Release Time", ofs: 26 }),
  row({ group: "Pitch EG", name: "Release Level", ofs: 27, rawMin: -99, signed: true }),
];
const other = [row({ group: "Insert", name: "Attack Time", ofs: 30 }), row({ group: "Insert", name: "Decay Time", ofs: 31 })];

function find(rows: Row[], group: string): Envelope {
  const env = findEnvelopes(rows).find((e) => e.group === group);
  assert.ok(env, group);
  return env;
}

// Entry bytes for the amp envelope: start 0, attack 6 at level 99, break 50 at 99, slope 87, sustain 99, release 37 to level 0.
const entry = Uint8Array.of(0, 6, 99, 50, 99, 87, 99, 37, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const writes = (w: { row: Row; value: number }[]) => Object.fromEntries(w.map(({ row: r, value }) => [r.name, value]));

test("envelopes are the groups with the seven required rows; sustain and release are optional", () => {
  const rows = [...amp, ...filter, ...pitch, ...other];
  assert.deepEqual(findEnvelopes(rows).map((e) => e.group).sort(), ["Amp EG", "Filter EG", "Pitch EG"]);
  assert.equal(find(rows, "Pitch EG").fields.sustainLevel, null);
  assert.equal(find(rows, "Pitch EG").fields.releaseLevel?.name, "Release Level");
  assert.equal(find(rows, "Amp EG").fields.attackTime.name, "Attack Time");
});

test("readEnvelope reads the fields and treats missing levels as 0", () => {
  const v = readEnvelope(find(amp, "Amp EG"), entry);
  assert.deepEqual([v.startLevel, v.attackLevel, v.breakLevel, v.sustainLevel, v.attackTime, v.decayTime, v.slopeTime, v.releaseTime], [0, 99, 99, 99, 6, 50, 87, 37]);
  assert.equal(readEnvelope(find(pitch, "Pitch EG"), entry).sustainLevel, 0);
});

test("envelope points run through the attack, break, sustain hold and release", () => {
  const v = readEnvelope(find(amp, "Amp EG"), entry);
  assert.deepEqual(envelopePoints(v), [{ x: 0, y: 0 }, { x: 6, y: 99 }, { x: 56, y: 99 }, { x: 143, y: 99 }, { x: 143 + HOLD, y: 99 }, { x: 143 + HOLD + 37, y: 0 }]);
});

test("dragging writes only the editable rows the point moves, and the fixed release level is never written", () => {
  const env = find(amp, "Amp EG"), v = readEnvelope(env, entry);
  assert.deepEqual(writes(dragEnvelope(env, v, 1, 20, 50)), { "Attack Time": 20, "Attack Level": 50 });
  assert.deepEqual(writes(dragEnvelope(env, v, 2, 16, 40)), { "Decay Time": 10, "Break Level": 40 });
  assert.deepEqual(writes(dragEnvelope(env, v, 3, 66, 20)), { "Slope Time": 10, "Sustain Level": 20 });
  assert.deepEqual(writes(dragEnvelope(env, v, 4, 999, 33)), { "Sustain Level": 33 }, "the hold has a fixed width");
  assert.deepEqual(writes(dragEnvelope(env, v, 5, envelopePoints(v)[4].x + 9, 77)), { "Release Time": 9 }, "release level is fixed");
});

test("drag values are clamped to each row's range and rounded", () => {
  const env = find(filter, "Filter EG"), v = readEnvelope(env, entry);
  assert.deepEqual(writes(dragEnvelope(find(amp, "Amp EG"), readEnvelope(find(amp, "Amp EG"), entry), 1, 9999, -9999)), { "Attack Time": 99, "Attack Level": 0 });
  assert.deepEqual(writes(dragEnvelope(find(amp, "Amp EG"), readEnvelope(find(amp, "Amp EG"), entry), 1, -5, 12.6)), { "Attack Time": 0, "Attack Level": 13 });
  assert.equal(writes(dragEnvelope(env, v, 1, 10, -500))["Attack Level"], -99, "bipolar level floor");
});

test("envelope axes keep the time scale fixed and bracket the level range", () => {
  const a = envelopeAxes(find(amp, "Amp EG"));
  assert.equal(a.axisMax, 99 * 4 + HOLD);
  assert.deepEqual([a.levelMin, a.levelMax], [0, 99]);
  assert.equal(envelopeAxes(find(pitch, "Pitch EG")).levelMin, -99);
});

// Combi rows for all 16 timbres, at offsets 100 x timbre, so the fixture is easy to read.
const combi: Row[] = [];
for (let t = 1; t <= 16; t++) {
  const base = 100 * t;
  for (const [i, name, rawMin, rawMax] of [[0, "Status", 0, 4], [1, "Key Window Bottom", 0, 127], [2, "Key Window Top", 0, 127], [3, "Vel.Window Low", 1, 127], [4, "Vel.Window High", 1, 127], [5, "Bank Number", 0, 30], [6, "Program Number", 0, 127]] as const) {
    combi.push(row({ group: `Timbre${t}`, name, ofs: base + i, rawMin, rawMax, valueText: "0~127" }));
  }
}
const tables = { combi } as unknown as ParamTables;

test("timbre zones read each timbre's window and bank", () => {
  const e = new Uint8Array(1700);
  e[100] = 0; e[101] = 40; e[102] = 60; e[103] = 10; e[104] = 90; e[105] = 5; e[106] = 17;
  e[200] = 2; e[201] = 20; e[202] = 30; e[203] = 1; e[204] = 127; e[205] = 0; e[206] = 3;
  const z = timbreZones(tables, e);
  assert.equal(z.length, 16);
  assert.deepEqual(z[0], { timbre: 1, status: 0, keyBottom: 40, keyTop: 60, velLow: 10, velHigh: 90, bank: 5, program: 17 });
  assert.equal(z[1].status, 2);
  assert.equal(z[1].keyTop, 30);
});

test("a zone edge cannot cross its opposite edge, and velocity starts at 1", () => {
  const z = { keyBottom: 40, keyTop: 60, velLow: 10, velHigh: 90 };
  assert.equal(clampZoneEdge(z, "keyTop", 20), 40);
  assert.equal(clampZoneEdge(z, "keyBottom", 100), 60);
  assert.equal(clampZoneEdge(z, "velHigh", 2), 10);
  assert.equal(clampZoneEdge(z, "velLow", 120), 90);
  assert.equal(clampZoneEdge(z, "keyTop", 500), 127);
  assert.equal(clampZoneEdge(z, "velLow", -5), 1);
  assert.equal(clampZoneEdge(z, "keyBottom", -5), 0);
});
