// Records every message a Link sends or receives into the monitor, and tracks which incoming notes are held for the keys.
// The keys redraw once per animation frame; the monitor table redraws at most every 250 ms, since each redraw rebuilds every row.
import { MonitorLog, type Dir, type MonitorEntry } from "../../core/midi/monitor.ts";
import type { MidiTransport } from "../../core/device/transport.ts";

export const monitor = new MonitorLog(2000);
// Active Sensing (about 3 a second) is kept apart so it cannot evict real traffic from the ring.
const sensing = new MonitorLog(200);
let sensingShown = false;
const heldIn = new Set<number>();
const listeners = new Set<() => void>();
const monitorListeners = new Set<() => void>();
let version = 0;
let frame = 0;
let monitorTimer = 0;

function flush(): void {
  frame = 0;
  for (const l of [...listeners]) l();
}

function flushMonitor(): void {
  monitorTimer = 0;
  for (const l of [...monitorListeners]) l();
}

function changed(): void {
  version++;
  if (!frame) frame = requestAnimationFrame(flush);
  if (!monitorTimer) monitorTimer = window.setTimeout(flushMonitor, 250);
}

export function subscribeMidi(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function subscribeMonitor(cb: () => void): () => void {
  monitorListeners.add(cb);
  return () => {
    monitorListeners.delete(cb);
  };
}

export const midiVersion = (): number => version;
export const isHeldIn = (n: number): boolean => heldIn.has(n);

// The table's rows: the ring, plus Active Sensing when it is shown. Sorted by time; the ring and the sensing log each number their own seq.
export function monitorEntries(): MonitorEntry[] {
  if (!sensingShown) return monitor.entries();
  return [...monitor.entries(), ...sensing.entries()].sort((a, b) => a.time - b.time);
}

export function setSensingShown(on: boolean): void {
  sensingShown = on;
  changed();
}

function trackHeld(b: Uint8Array): void {
  if (b.length < 3) return;
  const kind = b[0] & 0xf0;
  if (kind === 0x90 && b[2] > 0) heldIn.add(b[1]);
  else if (kind === 0x80 || kind === 0x90) heldIn.delete(b[1]);
}

const incoming = new Set<(msg: Uint8Array, t: number) => void>();
// The recorder listens here for every message the keyboard sends.
export function subscribeIncoming(cb: (msg: Uint8Array, t: number) => void): () => void {
  incoming.add(cb);
  return () => {
    incoming.delete(cb);
  };
}

const outgoing = new Set<(msg: Uint8Array) => void>();
export function subscribeOutgoing(cb: (msg: Uint8Array) => void): () => void {
  outgoing.add(cb);
  return () => {
    outgoing.delete(cb);
  };
}

function record(dir: Dir, msg: Uint8Array): void {
  const t = performance.now();
  if (dir === "in") for (const l of [...incoming]) l(msg, t);
  else for (const l of [...outgoing]) l(msg);
  if (msg[0] === 0xfe) {
    sensing.add(dir, msg, t);
    if (!sensingShown) return; // hidden: no redraw
  } else {
    monitor.add(dir, msg, t);
    if (dir === "in") trackHeld(msg);
  }
  changed();
}

export function clearMonitor(): void {
  monitor.clear();
  sensing.clear();
  changed();
}

// Wraps a transport so both directions are recorded. Replaces nothing: the wrapped transport still does the work.
export function tapTransport(t: MidiTransport): MidiTransport {
  return {
    send(msg) {
      record("out", msg);
      t.send(msg);
    },
    onMessage(cb) {
      return t.onMessage((msg) => {
        record("in", msg);
        cb(msg);
      });
    },
    close() {
      heldIn.clear();
      t.close();
    },
  };
}
