import { decode7, encode7 } from "../sysex/encoding.ts";
import { sha1 } from "../sysex/sha1.ts";
import { buildKorg, DEVICE_INQUIRY, Fn, parseKorg } from "../sysex/message.ts";
import { writeParam, type ParamTables, type Row } from "../params/params.ts";
import { parseMasterVolume } from "../midi/masterVolume.ts";
import type { MidiTransport } from "./transport.ts";

interface Slot {
  obj: number;
  bank: number;
  index: number;
  version: number;
  data: Uint8Array;
}

const READ_ONLY_PROGRAM_BANKS = (bank: number) => bank >= 0x10 && bank <= 0x1a;
const keyOf = (obj: number, bank: number, index: number) => `${obj}/${bank}/${index}`;
const copySlot = (s: Slot): Slot => ({ ...s, data: Uint8Array.from(s.data) });
// Channel voice messages and KORG Mode Change (F0 42 3g 68 4E) are player traffic, not Object messages.
const isPlayerTraffic = (b: Uint8Array): boolean =>
  (b[0] === 0xf0 && b[1] === 0x7e && b[3] === 9) || (b[0] >= 0x80 && b[0] < 0xf0) || (b[0] === 0xf0 && b[1] === 0x42 && (b[2] & 0xf0) === 0x30 && b[3] === 0x68 && b[4] === 0x4e);

const isKorgFn = (b: Uint8Array, fn: number): boolean => b[0] === 0xf0 && b[1] === 0x42 && (b[2] & 0xf0) === 0x30 && b[3] === 0x68 && b[4] === fn;
const isCurrentObjectDump = (b: Uint8Array): boolean => isKorgFn(b, Fn.currentObjectDump);
// The edit buffer's parameter table, by object type and size (HD-1 programs are 3706 bytes, EXi programs 4960; engine rows are not modelled).
const editRows = (t: ParamTables, obj: number, size: number): Row[] | null => (obj === 1 ? t.combi : obj === 0 ? (size === 3706 ? t.programHd1 : t.programExiCommon) : null);

export class SimulatedKronos implements MidiTransport {
  private readonly channel: number;
  private latencyMs: number;
  private readonly listeners = new Set<(msg: Uint8Array) => void>();
  private stored = new Map<string, Slot>();
  private temp = new Map<string, Slot>();
  private midi: number[][] = [];
  private edit = new Map<number, { version: number; data: Uint8Array }>();
  private mode = -1; // object type of the last Current Object Dump: parameter changes apply to its edit buffer
  private tables: ParamTables | null;
  private dumps = 0;
  private paramChanges = 0;

  // tables: the row tables the keyboard side uses to find a parameter id's field. Without them parameter changes are counted but not applied.
  constructor(opts: { channel?: number; latencyMs?: number; tables?: ParamTables } = {}) {
    this.channel = opts.channel ?? 0;
    this.latencyMs = opts.latencyMs ?? 1;
    this.tables = opts.tables ?? null;
  }

  useTables(tables: ParamTables): void {
    this.tables = tables;
  }

  // Test hooks: how many whole Current Object Dumps and Parameter Changes arrived, and the edit buffer they built.
  counts(): { dumps: number; paramChanges: number } {
    return { dumps: this.dumps, paramChanges: this.paramChanges };
  }

  editBuffer(obj: number): { version: number; data: Uint8Array } | undefined {
    const e = this.edit.get(obj);
    return e ? { version: e.version, data: Uint8Array.from(e.data) } : undefined;
  }

  // Test hook: makes the keyboard hold different edit-buffer bytes than were sent.
  setEditBuffer(obj: number, version: number, data: Uint8Array): void {
    this.edit.set(obj, { version, data: Uint8Array.from(data) });
  }

  // Master Volume messages received: how many, and the last 14-bit value.
  masterVolume: { count: number; last: number | null } = { count: 0, last: null };

  // The last Set List select (Bank MSB 0, Bank LSB = set, Program Change = slot) and how many arrived.
  setListSelect: { count: number; set: number; slot: number } | null = null;
  private bank = [0, 0];

