import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getEntry, listBanks, setEntry, setName } from "../pcg/library.ts";
import { parsePcg, serializePcg, type PcgFile } from "../pcg/pcg.ts";
import { referencedSlots } from "../pcg/refs.ts";
import { paramsFor, readParam, type ParamTables } from "../params/params.ts";
import { askPrompt, KIND_HINT } from "./agent.ts";
import { existingChanged, planDestination } from "./destination.ts";
import { runTool, SoundSession, type Slot } from "./session.ts";

// The real generated tables and the factory library: the object kinds, offsets and ranges are the shipped ones.
const T = JSON.parse(readFileSync(new URL("../../generated/params.json", import.meta.url), "utf8")) as ParamTables;
const lib = (): PcgFile => parsePcg(new Uint8Array(readFileSync(new URL("../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG", import.meta.url))));
// The factory library has no Init slots: blank one unused Combi and one unused Program of the pad's engine type, so Keep as has somewhere to copy to.
function withFreeSlots(f: PcgFile): PcgFile {
  const used = referencedSlots(f);
  const banks = listBanks(f);
  const padType = banks.find((b) => b.key === "program:INT-C")!.type;
  for (const b of banks.filter((x) => (x.kind === "combi" || (x.kind === "program" && x.type === padType)) && x.key !== "combi:INT-A")) {
    const i = Array.from({ length: b.count }, (_, n) => n).find((n) => !used.has(`${b.key}/${n}`) && !(b.key === PAD.key && n === PAD.index));
    if (i !== undefined) setName(f, b.key, i, "Init");
  }
  return f;
}
const COMBI: Slot = { key: "combi:INT-A", index: 1 }; // timbre 7 plays INT-C 37 "String Pad 1"
const PAD: Slot = { key: "program:INT-C", index: 37 };
const OTHER: Slot = { key: "program:INT-C", index: 38 };
const KIT: Slot = { key: "drumkit:INT", index: 0 };
const SEQ: Slot = { key: "waveseq:INT", index: 0 };
const same = (a: PcgFile, b: PcgFile) => assert.equal(Buffer.from(serializePcg(a)).equals(Buffer.from(serializePcg(b))), true);
const bytes = (f: PcgFile, s: Slot) => Buffer.from(getEntry(f, s.key, s.index));

type Sound = { kind: string; groups: string[]; timbres?: { timbres: number[]; key: string; index: number; name: string }[]; notesWithSamples?: number[]; params?: { id: string; name: string; value: number; min: number; max: number }[] };
const describe = (s: SoundSession, slot: Slot, group?: string): Sound => (runTool(s, "describe_sound", { ...slot, ...(group ? { group } : {}) }) as unknown as { sound: Sound }).sound;
// The first setting of the first group that has one, and a value different from today's.
function aSetting(s: SoundSession, slot: Slot, skip: RegExp = /^$/): { id: string; value: number; name: string } {
  for (const g of describe(s, slot).groups) {
    const p = describe(s, slot, g).params?.find((x) => x.max > x.min && !skip.test(x.name));
    if (p) return { id: p.id, name: p.name, value: p.value === p.min ? p.max : p.min };
  }
  throw new Error("no setting");
}
const set = (s: SoundSession, slot: Slot, id: string, value: number) => runTool(s, "set_params", { ...slot, changes: [{ id, value }] });

test("describe_sound on a Combi lists each distinct timbre Program with its bank key, index and name", () => {
  const s = new SoundSession(T, lib(), { onlySlot: COMBI });
  const d = describe(s, COMBI);
  assert.equal(d.kind, "combi");
  assert.ok(d.groups.includes("Timbre1"));
  const pad = d.timbres?.find((t) => /pad/i.test(t.name));
  assert.deepEqual([pad?.key, pad?.index, pad?.name, pad?.timbres], [PAD.key, PAD.index, "String Pad 1", [7]]);
});

