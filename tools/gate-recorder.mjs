// Acceptance gate for recording what is played on the Kronos. Owned by the architect: builders must not edit it.
//
// PURE EXPORTS the builder must provide
//   src/core/midi/smfwrite.ts
//     writeSmf(events: readonly { ms: number; data: number[] }[]): Uint8Array
//       SMF type 0, one track, 480 ppq, a tempo meta of 500000 us/quarter (120 bpm, so 1 ms = 0.96 tick), end-of-track.
//       Events are sorted by ms (stable); only channel voice messages (status 0x80..0xEF, right length, data bytes < 128) are
//       accepted, anything else throws, and so does a negative time. Must round-trip through parseSmf (times within 1 ms).
//   src/core/midi/recorder.ts
//     isRecordable(data: readonly number[]): boolean  // true only for channel voice messages; false for clock F8, Active Sensing FE, sysex, etc.
//     MAX_RECORD_EVENTS: number                        // 500000
//     class MidiRecorder { constructor(max?: number)   // max defaults to MAX_RECORD_EVENTS
//       add(data: readonly number[], nowMs: number): boolean   // false when ignored (not recordable) or the limit is already reached; the first accepted event sets time 0
//       readonly events: { ms: number; data: number[] }[]; readonly noteCount: number /* note-ons with velocity > 0 */;
//       readonly lengthMs: number /* ms of the last event */; readonly full: boolean /* limit reached */ }
//
// TEST IDS (all in the MIDI Player panel, in the app)
//   recorder-arm      Record button: arms capture; recording starts at the first recordable event; disabled with no keyboard connected
//   recorder-stop     Stop button: ends capture (enabled while armed or recording)
//   recorder-play     Play the take through the player to the keyboard; disabled until a take with events exists
//   recorder-save     Save the take as a .mid into the MIDI library; disabled until a take with events exists
//   recorder-status   text: contains "armed" after Record before any event, "recording" while capturing, "stopped" after Stop or the limit
//   recorder-length   take length shown as M:SS.s (for example 0:01.3)
//   recorder-notes    note count, digits only
//   recorder-message  notice text; after the limit is hit it contains "limit"; after Save it contains the saved file name
//
// TEST-ONLY ENV VARS (set by this gate at launch): KRONOS_E2E=1 (kit), KRONOS_E2E_MIDI_DIR=<tmp>/midi (library folder; the gate
//   also sets it in the main process after launch, as gate-midiweb does), KRONOS_E2E_RECORD_MAX=6 (replaces the 500,000 event limit;
//   only honoured when KRONOS_E2E=1). Keyboard input is simulated with window.__kronosE2E.injectMidi(bytes); window.__kronosE2E.midiLog()
//   shows what was sent to the keyboard.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("RECORDER"), { check, finish } = g, C = await core(g);
let S, W, R;
try { S = await load("src/core/midi/smf.ts"); W = await load("src/core/midi/smfwrite.ts"); R = await load("src/core/midi/recorder.ts"); } catch (e) { g.fails.push(`cannot load recorder modules: ${e.message}`); await finish(); }

const ev = (r) => r.events.map((e) => [Math.round(e.ms), ...e.data]);
const EV = [{ ms: 0, data: [0xc0, 5] }, { ms: 0, data: [0xb0, 64, 127] }, { ms: 0, data: [0x90, 60, 100] }, { ms: 250, data: [0xe0, 0, 96] }, { ms: 500, data: [0xd0, 40] }, { ms: 1000, data: [0x80, 60, 0] }, { ms: 100000, data: [0x91, 62, 90] }, { ms: 100500, data: [0x81, 62, 0] }];

