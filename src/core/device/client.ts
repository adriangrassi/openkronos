import { decode7, encode7 } from "../sysex/encoding.ts";
import { buildKorg, DEVICE_INQUIRY, Fn, parseDeviceInquiryReply, parseKorg, type DeviceInquiryReply } from "../sysex/message.ts";
import type { MidiTransport } from "./transport.ts";

const REPLY_TEXT: Record<number, string> = {
  1: "parameter type does not match the current mode",
  2: "unknown message type, parameter or index",
  3: "short or malformed message",
  4: "target object not found",
  5: "insufficient resources to complete the request",
  6: "parameter value out of range",
  7: "internal error in the keyboard",
  64: "other error (wrong program bank type for this dump, or invalid data)",
  65: "target object is protected",
  66: "memory overflow",
};

export class KronosError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`Kronos reply ${code}: ${REPLY_TEXT[code] ?? "unknown reply code"}`);
    this.name = "KronosError";
    this.code = code;
  }
}

export class KronosTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KronosTimeoutError";
  }
}

export interface ClientOptions {
  channel?: number;
  timeoutMs?: number;
  paramSettleMs?: number;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: Error };
// Returns null when the message is not the reply this request is waiting for.
type Matcher = (raw: Uint8Array) => Outcome | null;
interface Job {
  label: string;
  msg: Uint8Array;
  match: Matcher;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  // Set for a message the keyboard may not answer on success: silence for this long counts as done.
  settleMs?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const ok = (value: unknown): Outcome => ({ ok: true, value });
const fail = (error: Error): Outcome => ({ ok: false, error });

export class KronosClient {
  private readonly transport: MidiTransport;
  private readonly channel: number;
  private readonly timeoutMs: number;
  private readonly paramSettleMs: number;
  private readonly unsubscribe: () => void;
  private readonly queue: Job[] = [];
  private current: Job | null = null;
  private closed = false;

  constructor(transport: MidiTransport, opts: ClientOptions = {}) {
    this.transport = transport;
    this.channel = opts.channel ?? 0;
    // shortcut: the keyboard answers every request within 5 s (flash writes included), confirm on the real keyboard
    this.timeoutMs = opts.timeoutMs ?? 5000;
    // shortcut: the doc does not say if a Parameter Change is answered on success; an error reply (codes 1, 2, 6) within this window fails it, confirm on the real keyboard
    this.paramSettleMs = opts.paramSettleMs ?? 30;
    this.unsubscribe = transport.onMessage((raw) => this.receive(raw));
  }

  async identify(): Promise<DeviceInquiryReply> {
    return this.run<DeviceInquiryReply>("device inquiry", DEVICE_INQUIRY, (raw) => {
      const r = parseDeviceInquiryReply(raw);
      if (!r || r.channel !== this.channel) return null;
      if (r.manufacturer !== 0x42 || r.family !== 0x68) {
        return fail(new Error(`not a KORG Kronos: manufacturer 0x${r.manufacturer.toString(16)}, family 0x${r.family.toString(16)}`));
      }
      return ok(r);
    });
  }

  async requestObject(obj: number, bank: number, index: number): Promise<{ version: number; data: Uint8Array }> {
    checkAddress(obj, bank, index);
    const [idH, idL] = splitIndex(index);
    const msg = buildKorg(this.channel, Fn.objectDumpRequest, [obj, bank, idH, idL]);
    return this.run(`object dump request (type ${obj}, bank 0x${bank.toString(16).toUpperCase()}, slot ${index})`, msg, dataMatcher(this.channel, Fn.objectDump, [obj, bank, idH, idL], (rest) => {
      if (rest.length < 1) throw new RangeError("object dump without a version byte");
      return { version: rest[0], data: decode7(rest.subarray(1)) };
    }));
  }

  // Read-only: asks for the object type's edit buffer. The reply is function 0x75 (obj, version, data), or Reply 24 with a code.
  async requestCurrentObject(obj: number): Promise<{ version: number; data: Uint8Array }> {
    checkBankAddress(obj, 0);
    const msg = buildKorg(this.channel, Fn.currentObjectDumpRequest, [obj]);
    return this.run(`current object dump request (type ${obj})`, msg, dataMatcher(this.channel, Fn.currentObjectDump, [obj], (rest) => {
      if (rest.length < 1) throw new RangeError("current object dump without a version byte");
      return { version: rest[0], data: decode7(rest.subarray(1)) };
    }));
  }

  async sendObject(obj: number, bank: number, index: number, version: number, data: Uint8Array): Promise<void> {
    checkAddress(obj, bank, index);
    const [idH, idL] = splitIndex(index);
    // Never Store Bank here: a dump only reaches temporary memory until storeBank.
    const msg = buildKorg(this.channel, Fn.objectDump, [obj, bank, idH, idL, version, ...encode7(data)]);
    await this.run("object dump", msg, ackMatcher(this.channel));
  }