test("Refine on a Combi changes its own setting and the named part's Program, nothing else, and Undo covers both", () => {
  const f = lib();
  const before = lib();
  const s = new SoundSession(T, f, { onlySlot: COMBI });
  const own = aSetting(s, COMBI, /Number|Status|Channel/);
  assert.equal(set(s, COMBI, own.id, own.value).ok, true);
  const prog = aSetting(s, PAD);
  assert.equal(set(s, PAD, prog.id, prog.value).ok, true);
  assert.deepEqual(s.touched().map((x) => `${x.key}/${x.index}`).sort(), [`${COMBI.key}/${COMBI.index}`, `${PAD.key}/${PAD.index}`].sort());
  assert.notDeepEqual(bytes(f, PAD), bytes(before, PAD));
  assert.equal(s.undoAll(), 2);
  same(f, before);
});

test("a Combi Refine refuses every slot that is not the Combi or one of its timbre Programs, with the bytes unchanged", () => {
  const f = lib();
  const before = lib();
  const s = new SoundSession(T, f, { onlySlot: COMBI });
  const o = aSetting(s, OTHER);
  const r = set(s, OTHER, o.id, o.value);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /Refine may change only/);
  for (const x of [KIT, SEQ, { key: "combi:INT-A", index: 2 }]) {
    const e = { id: "0.0", value: 1 };
    assert.equal(set(s, x, e.id, e.value).ok, false);
  }
  assert.equal(s.touched().length, 0);
  same(f, before);
});

test("the timbre Programs a Refine may write are fixed when the run starts: re-pointing a timbre does not unlock another Program", () => {
  const s = new SoundSession(T, lib(), { onlySlot: COMBI });
  const prog = describe(s, COMBI, "Timbre7").params!.find((p) => p.name === "Program Number")!;
  assert.equal(set(s, COMBI, prog.id, OTHER.index).ok, true);
  const o = aSetting(s, OTHER);
  assert.equal(set(s, OTHER, o.id, o.value).ok, false);
});

test("a Program Refine still may write only that Program", () => {
  const s = new SoundSession(T, lib(), { onlySlot: PAD });
  const o = aSetting(s, OTHER);
  assert.match(String(set(s, OTHER, o.id, o.value).error), /Refine may change only program:INT-C 37/);
});

test("a Drum Kit: Ask explains it, Refine changes a zone setting only, sample picks stay out", () => {
  const f = lib();
  const ask = new SoundSession(T, f, { ask: true });
  const d = describe(ask, KIT);
  assert.equal(d.kind, "drumkit");
  assert.ok(d.groups.length < 20, "the 1280 groups are summarised, not listed");
  assert.ok(d.notesWithSamples!.length > 0);
  const zone = `Note${d.notesWithSamples![0]} Zone1`;
  const rows = describe(ask, KIT, zone).params!;
  assert.ok(rows.some((p) => p.name === "Level"));
  assert.ok(!rows.some((p) => p.name === "Sample Id" || /UUID|^Name$/.test(p.name)));
  assert.equal(set(ask, KIT, rows[0].id, rows[0].value).ok, false);
  const before = lib();
  const s = new SoundSession(T, f, { onlySlot: KIT });
  const lvl = describe(s, KIT, zone).params!.find((p) => p.name === "Level")!;
  assert.equal(set(s, KIT, lvl.id, 40).ok, true);
  const e = getEntry(f, KIT.key, KIT.index);
  assert.equal(readParam(e, paramsFor(T, "drumkit", e).find((r) => `${r.ofs}.${r.bitLo ?? 0}` === lvl.id)!), 40);
  assert.deepEqual(s.touched(), [KIT]);
  s.undoAll();
  same(f, before);
});

