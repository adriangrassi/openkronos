import assert from "node:assert/strict";
import { test } from "node:test";
import { connectKronos, type MidiAccessLike, type MidiInputLike, type MidiOutputLike } from "./webmidi.ts";

const REPLY = [0xf0, 0x7e, 0, 6, 2, 0x42, 0x68, 0, 0x17, 0, 3, 1, 2, 0, 0xf7];

// Fake port: one listener slot, like the test helpers in the gate.
function fakeInput(name: string) {
  let listener: ((e: { data: Uint8Array | null }) => void) | null = null;
  const port: MidiInputLike & { fire(d: number[]): void } = {
    id: name,
    name,
    addEventListener: (_t, l) => {
      listener = l;
    },
    removeEventListener: () => {
      listener = null;
    },
    fire: (d) => listener?.({ data: Uint8Array.from(d) }),
  };
  return port;
}

function fakeAccess(answerOn: string | null, deviceId = 0) {
  const reply = REPLY.map((v, i) => (i === 2 ? deviceId : v));
  const inputs = [fakeInput("Other Gear"), fakeInput("KRONOS")];
  const sent: Uint8Array[] = [];
  const outputs: MidiOutputLike[] = ["Microsoft GS Wavetable Synth", "KRONOS"].map((name, i) => ({
    id: name,
    name,
    send(d: Uint8Array | number[]) {
      const bytes = Uint8Array.from(d);
      sent.push(bytes);
      if (name === answerOn) setTimeout(() => inputs[i].fire(reply), 1);
    },
  }));
  const access: MidiAccessLike = {
    inputs: { values: () => inputs },
    outputs: { values: () => outputs },
  };
  return { access, sent, inputs };
}

test("finds the Kronos by its reply, not by port name", async () => {
  const { access } = fakeAccess("KRONOS");
  const c = await connectKronos(access, { timeoutMs: 100 });
  assert.equal(c.identity.family, 0x68);
  assert.equal(c.outputName, "KRONOS");
  assert.equal(c.inputName, "KRONOS");
});

test("rejects with No Kronos found when nothing answers", async () => {
  const { access } = fakeAccess(null);
  await assert.rejects(connectKronos(access, { timeoutMs: 20 }), /No Kronos found/);
});

test("transport sends whole messages, and delivers only the chosen port's replies", async () => {
  const { access, sent, inputs } = fakeAccess("KRONOS");
  const c = await connectKronos(access, { timeoutMs: 100 });
  const received: Uint8Array[] = [];
  const stop = c.transport.onMessage((m) => received.push(m));
  const sysex = [0xf0, 0x42, 0x30, 0x68, 0x00, 0xf7];
  c.transport.send(Uint8Array.from(sysex));
  assert.deepEqual(Array.from(sent.at(-1) ?? []), sysex);
  // The other port's traffic is ignored; the Kronos port's reply arrives whole.
  inputs[0].fire(sysex);
  inputs[1].fire(sysex);
  assert.equal(received.length, 1);
  assert.deepEqual(Array.from(received[0]), sysex);
  stop();
  c.transport.close();
});

test("requests use the Global MIDI channel the keyboard reports, not channel 1", async () => {
  const { access, sent } = fakeAccess("KRONOS", 14);
  const c = await connectKronos(access, { timeoutMs: 100 });
  sent.length = 0;
  const pending = c.client.requestObject(0, 0, 0).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][2], 0x3e, "header is 3g with g = 14");
  c.client.close();
  await pending;
});
