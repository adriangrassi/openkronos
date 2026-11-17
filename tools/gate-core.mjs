// Acceptance gate for src/core (SysEx layer, client, simulator). Owned by the architect: builders must not edit it.
// Byte sequences come from KORG's KRONOS_MIDI_SysEx.txt v1.27 and from replies captured from the real keyboard.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const fails = [];
const check = async (name, fn) => {
  try { await fn(); console.log("ok  ", name); }
  catch (e) { fails.push(`${name}: ${e.message.split("\n").slice(0, 6).join(" ")}`); console.log("FAIL", name); }
};
const finish = () => {
  console.log(fails.length ? `\nCORE FAIL (${fails.length})\n- ${fails.join("\n- ")}` : "\nCORE PASS");
  process.exit(fails.length ? 1 : 0);
};

let enc, msg, cli, sim;
try {
  enc = await load("src/core/sysex/encoding.ts");
  msg = await load("src/core/sysex/message.ts");
  cli = await load("src/core/device/client.ts");
  sim = await load("src/core/device/simulator.ts");
} catch (e) { fails.push(`cannot load core modules: ${e.message}`); finish(); }

const hex = (a) => Buffer.from(a).toString("hex").replace(/(..)(?=.)/g, "$1 ").toUpperCase();
const bytes = (s) => Uint8Array.from(s.trim().split(/[\s-]+/).map((x) => parseInt(x, 16)));
const same = (actual, expected, label = "") => assert.equal(hex(actual), hex(expected), label);
const REAL_IDENTITY = "F0 7E 00 06 02 42 68 00 17 00 03 01 02 00 F7";   // captured from the owner's Kronos, 2026-11-07

// A scripted transport the builder's code cannot influence.
class Fake {
  sent = []; subs = new Set(); onSend = null;
  send(m) { this.sent.push(Uint8Array.from(m)); this.onSend?.(Uint8Array.from(m)); }
  onMessage(cb) { this.subs.add(cb); return () => this.subs.delete(cb); }
  close() {}
  emit(m) { for (const cb of [...this.subs]) cb(Uint8Array.from(m)); }
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const reply = (ch, fn, payload) => Uint8Array.from([0xf0, 0x42, 0x30 | ch, 0x68, fn, ...payload, 0xf7]);
const rand = (n, seed = 7) => { const a = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; a[i] = x >> 16 & 255; } return a; };

// ---- encoding
await check("encode7 worked example: 80 01 -> 01 00 01", () => same(enc.encode7(bytes("80 01")), bytes("01 00 01")));
await check("encode7 full group + partial: 8 x FF", () => same(enc.encode7(new Uint8Array(8).fill(255)), bytes("7F 7F 7F 7F 7F 7F 7F 7F 01 7F")));
await check("encode7 bit order: first byte's top bit is bit 0 of the MS byte", () => same(enc.encode7(bytes("80 00 00 00 00 00 81")), bytes("41 00 00 00 00 00 00 01")));
await check("encode7/decode7 round trip, lengths 0..300", () => { for (let n = 0; n <= 300; n++) same(enc.decode7(enc.encode7(rand(n, n + 1))), rand(n, n + 1), `n=${n}`); });
await check("encode7 output is always 7-bit", () => assert.ok(enc.encode7(rand(5000)).every((b) => b < 128)));
await check("size formulas agree with real lengths", () => { for (let n = 0; n <= 2000; n++) { const s = enc.encode7(new Uint8Array(n)).length; assert.equal(enc.sysExSize(n), s, `sysExSize(${n})`); assert.equal(enc.binarySize(s), n, `binarySize(${s})`); } });
await check("KORG's stated dump sizes", () => { assert.equal(enc.sysExSize(3706), 4236); assert.equal(enc.sysExSize(7810), 8926); assert.equal(enc.sysExSize(69416), 79333); });
await check("signed 21-bit values", () => {
  same(enc.encodeSigned21(-1), bytes("7F 7F 7F")); same(enc.encodeSigned21(0), bytes("00 00 00"));
  same(enc.encodeSigned21(1048575), bytes("3F 7F 7F")); same(enc.encodeSigned21(-1048576), bytes("40 00 00"));
  for (const v of [-1048576, -300, -1, 0, 1, 300, 1048575]) { const [h, m, l] = enc.encodeSigned21(v); assert.equal(enc.decodeSigned21(h, m, l), v); }
  assert.throws(() => enc.encodeSigned21(1048576)); assert.throws(() => enc.encodeSigned21(-1048577));
});