  send(msg: Uint8Array): void {
    const copy = Uint8Array.from(msg);
    if ((copy[0] & 0xf0) === 0xb0 && (copy[1] === 0 || copy[1] === 0x20)) this.bank[copy[1] === 0 ? 0 : 1] = copy[2];
    else if ((copy[0] & 0xf0) === 0xc0 && this.bank[0] === 0) this.setListSelect = { count: (this.setListSelect?.count ?? 0) + 1, set: this.bank[1], slot: copy[1] };
    const mv = parseMasterVolume(copy);
    if (mv !== null) {
      this.masterVolume = { count: this.masterVolume.count + 1, last: mv };
      return;
    }
    // Player traffic is recorded for the e2e gate and never answered.
    if (isPlayerTraffic(copy)) {
      this.midi.push([...copy]);
      return;
    }
    // Live edits are recorded too, and still answered below.
    if (isCurrentObjectDump(copy) || isKorgFn(copy, Fn.parameterChangeInteger) || isKorgFn(copy, Fn.currentObjectDumpRequest)) this.midi.push([...copy]);
    // Replies are always async, as KORG's document implies.
    setTimeout(() => this.handle(copy), this.latencyMs);
  }

  midiLog(): number[][] {
    return this.midi.map((m) => [...m]);
  }

