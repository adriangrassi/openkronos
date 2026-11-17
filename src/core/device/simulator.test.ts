import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKorg } from "../sysex/message.ts";
import { encode7 } from "../sysex/encoding.ts";
import { KronosClient, KronosError } from "./client.ts";
import { SimulatedKronos } from "./simulator.ts";
import { coalescedSender, masterVolumeMessage } from "../midi/masterVolume.ts";
import { setListSelectBytes } from "../midi/setlist.ts";
import { stepSlot } from "../pcg/setlist.ts";
import { decodeMessage } from "../midi/monitor.ts";

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
const setup = () => {
  const s = new SimulatedKronos();
  return { s, c: new KronosClient(s, { timeoutMs: 300 }) };
};

test("simulator identifies as the owner's Kronos on channel 0", async () => {
  const { c } = setup();
  const r = await c.identify();
  assert.equal(r.family, 0x68);
  assert.equal(r.member, 0x17);
  assert.deepEqual(r.version.slice(0, 3), [3, 1, 2]);
});

test("simulator serves a seeded object and reports a missing one as code 4", async () => {
  const { s, c } = setup();
  const data = bytes(64, 1);
  s.seedObject(0, 0x40, 5, 5, data);
  const r = await c.requestObject(0, 0x40, 5);
  assert.equal(r.version, 5);
  assert.deepEqual([...r.data], [...data]);
  await assert.rejects(c.requestObject(0, 0x40, 99), (e: unknown) => e instanceof KronosError && e.code === 4);
});

test("an object dump is temporary until Store Bank, and a power cycle drops it", async () => {
  const { s, c } = setup();
  const a = bytes(40, 1);
  const b = bytes(40, 2);
  s.seedObject(0, 0x40, 5, 5, a);
  await c.sendObject(0, 0x40, 5, 5, b);
  assert.deepEqual([...(await c.requestObject(0, 0x40, 5)).data], [...b]);
  assert.deepEqual([...s.storedObject(0, 0x40, 5)!.data], [...a]);
  s.powerCycle();
  assert.deepEqual([...(await c.requestObject(0, 0x40, 5)).data], [...a]);
});

test("Store Bank makes one bank permanent and leaves the others alone", async () => {
  const { s, c } = setup();
  const a = bytes(20, 1);
  const b = bytes(20, 2);
  s.seedObject(0, 0x40, 5, 5, a);
  s.seedObject(0, 0x41, 5, 5, a);
  await c.sendObject(0, 0x40, 5, 5, b);
  await c.sendObject(0, 0x41, 5, 5, b);
  await c.storeBank(0, 0x40);
  s.powerCycle();
  assert.deepEqual([...(await c.requestObject(0, 0x40, 5)).data], [...b]);
  assert.deepEqual([...(await c.requestObject(0, 0x41, 5)).data], [...a]);
});

test("a write to a read-only program bank is refused with code 65 and changes nothing", async () => {
  const { s, c } = setup();
  const a = bytes(20, 1);
  s.seedObject(0, 0x10, 0, 5, a);
  await assert.rejects(c.sendObject(0, 0x10, 0, 5, bytes(20, 9)), (e: unknown) => e instanceof KronosError && e.code === 65);
  assert.deepEqual([...s.storedObject(0, 0x10, 0)!.data], [...a]);
});

test("bank digest is 20 bytes, changes only after Store Bank", async () => {
  const { s, c } = setup();
  s.seedObject(0, 0x40, 5, 5, bytes(30, 1));
  const before = await c.bankDigest(0, 0x40);
  assert.equal(before.length, 20);
  await c.sendObject(0, 0x40, 5, 5, bytes(30, 2));
  assert.deepEqual([...(await c.bankDigest(0, 0x40))], [...before]);
  await c.storeBank(0, 0x40);
  assert.notDeepEqual([...(await c.bankDigest(0, 0x40))], [...before]);
});

test("replies arrive asynchronously, never from inside send", () => {
  const s = new SimulatedKronos();
  let got = 0;
  s.onMessage(() => got++);
  s.send(buildKorg(0, 0x12, []));
  assert.equal(got, 0);
});

