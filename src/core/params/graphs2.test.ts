import { test } from "node:test";
import assert from "node:assert/strict";
import { LFO_WAVEFORMS, drumMap, findLfos, lfoPoints, waveSeqTimeline, waveShown } from "./graphs2.ts";
import type { ParamTables, Row } from "./params.ts";

// Synthetic rows only: no KORG data. Offsets are arbitrary and each field is one byte unless noted.
const row = (p: Partial<Row> & Pick<Row, "name" | "ofs">): Row => ({
  bitHi: null, bitLo: null, group: "G", rawMin: 0, rawMax: 99, fixed: false, valueText: "0~99", signed: false,
  continuation: false, parts: [[p.ofs, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...p,
});

test("findLfos needs Waveform and Frequency; Shape is optional", () => {
  const rows = [
    row({ group: "OSC1 LFO1", name: "Waveform", ofs: 0, rawMax: 17 }),
    row({ group: "OSC1 LFO1", name: "Frequency", ofs: 1 }),
    row({ group: "OSC1 LFO1", name: "Shape", ofs: 2, rawMin: -99, rawMax: 99, signed: true }),
    row({ group: "Effect LFO1", name: "Frequency", ofs: 3 }),
    row({ group: "Common LFO", name: "Waveform", ofs: 4, rawMax: 17 }),
    row({ group: "Common LFO", name: "Frequency", ofs: 5 }),
  ];
  const l = findLfos(rows);
  assert.deepEqual(l.map((x) => x.group), ["OSC1 LFO1", "Common LFO"]);
  assert.equal(l[0].fields.waveform.name, "Waveform");
  assert.equal(l[0].fields.shape?.name, "Shape");
  assert.equal(l[1].fields.shape, null);
});

test("there are 18 LFO waveform names, and every wave draws in range", () => {
  assert.equal(LFO_WAVEFORMS.length, 18);
  for (let w = 0; w < 18; w++) {
    for (const shape of [-99, 0, 99]) {
      const p = lfoPoints(w, shape, 32);
      assert.equal(p.length, 32);
      assert.ok(p.every((y) => y >= -1 && y <= 1), `wave ${w} shape ${shape}`);
    }
    assert.deepEqual(lfoPoints(w, 10, 16), lfoPoints(w, 10, 16), "must be repeatable");
  }
  assert.notDeepEqual(lfoPoints(0, 0, 32), lfoPoints(5, 0, 32));
});

// Drum kit rows: one zone template at 24 (Sample On/Off, Sample Id, Level), repeated per note and zone.
const drumTemplate: Row[] = [
  row({ group: "", name: "Sample On/Off", ofs: 24, rawMax: 1 }),
  row({ group: "", name: "Sample Id", ofs: 42 }),
  row({ group: "", name: "Level", ofs: 44 }),
];
const drumTables = { drumkit: drumTemplate } as unknown as ParamTables;
const drumEntry = new Uint8Array(24 + 300 * 128);
// Note 2 (index 1), zone 3: on, sample 7, level 50. Everything else stays 0.
const z3 = 24 + 300 * 1 + 34 * 2;
drumEntry[z3] = 1;
drumEntry[z3 + 18] = 7;
drumEntry[z3 + 20] = 50;

test("drumMap reads 128 notes with 8 zones each", () => {
  const m = drumMap(drumTables, drumEntry);
  assert.equal(m.length, 128);
  assert.equal(m[1].zones.length, 8);
  assert.deepEqual(m[1].zones[2], { zone: 3, on: true, sampleId: 7, level: 50 });
  assert.equal(m[0].zones[0].on, false);
});

// Wave sequence rows: Common at 0..39, one step template at 40 (Step Type 40, Level 60, Duration 67, Crossfade 71).
const waveTemplate: Row[] = [
  row({ group: "Common", name: "End Step", ofs: 26, rawMax: 63 }),
  row({ group: "Common", name: "Start Step", ofs: 27, rawMax: 63 }),
  row({ group: "Common", name: "Loop Start", ofs: 36, rawMax: 63 }),
  row({ group: "Common", name: "Loop End", ofs: 37, rawMax: 63 }),
  row({ group: "", name: "Step Type", ofs: 40, rawMax: 2 }),
  row({ group: "", name: "Level", ofs: 60 }),
  row({ group: "", name: "Duration", ofs: 67, rawMax: 146 }),
  row({ group: "", name: "Crossfade", ofs: 71, rawMax: 145 }),
];
const waveTables = { waveseq: waveTemplate } as unknown as ParamTables;
const waveEntry = new Uint8Array(40 + 34 * 64);
waveEntry[26] = 2; // end step index 2
waveEntry[27] = 62; // start step index 62, so the shown steps wrap past 63
waveEntry[40 + 34 * 1 + 27] = 30; // Step 2 duration

test("waveSeqTimeline reads 64 steps and the range", () => {
  const t = waveSeqTimeline(waveTables, waveEntry);
  assert.equal(t.steps.length, 64);
  assert.equal(t.startStep, 62);
  assert.equal(t.endStep, 2);
  assert.equal(t.steps[1].duration, 30);
  assert.equal(t.steps[1].durationRow.name, "Duration");
});

test("waveShown wraps from the start step to the end step", () => {
  assert.deepEqual(waveShown(waveSeqTimeline(waveTables, waveEntry)), [62, 63, 0, 1, 2]);
});
