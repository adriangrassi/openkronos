import assert from "node:assert/strict";
import { test } from "node:test";
import { bank, container, entry, file, raw } from "../pcg/synthetic.ts";
import { getEntry, getName, listBanks, setEntry, setName } from "../pcg/library.ts";
import { parsePcg, serializePcg, verifyChecksums, type PcgFile } from "../pcg/pcg.ts";
import { Fn } from "../sysex/message.ts";
import { KronosClient } from "./client.ts";
import { SimulatedKronos } from "./simulator.ts";
import { pullBank, pullKeyboard, pushEntries, seedSimulator } from "./sync.ts";

// Synthetic library: one HD-1 program bank (INT-A) of 128 slots, padded to 4960 bytes. Contains no KORG data.
const synth = (): PcgFile => {
  const programs = Array.from({ length: 128 }, (_, i) => entry(`Synth ${i}`, 4960, 0x5a));
  return parsePcg(file(container("PCG1",
    raw("DIV1", new Uint8Array(44), 0x10000),
    container("PRG1", bank("PBK1", 4960, 0, programs)),
    container("CMB1"), container("DKT1"), container("WSQ1"))));
};

const rig = (f: PcgFile) => {
  const sim = new SimulatedKronos({ latencyMs: 0 });
  seedSimulator(sim, f);
  return { sim, client: new KronosClient(sim, { timeoutMs: 2000 }) };
};

test("pullBank restores the object bytes and keeps the slot tail", async () => {
  const f = synth();
  const { client } = rig(f);
  setName(f, "program:INT-A", 3, "Local");
  const edited = getEntry(f, "program:INT-A", 3);
  edited.fill(0x77, 3706);
  setEntry(f, "program:INT-A", 3, edited);

  await pullBank(client, f, "program:INT-A");

  assert.equal(getName(f, "program:INT-A", 3), "Synth 3");
  assert.ok(getEntry(f, "program:INT-A", 3).subarray(3706).every((b) => b === 0x77), "tail past 3706 changed");
  assert.deepEqual(verifyChecksums(f), []);
});

test("a cancelled pull changes nothing", async () => {
  const f = synth();
  const { client } = rig(f);
  setName(f, "program:INT-A", 0, "Keep");
  const before = serializePcg(f);
  const ac = new AbortController();
  await assert.rejects(
    pullBank(client, f, "program:INT-A", { signal: ac.signal, onProgress: (d) => { if (d === 5) ac.abort(); } }),
    (e: Error) => e.name === "AbortError",
  );
  assert.deepEqual(serializePcg(f), before);
});

test("pushEntries sends only the named slots and never a Store Bank", async () => {
  const f = synth();
  const { sim, client } = rig(f);
  const sent: number[] = [];
  const real = sim.send.bind(sim);
  sim.send = (m: Uint8Array) => { sent.push(m[4]); real(m); };

  await pushEntries(client, f, "program:INT-A", [1, 2]);

  assert.equal(sent.length, 2);
  assert.ok(sent.every((fn) => fn === Fn.objectDump), `unexpected functions ${sent.map((x) => x.toString(16))}`);
});

test("pullKeyboard builds a library from the keyboard alone and survives a save", async () => {
  const f = synth();
  const { client } = rig(f);
  const seen: number[][] = [];

  const pulled = await pullKeyboard(client, { onProgress: (d, t) => seen.push([d, t]) });

  const info = listBanks(pulled).find((b) => b.key === "program:INT-A");
  assert.ok(info, "program:INT-A missing");
  assert.equal(info.type, "hd1");
  assert.equal(info.count, 128);
  assert.equal(getName(pulled, "program:INT-A", 42), "Synth 42");
  assert.ok(getEntry(pulled, "program:INT-A", 42).subarray(3706).every((b) => b === 0), "pulled tail should be zero");
  assert.deepEqual(verifyChecksums(pulled), []);
  assert.equal(seen.at(-1)?.[0], seen.at(-1)?.[1], "final progress should equal the total");
  assert.equal(listBanks(parsePcg(serializePcg(pulled))).length, listBanks(pulled).length);
});