// ---- envelope
await check("buildKorg exact bytes", () => same(msg.buildKorg(0, 0x72, [0x00, 0x40, 0x00, 0x05]), bytes("F0 42 30 68 72 00 40 00 05 F7")));
await check("buildKorg channel nibble", () => same(msg.buildKorg(15, 0x37, [0, 0x40]), bytes("F0 42 3F 68 37 00 40 F7")));
await check("buildKorg refuses a payload byte above 7F", () => assert.throws(() => msg.buildKorg(0, 0x73, [0x80])));
await check("parseKorg reads channel, function, payload", () => { const p = msg.parseKorg(bytes("F0 42 35 68 24 41 F7")); assert.equal(p.channel, 5); assert.equal(p.fn, 0x24); same(p.payload, bytes("41")); });
await check("parseKorg rejects other gear and non-SysEx", () => { assert.equal(msg.parseKorg(bytes("F0 41 30 68 24 00 F7")), null); assert.equal(msg.parseKorg(bytes("F0 42 30 50 24 00 F7")), null); assert.equal(msg.parseKorg(bytes("F8")), null); assert.equal(msg.parseKorg(bytes("F0 42 30 68 24 00")), null); });
await check("device inquiry bytes", () => same(msg.DEVICE_INQUIRY, bytes("F0 7E 7F 06 01 F7")));
await check("parse the real keyboard's identity reply", () => { const p = msg.parseDeviceInquiryReply(bytes(REAL_IDENTITY)); assert.deepEqual({ ...p, version: [...p.version] }, { channel: 0, manufacturer: 0x42, family: 0x68, member: 0x17, version: [3, 1, 2, 0] }); });

// ---- client against scripted bytes
const mk = (opts = {}) => { const t = new Fake(); return { t, c: new cli.KronosClient(t, { timeoutMs: 200, ...opts }) }; };
const DATA = rand(100, 42), WIRE = enc.encode7(DATA);