  // Replaces the object type's edit buffer only: nothing is stored, the keyboard answers with Reply 24.
  async sendCurrentObject(obj: number, version: number, data: Uint8Array): Promise<void> {
    checkBankAddress(obj, 0);
    await this.run("current object dump", buildKorg(this.channel, Fn.currentObjectDump, [obj, version, ...encode7(data)]), ackMatcher(this.channel));
  }

  // One finished function 0x43 message (see paramSend.ts). Changes the edit buffer only, like sendCurrentObject.
  async sendParamChange(msg: Uint8Array): Promise<void> {
    const m = parseKorg(msg);
    if (!m || m.channel !== this.channel || m.fn !== Fn.parameterChangeInteger) throw new RangeError("not a parameter change for this channel");
    await this.run("parameter change", msg, ackMatcher(this.channel), this.paramSettleMs);
  }

  async storeBank(obj: number, bank: number): Promise<void> {
    checkBankAddress(obj, bank);
    // shortcut: Reply 24 code 0 is the success answer to a Store Bank Request (the doc does not say), confirm on the real keyboard
    await this.run("store bank", buildKorg(this.channel, Fn.storeBankRequest, [obj, bank]), ackMatcher(this.channel));
  }

  async bankDigest(obj: number, bank: number): Promise<Uint8Array> {
    checkBankAddress(obj, bank);
    const msg = buildKorg(this.channel, Fn.bankDigestRequest, [obj, bank]);
    return this.run("bank digest request", msg, dataMatcher(this.channel, Fn.bankDigest, [obj, bank], (rest) => {
      const digest = decode7(rest);
      if (digest.length !== 20) throw new RangeError(`bank digest is ${digest.length} bytes, expected 20`);
      return digest;
    }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    const pending = this.current ? [this.current, ...this.queue] : [...this.queue];
    this.current = null;
    this.queue.length = 0;
    for (const job of pending) {
      clearTimeout(job.timer);
      job.reject(new Error("KronosClient closed"));
    }
  }

  private run<T>(label: string, msg: Uint8Array, match: Matcher, settleMs?: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error("KronosClient closed"));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ label, msg, match, settleMs, resolve: (v) => resolve(v as T), reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    job.timer = setTimeout(() => {
      this.finish(job, job.settleMs !== undefined ? ok(undefined) : fail(new KronosTimeoutError(`No reply to ${job.label} within ${this.timeoutMs} ms`)));
    }, job.settleMs ?? this.timeoutMs);
    try {
      this.transport.send(job.msg);
    } catch (e) {
      this.finish(job, fail(e instanceof Error ? e : new Error(String(e))));
    }
  }

  private receive(raw: Uint8Array): void {
    const job = this.current;
    if (!job || this.closed) return;
    let outcome: Outcome | null;
    try {
      outcome = job.match(raw);
    } catch (e) {
      outcome = fail(e instanceof Error ? e : new Error(String(e)));
    }
    if (outcome) this.finish(job, outcome);
  }

  private finish(job: Job, outcome: Outcome): void {
    if (this.current !== job) return;
    this.current = null;
    clearTimeout(job.timer);
    if (outcome.ok) job.resolve(outcome.value);
    else job.reject(outcome.error);
    this.pump();
  }
}

function checkAddress(obj: number, bank: number, index: number): void {
  checkBankAddress(obj, bank);
  if (!Number.isInteger(index) || index < 0 || index > 0x3fff) throw new RangeError(`bad index ${index}`);
}

function checkBankAddress(obj: number, bank: number): void {
  if (!Number.isInteger(obj) || obj < 0 || obj > 0x7f || !Number.isInteger(bank) || bank < 0 || bank > 0x7f) {
    throw new RangeError(`bad object or bank: obj=${obj} bank=${bank}`);
  }
}

function splitIndex(index: number): [number, number] {
  return [index >> 7, index & 0x7f];
}

// Reply 24 with code 0 acknowledges a write. Code 0 is not an answer to a read, so reads keep waiting.
function replyCode(raw: Uint8Array, channel: number): number | null {
  const m = parseKorg(raw);
  if (!m || m.channel !== channel || m.fn !== Fn.reply || m.payload.length < 1) return null;
  return m.payload[0];
}

// shortcut: Reply 24 has no request echo, so a late reply to a timed-out request would answer the next one, confirm on the real keyboard
function ackMatcher(channel: number): Matcher {
  return (raw) => {
    const code = replyCode(raw, channel);
    if (code === null) return null;
    return code === 0 ? ok(undefined) : fail(new KronosError(code));
  };
}

function dataMatcher<T>(channel: number, expectFn: number, header: number[], decode: (rest: Uint8Array) => T): Matcher {
  return (raw) => {
    const code = replyCode(raw, channel);
    if (code !== null) return code === 0 ? null : fail(new KronosError(code));
    const m = parseKorg(raw);
    if (!m || m.channel !== channel || m.fn !== expectFn) return null;
    if (m.payload.length < header.length || header.some((b, i) => m.payload[i] !== b)) return null;
    return ok(decode(m.payload.subarray(header.length)));
  };
}