test("a Wave Sequence: describe reads the Common and Step groups, set_params changes a step level, the sample pick is refused", () => {
  const f = lib();
  const before = lib();
  const s = new SoundSession(T, f, { onlySlot: SEQ });
  const d = describe(s, SEQ);
  assert.equal(d.kind, "waveseq");
  assert.ok(d.groups.includes("Common") && d.groups.includes("Step1"));
  const step = describe(s, SEQ, "Step1").params!;
  assert.ok(!step.some((p) => p.name === "Multisample Select"));
  const lvl = step.find((p) => p.name === "Level")!;
  assert.equal(set(s, SEQ, lvl.id, lvl.value === 10 ? 20 : 10).ok, true);
  assert.equal(set(s, { key: "waveseq:INT", index: 1 }, lvl.id, 5).ok, false);
  assert.deepEqual(s.touched(), [SEQ]);
  s.undoAll();
  same(f, before);
});

test("a build run still cannot see or write a Drum Kit or Wave Sequence", () => {
  const s = new SoundSession(T, lib());
  assert.match(String(runTool(s, "describe_sound", { ...KIT }).error), /no sound at/);
  assert.equal(runTool(s, "set_params", { ...SEQ, changes: [{ id: "60.0", value: 1 }] }).ok, false);
});

test("the Ask opening line and the kind hints name the open object's kind", () => {
  const open = { key: KIT.key, index: 0, name: "Trance kit", kind: "drumkit", engine: "Drum Kit", bank: "INT" };
  assert.match(askPrompt(open, "what does it do?"), /Drum Kit INT 000/);
  assert.match(askPrompt({ ...open, kind: "waveseq" }, "?"), /Wave Sequence/);
  assert.match(KIND_HINT.combi, /timbres/);
  assert.match(KIND_HINT.drumkit, /notesWithSamples/);
  assert.match(KIND_HINT.waveseq, /Step/);
});

test("Keep as: a Combi and its Program changed together keep their link in a new Combi and in a new Program", () => {
  const f = withFreeSlots(lib());
  const base = withFreeSlots(lib());
  const s = new SoundSession(T, f, { onlySlot: COMBI });
  const own = aSetting(s, COMBI, /Number|Status|Channel/);
  set(s, COMBI, own.id, own.value);
  const prog = aSetting(s, PAD);
  set(s, PAD, prog.id, prog.value);
  const changed = s.touched();
  assert.equal(existingChanged(changed, base, f).length, 2);
  const t7 = (file: PcgFile, c: Slot) => {
    const e = getEntry(file, c.key, c.index);
    const cell = (n: string) => readParam(e, T.combi.find((r) => r.group === "Timbre7" && r.name === n)!);
    return { bank: cell("Bank Number"), program: cell("Program Number") };
  };
  for (const kind of ["new-combi", "new-program"] as const) {
    const plan = planDestination(T, kind, changed, base, f);
    assert.equal(plan.ok, true, kind + ": " + (plan.ok ? "" : plan.error));
    if (!plan.ok) return;
    const out = parsePcg(serializePcg(f));
    for (const w of plan.writes) setEntry(out, w.key, w.index, w.bytes);
    const copy = plan.moves.find((m) => m.program && m.from.key === PAD.key)!.program!;
    assert.deepEqual(bytes(out, PAD), bytes(base, PAD), `${kind}: the original Program is back`);
    const holder = kind === "new-combi" ? plan.moves.find((m) => m.from.key === COMBI.key)!.combi! : COMBI;
    assert.equal(t7(out, holder).program, copy.index, `${kind}: the Combi plays the new Program`);
    if (kind === "new-combi") assert.deepEqual(bytes(out, COMBI), bytes(base, COMBI));
  }
});

test("a Combi Refine may search for a sound to put in a timbre (read-only), and may not copy or build", () => {
  const s = new SoundSession(T, lib(), { onlySlot: COMBI });
  const hit = runTool(s, "search_sounds", { text: "piano", kind: "program", limit: 3 }) as unknown as { ok: boolean; results: unknown[] };
  assert.equal(hit.ok, true);
  assert.ok(hit.results.length > 0);
  const copy = runTool(s, "copy_sound", { fromKey: "program:INT-A", fromIndex: 0, name: "x" }) as unknown as { ok: boolean; error?: string };
  assert.equal(copy.ok, false);
  assert.match(String(copy.error), /Refine may not use/);
});
