import assert from "node:assert/strict";
import { test } from "node:test";
import params from "../../generated/params.json" with { type: "json" };
import { bank, container, entry, file, raw } from "../pcg/synthetic.ts";
import { getEntry, listBanks, setEntry } from "../pcg/library.ts";
import { parsePcg, type PcgFile } from "../pcg/pcg.ts";
import { readParam, writeParam, type ParamTables, type Row } from "../params/params.ts";
import { KronosClient } from "./client.ts";
import { Latest } from "./live.ts";
import { LiveSender } from "./livesend.ts";
import { encodeParamChange, MAX_PARAM_ROWS, planParamChanges, rowsForKind } from "./paramSend.ts";
import { SimulatedKronos } from "./simulator.ts";

const T = params as unknown as ParamTables;
const row = (rows: Row[], group: string, name: string): Row => {
  const r = rows.find((x) => x.group === group && x.name === name);
  assert.ok(r, `no row ${group} / ${name}`);
  return r;
};
const HEAD = [0xf0, 0x42, 0x30, 0x68, 0x43];
const msg = (...body: number[]) => [...HEAD, ...body, 0xf7];
const withValue = (size: number, r: Row, v: number): Uint8Array => {
  const e = new Uint8Array(size);
  writeParam(e, r, v);
  return e;
};
const bytes = (m: Uint8Array | null) => (m ? [...m] : null);

// Expected bytes are written from KRONOS_MIDI_SysEx.txt [43]: F0 42 3g 68 43, TYP SOC SUB PID IDX, value as 21-bit two's complement in three 7-bit bytes (note *4).
// The ids are the TYP SOC SUB PID IDX cells of the row in Prog_HD-1.txt / CombiAndSongTimbreSet.txt, copied here by hand.
test("plain byte: HD-1 Insert Effect1 Panpot (OFS 92, 7|0|0|6|0)", () => {
  const r = row(T.programHd1, "Insert Effect1", "Panpot");
  assert.equal(r.ofs, 92);
  assert.deepEqual(bytes(encodeParamChange(0, r, withValue(3706, r, 100), T.programHd1)), msg(7, 0, 0, 6, 0, 0, 0, 0x64));
});

test("signed byte: HD-1 Vector Control (0) Position X = -5 (OFS 1212, 2|0|0|16|0)", () => {
  const r = row(T.programHd1, "Vector Control", "(0) Position X");
  assert.equal(r.ofs, 1212);
  const e = withValue(3706, r, -5);
  assert.equal(e[1212], 0xfb);
  // -5 in 21 bits is 0x1FFFFB
  assert.deepEqual(bytes(encodeParamChange(0, r, e, T.programHd1)), msg(2, 0, 0, 16, 0, 0x7f, 0x7f, 0x7b));
});

test("16-bit signed: Combi Timbre3 Detune = -1200 (OFS 5186+5187, 4|2|0|23|0)", () => {
  const r = row(T.combi, "Timbre3", "Detune");
  const e = withValue(7810, r, -1200);
  assert.deepEqual([e[5186], e[5187]], [0x50, 0xfb]);
  // 0x200000 - 1200 = 2095952 = 127 * 16384 + 118 * 128 + 80
  assert.deepEqual(bytes(encodeParamChange(0, r, e, T.combi)), msg(4, 2, 0, 23, 0, 0x7f, 0x76, 0x50));
});

test("16-bit unsigned: HD-1 Effect LFO2 BPM = 12000 (OFS 1202+1203, 8|1|0|4|0)", () => {
  const r = row(T.programHd1, "Effect LFO2", "BPM");
  const e = withValue(3706, r, 12000);
  assert.deepEqual([e[1202], e[1203]], [0xe0, 0x2e]);
  // 12000 = 0 * 16384 + 93 * 128 + 96
  assert.deepEqual(bytes(encodeParamChange(0, r, e, T.programHd1)), msg(8, 1, 0, 4, 0, 0, 0x5d, 0x60));
});

