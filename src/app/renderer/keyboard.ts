// Keyboard connections for the app: the simulator or USB, and the error text shown to the user.
import { KronosClient, KronosTimeoutError } from "../../core/device/client.ts";
import { SimulatedKronos } from "../../core/device/simulator.ts";
import { seedSimulator } from "../../core/device/sync.ts";
import type { MidiTransport } from "../../core/device/transport.ts";
import type { BankInfo } from "../../core/pcg/library.ts";
import type { PcgFile } from "../../core/pcg/pcg.ts";
import { connectKronos, type MidiAccessLike } from "./webmidi.ts";
import { nameFromBytes } from "./document.ts";
import { tapTransport } from "./midi-tap.ts";

export interface Link {
  readonly sim: SimulatedKronos | null;
  readonly client: KronosClient;
  readonly status: string;
  // The keyboard's MIDI channel, 0..15: the identity reply's device ID over USB, the simulator's channel 0.
  readonly channel: number;
  // Raw MIDI for the player; the same port as the client.
  send(msg: Uint8Array): void;
  close(): void;
}

// Object type and bank address per KORG's document, as in sync.ts (not exported there).
const OBJ_TYPE: Record<Exclude<BankInfo["kind"], "setlist">, number> = { program: 0, combi: 1, drumkit: 4, waveseq: 5 };

export function kronosAddress(info: BankInfo): { obj: number; bank: number } | null {
  if (info.kind === "setlist" || info.sysexBank === null) return null;
  return { obj: OBJ_TYPE[info.kind], bank: info.sysexBank };
}

export function connectSimulated(file: PcgFile): Link {
  const sim = new SimulatedKronos();
  seedSimulator(sim, file);
  const transport = tapTransport(sim);
  const client = new KronosClient(transport);
  return {
    sim,
    client,
    status: "Simulated Kronos, OS 3.1.2",
    channel: 0,
    send: (msg) => transport.send(msg),
    close: () => {
      client.close();
      transport.close();
    },
  };
}

export async function connectUsb(): Promise<Link> {
  if (!navigator.requestMIDIAccess) throw new Error("This window has no MIDI access.");
  const access = await navigator.requestMIDIAccess({ sysex: true });
  // The DOM MIDI types are wider than MidiAccessLike, which is all connectKronos uses.
  const c = await connectKronos(access as unknown as MidiAccessLike, { wrap: tapTransport });
  const [a, b, d] = c.identity.version;
  return {
    sim: null,
    client: c.client,
    status: `Kronos, OS ${a}.${b}.${d}, on ${c.outputName}`,
    channel: c.identity.channel,
    send: (msg) => c.transport.send(msg),
    close: () => {
      c.client.close();
      (c.transport as MidiTransport).close();
    },
  };
}

// The simulator's object keeps the name in its first 24 bytes.
export function simulatedName(sim: SimulatedKronos, info: BankInfo, index: number, which: "temp" | "stored"): string {
  const addr = kronosAddress(info);
  if (!addr) throw new Error(`${info.key} is not on the keyboard`);
  const slot = which === "temp" ? sim.tempObject(addr.obj, addr.bank, index) : sim.storedObject(addr.obj, addr.bank, index);
  if (!slot) throw new Error(`${info.key} ${index} is not on the simulator`);
  return nameFromBytes(slot.data);
}

export function describeError(e: unknown): string {
  if (e instanceof KronosTimeoutError) {
    return `The keyboard stopped answering (${e.message}). Check the USB cable, that the keyboard is on and that no other MIDI program is using it, then try again.`;
  }
  const msg = e instanceof Error ? e.message : String(e);
  const clean = msg.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
  return /wrong program bank type/i.test(clean) ? `${clean} This usually means that bank holds a different kind of sound on the keyboard (HD-1 or EXi) than in your file: press Check everything, then Pull This Bank for it.` : clean;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const stamp = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

export const backupName = (key: string, op: "send" | "store" | "sync"): string => `${key.replace(":", "-")}-before-${op}-${stamp()}.PCG`;
