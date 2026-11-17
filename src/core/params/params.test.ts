import { test } from "node:test";
import assert from "node:assert/strict";
import { exiEngines, formatValue, isEditable, paramsFor, readParam, writeParam, type ParamTables, type Row } from "./params.ts";

const base: Row = { ofs: 0, bitHi: null, bitLo: null, group: "G", name: "F", rawMin: 0, rawMax: 255, fixed: false, valueText: "~", signed: false, continuation: false, parts: [[0, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null };
const row = (p: Partial<Row>): Row => ({ ...base, ...p });

test("a field is its parts, least significant first, across bytes", () => {
  // 10-bit value: all of byte 2 (low 8 bits) and bits 1~0 of byte 3
  const cutoff = row({ name: "Cutoff", rawMin: 0, rawMax: 1000, parts: [[2, 7, 0], [3, 1, 0]] });
  const e = Uint8Array.of(0, 0, 0x9c, 0x02);
  assert.equal(readParam(e, cutoff), 0x29c);
  writeParam(e, cutoff, 1000);
  assert.deepEqual(Array.from(e.subarray(2)), [0xe8, 0x03]);
  assert.throws(() => writeParam(e, cutoff, 1001), RangeError);
});

test("writing a split field leaves the neighbouring setting's bits alone", () => {
  // Cutoff owns byte 3 bits 1~0; Resonance owns byte 3 bits 7~2 in the same byte
  const cutoff = row({ name: "Cutoff", rawMin: 0, rawMax: 1000, parts: [[2, 7, 0], [3, 1, 0]] });
  const reso = row({ name: "Resonance", rawMin: 0, rawMax: 63, parts: [[3, 7, 2]] });
  const e = Uint8Array.of(0, 0, 0x00, 0b1010_1101);
  writeParam(e, reso, 0b010101);
  assert.equal(readParam(e, reso), 0b010101);
  assert.equal(e[3] & 0b11, 0b01, "cutoff's bits were rewritten by the resonance edit");
  writeParam(e, cutoff, 3);
  assert.equal(readParam(e, reso), 0b010101, "resonance was rewritten by the cutoff edit");
  assert.equal(e[3] >> 2, 0b010101);
  assert.equal(e[3] & 0b11, 0, "cutoff's high bits should be 0 for the value 3");
});

test("bit fields keep every bit outside their own range", () => {
  const sw = row({ ofs: 2, bitHi: 6, bitLo: 6, rawMax: 1, valueText: "Off~On", parts: [[2, 6, 6]] });
  const ch = row({ ofs: 2, bitHi: 5, bitLo: 0, rawMax: 63, parts: [[2, 5, 0]] });
  const e = Uint8Array.of(0, 0, 0b0101_0011);
  assert.equal(readParam(e, sw), 1);
  assert.equal(readParam(e, ch), 0b010011);
  writeParam(e, sw, 0);
  assert.equal(e[2], 0b0001_0011);
  assert.equal(readParam(e, ch), 0b010011);
});

test("a signed field sign-extends from its total width", () => {
  // -99..+99 fits in 8 bits even when a blank byte follows it
  const r = row({ ofs: 1, rawMin: -99, rawMax: 99, signed: true, parts: [[1, 7, 0]] });
  const e = Uint8Array.of(0, 0x9d);
  assert.equal(readParam(e, r), -99);
  writeParam(e, r, 99);
  assert.equal(e[1], 0x63);
  writeParam(e, r, -1);
  assert.equal(e[1], 0xff);
});

test("a signed split field of 10 bits reads negative values", () => {
  // -301..300 in 10 bits: byte 0 whole plus byte 1 bits 1~0
  const r = row({ rawMin: -301, rawMax: 300, signed: true, parts: [[0, 7, 0], [1, 1, 0]] });
  const e = Uint8Array.of(0xd3, 0x02);
  assert.equal(readParam(e, r), -301);
  writeParam(e, r, 0);
  assert.deepEqual(Array.from(e), [0x00, 0x00]);
});

test("a 32-bit signed field spans four bytes, least significant first", () => {
  const seed = row({ rawMin: -2147483648, rawMax: 2147483647, signed: true, parts: [[0, 7, 0], [1, 7, 0], [2, 7, 0], [3, 7, 0]] });
  const e = new Uint8Array(4);
  writeParam(e, seed, -2);
  assert.deepEqual(Array.from(e), [0xfe, 0xff, 0xff, 0xff]);
  assert.equal(readParam(e, seed), -2);
});

test("a continuation row is never editable and owns no bits", () => {
  assert.equal(isEditable(row({ continuation: true, name: "", parts: [] })), false);
  assert.equal(isEditable(row({ name: "Panpot" })), true);
  assert.equal(isEditable(row({ name: "Name" })), false);
  assert.equal(isEditable(row({ fixed: true, rawMin: 16, rawMax: 16 })), false);
  assert.equal(isEditable(row({ name: "[PCM] High MS Bank UUID", rawMax: 255 })), false);
});

test("writing a value out of range throws and changes nothing", () => {
  const e = new Uint8Array(4);
  const r = row({ ofs: 1, rawMin: 0, rawMax: 1, parts: [[1, 0, 0]] });
  assert.throws(() => writeParam(e, r, 2), RangeError);
  assert.throws(() => writeParam(e, r, 0.5), RangeError);
  assert.deepEqual(Array.from(e), [0, 0, 0, 0]);
});

test("values are shown the way the value column writes them", () => {
  const pan = row({ rawMin: 0, rawMax: 127, valueText: "L000~R127" });
  assert.equal(formatValue(pan, 0), "L000");
  assert.equal(formatValue(pan, 127), "R127");
  const sw = row({ rawMin: 0, rawMax: 1, valueText: "Off~On" });
  assert.equal(formatValue(sw, 0), "Off");
  assert.equal(formatValue(sw, 1), "On");
  const shape = row({ rawMin: -99, rawMax: 99, valueText: "-99~+99" });
  assert.equal(formatValue(shape, 0), "0");
  assert.equal(formatValue(shape, 99), "+99");
});

test("words name only the two ends of a wide range", () => {
  const fx = row({ rawMin: 0, rawMax: 185, valueText: "No Effect~Multitap" });
  assert.equal(formatValue(fx, 0), "No Effect");
  assert.equal(formatValue(fx, 185), "Multitap");
  assert.equal(formatValue(fx, 50), "50");
  assert.equal(formatValue(fx, 191), "191");
});

test("an EXi program names its engines and gets their rows at their own base", () => {
  const algo = (group: string) => {
    const ofs = group === "EXi1 Common" ? 2857 : 3909;
    return row({ ofs, group, name: "Algorithm Type", rawMax: 9, valueText: "Off~EP-1", parts: [[ofs, 7, 0]] });
  };
  const tables = {
    programHd1: [],
    programExiCommon: [algo("EXi1 Common"), algo("EXi2 Common")],
    combi: [],
    global: [],
    drumkit: [],
    waveseq: [],
    engines: {
      "AL-1": [],
      "CX-3": [row({ ofs: 3, name: "Delay", parts: [[3, 7, 0], [4, 1, 0]] })],
      "STR-1": [],
      "MS-20EX": [],
      PolysixEX: [],
      "MOD-7": [],
      "SGX-2": [],
      "EP-1": [],
    },
  } as unknown as ParamTables;
  const e = new Uint8Array(4960);
  e[2857] = 3; // CX-3
  e[3909] = 0; // Off
  assert.deepEqual(exiEngines(tables, e), ["CX-3", "Off"]);
  const rows = paramsFor(tables, "exi", e);
  const engineRow = rows.find((r) => r.name === "Delay");
  assert.ok(engineRow);
  assert.equal(engineRow.ofs, 2908 + 3);
  assert.deepEqual(engineRow.parts, [[2908 + 3, 7, 0], [2908 + 4, 1, 0]]);
  assert.equal(engineRow.group, "EXi1 CX-3: G");
  assert.equal(paramsFor(tables, "hd1", e).length, 0);
});

// Synthetic tables only: enough to check how the drum kit and wave sequence repeats are laid out.
const tablesWith = (o: Partial<ParamTables>): ParamTables =>
  ({ effectTypes: [], programHd1: [], programExiCommon: [], combi: [], global: [], drumkit: [], waveseq: [], engines: {}, ...o }) as unknown as ParamTables;

test("Effect Type and Algorithm Type are read-only; other rows are not", () => {
  assert.equal(isEditable(row({ name: "Effect Type" })), false);
  assert.equal(isEditable(row({ name: "Algorithm Type" })), false);
  assert.equal(isEditable(row({ name: "Panpot" })), true);
});

test("a drum kit's repeats are expanded from one note and one zone template", () => {
  const names = Array.from({ length: 24 }, (_, i) => row({ ofs: i, name: "Name", group: "Common", parts: [[i, 7, 0]] }));
  const T = tablesWith({
    drumkit: [
      ...names,
      row({ ofs: 24, name: "Sample On/Off", group: "Note1 Zone1 DS", parts: [[24, 7, 0]] }),
      row({ ofs: 56, name: "Low Boost", group: "Note1 Zone1 DS", parts: [[56, 7, 0]] }),
      row({ ofs: 58, name: "Sample On/Off", group: "Note1 Zone2 DS", parts: [[58, 7, 0]] }), // zone 2 sample: dropped
      row({ ofs: 296, name: "Bottom Velocity", group: "Note1 Zone1 - 2", parts: [[296, 7, 0]] }),
      row({ ofs: 297, name: "Velocity XFade Range", group: "Velocity Control", parts: [[297, 7, 0]] }),
      row({ ofs: 298, name: "Velocity XFade Shape", group: "", bitHi: 1, bitLo: 0, rawMax: 2, parts: [[298, 1, 0]] }),
      row({ ofs: 317, name: "Pan", group: "Note1 Common", parts: [[317, 7, 0]] }),
      row({ ofs: 322, name: "Assign", group: "Note1 Common", bitHi: 0, bitLo: 0, rawMax: 1, parts: [[322, 0, 0]] }),
    ],
  });
  const rows = paramsFor(T, "drumkit", new Uint8Array(0));
  assert.equal(rows.length, 24 + 128 * (8 * 2 + 3 + 2));
  assert.equal(rows.find((r) => r.group === "Note128 Zone8" && r.name === "Low Boost")?.ofs, 24 + 300 * 127 + 34 * 7 + 32);
  assert.equal(rows.some((r) => r.group === "Note1 Zone2 DS"), false);
  assert.equal(rows.find((r) => r.group === "Note2 Velocity" && r.name === "Bottom Velocity")?.ofs, 24 + 300 + 272);
  assert.equal(rows.find((r) => r.group === "Note128 Common" && r.name === "Assign")?.parts[0][0], 24 + 300 * 127 + 298);
});

test("a wave sequence's steps are expanded from one step template", () => {
  const T = tablesWith({
    waveseq: [
      row({ ofs: 0, name: "Name", group: "Common", parts: [[0, 7, 0]] }),
      row({ ofs: 26, name: "End Step", group: "Common", parts: [[26, 7, 0]] }),
      row({ ofs: 40, name: "Step Type", group: "Step1", rawMax: 2, parts: [[40, 1, 0]] }),
      row({ ofs: 73, name: "Fade-Out Shape", group: "Step1", rawMin: -128, rawMax: 127, signed: true, parts: [[73, 7, 0]] }),
      row({ ofs: 74, name: "Step Type", group: "Step2", rawMax: 2, parts: [[74, 1, 0]] }), // the table's Step2 sample: dropped
    ],
  });
  const rows = paramsFor(T, "waveseq", new Uint8Array(0));
  assert.equal(rows.length, 2 + 64 * 2);
  assert.equal(rows.find((r) => r.group === "Step37" && r.name === "Fade-Out Shape")?.ofs, 40 + 34 * 36 + 33);
  assert.equal(rows.filter((r) => r.group === "Step2").length, 2);
});