test("bit field: HD-1 Insert Effect1 Fx Control Bus (OFS 93 bits 5~4, 7|0|0|4|0) sends only its own field", () => {
  const r = row(T.programHd1, "Insert Effect1", "Fx Control Bus");
  const before = new Uint8Array(3706);
  before[93] = 0x0b; // Bus Select (bits 3~0) = 11
  const after = Uint8Array.from(before);
  after[93] = 0x2b; // Fx Control Bus = 2
  assert.deepEqual(bytes(encodeParamChange(0, r, after, T.programHd1)), msg(7, 0, 0, 4, 0, 0, 0, 2));
  assert.deepEqual(planParamChanges(0, T.programHd1, before, after)?.map(bytes), [msg(7, 0, 0, 4, 0, 0, 0, 2)]);
});

test("timbre-indexed combi rows: Timbre3 Volume (SOC 2) and Timbre12 Pan (SOC 11)", () => {
  const vol = row(T.combi, "Timbre3", "Volume");
  assert.equal(vol.ofs, 5183);
  assert.deepEqual(bytes(encodeParamChange(0, vol, withValue(7810, vol, 127), T.combi)), msg(4, 2, 0, 2, 0, 0, 0, 0x7f));
  const pan = row(T.combi, "Timbre12", "Pan");
  assert.deepEqual([pan.typ, pan.soc, pan.sub, pan.pid, pan.idx], [4, 11, 0, 1, 0]);
  assert.deepEqual(bytes(encodeParamChange(0, pan, withValue(7810, pan, 1), T.combi)), msg(4, 11, 0, 1, 0, 0, 0, 1));
});

test("effect slot routing: HD-1 Insert Effect1 Send1 = 64 (OFS 94, 7|0|0|7|0); the channel goes in the header", () => {
  const r = row(T.programHd1, "Insert Effect1", "Send1");
  const m = encodeParamChange(5, r, withValue(3706, r, 64), T.programHd1);
  assert.deepEqual(bytes(m), [0xf0, 0x42, 0x35, 0x68, 0x43, 7, 0, 0, 7, 0, 0, 0, 0x40, 0xf7]);
});

test("EXi program common rows map too: EXi2 Common Transpose = -60 (0|0|0|36|1)", () => {
  const r = row(T.programExiCommon, "EXi2 Common", "Transpose");
  assert.deepEqual([r.typ, r.soc, r.sub, r.pid, r.idx], [0, 0, 0, 36, 1]);
  assert.deepEqual(bytes(encodeParamChange(0, r, withValue(4960, r, -60), T.programExiCommon)), msg(0, 0, 0, 36, 1, 0x7f, 0x7f, 0x44));
});

test("rows that cannot be mapped with certainty return null", () => {
  const hd = T.programHd1;
  const e = new Uint8Array(3706);
  const isNull = (r: Row, rows = hd) => assert.equal(encodeParamChange(0, r, e, rows), null, `${r.group} / ${r.name}`);
  isNull(row(hd, "Insert Effect1", "Effect Type")); // changes how a block of bytes is read
  isNull(row(hd, "Insert Effect1", "Switch")); // "-> bypass, Invert Value"
  isNull(row(hd, "Master Effect2", "Switch"));
  isNull(row(hd, "Insert Effect1", "Chain To")); // shares PID 2 with Chain Switch
  isNull(row(hd, "Insert Effect1", "Chain Switch"));
  isNull(row(hd, "Tone Adjust", "Knob1 Assign")); // "SUB = (Assign >> 7) & 0x01, Value = Assign & 0x7f"
  isNull(row(hd, "KARMA Common", "Tempo")); // KARMA has its own message function (6D)
  isNull(row(hd, "Drum Track Common", "Pattern Number")); // so has Drum Track (6E)
  isNull(row(hd, "KARMA Module", "Start Seed")); // 32 bits, Big Endian
  isNull(row(hd, "Common", "Name"));
  isNull(row(T.programExiCommon, "EXi1 Common", "Algorithm Type"), T.programExiCommon);
});

test("bigger edits are left to the whole dump, no change sends nothing", () => {
  const before = new Uint8Array(3706);
  const after = Uint8Array.from(before);
  const names = ["Panpot", "Send1", "Send2", "Rec Bus", "Bus Select"].slice(0, MAX_PARAM_ROWS + 1);
  for (const n of names) writeParam(after, row(T.programHd1, "Insert Effect1", n), 1);
  assert.equal(planParamChanges(0, T.programHd1, before, after), null);
  assert.equal(planParamChanges(0, T.programHd1, before, before)?.length, 0);
  const two = Uint8Array.from(before);
  writeParam(two, row(T.programHd1, "Insert Effect1", "Panpot"), 1);
  writeParam(two, row(T.programHd1, "Insert Effect1", "Send1"), 1);
  assert.equal(planParamChanges(0, T.programHd1, before, two)?.length, 2);
});

