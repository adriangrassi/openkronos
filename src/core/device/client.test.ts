import { test } from "node:test";
import assert from "node:assert/strict";
import { encode7 } from "../sysex/encoding.ts";
import { buildKorg, DEVICE_INQUIRY } from "../sysex/message.ts";
import { KronosClient, KronosError, KronosTimeoutError } from "./client.ts";
import type { MidiTransport } from "./transport.ts";

// A transport the test drives by hand: it records what was sent and lets the test inject replies.
class ManualTransport implements MidiTransport {
  sent: Uint8Array[] = [];
  private listeners = new Set<(msg: Uint8Array) => void>();
  send(msg: Uint8Array): void {
    this.sent.push(Uint8Array.from(msg));
  }
  onMessage(cb: (msg: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  close(): void {
    this.listeners.clear();
  }
  inject(msg: Uint8Array): void {
    for (const cb of [...this.listeners]) cb(msg);
  }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const korgReply = (fn: number, payload: number[], channel = 0) => buildKorg(channel, fn, payload);
const replyCode = (code: number, channel = 0) => korgReply(0x24, [code], channel);
const payloadOf = (fn: number, payload: number[]) => buildKorg(0, fn, payload);
const DATA = Uint8Array.from({ length: 30 }, (_, i) => (i * 29 + 3) & 0xff);
const WIRE = [...encode7(DATA)];

function setup(timeoutMs = 200) {
  const t = new ManualTransport();
  const c = new KronosClient(t, { timeoutMs });
  return { t, c };
}

test("identify sends the inquiry and returns the keyboard's identity", async () => {
  const { t, c } = setup();
  const p = c.identify();
  await tick();
  assert.deepEqual([...t.sent[0]], [...DEVICE_INQUIRY]);
  t.inject(Uint8Array.from([0xf0, 0x7e, 0x00, 0x06, 0x02, 0x42, 0x68, 0x00, 0x17, 0x00, 0x03, 0x01, 0x02, 0x00, 0xf7]));
  const r = await p;
  assert.equal(r.family, 0x68);
  assert.equal(r.member, 0x17);
});

test("identify refuses a device that is not a Kronos", async () => {
  const { t, c } = setup();
  const p = c.identify();
  await tick();
  t.inject(Uint8Array.from([0xf0, 0x7e, 0x00, 0x06, 0x02, 0x41, 0x68, 0x00, 0x17, 0x00, 0x03, 0x01, 0x02, 0x00, 0xf7]));
  await assert.rejects(p, Error);
});

test("requestObject decodes the dump and checks the echoed address", async () => {
  const { t, c } = setup();
  const p = c.requestObject(0, 0x40, 5);
  await tick();
  assert.deepEqual([...t.sent[0]], [0xf0, 0x42, 0x30, 0x68, 0x72, 0, 0x40, 0, 5, 0xf7]);
  t.inject(payloadOf(0x73, [0, 0x40, 0, 6, 5, ...WIRE])); // wrong index: ignored
  t.inject(payloadOf(0x73, [0, 0x40, 0, 5, 5, ...WIRE]));
  const r = await p;
  assert.equal(r.version, 5);
  assert.deepEqual([...r.data], [...DATA]);
});

test("a Reply 24 error becomes a KronosError with its code", async () => {
  const { t, c } = setup();
  const p = c.requestObject(0, 0x40, 5);
  await tick();
  t.inject(replyCode(4));
  await assert.rejects(p, (e: unknown) => e instanceof KronosError && e.name === "KronosError" && e.code === 4);
});

test("an index above 127 is split into high and low 7-bit bytes", async () => {
  const { t, c } = setup();
  const p = c.requestObject(0x0d, 0, 200).catch(() => {});
  await tick();
  assert.deepEqual([...t.sent[0]], [0xf0, 0x42, 0x30, 0x68, 0x72, 0x0d, 0x00, 0x01, 0x48, 0xf7]);
  t.inject(replyCode(4));
  await p;
});

test("sendObject sends one dump, never a Store Bank Request, and resolves on code 0", async () => {
  const { t, c } = setup();
  const p = c.sendObject(0, 0x40, 5, 5, DATA);
  await tick();
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0][4], 0x73);
  t.inject(replyCode(0));
  await p;
  assert.ok(!t.sent.some((m) => m[4] === 0x76));
});

test("sendObject to a protected object rejects with code 65", async () => {
  const { t, c } = setup();
  const p = c.sendObject(0, 0x10, 0, 5, DATA);
  await tick();
  t.inject(replyCode(65));
  await assert.rejects(p, (e: unknown) => e instanceof KronosError && e.code === 65);
});

test("storeBank sends the 76 request and resolves on code 0", async () => {
  const { t, c } = setup();
  const p = c.storeBank(0, 0x40);
  await tick();
  assert.deepEqual([...t.sent[0]], [0xf0, 0x42, 0x30, 0x68, 0x76, 0x00, 0x40, 0xf7]);
  t.inject(replyCode(0));
  await p;
});

test("bankDigest returns the 20 decoded digest bytes", async () => {
  const { t, c } = setup();
  const digest = Uint8Array.from({ length: 20 }, (_, i) => 0x80 + i);
  const p = c.bankDigest(0, 0x40);
  await tick();
  assert.deepEqual([...t.sent[0]], [0xf0, 0x42, 0x30, 0x68, 0x37, 0, 0x40, 0xf7]);
  t.inject(payloadOf(0x38, [0, 0x40, ...encode7(digest)]));
  assert.deepEqual([...(await p)], [...digest]);
});

test("a silent keyboard times out with KronosTimeoutError, and the next request still runs", async () => {
  const { t, c } = setup(40);
  await assert.rejects(c.requestObject(0, 0x40, 5), (e: unknown) => e instanceof KronosTimeoutError);
  const p = c.requestObject(0, 0x40, 6);
  await tick();
  t.inject(payloadOf(0x73, [0, 0x40, 0, 6, 5, ...WIRE]));
  await p;
});

test("requests run one at a time", async () => {
  const { t, c } = setup();
  const a = c.requestObject(0, 0x40, 1);
  const b = c.requestObject(0, 0x40, 2);
  await tick();
  assert.equal(t.sent.length, 1);
  t.inject(payloadOf(0x73, [0, 0x40, 0, 1, 5, ...WIRE]));
  await a;
  await tick();
  assert.equal(t.sent.length, 2);
  t.inject(payloadOf(0x73, [0, 0x40, 0, 2, 5, ...WIRE]));
  await b;
});

test("other channels, other gear and stray bytes do not answer a pending request", async () => {
  const { t, c } = setup(80);
  let settled = false;
  const p = c.requestObject(0, 0x40, 5).finally(() => {
    settled = true;
  });
  await tick();
  t.inject(Uint8Array.from([0xf8]));
  t.inject(Uint8Array.from([0xf0, 0x41, 0x10, 0x42, 0x12, 0xf7]));
  t.inject(korgReply(0x24, [0], 4));
  t.inject(buildKorg(7, 0x73, [0, 0x40, 0, 5, 5, ...WIRE]));
  await tick(10);
  assert.equal(settled, false);
  t.inject(payloadOf(0x73, [0, 0x40, 0, 5, 5, ...WIRE]));
  await p;
});

test("channel option is used on the wire", async () => {
  const t = new ManualTransport();
  const c = new KronosClient(t, { channel: 3, timeoutMs: 200 });
  const p = c.storeBank(1, 0x40);
  await tick();
  assert.deepEqual([...t.sent[0]], [0xf0, 0x42, 0x33, 0x68, 0x76, 0x01, 0x40, 0xf7]);
  t.inject(replyCode(0, 3));
  await p;
});

test("close rejects what is waiting and stops listening", async () => {
  const { t, c } = setup();
  const p = c.requestObject(0, 0x40, 5);
  await tick();
  c.close();
  await assert.rejects(p, /closed/);
  t.inject(payloadOf(0x73, [0, 0x40, 0, 5, 5, ...WIRE]));
  await assert.rejects(c.storeBank(0, 0x40), /closed/);
});

const PARAM = buildKorg(0, 0x43, [7, 0, 0, 6, 0, 0, 0, 100]);

test("a parameter change is done after the settle time when the keyboard stays silent, and the next request waits for it", async () => {
  const t = new ManualTransport();
  const c = new KronosClient(t, { timeoutMs: 1000, paramSettleMs: 10 });
  let done = false;
  const p = c.sendParamChange(PARAM).then(() => { done = true; });
  const q = c.sendCurrentObject(0, 5, new Uint8Array(7));
  await tick(2);
  assert.equal(t.sent.length, 1);
  assert.equal(done, false);
  await p;
  await tick(2);
  assert.equal(t.sent.length, 2);
  t.inject(replyCode(0));
  await q;
  c.close();
});

test("a parameter change answered with an error reply fails with that code, Reply 0 finishes it early", async () => {
  const t = new ManualTransport();
  const c = new KronosClient(t, { timeoutMs: 1000, paramSettleMs: 500 });
  const bad = c.sendParamChange(PARAM);
  t.inject(replyCode(6));
  await assert.rejects(bad, (e: Error) => e instanceof KronosError && e.code === 6);
  const good = c.sendParamChange(PARAM);
  t.inject(replyCode(0));
  await good;
  c.close();
});

test("only a Parameter Change (integer) for this channel can be sent as one", async () => {
  const c = new KronosClient(new ManualTransport());
  await assert.rejects(c.sendParamChange(buildKorg(0, 0x75, [0, 5])), RangeError);
  await assert.rejects(c.sendParamChange(buildKorg(1, 0x43, [7, 0, 0, 6, 0, 0, 0, 1])), RangeError);
  c.close();
});

test("requestCurrentObject sends function 0x74 with the type and decodes the 0x75 reply", async () => {
  const { t, c } = setup();
  const p = c.requestCurrentObject(1);
  await tick();
  assert.deepEqual([...t.sent[0]], [0xf0, 0x42, 0x30, 0x68, 0x74, 1, 0xf7]);
  t.inject(payloadOf(0x75, [0, 5, ...WIRE]));
  t.inject(payloadOf(0x75, [1, 5, ...WIRE]));
  const r = await p;
  assert.equal(r.version, 5);
  assert.deepEqual([...r.data], [...DATA]);
  c.close();
});

test("requestCurrentObject fails with the keyboard's code, and a silent keyboard gives a labelled timeout", async () => {
  const t = new ManualTransport();
  const c = new KronosClient(t, { timeoutMs: 20 });
  const bad = c.requestCurrentObject(0);
  t.inject(replyCode(4));
  await assert.rejects(bad, (e: Error) => e instanceof KronosError && e.code === 4);
  await assert.rejects(c.requestCurrentObject(0), (e: Error) => e instanceof KronosTimeoutError && /current object dump request \(type 0\)/.test(e.message));
  c.close();
});
