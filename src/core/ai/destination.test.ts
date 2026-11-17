import { test } from "node:test";
import assert from "node:assert/strict";
import { getEntry, getName, setEntry } from "../pcg/library.ts";
import { parsePcg, serializePcg, type PcgFile } from "../pcg/pcg.ts";
import { bank, container, entry, file, raw } from "../pcg/synthetic.ts";
import { readParam, type ParamTables, type Row } from "../params/params.ts";
import { destLines, existingChanged, planDestination, type DestPlan } from "./destination.ts";

// Synthetic data only, laid out like session.test.ts: INT-A 0 free, 1 "Lead" (used by Combi 0), 2 "Pad", 3 free; U-A 0 free.
const EXI = 4960;
const COMBI = 7810;
const row = (p: Partial<Row>): Row => ({ ofs: 0, bitHi: null, bitLo: null, group: "", name: "", rawMin: 0, rawMax: 127, fixed: false, valueText: "", signed: false, continuation: false, parts: [[0, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null, ...p }) as Row;
const timbreRows = (t: number): Row[] => {
  const b = 4802 + 188 * (t - 1);
  const g = `Timbre${t}`;
  return [
    row({ group: g, name: "Program Number", ofs: b, parts: [[b, 7, 0]] }),
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
const T = { effectTypes: [], valueLists: {}, programHd1: [], programExiCommon: [], combi: Array.from({ length: 16 }, (_, i) => timbreRows(i + 1)).flat(), global: [], drumkit: [], waveseq: [], engines: {} } as unknown as ParamTables;

const exiProgram = (name: string, level = 50): Uint8Array => {
  const e = entry(name, EXI);
  e[2689] = 127;
  e[40] = 2;
  e[1 + 2908] = level;
  return e;
};
const combi = (name: string, timbres: Record<number, [number, number]> = {}): Uint8Array => {
  const e = entry(name, COMBI);
  for (let t = 0; t < 16; t++) e[4803 + 188 * t] = 127;
  for (const [t, [num, col]] of Object.entries(timbres)) {
    e[4802 + 188 * Number(t)] = num;
    e[4803 + 188 * Number(t)] = col;
  }
  return e;
};
const build = (programs: Uint8Array[], combis: Uint8Array[]): PcgFile =>
  parsePcg(file(container("PCG1", raw("DIV1", new Uint8Array(44), 0x10000), container("PRG1", bank("MBK1", EXI, 0, programs), bank("PBK1", EXI, 0x20000, [exiProgram("Init Brass")])), container("CMB1", bank("CBK1", COMBI, 0, combis)))));
const base = () => build([exiProgram("Init Program"), exiProgram("Lead", 40), exiProgram("Pad", 60), exiProgram("Init Keys")], [combi("Stack", { 0: [1, 0] }), combi("Init Combi"), combi("Init Combi 2")]);
const PAD = { key: "program:INT-A", index: 2 };
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
type Good = Extract<DestPlan, { ok: true }>;
const ok = (p: DestPlan): Good => {
  assert.equal(p.ok, true, p.ok ? "" : p.error);
  return p as Good;
};
const poke = (f: PcgFile, key: string, index: number, at: number, v: number) => {
  const e = getEntry(f, key, index);
  e[at] = v;
  setEntry(f, key, index, e);
};
// The library after an AI run that changed Pad's level.
const changedLib = (): PcgFile => {
  const f = base();
  poke(f, PAD.key, PAD.index, 1 + 2908, 99);
  return f;
};
const apply = (f: PcgFile, p: Good) => {
  for (const w of p.writes) setEntry(f, w.key, w.index, w.bytes);
};

test("current writes nothing: the changed slot stays as the run left it", () => {
  const p = ok(planDestination(T, "current", [PAD], base(), changedLib()));
  assert.deepEqual(p.writes, []);
  assert.deepEqual(p.moves, []);
});

test("new program: the changed bytes go to the first free slot as 'Pad AI', the original is back to the baseline", () => {
  const b = base();
  const lib = changedLib();
  const changedBytes = new Uint8Array(getEntry(lib, PAD.key, PAD.index));
  const before = serializePcg(lib);
  const p = ok(planDestination(T, "new-program", [PAD], b, lib));
  assert.equal(Buffer.from(serializePcg(lib)).equals(Buffer.from(before)), true, "planning never touches the library");
  assert.equal(p.moves.length, 1);
  assert.deepEqual([p.moves[0].program?.key, p.moves[0].program?.index, p.moves[0].program?.name], ["program:INT-A", 0, "Pad AI"]);
  apply(lib, p);
  assert.equal(same(getEntry(lib, PAD.key, PAD.index), getEntry(b, PAD.key, PAD.index)), true, "original equals the baseline");
  const copy = getEntry(lib, "program:INT-A", 0);
  assert.equal(getName(lib, "program:INT-A", 0), "Pad AI");
  assert.equal(same(copy.subarray(24), changedBytes.subarray(24)), true, "the copy holds the changed bytes");
  assert.equal(copy[1 + 2908], 99);
  assert.equal(getName(lib, "program:INT-A", 3), "Init Keys", "only one slot was used");
});

test("a name that is taken gets a number, and long names are cut to 16 characters", () => {
  const f = build([exiProgram("Init Program"), exiProgram("Lead", 40), exiProgram("Pad", 60), exiProgram("Pad AI")], [combi("Stack", { 0: [1, 0] }), combi("Init Combi")]);
  const baseF = parsePcg(serializePcg(f));
  poke(f, PAD.key, PAD.index, 40, 3);
  const p = ok(planDestination(T, "new-program", [PAD], baseF, f));
  assert.equal(p.moves[0].program?.name, "Pad AI 2");
  const long = build([exiProgram("Init Program"), exiProgram("A Very Long Sound Name X")], [combi("Init Combi")]);
  const longBase = parsePcg(serializePcg(long));
  poke(long, "program:INT-A", 1, 40, 3);
  const q = ok(planDestination(T, "new-program", [{ key: "program:INT-A", index: 1 }], longBase, long));
  assert.equal(q.moves[0].program?.name, "A Very Long S AI");
  assert.ok((q.moves[0].program?.name ?? "").length <= 16);
});

test("new program + combi: a Combi in the first free Combi slot has the new program as timbre 1", () => {
  const b = base();
  const lib = changedLib();
  const p = ok(planDestination(T, "new-combi", [PAD], b, lib));
  const m = p.moves[0];
  assert.deepEqual([m.combi?.key, m.combi?.index, m.combi?.name], ["combi:INT-A", 1, "Pad Combi"]);
  apply(lib, p);
  const c = getEntry(lib, "combi:INT-A", 1);
  const get = (t: number, n: string) => readParam(c, T.combi.find((r) => r.group === `Timbre${t}` && r.name === n)!);
  assert.equal(get(1, "Program Number"), 0, "points at INT-A 000, the new program");
  assert.equal(get(1, "Bank Number"), 0, "bank INT-A");
  assert.equal(get(1, "Status"), 1, "timbre 1 on");
  assert.equal(get(2, "Status"), 0, "the other timbres are off");
  assert.equal(same(getEntry(lib, PAD.key, PAD.index), getEntry(b, PAD.key, PAD.index)), true, "original untouched");
  assert.equal(getName(lib, "combi:INT-A", 2), "Init Combi 2");
});

test("no free program slot: a clear error, nothing written", () => {
  const f = build([exiProgram("Lead", 40), exiProgram("Pad", 60)], [combi("Init Combi")]);
  const baseF = parsePcg(serializePcg(f));
  poke(f, PAD.key, 1, 40, 3);
  const p = planDestination(T, "new-program", [{ key: PAD.key, index: 1 }], baseF, f);
  assert.equal(p.ok, false);
  assert.match(p.ok ? "" : p.error, /free program slot/i);
});

test("no free Combi slot for the combi option: a clear error", () => {
  const f = build([exiProgram("Init Program"), exiProgram("Pad", 60)], [combi("Stack", { 0: [1, 0] })]);
  const baseF = parsePcg(serializePcg(f));
  poke(f, PAD.key, 1, 40, 3);
  const p = planDestination(T, "new-combi", [{ key: PAD.key, index: 1 }], baseF, f);
  assert.equal(p.ok, false);
  assert.match(p.ok ? "" : p.error, /free Combi slot/i);
});

test("a changed Combi: new program leaves it current, new combi is a copy named 'Stack AI'", () => {
  const b = base();
  const lib = base();
  const S = { key: "combi:INT-A", index: 0 };
  poke(lib, S.key, S.index, 100, 77);
  assert.deepEqual(ok(planDestination(T, "new-program", [S], b, lib)).writes, []);
  const p = ok(planDestination(T, "new-combi", [S], b, lib));
  assert.deepEqual([p.moves[0].program, p.moves[0].combi?.key, p.moves[0].combi?.index, p.moves[0].combi?.name], [undefined, "combi:INT-A", 1, "Stack AI"]);
  apply(lib, p);
  assert.equal(getEntry(lib, "combi:INT-A", 1)[100], 77);
  assert.equal(same(getEntry(lib, S.key, S.index), getEntry(b, S.key, S.index)), true);
});

test("slots of other kinds, and slots that were empty before the run, are never moved", () => {
  const b = base();
  const lib = changedLib();
  const newOne = { key: "program:INT-A", index: 3 };
  setEntry(lib, newOne.key, newOne.index, exiProgram("Fresh"));
  assert.deepEqual(existingChanged([PAD, newOne, { key: "drumkit:INT", index: 0 }], b, lib), [PAD]);
  const p = ok(planDestination(T, "new-program", [newOne, { key: "drumkit:INT", index: 0 }], b, lib));
  assert.deepEqual(p.writes, []);
});

test("several changed slots each get their own free slots", () => {
  const f = base();
  const baseF = parsePcg(serializePcg(f));
  const L = { key: "program:INT-A", index: 1 };
  for (const s of [L, PAD]) poke(f, s.key, s.index, 40, 3);
  const p = ok(planDestination(T, "new-combi", [L, PAD], baseF, f));
  assert.deepEqual(p.moves.map((m) => [m.program?.index, m.combi?.index]), [[0, 1], [3, 2]]);
  assert.equal(new Set(p.writes.map((w) => `${w.key}/${w.index}`)).size, p.writes.length, "no slot written twice");
});

test("destLines names the slots before and after", () => {
  const lib = changedLib();
  const L = (s: { key: string; index: number }) => `${s.key.split(":")[1]} ${String(s.index).padStart(3, "0")}`;
  assert.deepEqual(destLines("current", [PAD], null, L).preview, ["-> INT-A 002 overwritten"]);
  const p = ok(planDestination(T, "new-program", [PAD], base(), lib));
  const np = destLines("new-program", [PAD], p, L);
  assert.deepEqual(np.preview, ['-> INT-A 000 "Pad AI" (original INT-A 002 stays)']);
  assert.equal(np.done, 'Kept as new program INT-A 000 "Pad AI": original INT-A 002 unchanged.');
  const pc = ok(planDestination(T, "new-combi", [PAD], base(), lib));
  assert.equal(destLines("new-combi", [PAD], pc, L).done, 'Kept as new program INT-A 000 "Pad AI" and Combi INT-A 001 "Pad Combi": original INT-A 002 unchanged.');
});
