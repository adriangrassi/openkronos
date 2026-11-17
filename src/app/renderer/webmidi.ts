// Finds the Kronos by asking each MIDI output for its identity, never by port name.
import { KronosClient } from "../../core/device/client.ts";
import type { MidiTransport } from "../../core/device/transport.ts";
import { DEVICE_INQUIRY, parseDeviceInquiryReply, type DeviceInquiryReply } from "../../core/sysex/message.ts";

// Narrower than the DOM types on purpose: the tests pass plain fakes, and the renderer passes the real MIDIAccess.
export interface MidiPortLike {
  readonly id: string;
  readonly name: string | null;
}
export interface MidiInputLike extends MidiPortLike {
  addEventListener(type: "midimessage", listener: (e: { data: Uint8Array | null }) => void): void;
  removeEventListener(type: "midimessage", listener: (e: { data: Uint8Array | null }) => void): void;
}
export interface MidiOutputLike extends MidiPortLike {
  send(data: Uint8Array | number[]): void;
}
export interface MidiAccessLike {
  readonly inputs: { values(): Iterable<MidiInputLike> };
  readonly outputs: { values(): Iterable<MidiOutputLike> };
}

export interface KronosConnection {
  client: KronosClient;
  transport: MidiTransport;
  identity: DeviceInquiryReply;
  inputName: string;
  outputName: string;
}

type Listener = (input: MidiInputLike, data: Uint8Array) => void;

const KORG_MANUFACTURER = 0x42;
const KRONOS_FAMILY = 0x68;

function askOutput(output: MidiOutputLike, listeners: Set<Listener>, timeoutMs: number): Promise<{ input: MidiInputLike; reply: DeviceInquiryReply } | null> {
  return new Promise((resolve) => {
    const finish = (hit: { input: MidiInputLike; reply: DeviceInquiryReply } | null) => {
      listeners.delete(listener);
      clearTimeout(timer);
      resolve(hit);
    };
    const listener: Listener = (input, data) => {
      const reply = parseDeviceInquiryReply(data);
      if (reply && reply.manufacturer === KORG_MANUFACTURER && reply.family === KRONOS_FAMILY) finish({ input, reply });
    };
    listeners.add(listener);
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      output.send(DEVICE_INQUIRY);
    } catch {
      finish(null);
    }
  });
}

export async function connectKronos(
  access: MidiAccessLike,
  opts: { timeoutMs?: number; wrap?: (t: MidiTransport) => MidiTransport } = {},
): Promise<KronosConnection> {
  const timeoutMs = opts.timeoutMs ?? 1000;
  const inputs = [...access.inputs.values()];
  const outputs = [...access.outputs.values()];
  const listeners = new Set<Listener>();

  // Every input feeds one shared dispatch, so a reply is matched to the port it came from.
  const detachers = inputs.map((input) => {
    const onMessage = (e: { data: Uint8Array | null }) => {
      if (e.data) for (const l of [...listeners]) l(input, e.data);
    };
    input.addEventListener("midimessage", onMessage);
    return () => input.removeEventListener("midimessage", onMessage);
  });
  const detachAll = () => detachers.forEach((d) => d());

  for (const output of outputs) {
    const hit = await askOutput(output, listeners, timeoutMs);
    if (!hit) continue;
    const { input, reply } = hit;
    const raw: MidiTransport = {
      send: (msg) => output.send(msg),
      onMessage: (cb) => {
        const l: Listener = (from, data) => {
          if (from === input) cb(data);
        };
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      },
      close: () => {
        listeners.clear();
        detachAll();
      },
    };
    // shortcut: the device inquiry during connect is not wrapped, so it is not in the monitor; upgrade if someone needs it
    const transport = opts.wrap ? opts.wrap(raw) : raw;
    return {
      // The SysEx header carries the keyboard's Global MIDI channel (F0 42 3g ...): a request on any other channel is ignored.
      client: new KronosClient(transport, { channel: reply.channel <= 15 ? reply.channel : 0 }),
      transport,
      identity: reply,
      inputName: input.name ?? input.id,
      outputName: output.name ?? output.id,
    };
  }

  detachAll();
  throw new Error(`No Kronos found: asked ${outputs.length} MIDI output(s) for an identity and none answered as a KORG Kronos.`);
}
