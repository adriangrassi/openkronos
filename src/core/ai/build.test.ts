import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getEntry, setName } from "../pcg/library.ts";
import { parsePcg } from "../pcg/pcg.ts";
import { readZones } from "../pcg/multisamples.ts";
import { paramsFor, readParam, type ParamTables } from "../params/params.ts";
import { runAgent, DEFAULT_SYSTEM, type ChatReply } from "./agent.ts";
import { buildSummary } from "./buildsummary.ts";
import { runTool, SoundSession } from "./session.ts";

// The real generated tables and the factory library: ids, offsets and ranges are the shipped ones.
const T = JSON.parse(readFileSync(new URL("../../generated/params.json", import.meta.url), "utf8")) as ParamTables;
const PIANO = { key: "program:INT-A", index: 0 }; // SGX-2 "KRONOS German Grand"
const HD = { key: "program:INT-B", index: 6 }; // HD-1, renamed free below
const COMBI = { key: "combi:INT-F", index: 100 };
type Lib = ReturnType<typeof lib>;
const lib = () => {
  const f = parsePcg(new Uint8Array(readFileSync(new URL("../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG", import.meta.url))));
  setName(f, COMBI.key, COMBI.index, "Init Combi");
  setName(f, HD.key, HD.index, "Init HD Program");
  return f;
};
const mk = (opts = {}) => { const f = lib(); return { f, s: new SoundSession(T, f, opts) }; };
const combiRow = (f: Lib, group: string, name: string) => { const e = getEntry(f, COMBI.key, COMBI.index); return readParam(e, paramsFor(T, "combi", e).find((r) => r.group === group && r.name === name)!); };
const cell = (f: Lib, t: number, name: string) => combiRow(f, `Timbre${t}`, name);
const modCell = (f: Lib, m: string, name: string) => combiRow(f, `KARMA Module ${m}`, name);
const idOf = (f: Lib, key: string, index: number, group: string, name: string) => { const r = paramsFor(T, "hd1", getEntry(f, key, index)).find((x) => x.group === group && x.name === name)!; return `${r.ofs}.${r.bitLo ?? 0}`; };