await check("identify sends inquiry, returns the keyboard's details", async () => {
  const { t, c } = mk(); const p = c.identify(); await tick(); same(t.sent[0], bytes("F0 7E 7F 06 01 F7")); t.emit(bytes(REAL_IDENTITY));
  const r = await p; assert.equal(r.family, 0x68); assert.equal(r.member, 0x17); assert.deepEqual([...r.version], [3, 1, 2, 0]); assert.equal(r.channel, 0);
});
await check("identify rejects a device that is not a Kronos", async () => {
  const { t, c } = mk(); const p = c.identify(); await tick(); t.emit(bytes("F0 7E 00 06 02 42 50 00 17 00 03 01 02 00 F7")); await assert.rejects(p);
});
await check("requestObject: exact request, decoded result", async () => {
  const { t, c } = mk(); const p = c.requestObject(0, 0x40, 5); await tick(); same(t.sent[0], bytes("F0 42 30 68 72 00 40 00 05 F7"));
  t.emit(reply(0, 0x73, [0, 0x40, 0, 5, 5, ...WIRE])); const r = await p; assert.equal(r.version, 5); same(r.data, DATA);
});
await check("requestObject: index above 127 splits into idH and idL", async () => {
  const { t, c } = mk(); const p = c.requestObject(0x0d, 0, 200).catch(() => {}); await tick(); same(t.sent[0], bytes("F0 42 30 68 72 0D 00 01 48 F7")); t.emit(reply(0, 0x24, [4])); await p;
});
await check("requestObject: Reply 24 failure becomes a typed error with its code", async () => {
  const { t, c } = mk(); const p = c.requestObject(0, 0x40, 5); await tick(); t.emit(reply(0, 0x24, [4]));
  await assert.rejects(p, (e) => e.name === "KronosError" && e.code === 4);
});
await check("sendObject: exact bytes, one message, no Store", async () => {
  const { t, c } = mk(); const p = c.sendObject(0, 0x40, 5, 5, DATA); await tick();
  same(t.sent[0], Uint8Array.from([0xf0, 0x42, 0x30, 0x68, 0x73, 0, 0x40, 0, 5, 5, ...WIRE, 0xf7])); t.emit(reply(0, 0x24, [0])); await p;
  assert.equal(t.sent.length, 1); assert.ok(!t.sent.some((m) => m[4] === 0x76), "sendObject sent Store Bank");
});
await check("sendObject: protected object rejects with code 65", async () => {
  const { t, c } = mk(); const p = c.sendObject(0, 0x10, 0, 5, DATA); await tick(); t.emit(reply(0, 0x24, [65]));
  await assert.rejects(p, (e) => e.name === "KronosError" && e.code === 65);
});
await check("storeBank: exact bytes", async () => {
  const { t, c } = mk(); const p = c.storeBank(0, 0x40); await tick(); same(t.sent[0], bytes("F0 42 30 68 76 00 40 F7")); t.emit(reply(0, 0x24, [0])); await p;
});
await check("bankDigest: exact request, 20-byte result", async () => {
  const { t, c } = mk(); const d = rand(20, 9); const p = c.bankDigest(0, 0x40); await tick(); same(t.sent[0], bytes("F0 42 30 68 37 00 40 F7"));
  const w = enc.encode7(d); assert.equal(w.length, 23); t.emit(reply(0, 0x38, [0, 0x40, ...w])); same(await p, d);
});
await check("a silent keyboard times out with a typed error, and the client still works afterwards", async () => {
  const { t, c } = mk({ timeoutMs: 40 }); await assert.rejects(c.requestObject(0, 0x40, 5), (e) => e.name === "KronosTimeoutError");
  const p = c.requestObject(0, 0x40, 6); await tick(); same(t.sent.at(-1), bytes("F0 42 30 68 72 00 40 00 06 F7")); t.emit(reply(0, 0x73, [0, 0x40, 0, 6, 5, ...WIRE])); await p;
});
await check("requests go strictly one at a time", async () => {
  const { t, c } = mk(); const a = c.requestObject(0, 0x40, 1), b = c.requestObject(0, 0x40, 2); await tick();
  assert.equal(t.sent.length, 1, "second request sent before the first was answered");
  t.emit(reply(0, 0x73, [0, 0x40, 0, 1, 5, ...WIRE])); await a; await tick();
  assert.equal(t.sent.length, 2); t.emit(reply(0, 0x73, [0, 0x40, 0, 2, 5, ...WIRE])); await b;
});
await check("unrelated traffic does not answer a pending request", async () => {
  const { t, c } = mk({ timeoutMs: 80 }); let done = false; const p = c.requestObject(0, 0x40, 5).finally(() => { done = true; }); await tick();
  t.emit(bytes("F8")); t.emit(bytes("F0 41 10 42 12 F7")); t.emit(reply(0, 0x38, [0, 0x40, ...new Uint8Array(23)]));
  t.emit(reply(0, 0x73, [0, 0x40, 0, 9, 5, ...WIRE])); t.emit(reply(7, 0x73, [0, 0x40, 0, 5, 5, ...WIRE])); await tick(10);
  assert.equal(done, false, "resolved by a message that was not its reply"); t.emit(reply(0, 0x73, [0, 0x40, 0, 5, 5, ...WIRE])); await p;
});
await check("channel option is used and enforced", async () => {
  const { t, c } = mk({ channel: 3 }); const p = c.storeBank(1, 0x40); await tick(); same(t.sent[0], bytes("F0 42 33 68 76 01 40 F7")); t.emit(reply(3, 0x24, [0])); await p;
});

