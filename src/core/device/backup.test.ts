import assert from "node:assert/strict";
import { test } from "node:test";
import { bank, container, entry, file, leaf, raw } from "../pcg/synthetic.ts";
import { getGlobal, getEntry, listBanks, type BankInfo } from "../pcg/library.ts";
import { parsePcg, verifyChecksums, type PcgFile } from "../pcg/pcg.ts";
import { KronosClient, KronosError } from "./client.ts";
import { buildDiv1, buildSetListCompanion } from "./backup.ts";
import { pullFull, seedSimulator } from "./sync.ts";
import { SimulatedKronos } from "./simulator.ts";

// Synthetic only: every byte here is made up for the test.
const info = (kind: BankInfo["kind"], sysexBank: number | null, label: string): BankInfo => ({
  key: `${kind}:${label}`, kind, type: null, id: 0, label, sysexBank, count: 1, entrySize: 1, version: 0, objectSize: 1,
});
const words = (b: Uint8Array): number[] => Array.from({ length: 22 }, (_, i) => (b[i * 2] << 8) | b[i * 2 + 1]);

test("buildDiv1 sets the program, combi, drum and wave bits and the set list flag", () => {
  const d = buildDiv1([
    info("program", 0, "INT-A"), info("program", 5, "INT-F"), info("program", 0x40 + 3, "U-D"), info("program", 0x40 + 12, "U-GG"),
    info("combi", 2, "INT-C"), info("combi", 0x40, "U-A"),
    info("drumkit", 0, "INT"), info("drumkit", 0x41, "U-B"),
    info("waveseq", 0x40 + 13, "U-GG"),
    info("setlist", null, "SET"),
  ]);
  assert.equal(d.length, 44);
  assert.deepEqual(words(d), [
    0, 0,
    (1 << 0) | (1 << 5) | (1 << 9), 0x15, 1 << 2, 0x15, // program bits 0, 5, 9 (low word) and 18 (high word)
    (1 << 2) | (1 << 7), 0x0e, 0, 0x0e,                 // combi INT-C, user A at bit 7 (shortcut)
    (1 << 0) | (1 << 2), 0x0f, 0, 0x0f,                 // drum INT, user B
    1 << 14, 0x0f, 0, 0x0f,                             // wave user GG
    1, 1,
    0xffff, 0,
  ]);
});

test("buildDiv1 with no set lists writes 0 0 and no user bits for absent banks", () => {
  const w = words(buildDiv1([info("program", 0, "INT-A")]));
  assert.deepEqual(w.slice(18, 20), [0, 0]);
  assert.equal(w[2], 1);
});

test("buildSetListCompanion lays out the name, the size word and the slot names", () => {
  const e = new Uint8Array(69416);
  e.set(new TextEncoder().encode("My Set"), 0);
  e.set(new TextEncoder().encode("Slot five"), 24 + 542 * 5);
  const c = buildSetListCompanion(e);
  const dv = new DataView(c.buffer);
  assert.equal(c.length, 3612);
  assert.equal(new TextDecoder().decode(c.subarray(0, 6)), "My Set");
  assert.equal(dv.getUint32(24, true), 69416);
  assert.equal(new TextDecoder().decode(c.subarray(28 + 5 * 28, 28 + 5 * 28 + 9)), "Slot five");
  assert.equal(dv.getUint32(28 + 5 * 28 + 24, true), 542);
});

// A file with one program bank, a Set List bank with its companion, and Global.
const synthFile = (): PcgFile => {
  const programs = Array.from({ length: 128 }, (_, i) => entry(`Prog ${i}`, 4960, 0x21));
  const sets = Array.from({ length: 128 }, (_, i) => entry(`Set ${i}`, 69416, 0x33));
  const comps = sets.map(buildSetListCompanion);
  const global = Uint8Array.from({ length: 300 }, (_, i) => (i * 5) & 0xff);
  return parsePcg(file(container("PCG1",
    raw("DIV1", new Uint8Array(44), 0x10000),
    container("SLS1", container("SLD1", bank("SDB1", 3612, 0, comps)), container("STL1", bank("SBK1", 69416, 0, sets))),
    container("PRG1", bank("PBK1", 4960, 0, programs)),
    container("CMB1"), container("DKT1"), container("WSQ1"),
    leaf("GLB1", global))));
};

const rig = (f: PcgFile) => {
  const sim = new SimulatedKronos({ latencyMs: 0 });
  seedSimulator(sim, f);
  return { sim, client: new KronosClient(sim, { timeoutMs: 2000 }) };
};

test("seedSimulator seeds every Set List and Global", () => {
  const f = synthFile();
  const { sim } = rig(f);
  assert.equal(sim.storedObject(0x0d, 0, 127)?.data.length, 69416);
  assert.equal(sim.storedObject(0x0d, 0, 3)?.version, 0);
  assert.deepEqual(sim.storedObject(3, 0, 0)?.data, getGlobal(f));
});

test("pullFull brings back the banks, Set Lists, Global and an optional object", async () => {
  const f = synthFile();
  const { sim, client } = rig(f);
  const karma = Uint8Array.from([1, 2, 3, 4]);
  sim.seedObject(6, 0, 0, 1, karma);
  const seen: number[][] = [];

  const r = await pullFull(client, { onProgress: (d, t) => seen.push([d, t]) });

  assert.deepEqual(verifyChecksums(r.pcg), []);
  assert.deepEqual(listBanks(r.pcg).map((b) => b.key).sort(), listBanks(f).map((b) => b.key).sort());
  assert.deepEqual(getGlobal(r.pcg), getGlobal(f));
  assert.deepEqual(getEntry(r.pcg, "setlist:SET", 7), getEntry(f, "setlist:SET", 7));
  assert.deepEqual(r.objects, [{ obj: 6, bank: 0, index: 0, version: 1, data: karma }]);
  assert.deepEqual(r.report.failed, []);
  assert.ok(r.report.notIncluded.some((s) => /sample/i.test(s)));
  assert.ok(seen.length > 100, "progress was not reported");
  assert.equal(seen.at(-1)?.[0], seen.at(-1)?.[1]);
});

test("an optional object error is reported and the pull goes on", async () => {
  const f = synthFile();
  const { client } = rig(f);
  const real = client.requestObject.bind(client);
  client.requestObject = (o, b, i) => (o === 7 ? Promise.reject(new KronosError(2)) : real(o, b, i));

  const r = await pullFull(client);

  assert.equal(listBanks(r.pcg).length, listBanks(f).length);
  assert.ok(r.report.failed.some((x) => /KARMA Template/.test(x)), JSON.stringify(r.report.failed));
});

test("a Global error rejects the whole pull", async () => {
  const { client } = rig(synthFile());
  const real = client.requestObject.bind(client);
  client.requestObject = (o, b, i) => (o === 3 ? Promise.reject(new KronosError(2)) : real(o, b, i));
  await assert.rejects(pullFull(client), (e: Error) => e.name === "KronosError");
});

test("pullFull sends only read requests", async () => {
  const { sim, client } = rig(synthFile());
  const sent = new Set<number>();
  const real = sim.send.bind(sim);
  sim.send = (m: Uint8Array) => { sent.add(m[4]); real(m); };
  await pullFull(client);
  assert.deepEqual([...sent], [0x72]);
});