test("list_multisamples returns ids a set_params ms change takes, with names, and says they are not sample names", () => {
  const { s } = mk();
  const r = runTool(s, "list_multisamples", { limit: 5 }) as any;
  assert.equal(r.ok, true); assert.equal(r.multisamples.length, 5); assert.ok(r.total > 500);
  for (const m of r.multisamples) { assert.ok(Number.isInteger(m.id)); assert.match(m.name, /#\d+$/); assert.ok(m.usedBy.length > 0); }
  assert.match(String(r.note), /no sample names/i);
  const q = runTool(s, "list_multisamples", { query: "piano" }) as any;
  assert.ok(q.multisamples.length > 0 && q.total < r.total);
  assert.ok(q.multisamples.every((m: any) => m.usedBy.some((n: string) => /piano/i.test(n))));
  assert.equal((runTool(s, "list_multisamples", { query: "zzzznothing" }) as any).multisamples.length, 0);
  assert.equal((runTool(s, "list_multisamples", { category: "strings" }) as any).ok, true);
});

test("set_params applies a multisample by id to OSC2 of an HD-1 copy, reports the engine, and warns when Oscillator Mode is still Single", () => {
  const { f, s } = mk();
  const copy = runTool(s, "copy_sound", { fromKey: HD.key, fromIndex: HD.index, name: "My Pad" }) as any;
  assert.equal(copy.ok, true);
  const mode = idOf(f, copy.key, copy.index, "Common", "Oscillator Mode");
  assert.equal((runTool(s, "set_params", { key: copy.key, index: copy.index, changes: [{ id: mode, value: 0 }] }) as any).ok, true);
  const ms = (runTool(s, "list_multisamples", { query: "strings" }) as any).multisamples[0];
  const r = runTool(s, "set_params", { key: copy.key, index: copy.index, changes: [{ ms: { osc: 2, zone: 1, id: ms.id } }] }) as any;
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.engine, "HD-1");
  const z = readZones(getEntry(f, copy.key, copy.index)).find((x) => x.osc === 2 && x.zone === 1)!;
  assert.deepEqual([z.type, z.ref.bank, z.ref.number], [1, ms.bank, ms.number]);
  assert.match(r.warnings.join(" "), /Oscillator Mode/);
  const r2 = runTool(s, "set_params", { key: copy.key, index: copy.index, changes: [{ id: mode, value: 1 }] }) as any;
  assert.equal(r2.ok, true); assert.deepEqual(r2.warnings ?? [], []);
});

test("set_params refuses a bad multisample id or zone, a bare MS Number, and writes nothing", () => {
  const { f, s } = mk();
  const before = getEntry(f, HD.key, HD.index).slice();
  const num = idOf(f, HD.key, HD.index, "OSC2 Trigger", "Zone1 MS Number");
  const cases: [unknown[], RegExp][] = [
    [[{ ms: { osc: 2, zone: 1, id: 999999 } }], /list_multisamples/],
    [[{ ms: { osc: 3, zone: 1, id: 0 } }], /osc/],
    [[{ ms: { osc: 2, zone: 9, id: 0 } }], /zone/],
    [[{ id: num, value: 5 }], /list_multisamples/],
  ];
  for (const [changes, re] of cases) {
    const r = runTool(s, "set_params", { key: HD.key, index: HD.index, changes }) as any;
    assert.equal(r.ok, false); assert.match(JSON.stringify(r), re);
  }
  assert.deepEqual(getEntry(f, HD.key, HD.index), before);
});

test("an SGX-2 piano or a Combi refuses OSC edits and the error says to use a Combination", () => {
  const { s } = mk();
  const piano = runTool(s, "set_params", { key: PIANO.key, index: PIANO.index, changes: [{ ms: { osc: 2, zone: 1, id: 0 } }] }) as any;
  assert.equal(piano.ok, false); assert.match(JSON.stringify(piano), /SGX-2/); assert.match(JSON.stringify(piano), /Combination/);
  const combi = runTool(s, "set_params", { key: COMBI.key, index: COMBI.index, changes: [{ ms: { osc: 1, zone: 1, id: 0 } }] }) as any;
  assert.equal(combi.ok, false); assert.match(JSON.stringify(combi), /no oscillators/);
});

test("OSC settings keep their ranges: an out-of-range OSC2 attack is refused, a valid one is read back", () => {
  const { f, s } = mk();
  const id = idOf(f, HD.key, HD.index, "OSC2 Amplifier EG", "Attack Time");
  const bad = runTool(s, "set_params", { key: HD.key, index: HD.index, changes: [{ id, value: 200 }] }) as any;
  assert.equal(bad.ok, false);
  const ok = runTool(s, "set_params", { key: HD.key, index: HD.index, changes: [{ id, value: 60 }] }) as any;
  assert.equal(ok.ok, true); assert.equal(ok.engine, "HD-1");
});

test("a protected base is never changed or reused as a free slot", () => {
  const { s } = mk({ protect: [PIANO, HD] });
  const r = runTool(s, "set_params", { key: HD.key, index: HD.index, changes: [{ ms: { osc: 1, zone: 1, id: 0 } }] }) as any;
  assert.equal(r.ok, false); assert.match(JSON.stringify(r), /must stay unchanged/);
  assert.ok(!(runTool(s, "free_slots", { kind: "program", type: "hd1" }) as any).slots.some((x: any) => x.key === HD.key && x.index === HD.index));
});

test("a split: bass below C3 (keys 0..47) and the piano from C3 (48..127) builds two parts; C3 is note 48", () => {
  const { f, s } = mk();
  const r = runTool(s, "build_combi", { name: "Piano + Bass", parts: [{ ...PIANO, keyBottom: 48, keyTop: 127, volume: 100 }, { ...HD, keyBottom: 0, keyTop: 47, volume: 90 }] }) as any;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([1, 2].map((t) => [cell(f, t, "Key Window Bottom"), cell(f, t, "Key Window Top")]), [[48, 127], [0, 47]]);
});

test("overlapping ranges are refused unless the parts layer exactly, switch by velocity, or crossfade with slopes", () => {
  const { s } = mk();
  const build = (parts: unknown[]) => runTool(s, "build_combi", { name: "T", parts }) as any;
  const p = (extra: object) => ({ ...HD, keyBottom: 0, keyTop: 127, ...extra });
  const bad = build([{ ...PIANO, keyBottom: 40, keyTop: 127 }, p({ keyBottom: 0, keyTop: 60 })]);
  assert.equal(bad.ok, false); assert.match(bad.error, /overlap/); assert.match(bad.error, /parts 1 and 2/); assert.match(bad.error, /Slope/);
  assert.equal(build([{ ...PIANO, keyBottom: 0, keyTop: 127, velLow: 1, velHigh: 80 }, p({ velLow: 60, velHigh: 127 })]).ok, false);
  assert.equal(build([{ ...PIANO, keyBottom: 0, keyTop: 127 }, p({})]).ok, true, "identical ranges are a layer");
});

test("velocity switch and crossfade slopes build and are written", () => {
  const a = mk(), b = mk();
  assert.equal((runTool(a.s, "build_combi", { name: "V", parts: [{ ...PIANO, keyBottom: 0, keyTop: 127, velLow: 1, velHigh: 79 }, { ...HD, keyBottom: 0, keyTop: 127, velLow: 80, velHigh: 127 }] }) as any).ok, true);
  assert.deepEqual([cell(a.f, 1, "Vel.Window High"), cell(a.f, 2, "Vel.Window Low")], [79, 80]);
  const r = runTool(b.s, "build_combi", { name: "X", parts: [{ ...PIANO, keyBottom: 0, keyTop: 60, keyTopSlope: 8 }, { ...HD, keyBottom: 48, keyTop: 127, keyBottomSlope: 8 }] }) as any;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([cell(b.f, 1, "Key Window Top Slope"), cell(b.f, 2, "Key Window Bottom Slope")], [8, 8]);
  const range = runTool(b.s, "build_combi", { name: "Y", parts: [{ ...PIANO, keyBottom: 0, keyTop: 127, keyTopSlope: 16 }] }) as any;
  assert.equal(range.ok, false); assert.match(range.error, /slope/i);
});

test("configure_combi routes a KARMA module: GE, listens on the keyboard, plays one timbre, key zone, run flag, chord trigger, seed, scene", () => {
  const { f, s } = mk();
  runTool(s, "build_combi", { name: "Piano + Synth", parts: [{ ...PIANO, keyBottom: 48, keyTop: 127 }, { ...HD, keyBottom: 0, keyTop: 47, channel: 2 }] });
  const ge = (runTool(s, "search_ge", { query: "arp" }) as any).results[0].number;
  const r = runTool(s, "configure_combi", { key: COMBI.key, index: COMBI.index, karma: { scene: { select: 3 }, modules: [{ module: "A", ge, plays: 2, inputChannel: 16, keyBottom: 0, keyTop: 47, run: true, chordTrigger: 1, startSeed: 12345 }, { module: "B", run: false }] } }) as any;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(["GE Number", "Output MIDI Channel", "Input MIDI Channel", "Key Zone Top", "Run GE", "Clock Advance Chord Trigger", "Start Seed"].map((n) => modCell(f, "A", n)), [ge, 2, 16, 47, 1, 1, 12345]);
  assert.equal(modCell(f, "B", "Run GE"), 0);
  assert.equal(combiRow(f, "KARMA Common", "Scene Select"), 2);
});

test("a KARMA module cannot play a timbre that hears the keyboard, or one that is off, or give both plays and channel", () => {
  const { s } = mk();
  runTool(s, "build_combi", { name: "Piano + Synth", parts: [{ ...PIANO, keyBottom: 48, keyTop: 127 }, { ...HD, keyBottom: 0, keyTop: 47, channel: 2 }] });
  const go = (m: object) => runTool(s, "configure_combi", { key: COMBI.key, index: COMBI.index, karma: { modules: [{ module: "A", ...m }] } }) as any;
  assert.match(go({ plays: 1 }).error, /own channel/);
  assert.match(go({ plays: 5 }).error, /off/);
  assert.match(go({ plays: 2, channel: 3 }).error, /plays or channel/);
  assert.match(go({ inputChannel: 17 }).error, /inputChannel/);
  assert.match(go({ chordTrigger: 9 }).error, /chordTrigger/);
});

test("scripted run: pad + synth over the piano, arpeggio on the synth, split at C3; the Combi and an honest summary come out", async () => {
  const { f, s } = mk({ protect: [PIANO] });
  const call = (id: string, name: string, args: object) => ({ id, name, arguments: args as Record<string, unknown> });
  const geNum = (runTool(s, "search_ge", { query: "arp" }) as any).results[0].number;
  const script: ChatReply[] = [
    { content: "", toolCalls: [call("1", "search_ge", { query: "arp" })] },
    { content: "", toolCalls: [call("3", "build_combi", { name: "Piano Pad Synth", parts: [{ ...PIANO, keyBottom: 48, keyTop: 127, volume: 100 }, { key: HD.key, index: 7, keyBottom: 48, keyTop: 127, volume: 75 }, { key: "program:INT-B", index: 15, keyBottom: 0, keyTop: 47, volume: 90, channel: 2 }] })] },
    { content: "", toolCalls: [call("4", "configure_combi", { key: COMBI.key, index: COMBI.index, tempo: 100, karma: { modules: [{ module: "A", ge: geNum, plays: 3, inputChannel: 16, keyBottom: 0, keyTop: 47 }] } })] },
    { content: "Built it.", toolCalls: [] },
  ];
  let n = 0;
  const r = await runAgent({ session: s, prompt: "x", maxTurns: 10, chat: async () => script[n++] });
  assert.equal(r.status, "done");
  assert.deepEqual([1, 2, 3].map((t) => [cell(f, t, "Key Window Bottom"), cell(f, t, "Key Window Top")]), [[48, 127], [48, 127], [0, 47]]);
  assert.equal(modCell(f, "A", "Output MIDI Channel"), 2);
  const text = buildSummary(r.messages, (k, i) => `${k.replace("program:", "")} ${String(i).padStart(3, "0")}`, (g) => `GE ${g}`).join("\n");
  assert.match(text, /Piano Pad Synth/); assert.match(text, /INT-F 100/);
  assert.match(text, /Timbre 1.*keys C3\.\.G9/); assert.match(text, /Timbre 3.*keys C-1\.\.B2.*KARMA module A/);
  assert.match(text, /select the Combination on the keyboard/i); assert.match(text, /Store/); assert.match(text, /KARMA ON\/OFF/);
  assert.match(text, /silent with KARMA off/);
});

test("buildSummary is empty when no Combination was built", () => {
  assert.deepEqual(buildSummary([{ role: "user", content: "x" }], () => "", () => ""), []);
});

test("the prompt carries the structure rules: base stays, EXi needs a Combi, list_multisamples, note numbers, KARMA routing", () => {
  for (const re of [/list_multisamples/, /no OSC2/, /C3 = 48/, /plays/, /never edit the open sound/i, /Oscillator Mode/]) assert.match(DEFAULT_SYSTEM, re);
  assert.ok(DEFAULT_SYSTEM.length < 12_000, String(DEFAULT_SYSTEM.length));
});