// ---- simulator: must behave like KORG's document says, driven through the client
const sm = (opts = {}) => { const s = new sim.SimulatedKronos(opts); return { s, c: new cli.KronosClient(s, { timeoutMs: 300 }) }; };
const A = rand(3706, 1), B = rand(3706, 2);
await check("simulator identifies as the owner's Kronos", async () => { const { c } = sm(); const r = await c.identify(); assert.equal(r.family, 0x68); assert.equal(r.member, 0x17); assert.deepEqual([...r.version].slice(0, 3), [3, 1, 2]); });
await check("simulator serves a seeded object", async () => { const { s, c } = sm(); s.seedObject(0, 0x40, 5, 5, A); const r = await c.requestObject(0, 0x40, 5); assert.equal(r.version, 5); same(r.data, A); });
await check("simulator: missing object is Reply 24 code 4", async () => { const { c } = sm(); await assert.rejects(c.requestObject(0, 0x40, 99), (e) => e.code === 4); });
await check("simulator: an Object Dump is temporary until Store Bank", async () => {
  const { s, c } = sm(); s.seedObject(0, 0x40, 5, 5, A); await c.sendObject(0, 0x40, 5, 5, B);
  same((await c.requestObject(0, 0x40, 5)).data, B, "temporary copy not visible"); same(s.storedObject(0, 0x40, 5).data, A, "stored copy changed without Store");
  s.powerCycle(); same((await c.requestObject(0, 0x40, 5)).data, A, "edit survived a power cycle without Store");
});
await check("simulator: Store Bank makes it permanent, for that bank only", async () => {
  const { s, c } = sm(); s.seedObject(0, 0x40, 5, 5, A); s.seedObject(0, 0x41, 5, 5, A);
  await c.sendObject(0, 0x40, 5, 5, B); await c.sendObject(0, 0x41, 5, 5, B); await c.storeBank(0, 0x40); s.powerCycle();
  same((await c.requestObject(0, 0x40, 5)).data, B, "stored bank lost its edit"); same((await c.requestObject(0, 0x41, 5)).data, A, "other bank was stored too");
});
await check("simulator: read-only GM bank refuses writes with code 65", async () => { const { s, c } = sm(); s.seedObject(0, 0x10, 0, 5, A); await assert.rejects(c.sendObject(0, 0x10, 0, 5, B), (e) => e.code === 65); same(s.storedObject(0, 0x10, 0).data, A); });
await check("simulator: bank digest is 20 bytes and changes only after Store", async () => {
  const { s, c } = sm(); s.seedObject(0, 0x40, 5, 5, A); const d0 = await c.bankDigest(0, 0x40); assert.equal(d0.length, 20);
  await c.sendObject(0, 0x40, 5, 5, B); same(await c.bankDigest(0, 0x40), d0, "digest changed without Store");
  await c.storeBank(0, 0x40); assert.notEqual(hex(await c.bankDigest(0, 0x40)), hex(d0), "digest unchanged after Store");
});
await check("simulator never replies synchronously from send()", () => { const s = new sim.SimulatedKronos(); let got = 0; s.onMessage(() => got++); s.send(msg.DEVICE_INQUIRY); assert.equal(got, 0); });
await check("simulator: truncated dump is Reply 24 code 3", async () => {
  const s = new sim.SimulatedKronos(); const replies = []; s.onMessage((m) => replies.push(m)); s.send(bytes("F0 42 30 68 73 00 F7")); await tick(20);
  assert.ok(replies.length === 1 && replies[0][4] === 0x24 && replies[0][5] === 3, `got ${replies.map(hex).join(" | ")}`);
});

// ---- the builder's own tests and type check
await check("builder's unit tests exist and pass", () => {
  const found = readdirSync(path.join(root, "src"), { recursive: true }).filter((f) => String(f).endsWith(".test.ts"));
  assert.ok(found.length >= 3, `expected at least 3 *.test.ts files, found ${found.length}`);
  const r = spawnSync(process.execPath, ["--test", ...found.map((f) => path.join("src", String(f)))], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1200));
});
await check("TypeScript strict type check is clean", () => {
  const tsc = path.join(root, "node_modules/typescript/bin/tsc");
  assert.ok(existsSync(tsc), "typescript is not installed");
  const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", root], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 1200));
});
finish();