test("a truncated dump gets Reply 24 code 3", async () => {
  const s = new SimulatedKronos({ latencyMs: 1 });
  const replies: Uint8Array[] = [];
  s.onMessage((m) => replies.push(m));
  s.send(Uint8Array.from([0xf0, 0x42, 0x30, 0x68, 0x73, 0x00, 0xf7]));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(replies.length, 1);
  assert.deepEqual([...replies[0]], [0xf0, 0x42, 0x30, 0x68, 0x24, 0x03, 0xf7]);
});

test("simulator honours its channel and ignores other channels", async () => {
  const s = new SimulatedKronos({ channel: 2, latencyMs: 1 });
  const replies: Uint8Array[] = [];
  s.onMessage((m) => replies.push(m));
  s.send(buildKorg(0, 0x72, [0, 0x40, 0, 5]));
  s.send(buildKorg(2, 0x72, [0, 0x40, 0, 5]));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(replies.length, 1);
  assert.equal(replies[0][2], 0x32);
  assert.equal(replies[0][5], 4);
});

test("the Current Object Dump fills an edit buffer and counts; a Parameter Change without tables is counted and changes nothing", async () => {
  const sim = new SimulatedKronos({ latencyMs: 0 });
  const replies: number[][] = [];
  sim.onMessage((m) => replies.push([...m]));
  sim.send(buildKorg(0, 0x75, [0, 5, ...encode7(Uint8Array.of(1, 2, 3))]));
  sim.send(buildKorg(0, 0x43, [7, 0, 0, 6, 0, 0, 0, 100]));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sim.counts(), { dumps: 1, paramChanges: 1 });
  assert.deepEqual([...sim.editBuffer(0)!.data], [1, 2, 3]);
  assert.deepEqual(replies, [[0xf0, 0x42, 0x30, 0x68, 0x24, 0, 0xf7]]);
  sim.send(buildKorg(0, 0x43, [7, 0, 0]));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(replies.at(-1)![5], 3);
});

test("simulator counts Master Volume messages and keeps the last value, and the monitor shows a SysEx row", async () => {
  const { s } = setup();
  const sent = coalescedSender((v) => s.send(masterVolumeMessage(v, 0)), 10);
  sent.set(10 * 129);
  sent.set(50 * 129);
  sent.set(127 * 129);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(s.masterVolume, { count: 2, last: 16383 });
  assert.equal(decodeMessage(masterVolumeMessage(16383, 0)).type, "SysEx");
  assert.deepEqual(decodeMessage(masterVolumeMessage(16383, 0)).values, "8 bytes F0 7F 00 04 01 7F 7F F7");
});

test("a Set List select reaches the simulator as three messages in order; Next at slot 127 stays", () => {
  const s = new SimulatedKronos();
  for (const m of setListSelectBytes(2, 126, 0)) s.send(m);
  assert.deepEqual(s.midiLog(), [[0xb0, 0, 0], [0xb0, 0x20, 2], [0xc0, 126]]);
  assert.deepEqual(s.setListSelect, { count: 1, set: 2, slot: 126 });
  for (const m of setListSelectBytes(2, stepSlot(127, 1), 0)) s.send(m);
  assert.deepEqual(s.setListSelect, { count: 2, set: 2, slot: 127 });
});

test("simulator answers a Current Object Dump Request with its edit buffer, code 4 when nothing was sent, and can be made to differ", async () => {
  const { s, c } = setup();
  await assert.rejects(c.requestCurrentObject(0), (e: Error) => e instanceof KronosError && e.code === 4);
  const data = bytes(40, 3);
  await c.sendCurrentObject(0, 5, data);
  const r = await c.requestCurrentObject(0);
  assert.equal(r.version, 5);
  assert.deepEqual([...r.data], [...data]);
  const other = bytes(40, 9);
  s.setEditBuffer(0, 5, other);
  assert.deepEqual([...(await c.requestCurrentObject(0)).data], [...other]);
  c.close();
});