await check("only playing is recordable, never clock or sensing or system messages", () => {
  for (const d of [[0x90, 60, 100], [0x80, 60, 0], [0xb0, 64, 127], [0xe0, 0, 64], [0xc0, 3], [0xd0, 9], [0xa0, 60, 5], [0x9f, 1, 1]]) assert.equal(R.isRecordable(d), true, d.join());
  for (const d of [[0xf8], [0xfe], [0xfa], [0xfc], [0xf0, 0x42, 0xf7], [0xff], [0xf1, 3], [], [60, 100]]) assert.equal(R.isRecordable(d), false, d.join());
});
await check("the take starts at the first event and keeps the gaps", () => {
  const r = new R.MidiRecorder();
  assert.equal(r.add([0xf8], 50), false); assert.equal(r.events.length, 0);
  assert.equal(r.add([0x90, 60, 100], 1000), true); assert.equal(r.add([0xfe], 1100), false); assert.equal(r.add([0xb0, 64, 127], 1300), true); assert.equal(r.add([0x80, 60, 0], 2000), true); assert.equal(r.add([0x90, 62, 0], 2100), true);
  assert.deepEqual(r.events, [{ ms: 0, data: [0x90, 60, 100] }, { ms: 300, data: [0xb0, 64, 127] }, { ms: 1000, data: [0x80, 60, 0] }, { ms: 1100, data: [0x90, 62, 0] }]);
  assert.equal(r.noteCount, 1, "a note-on with velocity 0 is a note-off"); assert.equal(r.lengthMs, 1100); assert.equal(r.full, false);
});
await check("the event limit stops the take", () => {
  assert.equal(R.MAX_RECORD_EVENTS, 500000);
  const r = new R.MidiRecorder(3);
  assert.equal(r.add([0x90, 60, 100], 0), true); assert.equal(r.add([0x90, 61, 100], 1), true); assert.equal(r.full, false); assert.equal(r.add([0x90, 62, 100], 2), true); assert.equal(r.full, true);
  assert.equal(r.add([0x90, 63, 100], 3), false); assert.equal(r.events.length, 3); assert.equal(r.noteCount, 3);
});
await check("the writer makes a standard type 0 file at 480 ppq", () => {
  const b = W.writeSmf(EV), s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  assert.equal(s(0, 4), "MThd"); assert.deepEqual([...b.subarray(4, 14)], [0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]); assert.equal(s(14, 4), "MTrk");
  const len = (b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21];
  assert.equal(b.length, 22 + len, "track length matches the file");
  assert.deepEqual([...b.subarray(b.length - 4)], [0, 0xff, 0x2f, 0], "ends with end-of-track");
  assert.ok([...b.subarray(22)].join(",").includes("255,81,3,7,161,32"), "tempo 500000 present");
});
await check("what is written reads back the same through parseSmf", () => {
  const r = S.parseSmf(W.writeSmf(EV));
  assert.equal(r.format, 0); assert.equal(r.division, 480); assert.equal(r.events.length, EV.length);
  r.events.forEach((e, i) => { assert.deepEqual(e.data, EV[i].data, `event ${i}`); assert.ok(Math.abs(e.ms - EV[i].ms) <= 1, `time ${i}: ${e.ms} vs ${EV[i].ms}`); });
  assert.deepEqual(S.parseSmf(W.writeSmf([])).events, []);
});
await check("the writer sorts by time, keeps equal-time order, and refuses bad messages", () => {
  const r = S.parseSmf(W.writeSmf([{ ms: 500, data: [0x80, 60, 0] }, { ms: 0, data: [0x90, 60, 100] }, { ms: 0, data: [0x90, 64, 100] }]));
  assert.deepEqual(ev(r), [[0, 0x90, 60, 100], [0, 0x90, 64, 100], [500, 0x80, 60, 0]]);
  for (const d of [[0xf8], [0xf0, 1, 0xf7], [0x90, 60], [0x90, 200, 1], [0xc0, 5, 5], [0x40, 1, 1]]) assert.throws(() => W.writeSmf([{ ms: 0, data: d }]), d.join());
  assert.throws(() => W.writeSmf([{ ms: -5, data: [0x90, 60, 1] }]));
});
await testsAndTypes(g, ["core/midi/smfwrite.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C, { KRONOS_E2E_MIDI: "", KRONOS_E2E_MIDI_DIR: "PLACEHOLDER", KRONOS_E2E_RECORD_MAX: "6" });
const { X, text, until, win, tmp } = ui, LIB = path.join(tmp, "midi");
mkdirSync(LIB, { recursive: true });
await g.state.app.evaluate((_e, d) => { process.env.KRONOS_E2E_MIDI_DIR = d; }, LIB);
const log = () => win.evaluate(() => window.__kronosE2E.midiLog()), inject = (b) => win.evaluate((x) => window.__kronosE2E.injectMidi(x), b), wait = (ms) => new Promise((r) => setTimeout(r, ms));
const files = () => (existsSync(LIB) ? readdirSync(LIB).filter((n) => /\.mid$/i.test(n)) : []);
const parsed = (n) => S.parseSmf(new Uint8Array(readFileSync(path.join(LIB, n))));
const secs = (t) => { const m = /(\d+):(\d\d)\.(\d)/.exec(t); assert.ok(m, `bad length "${t}"`); return +m[1] * 60 + +m[2] + +m[3] / 10; };
const status = (re) => until(async () => re.test(await text("recorder-status")), `status ${re}`);

await ui.openFile();
await check("Record needs a keyboard connection", async () => { for (const id of ["recorder-arm", "recorder-play", "recorder-save"]) assert.equal(await X(id).isDisabled(), true, id); });
await ui.connectSim();
await check("Record arms and waits; nothing is captured until a real event", async () => {
  await X("recorder-arm").click(); await status(/armed/i); await inject([0xf8]); await inject([0xfe]); await wait(400);
  assert.match(await text("recorder-status"), /armed/i); assert.equal(await text("recorder-notes"), "0");
});
await check("it records playing and ignores clock and sensing", async () => {
  await inject([0x90, 60, 100]); await status(/recording/i);
  await inject([0xf8]); await wait(300); await inject([0xb0, 64, 127]); await inject([0xe0, 0, 96]); await inject([0xc0, 7]); await inject([0xfe]); await wait(300); await inject([0x80, 60, 0]);
  await X("recorder-stop").click(); await status(/stopped/i);
  assert.equal(await text("recorder-notes"), "1");
  const s = secs(await text("recorder-length")); assert.ok(s >= 0.5 && s <= 1.5, `length ${s}s`);
});
await check("Play plays the take through the player", async () => {
  const n = (await log()).length; await X("recorder-play").click();
  await until(async () => { const l = (await log()).slice(n); return l.some((m) => m[0] === 0x90 && m[1] === 60 && m[2] === 100) && l.some((m) => m[0] === 0x80 && m[1] === 60); }, "take replayed", 10000);
  const l = (await log()).slice(n);
  assert.ok(l.some((m) => m[0] === 0xc0 && m[1] === 7) && l.some((m) => m[0] === 0xe0 && m[2] === 96) && l.some((m) => m[0] === 0xb0 && m[1] === 64 && m[2] === 127), "controllers and bend replayed");
  assert.ok(!l.some((m) => m[0] === 0xf8 || m[0] === 0xfe), "clock was recorded");
});
await check("Save writes a standard .mid into the library with what was played", async () => {
  assert.equal(files().length, 0); await X("recorder-save").click(); await until(async () => files().length === 1, "file saved");
  const name = files()[0]; await until(async () => (await text("recorder-message")).includes(name), "message names the file");
  const r = parsed(name); assert.equal(r.format, 0); assert.equal(r.division, 480);
  assert.deepEqual(r.events.map((e) => e.data), [[0x90, 60, 100], [0xb0, 64, 127], [0xe0, 0, 96], [0xc0, 7], [0x80, 60, 0]]);
  assert.equal(Math.round(r.events[0].ms), 0); const gap = r.events[1].ms - r.events[0].ms; assert.ok(gap >= 250 && gap <= 900, `gap ${gap}`);
});
await check("a second take replaces the first and saving never overwrites", async () => {
  await X("recorder-arm").click(); await status(/armed/i); await inject([0x90, 70, 80]); await wait(150); await inject([0x80, 70, 0]); await X("recorder-stop").click(); await status(/stopped/i);
  assert.equal(await text("recorder-notes"), "1"); assert.ok(secs(await text("recorder-length")) < 0.9);
  await X("recorder-save").click(); await until(async () => files().length === 2, "a second file");
});
await check("hitting the event limit stops with a message and keeps the take", async () => {
  await X("recorder-arm").click(); await status(/armed/i);
  for (let i = 0; i < 10; i++) await inject([0x90, 40 + i, 100]);
  await status(/stopped/i); assert.match(await text("recorder-message"), /limit/i); assert.equal(await text("recorder-notes"), "6");
  await X("recorder-save").click(); await until(async () => files().length === 3, "saved");
  assert.ok(files().some((f) => parsed(f).events.length === 6), "a file with exactly 6 events");
});
await check("Record never writes to the keyboard by itself", async () => {
  const n = (await log()).length; await X("recorder-arm").click(); await inject([0x90, 50, 90]); await X("recorder-stop").click(); await wait(300); assert.equal((await log()).length, n);
});
await ui.noErrors();
await finish();