test("a changed byte no row owns (an effect's own parameters, a name) is not sent as a parameter", () => {
  const before = new Uint8Array(3706);
  const effectByte = Uint8Array.from(before);
  effectByte[60] = 9; // inside Insert Effect1's 64-byte parameter block, whose rows Effect.txt names but the program table does not
  assert.equal(planParamChanges(0, T.programHd1, before, effectByte), null);
  const named = Uint8Array.from(before);
  named[0] = 0x41;
  assert.equal(planParamChanges(0, T.programHd1, before, named), null);
  const typed = Uint8Array.from(before);
  typed[88] = 5; // Effect Type
  assert.equal(planParamChanges(0, T.programHd1, before, typed), null);
});

// ---- simulator round trip ----
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const KINDS = [
  { kind: "hd1", key: "program:INT-A", obj: 0, size: 3706 },
  { kind: "exi", key: "program:INT-B", obj: 0, size: 4960 },
  { kind: "combi", key: "combi:INT-A", obj: 1, size: 7810 },
] as const;

const synth = (): PcgFile =>
  parsePcg(file(container("PCG1",
    raw("DIV1", new Uint8Array(44), 0x10000),
    container("PRG1", bank("PBK1", 4960, 0, [entry("Hd", 4960)]), bank("MBK1", 4960, 1, [entry("Exi", 4960)])),
    container("CMB1", bank("CBK1", 7810, 0, [entry("Combi", 7810)])),
    container("DKT1"), container("WSQ1"))));

// Every editable row gets a random in-range value, so the edit buffer starts as a plausible sound.
function randomise(e: Uint8Array, rows: Row[], rnd: () => number): void {
  for (const r of rows) {
    if (r.continuation || r.fixed || r.name === "Name" || r.rawMax - r.rawMin > 100000) continue;
    writeParam(e, r, r.rawMin + Math.floor(rnd() * (r.rawMax - r.rawMin + 1)));
  }
}

function rig(tables: ParamTables, single: () => boolean, kind: (typeof KINDS)[number]) {
  const f = synth();
  const sim = new SimulatedKronos({ latencyMs: 0, tables });
  const client = new KronosClient(sim, { timeoutMs: 2000, paramSettleMs: 5 });
  const rows = rowsForKind(T, kind.kind);
  const e = getEntry(f, kind.key, 0);
  randomise(e, rows, rng(7));
  setEntry(f, kind.key, 0, e);
  const sender = new LiveSender({ client, channel: 0, key: kind.key, index: 0, tables: () => T, single });
  assert.equal(listBanks(f).find((b) => b.key === kind.key)!.objectSize, kind.size);
  const edit = (r: Row, v: number) => {
    const cur = getEntry(f, kind.key, 0);
    writeParam(cur, r, v);
    setEntry(f, kind.key, 0, cur);
  };
  const same = () => assert.deepEqual([...sim.editBuffer(kind.obj)!.data], [...getEntry(f, kind.key, 0).subarray(0, kind.size)]);
  return { f, sim, sender, rows, edit, same, key: kind.key };
}