  onMessage(cb: (msg: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  close(): void {
    this.listeners.clear();
  }

  seedObject(obj: number, bank: number, index: number, version: number, data: Uint8Array): void {
    const slot: Slot = { obj, bank, index, version, data: Uint8Array.from(data) };
    this.stored.set(keyOf(obj, bank, index), copySlot(slot));
    this.temp.set(keyOf(obj, bank, index), copySlot(slot));
  }

  // Test hooks for the app's e2e gate: change reply latency and read temporary memory directly.
  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  tempObject(obj: number, bank: number, index: number): { version: number; data: Uint8Array } | undefined {
    const s = this.temp.get(keyOf(obj, bank, index));
    return s ? { version: s.version, data: Uint8Array.from(s.data) } : undefined;
  }

  storedObject(obj: number, bank: number, index: number): { version: number; data: Uint8Array } | undefined {
    const s = this.stored.get(keyOf(obj, bank, index));
    return s ? { version: s.version, data: Uint8Array.from(s.data) } : undefined;
  }

  powerCycle(): void {
    this.temp = new Map([...this.stored].map(([k, s]) => [k, copySlot(s)]));
  }

  private emit(msg: Uint8Array): void {
    for (const cb of [...this.listeners]) cb(msg);
  }

  // Test hook for the e2e gate: delivers one message to the listeners, as if the keyboard had sent it.
  deliver(msg: Uint8Array): void {
    this.emit(Uint8Array.from(msg));
  }

  private reply(code: number): void {
    this.emit(buildKorg(this.channel, Fn.reply, [code]));
  }

  private handle(raw: Uint8Array): void {
    try {
      this.dispatch(raw);
    } catch {
      this.reply(7);
    }
  }

  private dispatch(raw: Uint8Array): void {
    if (raw.length === DEVICE_INQUIRY.length && raw.every((b, i) => b === DEVICE_INQUIRY[i])) {
      // F0 7E dev 06 02 42 68 00 17 00 03 01 02 00 F7
      this.emit(Uint8Array.from([0xf0, 0x7e, this.channel, 0x06, 0x02, 0x42, 0x68, 0x00, 0x17, 0x00, 0x03, 0x01, 0x02, 0x00, 0xf7]));
      return;
    }
    const m = parseKorg(raw);
    if (!m || m.channel !== this.channel || m.fn === Fn.reply) return;
    const p = m.payload;
    switch (m.fn) {
      case Fn.objectDumpRequest: {
        if (p.length !== 4) return this.reply(3);
        // shortcut: Object Dump Request reads temporary memory (the doc is silent), confirm on the real keyboard
        const slot = this.temp.get(keyOf(p[0], p[1], (p[2] << 7) | p[3]));
        if (!slot) return this.reply(4);
        this.emit(buildKorg(this.channel, Fn.objectDump, [p[0], p[1], p[2], p[3], slot.version, ...encode7(slot.data)]));
        return;
      }
      case Fn.objectDump: {
        if (p.length < 5) return this.reply(3);
        let data: Uint8Array;
        try {
          data = decode7(p.subarray(5));
        } catch {
          return this.reply(3);
        }
        if (p[0] === 0 && READ_ONLY_PROGRAM_BANKS(p[1])) return this.reply(65);
        const index = (p[2] << 7) | p[3];
        this.temp.set(keyOf(p[0], p[1], index), { obj: p[0], bank: p[1], index, version: p[4], data });
        this.reply(0);
        return;
      }
      case Fn.currentObjectDump: {
        if (p.length < 3) return this.reply(3);
        let data: Uint8Array;
        try {
          data = decode7(p.subarray(2));
        } catch {
          return this.reply(3);
        }
        this.edit.set(p[0], { version: p[1], data });
        this.mode = p[0];
        this.dumps++;
        return this.reply(0);
      }
      case Fn.currentObjectDumpRequest: {
        if (p.length !== 1) return this.reply(3);
        const e = this.edit.get(p[0]);
        if (!e) return this.reply(4);
        this.emit(buildKorg(this.channel, Fn.currentObjectDump, [p[0], e.version, ...encode7(e.data)]));
        return;
      }
      case Fn.parameterChangeInteger:
        return this.paramChange(p);
      case Fn.storeBankRequest: {
        if (p.length !== 2) return this.reply(3);
        // shortcut: a Store Bank Request to a read-only program bank replies 65 (the doc ties 65 to protection flags only), confirm on the real keyboard
        if (p[0] === 0 && READ_ONLY_PROGRAM_BANKS(p[1])) return this.reply(65);
        for (const slot of this.temp.values()) {
          if (slot.obj === p[0] && slot.bank === p[1]) this.stored.set(keyOf(slot.obj, slot.bank, slot.index), copySlot(slot));
        }
        this.reply(0);
        return;
      }
      case Fn.bankDigestRequest: {
        if (p.length !== 2) return this.reply(3);
        // shortcut: the digest hashes index, version and data of each stored object in index order (the doc only says SHA-1 over the bank), confirm on the real keyboard
        const slots = [...this.stored.values()]
          .filter((s) => s.obj === p[0] && s.bank === p[1])
          .sort((a, b) => a.index - b.index);
        const parts = slots.flatMap((s) => [Uint8Array.from([s.index >> 7, s.index & 0x7f, s.version]), s.data]);
        const all = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
        let at = 0;
        for (const x of parts) { all.set(x, at); at += x.length; }
        this.emit(buildKorg(this.channel, Fn.bankDigest, [p[0], p[1], ...encode7(sha1(all))]));
        return;
      }
      default:
        // shortcut: unknown functions get Reply 24 code 2 (the doc does not say what an unknown function gets), confirm on the real keyboard
        this.reply(2);
    }
  }

  // shortcut: a successful Parameter Change gets no reply (the doc does not say), errors get Reply 24 codes 1, 2, 3, 6; confirm on the real keyboard
  private paramChange(p: Uint8Array): void {
    if (p.length !== 8) return this.reply(3);
    this.paramChanges++;
    const buf = this.edit.get(this.mode);
    if (!buf || !this.tables) return;
    const rows = editRows(this.tables, this.mode, buf.data.length);
    if (!rows) return this.reply(1);
    const same = rows.filter((r) => !r.continuation && !/^(KARMA|Drum Track)/.test(r.group) && r.typ === p[0] && r.soc === p[1] && r.sub === p[2] && r.pid === p[3] && r.idx === p[4]);
    // KARMA and Drum Track rows answer to functions 6D and 6E, so they share ids with these. An id that names no row, or several fields (Chain Switch and Chain To), is not modelled: unknown parameter.
    if (same.length !== 1) return this.reply(2);
    // 21-bit two's complement (note *4)
    const u = (p[5] << 14) | (p[6] << 7) | p[7];
    const v = u >= 0x100000 ? u - 0x200000 : u;
    const row = same[0];
    if (v < row.rawMin || v > row.rawMax) return this.reply(6);
    writeParam(buf.data, row, v);
  }
}
