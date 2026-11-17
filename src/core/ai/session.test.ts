import { test } from "node:test";
import assert from "node:assert/strict";
import { getEntry, setEntry } from "../pcg/library.ts";
import { parsePcg, serializePcg, verifyChecksums, type PcgFile } from "../pcg/pcg.ts";
import { bank, container, entry, file, raw } from "../pcg/synthetic.ts";
import { readParam, type ParamTables, type Row } from "../params/params.ts";
import { bankKeyOf, bankNumberOf, runTool, SessionError, SoundSession, toolDefinitions } from "./session.ts";
import { HOLD_MESSAGE, RUN_MESSAGE, Workspace } from "../../app/renderer/document.ts";

// Synthetic data only: small banks built in code, with made-up field positions.
const EXI = 4960;
const COMBI = 7810;

const row = (p: Partial<Row>): Row => ({ ofs: 0, bitHi: null, bitLo: null, group: "", name: "", rawMin: 0, rawMax: 127, fixed: false, valueText: "", signed: false, continuation: false, parts: [[0, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...p });

// Engine block for AL-1 (its rows are offset by the engine base inside params.ts)
const AL1: Row[] = [
  row({ group: "Amp", name: "Attack", rawMax: 99, ofs: 0, parts: [[0, 7, 0]] }),
  row({ group: "Amp", name: "Level", rawMax: 99, ofs: 1, parts: [[1, 7, 0]] }),
  row({ group: "Amp", name: "Locked", fixed: true, ofs: 2, parts: [[2, 7, 0]] }),
];

const timbreRows = (t: number): Row[] => {
  const b = 4802 + 188 * (t - 1);
  const g = `Timbre${t}`;
  return [
    row({ group: g, name: "Program Number", ofs: b, parts: [[b, 7, 0]], rawMax: 127 }),
    row({ group: g, name: "Bank Number", ofs: b + 1, parts: [[b + 1, 7, 0]], rawMax: 30 }),
    row({ group: g, name: "Status", ofs: b + 2, parts: [[b + 2, 2, 0]], rawMax: 4 }),
    row({ group: g, name: "MIDI Channel", ofs: b + 2, bitHi: 7, bitLo: 3, parts: [[b + 2, 7, 3]], rawMax: 16 }),
    row({ group: g, name: "Key Window Bottom", ofs: b + 3, parts: [[b + 3, 7, 0]] }),
    row({ group: g, name: "Key Window Top", ofs: b + 4, parts: [[b + 4, 7, 0]] }),
    row({ group: g, name: "Vel.Window Low", ofs: b + 5, parts: [[b + 5, 7, 0]], rawMin: 1 }),
    row({ group: g, name: "Vel.Window High", ofs: b + 6, parts: [[b + 6, 7, 0]], rawMin: 1 }),
    row({ group: g, name: "Transpose", ofs: b + 7, parts: [[b + 7, 7, 0]], rawMin: -60, rawMax: 60, signed: true }),
    row({ group: g, name: "Volume", ofs: b + 8, parts: [[b + 8, 7, 0]] }),
  ];
};

// KARMA and Drum Track rows at the real offsets (modules are 744 bytes apart): the smallest set configure_combi needs.
const GE_NAMES = ["Arp Model 01 Up/Dn", "Arp Model 02 Dn/Up", "Funk Slap", "Rock 8th", "Rock 16th"];
const GE_CATS = ["Arpeggio", "Arpeggio", "Bass Pattern", "Drum", "Drum"];
const karmaRows: Row[] = [
  row({ group: "KARMA Common", name: "Tempo", ofs: 1304, parts: [[1304, 7, 0], [1305, 7, 0]], rawMin: 4000, rawMax: 30000, valueText: "40.00~300.00" }),
  row({ group: "Drum Track Common", name: "Pattern Number", ofs: 1292, parts: [[1292, 7, 0], [1293, 7, 0]], rawMax: 999 }),
  row({ group: "Drum Track Common", name: "Pattern Bank", ofs: 1294, parts: [[1294, 7, 0]], rawMax: 1, valueText: "Preset~User" }),
  row({ group: "Drum Track Common", name: "Drum Track On", ofs: 1295, bitHi: 4, bitLo: 4, parts: [[1295, 4, 4]], rawMax: 1, valueText: "Off~On" }),
  row({ group: "Drum Track Common", name: "Trigger Key Zone Bottom", ofs: 1296, parts: [[1296, 7, 0]], valueText: "C-1~G9" }),
  row({ group: "Drum Track Common", name: "Trigger Key Zone Top", ofs: 1297, parts: [[1297, 7, 0]], valueText: "C-1~G9" }),
  row({ group: "Drum Track Common", name: "Output MIDI Channel", ofs: 1301, parts: [[1301, 7, 0]], rawMax: 16, valueText: "1~Global" }),
  ...["A", "B", "C", "D"].flatMap((m, i) => {
    const b = 1814 + 744 * i;
    const g = `KARMA Module ${m}`;
    return [
      row({ group: g, name: "GE Number", ofs: b, parts: [[b, 7, 0], [b + 1, 7, 0]], rawMax: 3583, valueText: "0000:Arp Model 01 U", list: "KARMA GE" }),
      row({ group: g, name: "Output MIDI Channel", ofs: b + 3, parts: [[b + 3, 7, 0]], rawMax: 16, valueText: "1~Global" }),
      row({ group: g, name: "Transpose", ofs: b + 4, parts: [[b + 4, 7, 0]], rawMin: -36, rawMax: 36, signed: true, valueText: "-36~+36" }),
      row({ group: g, name: "Key Zone Top", ofs: b + 5, parts: [[b + 5, 7, 0]], valueText: "C-1~G9" }),
      row({ group: g, name: "Key Zone Bottom", ofs: b + 6, parts: [[b + 6, 7, 0]], valueText: "C-1~G9" }),
    ];
  }),
];

const T = {
  effectTypes: [],
  valueLists: { "KARMA GE": GE_NAMES, "KARMA GE Category": GE_CATS },
  programHd1: [],
  programExiCommon: [
    row({ group: "EXi1 Common", name: "Algorithm Type", ofs: 40, parts: [[40, 7, 0]], rawMax: 9, fixed: false }),
    row({ group: "EXi2 Common", name: "Algorithm Type", ofs: 41, parts: [[41, 7, 0]], rawMax: 9 }),
    row({ group: "Common", name: "Volume", ofs: 50, parts: [[50, 7, 0]] }),
  ],
  combi: [...Array.from({ length: 16 }, (_, i) => timbreRows(i + 1)).flat(), ...karmaRows],
  global: [],
  drumkit: [],
  waveseq: [],
  engines: { "AL-1": AL1, "CX-3": [], "STR-1": [], "MS-20EX": [], PolysixEX: [], "MOD-7": [], "SGX-2": [], "EP-1": [] },
} as unknown as ParamTables;

// An EXi program: AL-1 on EXi1. Drum and other pointer bytes are set to a bank no pointer uses.
const exiProgram = (name: string, level = 50): Uint8Array => {
  const e = entry(name, EXI);
  e[2689] = 127;
  e[40] = 2;
  e[1 + 2908] = level;
  return e;
};

// A Combi with 16 timbres; every timbre's bank byte points at no Program unless set.
const combi = (name: string, timbres: Record<number, [number, number]> = {}): Uint8Array => {
  const e = entry(name, COMBI);
  for (let t = 0; t < 16; t++) e[4803 + 188 * t] = 127;
  for (const [t, [num, col]] of Object.entries(timbres)) {
    e[4802 + 188 * Number(t)] = num;
    e[4803 + 188 * Number(t)] = col;
  }
  return e;
};

const build = (): PcgFile =>
  parsePcg(
    file(
      container(
        "PCG1",
        raw("DIV1", new Uint8Array(44), 0x10000),
        container(
          "PRG1",
          // INT-A: 0 free (Init), 1 "Lead" (used by Combi 0), 2 "Pad" (named, unused), 3 free (blank name is also free)
          bank("MBK1", EXI, 0, [exiProgram("Init Program"), exiProgram("Lead", 40), exiProgram("Pad", 60), exiProgram("Init Keys")]),
          // U-A: an HD-1 program, unused, named Init
          bank("PBK1", EXI, 0x20000, [exiProgram("Init Brass")]),
        ),
        container("CMB1", bank("CBK1", COMBI, 0, [combi("Stack", { 0: [1, 0] }), combi("Init Combi"), combi("Init Combi 2")])),
      ),
    ),
  );

const fresh = (hide?: { key: string; index: number }[]) => {
  const f = build();
  return { f, s: new SoundSession(T, f, hide ? { hide } : {}) };
};

const sameFile = (a: PcgFile, b: PcgFile) => assert.equal(Buffer.from(serializePcg(a)).equals(Buffer.from(serializePcg(b))), true);

test("search finds sounds by name, kind and engine, and reports use", () => {
  const { s } = fresh();
  const lead = s.search({ text: "lead" });
  assert.deepEqual(lead.map((x) => [x.key, x.index, x.name]), [["program:INT-A", 1, "Lead"]]);
  assert.deepEqual(lead[0].engines, ["AL-1"]);
  assert.equal(lead[0].used, true);
  assert.equal(s.search({ text: "pad" })[0].used, false);
  assert.ok(s.search({ kind: "combi" }).every((x) => x.kind === "combi" && x.key === "combi:INT-A"));
  assert.equal(s.search({ engine: "AL-1" }).length, 4, "all four EXi programs in INT-A use AL-1");
  assert.equal(s.search({ type: "hd1" })[0].key, "program:U-A");
});

test("hidden sounds cannot be found, described, copied, or used in a Combi", () => {
  const { s } = fresh([{ key: "program:INT-A", index: 1 }]);
  assert.equal(s.search({ text: "lead" }).length, 0);
  assert.throws(() => s.describe("program:INT-A", 1), SessionError);
  assert.throws(() => s.copySound({ fromKey: "program:INT-A", fromIndex: 1, name: "Copy" }), SessionError);
  assert.throws(() => s.buildCombi({ name: "Cheat", parts: [{ key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 127 }] }), SessionError);
  assert.equal(s.freeSlots("program", "exi").some((x) => x.key === "program:INT-A" && x.index === 1), false);
});

test("describe lists groups, then the editable settings of one group", () => {
  const { s } = fresh();
  const d = s.describe("program:INT-A", 1);
  assert.deepEqual(d.groups, ["Common", "EXi1 AL-1: Amp"]);
  assert.equal("params" in d, false);
  const g = s.describe("program:INT-A", 1, "EXi1 AL-1: Amp") as { params: { id: string; name: string; value: number; min: number; max: number; text: string }[] };
  assert.deepEqual(g.params.map((p) => [p.name, p.value, p.min, p.max]), [["Attack", 0, 0, 99], ["Level", 40, 0, 99]]);
  assert.ok(g.params.every((p) => typeof p.text === "string"));
  assert.throws(() => s.describe("program:INT-A", 1, "Nope"), SessionError);
});

test("setting values changes only those bits, and undo restores the file byte for byte", () => {
  const { f, s } = fresh();
  const before = serializePcg(f).slice();
  const r = s.setParams("program:INT-A", 1, [{ id: "2908.0", value: 20 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(verifyChecksums(f), []);
  const after = s.describe("program:INT-A", 1, "EXi1 AL-1: Amp") as { params: { name: string; value: number }[] };
  assert.equal(after.params.find((p) => p.name === "Attack")?.value, 20);
  assert.equal(after.params.find((p) => p.name === "Level")?.value, 40, "a neighbouring setting changed");
  assert.deepEqual(s.touched(), [{ key: "program:INT-A", index: 1 }]);
  assert.equal(s.undoAll(), 1);
  assert.deepEqual(serializePcg(f), before);
  assert.deepEqual(s.touched(), []);
  assert.ok(s.log().some((x) => x.action === "set_params"));
});

test("one refused change rejects the whole call and writes nothing", () => {
  const bad = [
    [{ id: "2909.0", value: 500 }],          // out of range
    [{ id: "99999.0", value: 1 }],        // no such id
    [{ id: "2910.0", value: 1 }],            // fixed setting
    [{ id: "40.0", value: 3 }],           // Algorithm Type is read-only
    [{ id: "2908.0", value: 1.5 }],          // not an integer
  ];
  for (const extra of bad) {
    const { f, s } = fresh();
    const before = serializePcg(f).slice();
    const r = s.setParams("program:INT-A", 1, [{ id: "2908.0", value: 20 }, ...extra]);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.errors.length >= 1);
    sameFile(f, parsePcg(before));
    assert.deepEqual(s.touched(), []);
  }
});

test("free slots are unused Init or blank slots, and copies go only there", () => {
  const { f, s } = fresh();
  const free = s.freeSlots("program", "exi").map((x) => `${x.key}/${x.index}`);
  assert.deepEqual(free, ["program:INT-A/0", "program:INT-A/3"]);
  const copied = s.copySound({ fromKey: "program:INT-A", fromIndex: 1, name: "Lead Copy" });
  assert.deepEqual([copied.key, copied.index], ["program:INT-A", 0]);
  assert.equal(getEntry(f, "program:INT-A", 0)[0], "L".charCodeAt(0));
  assert.equal(getEntry(f, "program:INT-A", 1)[0], "L".charCodeAt(0), "the source was changed");
  assert.deepEqual(s.search({ text: "lead copy" }).map((x) => x.index), [0]);
  const second = s.copySound({ fromKey: "program:INT-A", fromIndex: 1, name: "Lead Two" });
  assert.equal(second.index, 3);
  assert.throws(() => s.copySound({ fromKey: "program:INT-A", fromIndex: 1, name: "No Room" }), /free/i);
  assert.throws(() => s.copySound({ fromKey: "program:INT-A", fromIndex: 1, name: "Bad\u0001" }), SessionError);
});

test("buildCombi fills timbres in order, switches the rest off, and refuses bad parts without writing", () => {
  const { f, s } = fresh();
  const before = serializePcg(f).slice();
  for (const parts of [
    [],
    [{ key: "program:INT-A", index: 1, keyBottom: 70, keyTop: 60 }],
    [{ key: "program:INT-A", index: 200, keyBottom: 0, keyTop: 60 }],
    [{ key: "program:NOPE", index: 1, keyBottom: 0, keyTop: 60 }],
    [{ key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 60, velLow: 0 }],
    Array.from({ length: 17 }, () => ({ key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 60 })),
  ]) {
    assert.throws(() => s.buildCombi({ name: "Bad", parts }), SessionError);
  }
  sameFile(f, parsePcg(before));
  assert.deepEqual(s.touched(), []);

  const got = s.buildCombi({
    name: "Left And Right",
    parts: [
      { key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 59, transpose: -12 },
      { key: "program:U-A", index: 0, keyBottom: 60, keyTop: 127, velLow: 40, velHigh: 127, volume: 100, channel: 2 },
    ],
  });
  assert.deepEqual([got.key, got.index], ["combi:INT-A", 1]);
  const t1 = s.describe("combi:INT-A", 1, "Timbre1") as { params: { name: string; value: number }[] };
  const val = (p: { params: { name: string; value: number }[] }, n: string) => p.params.find((x) => x.name === n)?.value;
  assert.equal(val(t1, "Program Number"), 1);
  assert.equal(val(t1, "Bank Number"), 0);
  assert.equal(val(t1, "Status"), 1);
  assert.equal(val(t1, "MIDI Channel"), 16, "a part hears the keyboard");
  assert.equal(val(t1, "Transpose"), -12);
  const t2 = s.describe("combi:INT-A", 1, "Timbre2") as { params: { name: string; value: number }[] };
  assert.equal(val(t2, "Bank Number"), 17);
  assert.equal(val(t2, "Vel.Window Low"), 40);
  assert.equal(val(t2, "Vel.Window High"), 127);
  assert.equal(val(t2, "Volume"), 100);
  assert.equal(val(t2, "MIDI Channel"), 2);
  assert.throws(() => s.buildCombi({ name: "Bad", parts: [{ key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 59, channel: 17 }] }), /channel/);
  const t3 = s.describe("combi:INT-A", 1, "Timbre3") as { params: { name: string; value: number }[] };
  assert.equal(val(t3, "Status"), 0);
  assert.deepEqual(verifyChecksums(f), []);
  assert.equal(getEntry(f, "combi:INT-A", 1)[0], "L".charCodeAt(0));
});

test("buildCombi takes trackSounds, echoes them, and writes none of them into the Combi", () => {
  const { s } = fresh();
  const tracks = [{ track: 5, key: "program:U-A", index: 0 }];
  const got = s.buildCombi({ name: "Tracks", parts: [{ key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 127 }], trackSounds: tracks });
  assert.deepEqual(got.trackSounds, tracks);
  const val = (p: { params: { name: string; value: number }[] }, n: string) => p.params.find((x) => x.name === n)?.value;
  assert.equal(val(s.describe(got.key, got.index, "Timbre1") as { params: { name: string; value: number }[] }, "MIDI Channel"), 16);
  assert.equal(val(s.describe(got.key, got.index, "Timbre2") as { params: { name: string; value: number }[] }, "Status"), 0);
  for (const bad of [
    [{ track: 0, key: "program:U-A", index: 0 }],
    [{ track: 17, key: "program:U-A", index: 0 }],
    [{ track: 5, key: "program:U-A", index: 0 }, { track: 5, key: "program:INT-A", index: 1 }],
    [{ track: 5, key: "program:NOPE", index: 0 }],
    [{ track: 5, key: "combi:INT-A", index: 1 }],
    [{ track: 5, key: "program:U-A", index: 200 }],
  ]) {
    assert.throws(() => s.buildCombi({ name: "Bad", parts: [{ key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 127 }], trackSounds: bad }), SessionError);
  }
});

test("assign_tracks returns the track sounds and writes nothing to the library", () => {
  const { f, s } = fresh();
  const before = Buffer.from(serializePcg(f));
  const tracks = [{ track: 5, key: "program:U-A", index: 0 }, { track: 1, key: "program:INT-A", index: 1 }];
  assert.deepEqual(runTool(s, "assign_tracks", { trackSounds: tracks }), { ok: true, trackSounds: tracks });
  assert.equal(Buffer.from(serializePcg(f)).equals(before), true);
  assert.deepEqual(s.touched(), []);
});

test("assign_tracks refuses what build_combi refuses, and more than 16 items", () => {
  const { s } = fresh();
  const bad = [
    [],
    [{ track: 0, key: "program:U-A", index: 0 }],
    [{ track: 17, key: "program:U-A", index: 0 }],
    [{ track: 5, key: "program:U-A", index: 0 }, { track: 5, key: "program:INT-A", index: 1 }],
    [{ track: 5, key: "program:NOPE", index: 0 }],
    [{ track: 5, key: "combi:INT-A", index: 1 }],
    [{ track: 5, key: "program:U-A", index: 200 }],
    Array.from({ length: 17 }, (_, n) => ({ track: (n % 16) + 1, key: "program:U-A", index: 0 })),
  ];
  for (const trackSounds of bad) assert.equal(runTool(s, "assign_tracks", { trackSounds }).ok, false, JSON.stringify(trackSounds).slice(0, 80));
});

test("runTool never throws, and covers every action", () => {
  const { s } = fresh();
  assert.deepEqual(toolDefinitions().map((d) => d.name).sort(), ["assign_tracks", "build_combi", "configure_combi", "copy_sound", "describe_sound", "free_slots", "list_effect_types", "list_multisamples", "search_ge", "search_sounds", "set_params"]);
  for (const d of toolDefinitions()) assert.ok(d.description.length > 40 && d.input_schema.type === "object", d.name);
  assert.equal(runTool(s, "search_sounds", { text: "lead" }).ok, true);
  assert.equal(runTool(s, "no_such_tool", {}).ok, false);
  assert.equal(runTool(s, "search_sounds", null).ok, true, "null input is treated as no filters");
  assert.equal(runTool(s, "describe_sound", { key: "nope", index: 0 }).ok, false);
  assert.equal(runTool(s, "set_params", { key: "program:INT-A", index: 1, changes: [{ id: "99999.0", value: 1 }] }).ok, false);
  assert.equal(runTool(s, "build_combi", { name: "x", parts: "nope" }).ok, false);
  assert.equal(runTool(s, "copy_sound", undefined).ok, false);
});

test("describe_sound reads several groups in one call, each labelled, and the single-group form still works", () => {
  const { s } = fresh();
  const r = runTool(s, "describe_sound", { key: "program:INT-A", index: 1, groups: ["Common", "EXi1 AL-1: Amp"] });
  assert.equal(r.ok, true);
  const sound = r.sound as { reads: { group: string; params: { name: string }[] }[] };
  assert.deepEqual(sound.reads.map((x) => x.group), ["Common", "EXi1 AL-1: Amp"]);
  assert.deepEqual(sound.reads[1].params.map((p) => p.name), ["Attack", "Level"]);
  const one = runTool(s, "describe_sound", { key: "program:INT-A", index: 1, group: "EXi1 AL-1: Amp" });
  assert.equal((one.sound as { params: unknown[] }).params.length, 2);
  assert.equal("reads" in (one.sound as object), false);
});

test("describe_sound refuses more than 8 groups, an unknown group, or both forms, with a clear error", () => {
  const { s } = fresh();
  const nine = runTool(s, "describe_sound", { key: "program:INT-A", index: 1, groups: Array(9).fill("Common") });
  assert.equal(nine.ok, false);
  assert.match(String(nine.error), /groups must be 1 to 8 group names, got 9/);
  const bad = runTool(s, "describe_sound", { key: "program:INT-A", index: 1, groups: ["Common", "Nope"] });
  assert.equal(bad.ok, false);
  assert.match(String(bad.error), /no group "Nope"/);
  const both = runTool(s, "describe_sound", { key: "program:INT-A", index: 1, group: "Common", groups: ["Common"] });
  assert.equal(both.ok, false);
  assert.match(String(both.error), /group or groups, not both/);
});

test("configure_combi writes and reads back tempo, Drum Track and KARMA modules", () => {
  const { f, s } = fresh();
  const r = s.configureCombi({
    key: "combi:INT-A", index: 1, tempo: 123,
    drumTrack: { on: true, pattern: 42, bank: "user", channel: 9, keyBottom: 36, keyTop: 48 },
    karma: { modules: [{ module: "B", ge: 3, channel: 2, keyBottom: 60, keyTop: 84, transpose: -12 }, { module: "A", ge: 2 }] },
  });
  const e = getEntry(f, "combi:INT-A", 1);
  const get = (g: string, n: string) => readParam(e, T.combi.find((q) => q.group === g && q.name === n)!);
  assert.equal(get("KARMA Common", "Tempo"), 12300);
  assert.equal(get("Drum Track Common", "Drum Track On"), 1);
  assert.equal(get("Drum Track Common", "Pattern Number"), 42);
  assert.equal(get("Drum Track Common", "Pattern Bank"), 1);
  assert.equal(get("Drum Track Common", "Output MIDI Channel"), 9);
  assert.equal(get("Drum Track Common", "Trigger Key Zone Bottom"), 36);
  assert.equal(get("Drum Track Common", "Trigger Key Zone Top"), 48);
  assert.equal(get("KARMA Module B", "GE Number"), 3);
  assert.equal(get("KARMA Module B", "Output MIDI Channel"), 2);
  assert.equal(get("KARMA Module B", "Key Zone Bottom"), 60);
  assert.equal(get("KARMA Module B", "Key Zone Top"), 84);
  assert.equal(get("KARMA Module B", "Transpose"), -12);
  assert.equal(get("KARMA Module A", "GE Number"), 2);
  const text = (n: string) => r.written.find((w) => w.name.endsWith(n))?.text;
  assert.equal(text("Tempo"), "123.00");
  assert.equal(text("Drum Track On"), "On");
  assert.equal(r.written.find((w) => w.name === "KARMA Module B / GE Number")?.text, "Rock 8th");
  assert.equal(r.written.find((w) => w.name === "KARMA Module B / Key Zone Bottom")?.text, "C4");
  assert.deepEqual(s.touched(), [{ key: "combi:INT-A", index: 1 }]);
});

test("configure_combi touches only the named Combi and undo restores it byte for byte", () => {
  const { f, s } = fresh();
  const snap = (slot: number) => getEntry(f, "combi:INT-A", slot).slice();
  const others = [snap(0), snap(2)];
  const progs = [0, 1, 2, 3].map((i) => getEntry(f, "program:INT-A", i).slice());
  const before = snap(1);
  s.configureCombi({ key: "combi:INT-A", index: 1, tempo: 90, drumTrack: { on: true }, karma: { modules: [{ module: "C", ge: 4 }] } });
  assert.notDeepEqual(snap(1), before);
  assert.deepEqual([snap(0), snap(2)], others);
  assert.deepEqual([0, 1, 2, 3].map((i) => getEntry(f, "program:INT-A", i)), progs);
  assert.equal(s.undoAll(), 1);
  assert.deepEqual(snap(1), before);
});

test("configure_combi refuses a non-Combi, a hidden slot, bad values and unknown fields, writing nothing", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ key: "program:INT-A", index: 1, tempo: 100 }, /not a Combi/i],
    [{ key: "combi:INT-A", index: 9, tempo: 100 }, /no sound/],
    [{ key: "combi:INT-A", index: 1, tempo: 39 }, /tempo/],
    [{ key: "combi:INT-A", index: 1, tempo: 241 }, /tempo/],
    [{ key: "combi:INT-A", index: 1, volume: 5 }, /unknown field.*volume/],
    [{ key: "combi:INT-A", index: 1, drumTrack: { on: true, swing: 1 } }, /unknown field.*swing/],
    [{ key: "combi:INT-A", index: 1, drumTrack: {} }, /on/],
    [{ key: "combi:INT-A", index: 1, drumTrack: { on: true, pattern: 1000 } }, /pattern/],
    [{ key: "combi:INT-A", index: 1, karma: { modules: [{ module: "E", ge: 1 }] } }, /module/],
    [{ key: "combi:INT-A", index: 1, karma: { modules: [{ module: "A", on: false }] } }, /unknown field.*on/],
    [{ key: "combi:INT-A", index: 1, karma: { modules: [{ module: "A", ge: 5 }] } }, /ge/],
    [{ key: "combi:INT-A", index: 1, karma: { modules: [{ module: "A", keyBottom: 70, keyTop: 60 }] } }, /key/],
    [{ key: "combi:INT-A", index: 1, karma: { modules: [{ module: "A", ge: 1 }, { module: "A", ge: 2 }] } }, /twice/],
    [{ key: "combi:INT-A", index: 1 }, /nothing/i],
    [{ key: "combi:INT-A", index: 2, tempo: 100 }, /no sound/],
  ];
  for (const [input, re] of cases) {
    const { f, s } = fresh([{ key: "combi:INT-A", index: 2 }]);
    const before = serializePcg(f).slice();
    const r = runTool(s, "configure_combi", input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.match(String(r.error), re, JSON.stringify(input));
    sameFile(f, parsePcg(before));
    assert.deepEqual(s.touched(), []);
  }
});

test("search_ge finds Generated Effect names with their numbers and respects limit", () => {
  const { s } = fresh();
  assert.deepEqual(s.searchGe("rock"), [{ number: 3, name: "Rock 8th", category: "Drum" }, { number: 4, name: "Rock 16th", category: "Drum" }]);
  assert.deepEqual(s.searchGe("DRUM ROCK", 1), [{ number: 3, name: "Rock 8th", category: "Drum" }]);
  assert.deepEqual(s.searchGe("bass funk").map((x) => x.number), [2], "the category is searched too");
  assert.deepEqual(s.searchGe("arp model 02").map((x) => x.number), [1]);
  assert.deepEqual(s.searchGe("nothing here"), []);
  assert.equal(runTool(s, "search_ge", { query: "arp", limit: 1 }).ok, true);
  assert.equal(runTool(s, "search_ge", { query: "" }).ok, false);
  assert.equal(runTool(s, "search_ge", { query: "arp", limit: 31 }).ok, false);
});

test("with onlySlot, set_params on another slot is refused with the bytes unchanged; the target works and undoes", () => {
  const f = build();
  const s = new SoundSession(T, f, { onlySlot: { key: "program:INT-A", index: 1 } });
  const before = serializePcg(f);
  const bad = runTool(s, "set_params", { key: "program:INT-A", index: 2, changes: [{ id: "2908.0", value: 20 }] });
  assert.equal(bad.ok, false);
  assert.match(String(bad.error), /Refine may change only program:INT-A 1/);
  assert.equal(Buffer.from(serializePcg(f)).equals(Buffer.from(before)), true);
  assert.equal(runTool(s, "set_params", { key: "program:INT-A", index: 1, changes: [{ id: "2908.0", value: 20 }] }).ok, true);
  assert.equal(s.undoAll(), 1);
  assert.equal(Buffer.from(serializePcg(f)).equals(Buffer.from(before)), true);
});

test("the refine tool list has read and set tools only, and a refine session refuses the others", () => {
  const names = toolDefinitions("refine").map((d) => d.name);
  assert.ok(["describe_sound", "set_params", "list_effect_types"].every((n) => names.includes(n)));
  assert.ok(["copy_sound", "build_combi", "assign_tracks", "configure_combi", "search_ge"].every((n) => !names.includes(n)));
  const s = new SoundSession(T, build(), { onlySlot: { key: "program:INT-A", index: 1 } });
  assert.equal(runTool(s, "copy_sound", { fromKey: "program:INT-A", fromIndex: 1, name: "X" }).ok, false);
});

test("show_param returns names and values for valid ids and writes nothing", () => {
  const f = build();
  const s = new SoundSession(T, f);
  const before = serializePcg(f);
  const r = runTool(s, "show_param", { key: "program:INT-A", index: 1, ids: [{ id: "2908.0", note: "Raise this" }] }) as { ok: boolean; shown: { id: string; name: string; group: string; value: number; text: string; note: string }[] };
  assert.equal(r.ok, true);
  assert.equal(r.shown.length, 1);
  assert.equal(r.shown[0].id, "2908.0");
  assert.equal(r.shown[0].note, "Raise this");
  assert.equal(typeof r.shown[0].name, "string");
  assert.equal(typeof r.shown[0].value, "number");
  assert.equal(typeof r.shown[0].text, "string");
  assert.equal(s.touched().length, 0);
  sameFile(f, parsePcg(before));
});

test("show_param rejects an unknown id, more than 4 ids, no ids and a bad slot", () => {
  const s = new SoundSession(T, build());
  const ok = { id: "2908.0", note: "n" };
  assert.match(String(runTool(s, "show_param", { key: "program:INT-A", index: 1, ids: [{ id: "99999.0", note: "n" }] }).error), /99999\.0/);
  assert.equal(runTool(s, "show_param", { key: "program:INT-A", index: 1, ids: [ok, ok, ok, ok, ok] }).ok, false);
  assert.equal(runTool(s, "show_param", { key: "program:INT-A", index: 1, ids: [] }).ok, false);
  assert.equal(runTool(s, "show_param", { key: "program:INT-A", index: 999, ids: [ok] }).ok, false);
});

test("ask mode offers the read tools, search, lookup_param_help, show_param and propose_layer, and refuses every write tool", () => {
  assert.deepEqual(toolDefinitions("ask").map((d) => d.name).sort(), ["describe_sound", "list_effect_types", "lookup_param_help", "propose_layer", "search_sounds", "show_param"]);
  assert.equal(toolDefinitions("build").some((d) => d.name === "propose_layer"), false);
  assert.equal(toolDefinitions("refine").some((d) => d.name === "show_param"), false);
  const f = build();
  const s = new SoundSession(T, f, { ask: true });
  const before = serializePcg(f);
  for (const n of ["set_params", "copy_sound", "build_combi", "assign_tracks", "configure_combi", "search_ge"]) {
    const r = runTool(s, n, { key: "program:INT-A", index: 1, changes: [{ id: "2908.0", value: 20 }] });
    assert.equal(r.ok, false, n);
    assert.match(String(r.error), /Ask may not use/);
  }
  assert.equal(runTool(s, "show_param", { key: "program:INT-A", index: 1, ids: [{ id: "2908.0", note: "n" }] }).ok, true);
  sameFile(f, parsePcg(before));
});

// The AI review lock: slots the run touched refuse edits, every other slot stays editable and survives Keep and Discard.
const A = { key: "program:INT-A", index: 1 };
const B = { key: "program:INT-A", index: 2 };
const C = { key: "program:INT-A", index: 0 };
const level = (w: Workspace, s: { key: string; index: number }): number => getEntry(w.file, s.key, s.index)[2908];
const setLevel = (w: Workspace, s: { key: string; index: number }, v: number) => w.apply([s], () => { const e = getEntry(w.file, s.key, s.index); e[2908] = v; setEntry(w.file, s.key, s.index, e); }, `Level ${s.index}`);
// A run: snapshot, a session writing into the live file, then the review hold on everything it touched.
const aiRun = (w: Workspace, writes: [{ key: string; index: number }, number][]) => {
  const snapshot = w.clone();
  const session = new SoundSession(T, w.file);
  for (const [s, v] of writes) assert.equal(session.setParams(s.key, s.index, [{ id: "2908.0", value: v }]).ok, true);
  const slots = w.changedSince(snapshot, session.touched());
  w.holdSlots(session.touched());
  return { snapshot, session, slots };
};

test("review lock: a touched slot refuses edits with the exact message, other slots stay editable", async () => {
  const w = new Workspace(serializePcg(build()));
  aiRun(w, [[A, 20]]);
  const before = level(w, A);
  await assert.rejects(setLevel(w, A, 99), { message: "This sound has pending AI changes: Keep or Discard first" });
  assert.equal(HOLD_MESSAGE, "This sound has pending AI changes: Keep or Discard first");
  assert.equal(level(w, A), before);
  await assert.rejects(w.apply([B, A], () => undefined), { message: HOLD_MESSAGE }, "one held slot in the list refuses the whole edit");
  await setLevel(w, B, 77);
  assert.equal(level(w, B), 77);
  assert.equal(w.undo(), false, "main Undo stays off during a review");
  assert.equal(w.redo(), false);
});

test("review lock: Discard reverts the AI's slot only and keeps the owner's edit to another slot", async () => {
  const w = new Workspace(serializePcg(build()));
  const orig = level(w, A);
  const { session } = aiRun(w, [[A, 20]]);
  await setLevel(w, B, 77);
  assert.equal(session.undoAll(), 1);
  w.release();
  assert.equal(level(w, A), orig);
  assert.equal(level(w, B), 77);
  assert.deepEqual(w.changes().map((c) => c.index), [2], "only the owner's slot differs from the opened file");
  await setLevel(w, A, 5);
  assert.equal(level(w, A), 5, "released after Discard");
});

test("review lock: Keep records the AI slot as one step after the owner's earlier step, and neither undo touches the other", async () => {
  const w = new Workspace(serializePcg(build()));
  const orig = level(w, A);
  const { snapshot, slots } = aiRun(w, [[A, 20]]);
  await setLevel(w, B, 77);
  w.recordSince(snapshot, slots);
  w.release();
  assert.deepEqual(w.undoLabels(), ["Edit", "Level 2"], "B was recorded when edited, A's step lands at Keep");
  assert.equal(w.undo(), true);
  assert.equal(level(w, A), orig);
  assert.equal(level(w, B), 77);
  assert.equal(w.undo(), true);
  assert.equal(level(w, B), 0);
  await setLevel(w, A, 5);
  assert.equal(level(w, A), 5, "released after Keep");
});

test("review lock covers every touched slot, including one the run changed and changed back", async () => {
  const w = new Workspace(serializePcg(build()));
  const { session, slots } = aiRun(w, [[A, 20], [C, 10], [C, 0]]);
  assert.deepEqual(slots, [A], "the review lists only the net change");
  await assert.rejects(setLevel(w, C, 9), { message: HOLD_MESSAGE }, "Discard would restore C from the session's bytes, so an owner edit there would be lost");
  session.undoAll();
  w.release();
  await setLevel(w, C, 9);
  assert.equal(level(w, C), 9);
});

test("run lock: every slot and Global refuse edits and release is safe to repeat", async () => {
  const w = new Workspace(serializePcg(build()));
  w.holdAll();
  await assert.rejects(setLevel(w, B, 1), { message: RUN_MESSAGE });
  await assert.rejects(w.applyGlobal(() => undefined), { message: RUN_MESSAGE });
  w.release();
  w.release();
  await setLevel(w, B, 1);
  assert.equal(w.held, false);
});

test("show_param passes a per-target suggest through, and accepts calls without one", () => {
  const s = new SoundSession(T, build());
  const row = (s.describe("program:INT-A", 1, (s.describe("program:INT-A", 1).groups as string[])[0]).params as { id: string; min: number; max: number }[])[0];
  const mid = Math.floor((row.min + row.max) / 2);
  const r = runTool(s, "show_param", { key: "program:INT-A", index: 1, ids: [{ id: row.id, note: "Raise", suggest: mid }, { id: row.id, note: "Plain" }] }) as { ok: boolean; shown: { suggest?: number; suggestText?: string }[] };
  assert.equal(r.ok, true);
  assert.equal(r.shown[0].suggest, mid);
  assert.equal(typeof r.shown[0].suggestText, "string");
  assert.equal("suggest" in r.shown[1], false);
});

test("show_param refuses a suggest outside the row's range or not a whole number, naming the range", () => {
  const s = new SoundSession(T, build());
  const row = (s.describe("program:INT-A", 1, (s.describe("program:INT-A", 1).groups as string[])[0]).params as { id: string; min: number; max: number }[])[0];
  for (const bad of [row.max + 1, row.min - 1, 1.5, "10", NaN]) {
    const r = runTool(s, "show_param", { key: "program:INT-A", index: 1, ids: [{ id: row.id, note: "n", suggest: bad }] });
    assert.equal(r.ok, false, String(bad));
    assert.match(String(r.error), new RegExp(`${row.id}.*suggest.*${row.min}.*${row.max}`), String(bad));
  }
});

test("the show_param schema offers suggest as an optional number", () => {
  const d = toolDefinitions("ask").find((x) => x.name === "show_param") as unknown as { input_schema: { properties: { ids: { items: { properties: Record<string, { type: string }>; required: string[] } } } } };
  assert.equal(d.input_schema.properties.ids.items.properties.suggest.type, "integer");
  assert.deepEqual(d.input_schema.properties.ids.items.required, ["id", "note"]);
});

// Layer plans (propose_layer): read-only, steps in order, and the exact build_combi parts.
const idOfRow = (r: Row) => `${r.ofs}.${r.bitLo ?? 0}`;
const LEAD = { key: "program:INT-A", index: 1 };
type Plan = { ok: boolean; error?: string; method: string; slot: { key: string; index: number }; name: string; parts: { key: string; index: number; volume: number }[]; add: { chosen: { key: string; index: number; name: string }; candidates: unknown[] }; base: { engine: string }; steps: { n: number; kind: string; id: string; suggest?: number; timbre?: number; field?: string; bank?: number }[] };
const plan = (s: SoundSession, add: Record<string, unknown> = { role: "pad" }, method = "combi") => runTool(s, "propose_layer", { base: LEAD, add, method }) as unknown as Plan;

test("propose_layer returns candidates and ordered combi steps, and writes nothing", () => {
  const f = build(), s = new SoundSession(T, f, { ask: true }), before = serializePcg(f);
  const p = plan(s);
  assert.equal(p.ok, true);
  assert.deepEqual([p.method, p.base.engine, p.add.chosen.key, p.add.chosen.index, p.add.chosen.name], ["combi", "AL-1", "program:INT-A", 2, "Pad"]);
  assert.deepEqual([p.slot.key, p.slot.index], ["combi:INT-A", 1]);
  assert.deepEqual(p.steps.map((x) => [x.n, x.kind, x.field]), [[1, "note", undefined], [2, "combi-timbre", "program"], [3, "combi-timbre", "program"], [4, "combi-timbre", "level"], [5, "note", undefined]]);
  const t = (n: number, name: string) => idOfRow(T.combi.find((r) => r.group === `Timbre${n}` && r.name === name) as Row);
  assert.deepEqual([p.steps[1].id, p.steps[1].timbre, p.steps[1].suggest, p.steps[1].bank], [t(1, "Program Number"), 1, 1, 0]);
  assert.deepEqual([p.steps[2].id, p.steps[2].timbre, p.steps[2].suggest], [t(2, "Program Number"), 2, 2]);
  assert.equal(p.steps[3].id, t(2, "Volume"));
  assert.ok(p.steps[3].suggest! < p.parts[0].volume, "Timbre 2 is quieter than Timbre 1");
  assert.deepEqual(p.parts.map((x) => [x.key, x.index]), [["program:INT-A", 1], ["program:INT-A", 2]]);
  assert.match(p.name, /^[ -~]{1,24}$/);
  assert.equal(s.touched().length, 0);
  sameFile(f, parsePcg(before));
});

test("Build it for me writes the proposed parts into the proposed slot, timbre 1 = base, timbre 2 = the added sound", () => {
  const f = build(), p = plan(new SoundSession(T, f, { ask: true }), { role: "pad", transpose: -12, keyBottom: 48 });
  assert.equal(p.ok, true);
  assert.ok(p.steps.some((x) => x.field === "keyrange"));
  const s = new SoundSession(T, f), r = runTool(s, "build_combi", { name: p.name, parts: p.parts });
  assert.equal(r.ok, true, String(r.error));
  assert.deepEqual([r.key, r.index], [p.slot.key, p.slot.index]);
  const e = getEntry(f, p.slot.key, p.slot.index), cell = (n: number, name: string) => readParam(e, T.combi.find((x) => x.group === `Timbre${n}` && x.name === name) as Row);
  assert.deepEqual([cell(1, "Program Number"), cell(2, "Program Number"), cell(1, "Volume"), cell(2, "Volume"), cell(2, "Transpose"), cell(2, "Key Window Bottom")], [1, 2, 100, 80, -12, 48]);
});

test("propose_layer refuses osc2 on a base that is not HD-1, naming the combi method", () => {
  const f = build(), s = new SoundSession(T, f, { ask: true }), before = serializePcg(f);
  const r = plan(s, { role: "strings" }, "osc2");
  assert.equal(r.ok, false);
  assert.match(String(r.error), /HD-1/);
  assert.match(String(r.error), /combi/);
  sameFile(f, parsePcg(before));
});

test("propose_layer refuses bad input: a Combi base, an unknown method, a missing role, a missing match, a hidden sound", () => {
  const s = new SoundSession(T, build(), { ask: true });
  assert.equal(runTool(s, "propose_layer", { base: { key: "combi:INT-A", index: 0 }, add: { role: "pad" }, method: "combi" }).ok, false);
  assert.equal(plan(s, { role: "pad" }, "layer").ok, false);
  assert.equal(plan(s, {}).ok, false);
  assert.match(String(plan(s, { role: "harp" }).error), /no Program/);
  assert.equal(plan(s, { role: "pad", program: { key: "program:INT-A", index: 999 } }).ok, false);
  assert.equal(runTool(new SoundSession(T, build(), { ask: true, hide: [LEAD] }), "propose_layer", { base: LEAD, add: { role: "pad" }, method: "combi" }).ok, false);
});

test("propose_layer takes add.program as given, and says so when there is no free Combi slot", () => {
  const f = build(), s = new SoundSession(T, f), p = plan(s, { role: "strings", program: { key: "program:U-A", index: 0 } });
  assert.deepEqual([p.ok, p.add.chosen.key, p.add.candidates.length], [true, "program:U-A", 1]);
  assert.equal(runTool(s, "build_combi", { name: "One", parts: p.parts }).ok, true);
  assert.equal(runTool(s, "build_combi", { name: "Two", parts: p.parts }).ok, true);
  assert.match(String(plan(s).error), /no free Combi slot/);
});

test("propose_layer picks a Combi name no Combi has", () => {
  const f = build(), s = new SoundSession(T, f);
  const first = plan(s).name;
  assert.equal(runTool(s, "build_combi", { name: first, parts: plan(s).parts }).ok, true);
  assert.notEqual(plan(s).name, first);
});

// Keyboard-aware free slots: with a keyboard connected, only banks it is known to match give out new slots.
test("keyboard: a bank that differs from the keyboard gives no free slots, and the reason is named", () => {
  const f = build();
  const s = new SoundSession(T, f, { keyboard: { banks: { "program:INT-A": "differs", "program:U-A": "match", "combi:INT-A": "differs" } } });
  assert.deepEqual(s.freeSlots("program").map((x) => `${x.key}/${x.index}`), ["program:U-A/0"]);
  assert.equal(s.freeSlots("combi").length, 0);
  const r = runTool(s, "free_slots", { kind: "combi" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.skipped, ["INT-A differs from the keyboard: pull it first"]);
  assert.match(String(runTool(s, "build_combi", { name: "X", parts: [{ key: "program:INT-A", index: 1, keyBottom: 0, keyTop: 127 }] }).error), /INT-A differs from the keyboard: pull it first/);
  assert.match(String(runTool(s, "copy_sound", { fromKey: "program:INT-A", fromIndex: 1, name: "Copy" }).error), /pull it first/); // the only free slot of that engine type is in INT-A
});

test("keyboard: a bank that was not read is not used either", () => {
  const s = new SoundSession(T, build(), { keyboard: { banks: {} } });
  assert.equal(s.freeSlots("program").length, 0);
  assert.equal(s.freeSlots("combi").length, 0);
  assert.match(s.skippedBanks("program")[0].why, /INT-A was not checked against the keyboard: pull it first/);
});

test("keyboard: matching banks behave as before, and a build there leaves no file-only warning", () => {
  const f = build();
  const s = new SoundSession(T, f, { keyboard: { banks: { "program:INT-A": "match", "program:U-A": "match", "combi:INT-A": "match" } } });
  assert.deepEqual(s.freeSlots("combi").map((x) => x.index), [1, 2]);
  assert.equal(runTool(s, "build_combi", { name: "Pad Combi", parts: [{ key: "program:INT-A", index: 2, keyBottom: 0, keyTop: 127 }] }).ok, true);
  assert.equal(s.fileOnlyWarning(), null);
});

test("no keyboard: free slots come from the file as before, and the run warns that it chose from the file only", () => {
  const s = new SoundSession(T, build());
  assert.deepEqual(s.freeSlots("combi").map((x) => x.index), [1, 2]);
  assert.deepEqual(s.skippedBanks("combi"), []);
  assert.equal(s.fileOnlyWarning(), null);
  runTool(s, "build_combi", { name: "Pad Combi", parts: [{ key: "program:INT-A", index: 2, keyBottom: 0, keyTop: 127 }] });
  assert.equal(s.fileOnlyWarning(), "free slots chosen from the file only");
});

test("bankKeyOf is the inverse of bankNumberOf, and says nothing for GM and the factory banks", () => {
  const keys = ["INT-A", "INT-B", "INT-C", "INT-D", "INT-E", "INT-F", "U-A", "U-B", "U-C", "U-D", "U-E", "U-F", "U-G", "U-AA", "U-BB", "U-CC", "U-DD", "U-EE", "U-FF", "U-GG"].map((l) => `program:${l}`);
  for (const k of keys) assert.equal(bankKeyOf(bankNumberOf(k)!), k);
  assert.deepEqual([0, 5, 17, 23, 24, 30].map(bankKeyOf), ["program:INT-A", "program:INT-F", "program:U-A", "program:U-G", "program:U-AA", "program:U-GG"]);
  for (const n of [6, 10, 16, 31, 127, -1]) assert.equal(bankKeyOf(n), null);
});