for (const kind of KINDS) {
  test(`round trip, ${kind.kind}: 60 random single-row edits reach the simulator's edit buffer as parameter changes, no dump`, async () => {
    const x = rig(T, () => true, kind);
    await x.sender.send(x.f); // first load: the whole dump
    assert.deepEqual(x.sim.counts(), { dumps: 1, paramChanges: 0 });
    x.same();
    const rnd = rng(42);
    const pool = x.rows.filter((r) => encodeParamChange(0, r, getEntry(x.f, x.key, 0), x.rows) !== null);
    assert.ok(pool.length > 100, `only ${pool.length} mappable rows`);
    let changed = 0;
    for (let i = 0; i < 60; i++) {
      const r = pool[Math.floor(rnd() * pool.length)];
      const cur = readParam(getEntry(x.f, x.key, 0), r);
      const v = r.rawMin + Math.floor(rnd() * (r.rawMax - r.rawMin + 1));
      if (v === cur) continue;
      x.edit(r, v);
      await x.sender.send(x.f);
      changed++;
      x.same();
    }
    const c = x.sim.counts();
    assert.equal(c.dumps, 1, "an edit was sent as a whole dump");
    assert.ok(c.paramChanges >= changed && c.paramChanges <= changed * 2, `${c.paramChanges} messages for ${changed} edits`);
    assert.equal(x.sim.midiLog().filter((m) => m[4] === 0x75).length, 1, "a 0x75 dump went out after the first");
  });

  test(`round trip, ${kind.kind}: unmappable edits and bulk edits fall back to exactly one dump each`, async () => {
    const x = rig(T, () => true, kind);
    await x.sender.send(x.f);
    const typeRow = x.rows.find((r) => r.name === "Effect Type")!;
    const panpot = x.rows.find((r) => r.name === "Panpot" || r.name === "Pan")!;
    let dumps = 1;
    const dumpEdit = async (label: string, change: () => void) => {
      change();
      await x.sender.send(x.f);
      dumps++;
      assert.equal(x.sim.counts().dumps, dumps, label);
      x.same();
    };
    await dumpEdit("effect type", () => x.edit(typeRow, (readParam(getEntry(x.f, x.key, 0), typeRow) + 1) % 100));
    await dumpEdit("name", () => {
      const e = getEntry(x.f, x.key, 0);
      e[0] = e[0] === 0x41 ? 0x42 : 0x41;
      setEntry(x.f, x.key, 0, e);
    });
    await dumpEdit("bulk", () => {
      const e = getEntry(x.f, x.key, 0);
      for (let i = 0; i < 40; i++) e[200 + i] ^= 1;
      setEntry(x.f, x.key, 0, e);
    });
    assert.equal(x.sim.counts().paramChanges, 0);
    // a mappable edit right after still goes as a parameter change
    x.edit(panpot, (readParam(getEntry(x.f, x.key, 0), panpot) + 1) % 100);
    await x.sender.send(x.f);
    assert.deepEqual(x.sim.counts(), { dumps, paramChanges: 1 });
    x.same();
  });
}

test("with the setting off every edit is a whole dump, as before", async () => {
  const x = rig(T, () => false, KINDS[0]);
  await x.sender.send(x.f);
  x.edit(row(x.rows, "Insert Effect1", "Panpot"), 3);
  await x.sender.send(x.f);
  assert.deepEqual(x.sim.counts(), { dumps: 2, paramChanges: 0 });
  x.same();
});

test("calling a slot up again forgets what the keyboard held: the next send is a whole dump", async () => {
  const x = rig(T, () => true, KINDS[0]);
  await x.sender.send(x.f);
  x.sender.forget();
  x.edit(row(x.rows, "Insert Effect1", "Panpot"), 3);
  await x.sender.send(x.f);
  assert.deepEqual(x.sim.counts(), { dumps: 2, paramChanges: 0 });
});

test("a refused parameter (Reply 6) is repaired with one whole dump, not an error", async () => {
  const target = row(T.programHd1, "Insert Effect1", "Panpot");
  const strict = { ...T, programHd1: T.programHd1.map((r) => (r === target ? { ...r, rawMax: 10 } : r)) };
  const x = rig(strict, () => true, KINDS[0]);
  await x.sender.send(x.f);
  x.edit(target, 100);
  await x.sender.send(x.f);
  assert.deepEqual(x.sim.counts(), { dumps: 2, paramChanges: 1 });
  x.same();
});

test("a dragged slider: edits piling up while a send is in flight go out as the newest value, none lost", async () => {
  const x = rig(T, () => true, KINDS[2]);
  const sender = x.sender;
  const latest = new Latest((f: PcgFile) => sender.send(f), (e) => assert.fail(String(e)));
  await sender.send(x.f);
  const vol = row(T.combi, "Timbre3", "Volume");
  const pan = row(T.combi, "Timbre3", "Pan");
  for (let v = 1; v <= 20; v++) {
    x.edit(vol, v);
    if (v === 5) x.edit(pan, 9);
    latest.push(x.f);
  }
  await new Promise((r) => setTimeout(r, 120));
  const c = x.sim.counts();
  assert.equal(c.dumps, 1);
  assert.ok(c.paramChanges >= 2 && c.paramChanges < 20, `${c.paramChanges} messages for 20 edits`);
  x.same();
});
