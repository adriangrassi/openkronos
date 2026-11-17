// Acceptance gate for the bottom dock: on-screen keyboard and MIDI monitor. Owned by the architect: builders must not edit it.
//
// TEST-ONLY ENV: none beyond what launch() already sets (KRONOS_E2E=1 and the file/backup paths). The gate does NOT use KRONOS_E2E_BARE_SIM: it opens the factory file, then connects the simulator.
// TEST-ONLY HOOK the builder must add (exists only when api.e2e, next to midiLog in App.tsx):
//   window.__kronosE2E.injectMidi(bytes: number[]): void   delivers one message as if the keyboard had sent it, through the same receive path the monitor and the key lighting listen to (the simulator's listeners / the Link receive hook). Works only while a keyboard is connected.
//
// PURE MODULE src/core/midi/monitor.ts, exact exports:
//   noteName(n: number): string                      60 -> "C4", 61 -> "C#4", 21 -> "A0", 108 -> "C8", 0 -> "C-1" (sharps only)
//   type Dir = "in" | "out"
//   interface Decoded { type: string; channel: number | null; values: string }   channel is 1..16 or null for system messages
//   decodeMessage(data: ArrayLike<number>): Decoded
//       type is one of: "Note Off" "Note On" "Poly Pressure" "Control Change" "Program Change" "Channel Pressure" "Pitch Bend" "SysEx" "Timing Clock" "Start" "Continue" "Stop" "Active Sensing" "System Reset" "Song Position" "Song Select" "Tune Request" "Unknown"
//       Note On with velocity 0 decodes as "Note Off". Never throws: empty or truncated input gives type "Unknown".
//       values: Note On/Off "<noteName> <n> vel <v>" e.g. "C4 60 vel 100"; Poly Pressure "<noteName> <n> pressure <v>"; Control Change "cc <n> = <v>"; Program Change "prog <n>"; Channel Pressure "pressure <v>";
//       Pitch Bend "bend <signed>" where signed = (msb<<7|lsb) - 8192, e.g. "bend -8192", "bend 0", "bend 8191"; SysEx "<len> bytes <first 8 bytes as upper-case hex separated by spaces>" plus " ..." when longer than 8 bytes, e.g. "14 bytes F0 42 30 68 73 00 40 00 ...";
//       Song Position "pos <n>", Song Select "song <n>", other system messages "".
//   interface MonitorEntry { seq: number; time: number; dir: Dir; data: Uint8Array; type: string; channel: number | null; values: string }   seq starts at 0 and rises by 1 per add; time is the ms value given to add
//   class MonitorLog { constructor(capacity = 2000); readonly capacity: number; get size(): number; add(dir: Dir, data: ArrayLike<number>, time: number): MonitorEntry; entries(): MonitorEntry[] /* oldest first */; clear(): void }   a full ring drops the oldest; add copies the bytes; clear does not reset seq
//   filterEntries(entries: readonly MonitorEntry[], query: string, showActiveSensing: boolean): MonitorEntry[]   Active Sensing hidden unless showActiveSensing; query (trimmed, case-insensitive; empty = all) must be contained in "<IN|OUT> <type> <values>" (so "out", "control", "C4" and "cc 7" all match)
//   formatTime(ms: number): string                   1234567 -> "20:34.567" (mm:ss.mmm; minutes beyond 99 need not be handled)
//   formatEntries(entries: readonly MonitorEntry[]): string   one line per entry, tab separated: time, "IN"/"OUT", channel ("-" if null), type, values; lines joined with "\n", no trailing newline
//
// data-testid table (all in the dock; the dock is visible at the bottom of the main window at all times)
//   dock                     the dock container
//   dock-toggle              collapse/expand button (aria-expanded "true"/"false")
//   dock-body                the dock content; hidden or absent while collapsed
//   dock-tab-keys, dock-tab-monitor   the two tabs (aria-selected "true" on the active one); Keyboard is active at start and the dock starts expanded
//   dock-key-<n>             one element per MIDI note n = 21..108 (the 88 keys, and no other dock-key-* element); data-lit="1" while an incoming note is held, else "0"; data-down="1" while pressed locally, else "0"
//   dock-velocity            input type=range 1..127, default 100; used for computer-keyboard notes (mouse notes take velocity from the click height, lower = harder)
//   dock-sustain             toggle button (aria-pressed); on sends CC64 127, off sends CC64 0, on the keyboard's channel
//   dock-mod                 input type=range 0..127, sends CC1 on change
//   dock-pitch               input type=range -8192..8191, sends Pitch Bend on change
//   dock-octave              text of the computer-keyboard octave shift: "0", "+1", "-1" ... (- lowers by one octave, = raises, range -3..+3)
//   dock-mon-row-<i>         monitor table row i (0 = oldest shown); cells: dock-mon-time-<i> ("mm:ss.mmm"), dock-mon-dir-<i> ("IN"/"OUT"), dock-mon-ch-<i> ("1".."16" or "-"), dock-mon-type-<i>, dock-mon-val-<i>
//   dock-mon-count           text: number of rows currently shown in the table
//   dock-mon-pause           toggle button (aria-pressed). While paused the table is frozen but messages are still captured; resuming shows them
//   dock-mon-clear           empties the table and the ring
//   dock-mon-filter          text input, the filterEntries query
//   dock-mon-active-sensing  checkbox "show Active Sensing", unchecked by default
//   dock-mon-copy            copies formatEntries of the shown rows to the system clipboard
// The monitor records from app start, whichever tab is showing. Sent traffic includes the dock's own notes and every Link request; received includes every reply.
// Computer keys (event.code): row one KeyZ S X D C V G B H N J M = notes 48..59 (C3..B3), row two KeyQ 2 W 3 E R 5 T 6 Y 7 U = notes 60..71; Minus/Equal shift by -12/+12 notes per step. Ignored while an input, textarea or select has focus. Key repeat must not retrigger a note.
// A computer or mouse note-off is either 0x80 n 0 or 0x90 n 0. The keyboard's channel is link.channel (0 in the simulator, so status bytes 0x9n/0x8n/0xBn/0xEn with n = 0).
// Held notes are released (a note-off for each) on window blur, on switching tab, on collapsing the dock (the keys unmount) and on unmount.
import assert from "node:assert/strict";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("DOCK"), { check, finish } = g, C = await core(g);
let M; try { M = await load("src/core/midi/monitor.ts"); } catch (e) { g.fails.push(`cannot load monitor.ts: ${e.message}`); await finish(); }
const d = (...b) => M.decodeMessage(Uint8Array.from(b));
// Real data: the 7-bit-masked bytes of the factory file stand in for a dump payload.
const sysex = (len) => Uint8Array.from([0xf0, 0x42, 0x30, 0x68, ...Array.from(C.raw.subarray(100, 100 + len - 5), (x) => x & 0x7f), 0xf7]);
const hex = (a) => [...a].map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join(" ");

await check("note names", () => { for (const [n, s] of [[60, "C4"], [61, "C#4"], [21, "A0"], [108, "C8"], [0, "C-1"], [127, "G9"]]) assert.equal(M.noteName(n), s); });
await check("channel messages are decoded with real values", () => {
  assert.deepEqual(d(0x93, 60, 100), { type: "Note On", channel: 4, values: "C4 60 vel 100" });
  assert.deepEqual(d(0x93, 60, 0), { type: "Note Off", channel: 4, values: "C4 60 vel 0" });
  assert.deepEqual(d(0x80, 61, 64), { type: "Note Off", channel: 1, values: "C#4 61 vel 64" });
  assert.deepEqual(d(0xb0, 7, 127), { type: "Control Change", channel: 1, values: "cc 7 = 127" });
  assert.deepEqual(d(0xcf, 5), { type: "Program Change", channel: 16, values: "prog 5" });
  assert.deepEqual(d(0xd2, 40), { type: "Channel Pressure", channel: 3, values: "pressure 40" });
  assert.deepEqual(d(0xa1, 60, 9), { type: "Poly Pressure", channel: 2, values: "C4 60 pressure 9" });
  for (const [lsb, msb, s] of [[0, 0, "bend -8192"], [0, 64, "bend 0"], [127, 127, "bend 8191"], [1, 65, "bend 129"]]) assert.equal(d(0xe0, lsb, msb).values, s);
});
await check("system messages, SysEx from real data, and junk", () => {
  for (const [b, t] of [[[0xfe], "Active Sensing"], [[0xf8], "Timing Clock"], [[0xfa], "Start"], [[0xfb], "Continue"], [[0xfc], "Stop"], [[0xff], "System Reset"], [[0xf6], "Tune Request"]]) assert.deepEqual(d(...b), { type: t, channel: null, values: "" });
  assert.deepEqual(d(0xf2, 1, 1), { type: "Song Position", channel: null, values: "pos 129" }); assert.deepEqual(d(0xf3, 9), { type: "Song Select", channel: null, values: "song 9" });
  const s = sysex(14), r = M.decodeMessage(s); assert.equal(r.type, "SysEx"); assert.equal(r.channel, null); assert.equal(r.values, `14 bytes ${hex(s.subarray(0, 8))} ...`);
  const big = M.decodeMessage(sysex(5000)); assert.match(big.values, /^5000 bytes F0 42 30 68 /); assert.ok(big.values.length < 60, "preview must stay short");
  assert.equal(M.decodeMessage(Uint8Array.from([0xf0, 0x7e, 0xf7])).values, "3 bytes F0 7E F7");
  for (const b of [[], [0x90], [0x90, 60], [0xb0, 7], [0x45], [0xf4]]) assert.equal(M.decodeMessage(Uint8Array.from(b)).type, "Unknown", b.join());
});
await check("the ring keeps the newest 2000 entries", () => {
  const log = new M.MonitorLog(); assert.equal(log.capacity, 2000); for (let i = 0; i < 2500; i++) log.add(i % 2 ? "in" : "out", [0xb0, 7, i % 128], i);
  assert.equal(log.size, 2000); const e = log.entries(); assert.equal(e.length, 2000); assert.equal(e[0].seq, 500); assert.equal(e[0].time, 500); assert.equal(e[1999].seq, 2499); assert.equal(e[1999].values, `cc 7 = ${2499 % 128}`); assert.equal(e[0].dir, "out");
  log.clear(); assert.equal(log.size, 0); assert.deepEqual(log.entries(), []); assert.equal(log.add("in", [0xfe], 1).seq, 2500);
  const small = new M.MonitorLog(3); for (let i = 0; i < 5; i++) small.add("in", [0x90, 60 + i, 90], i); assert.deepEqual(small.entries().map((x) => x.data[1]), [62, 63, 64]);
  const src = [0x90, 60, 90], en = small.add("in", src, 9); src[1] = 1; assert.equal(en.data[1], 60, "the entry must copy the bytes");
});
const L = new M.MonitorLog(); L.add("out", [0x90, 60, 100], 1); L.add("in", [0xfe], 2); L.add("in", [0xb2, 7, 80], 3); L.add("in", sysex(20), 1234567);
await check("filtering hides Active Sensing and matches text", () => {
  const f = (q, a = false) => M.filterEntries(L.entries(), q, a).map((x) => x.type);
  assert.deepEqual(f("", false), ["Note On", "Control Change", "SysEx"]); assert.deepEqual(f("", true), ["Note On", "Active Sensing", "Control Change", "SysEx"]);
  assert.deepEqual(f("  OUT "), ["Note On"]); assert.deepEqual(f("control"), ["Control Change"]); assert.deepEqual(f("cc 7"), ["Control Change"]); assert.deepEqual(f("c4"), ["Note On"]); assert.deepEqual(f("sysex"), ["SysEx"]); assert.deepEqual(f("nothing like this"), []); assert.deepEqual(f("active"), []); assert.deepEqual(f("active", true), ["Active Sensing"]);
});
await check("copy text has one tab-separated line per row", () => {
  assert.equal(M.formatTime(1234567), "20:34.567"); assert.equal(M.formatTime(0), "00:00.000"); assert.equal(M.formatTime(61), "00:00.061");
  const t = M.formatEntries(M.filterEntries(L.entries(), "", false)).split("\n"); assert.equal(t.length, 3);
  assert.deepEqual(t[0].split("\t"), ["00:00.001", "OUT", "1", "Note On", "C4 60 vel 100"]); assert.deepEqual(t[1].split("\t"), ["00:00.003", "IN", "3", "Control Change", "cc 7 = 80"]); assert.deepEqual(t[2].split("\t").slice(1, 4), ["IN", "-", "SysEx"]); assert.equal(M.formatEntries([]), "");
});
await testsAndTypes(g, ["core/midi/monitor.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { X, seen, text, until, win } = ui;
const log = () => win.evaluate(() => window.__kronosE2E.midiLog()), wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isOn = (m, n, v) => m[0] === 0x90 && m[1] === n && (v === undefined ? m[2] > 0 : m[2] === v), isOff = (m, n) => (m[0] === 0x80 && m[1] === n) || (m[0] === 0x90 && m[1] === n && m[2] === 0);
const inject = (b) => win.evaluate((x) => window.__kronosE2E.injectMidi(x), b);
const count = async () => Number(await text("dock-mon-count")), row = async (i) => ({ dir: await text(`dock-mon-dir-${i}`), ch: await text(`dock-mon-ch-${i}`), type: await text(`dock-mon-type-${i}`), val: await text(`dock-mon-val-${i}`) });
const lastRow = async () => row((await count()) - 1);
const lit = async (n) => (await X(`dock-key-${n}`).getAttribute("data-lit")) === "1";
const mouseKey = async (n, yFrac, hold = false, xFrac = 0.2) => { const b = await X(`dock-key-${n}`).boundingBox(); assert.ok(b, `key ${n} has no box`); await win.mouse.move(b.x + b.width * xFrac, b.y + b.height * yFrac); await win.mouse.down(); if (!hold) { await wait(60); await win.mouse.up(); } };

await ui.openFile(); await ui.connectSim();
await X("dock-toggle").waitFor(); if ((await X("dock-toggle").getAttribute("aria-expanded")) !== "true") await X("dock-toggle").click(); // the dock starts collapsed
await check("the dock has two tabs and collapses", async () => {
  await seen("dock"); await seen("dock-body"); assert.equal(await X("dock-tab-keys").getAttribute("aria-selected"), "true"); assert.equal(await X("dock-toggle").getAttribute("aria-expanded"), "true");
  for (const n of [21, 60, 108]) assert.equal(await X(`dock-key-${n}`).count(), 1, `key ${n}`); assert.equal(await win.locator('[data-testid^="dock-key-"]').count(), 88);
  await X("dock-tab-monitor").click(); await seen("dock-mon-count"); assert.equal(await X("dock-tab-monitor").getAttribute("aria-selected"), "true"); await X("dock-tab-keys").click(); await seen("dock-key-60");
  await X("dock-toggle").click(); await until(async () => !(await X("dock-body").isVisible().catch(() => false)), "body hides"); assert.equal(await X("dock-toggle").getAttribute("aria-expanded"), "false"); assert.equal(await X("dock").isVisible(), true);
  await X("dock-toggle").click(); await seen("dock-key-60");
});
await check("computer keys play on two rows with octave shift, slider velocity, no repeat, and release", async () => {
  await X("dock-velocity").fill("77"); const base = (await log()).length; await win.keyboard.press("z"); await win.keyboard.press("x"); await win.keyboard.press("q"); await win.keyboard.press("e");
  await until(async () => (await log()).length >= base + 8, "four notes on and off");
  const m = (await log()).slice(base); for (const n of [48, 50, 60, 64]) { assert.ok(m.some((x) => isOn(x, n, 77)), `note ${n} at velocity 77`); assert.ok(m.some((x) => isOff(x, n)), `note ${n} released`); }
  assert.ok(m.every((x) => (x[0] & 15) === 0), "wrong channel");
  const b2 = (await log()).length; await win.keyboard.down("s"); await win.keyboard.down("s"); await win.keyboard.down("s"); await wait(150); assert.equal((await log()).slice(b2).filter((x) => isOn(x, 49)).length, 1, "key repeat retriggered"); assert.equal(await X("dock-key-49").getAttribute("data-down"), "1"); await win.keyboard.up("s"); await until(async () => (await log()).slice(b2).some((x) => isOff(x, 49)), "released on key up"); assert.equal(await X("dock-key-49").getAttribute("data-down"), "0");
  await win.keyboard.press("="); assert.equal(await text("dock-octave"), "+1"); const b3 = (await log()).length; await win.keyboard.press("z"); await until(async () => (await log()).length >= b3 + 2, "shifted note"); assert.ok((await log()).slice(b3).some((x) => isOn(x, 60)), "z should now be 60");
  await win.keyboard.press("-"); await win.keyboard.press("-"); assert.equal(await text("dock-octave"), "-1"); const b4 = (await log()).length; await win.keyboard.press("z"); await until(async () => (await log()).length >= b4 + 2, "lowered note"); assert.ok((await log()).slice(b4).some((x) => isOn(x, 36)), "z should now be 36");
  await win.keyboard.press("="); assert.equal(await text("dock-octave"), "0");
});
await check("typing in an input does not play notes or shift the octave", async () => {
  const b = (await log()).length; await X("search").click(); await win.keyboard.type("zxq=-"); await wait(250); assert.equal(await X("search").inputValue(), "zxq=-"); assert.equal((await log()).length, b, "notes went out while typing"); assert.equal(await text("dock-octave"), "0"); await X("search").fill(""); await win.locator("body").click({ position: { x: 3, y: 3 } });
});
await check("mouse velocity comes from the click height", async () => {
  const b = (await log()).length; await mouseKey(60, 0.08); await mouseKey(60, 0.92); await until(async () => (await log()).slice(b).filter((x) => isOn(x, 60)).length === 2, "two note-ons");
  const v = (await log()).slice(b).filter((x) => isOn(x, 60)).map((x) => x[2]); assert.ok(v[0] >= 1 && v[1] <= 127, `range ${v}`); assert.ok(v[1] >= v[0] + 40, `lower click should be harder: ${v}`); assert.ok((await log()).slice(b).some((x) => isOff(x, 60)), "released with the mouse");
});
await check("sustain, mod wheel and pitch wheel send controller bytes", async () => {
  const b = (await log()).length; await X("dock-sustain").click(); assert.equal(await X("dock-sustain").getAttribute("aria-pressed"), "true"); await X("dock-sustain").click(); assert.equal(await X("dock-sustain").getAttribute("aria-pressed"), "false");
  await X("dock-mod").fill("64"); await X("dock-pitch").fill("4096"); await until(async () => (await log()).slice(b).some((x) => x[0] === 0xe0), "pitch bend sent");
  const m = (await log()).slice(b), cc = (n, v) => m.some((x) => x[0] === 0xb0 && x[1] === n && x[2] === v); assert.ok(cc(64, 127) && cc(64, 0), "sustain on then off"); assert.ok(m.findIndex((x) => x[1] === 64 && x[2] === 127) < m.findIndex((x) => x[1] === 64 && x[2] === 0)); assert.ok(cc(1, 64), "mod wheel"); assert.ok(m.some((x) => x[0] === 0xe0 && x[1] === 0 && x[2] === 96), "pitch 8192+4096 = lsb 0 msb 96");
});
await check("held notes are released on blur, tab change and collapse", async () => {
  const held = async (release) => { const b = (await log()).length; await win.keyboard.down("z"); await until(async () => (await log()).slice(b).some((x) => isOn(x, 48)), "note on"); await release(); await until(async () => (await log()).slice(b).some((x) => isOff(x, 48)), "note off after release"); await win.keyboard.up("z"); await wait(80); };
  await held(() => win.evaluate(() => window.dispatchEvent(new Event("blur"))));
  await held(() => X("dock-tab-monitor").click()); await X("dock-tab-keys").click(); await seen("dock-key-60");
  await held(() => X("dock-toggle").click()); await X("dock-toggle").click(); await seen("dock-key-60");
  const b = (await log()).length; await mouseKey(62, 0.5, true, 0.5); await until(async () => (await log()).slice(b).some((x) => isOn(x, 62)), "mouse note on"); await win.evaluate(() => window.dispatchEvent(new Event("blur"))); await until(async () => (await log()).slice(b).some((x) => isOff(x, 62)), "mouse note released on blur"); await win.mouse.up();
});
await check("incoming notes light the keys", async () => {
  await inject([0x90, 64, 100]); await until(() => lit(64), "key 64 lit"); assert.equal(await lit(65), false); await inject([0x80, 64, 0]); await until(async () => !(await lit(64)), "key 64 off");
  await inject([0x93, 66, 90]); await until(() => lit(66), "key 66 lit on another channel"); await inject([0x93, 66, 0]); await until(async () => !(await lit(66)), "note on with velocity 0 turns it off");
});
await check("the monitor shows sent and received messages decoded, plus real transfer traffic", async () => {
  await X("dock-tab-monitor").click(); await seen("dock-mon-count"); await X("dock-mon-clear").click(); await until(async () => (await count()) === 0, "cleared");
  await inject([0x92, 61, 50]); await until(async () => (await count()) === 1, "one row"); assert.deepEqual(await lastRow(), { dir: "IN", ch: "3", type: "Note On", val: "C#4 61 vel 50" }); assert.match(await text("dock-mon-time-0"), /^\d\d:\d\d\.\d{3}$/);
  await X("dock-tab-keys").click(); await win.keyboard.press("z"); await X("dock-tab-monitor").click(); await until(async () => (await count()) >= 3, "sent notes shown"); const rows = []; for (let i = 0; i < (await count()); i++) rows.push(await row(i));
  assert.ok(rows.some((r) => r.dir === "OUT" && r.type === "Note On" && r.ch === "1" && r.val === "C3 48 vel 77"), JSON.stringify(rows)); assert.ok(rows.some((r) => r.dir === "OUT" && r.type === "Note Off" && r.val.startsWith("C3 48")));
  await X("dock-mon-clear").click(); await ui.openBank("program:INT-A"); await X("pull-bank").click();
  await until(async () => { const n = await count(); for (let i = 0; i < n; i++) if ((await text(`dock-mon-type-${i}`)) === "SysEx" && (await text(`dock-mon-dir-${i}`)) === "IN") return true; return false; }, "a received SysEx row from the pull", 30000);
  const n = await count(), dirs = new Set(); for (let i = 0; i < n; i++) { const r = await row(i); if (r.type === "SysEx") { dirs.add(r.dir); assert.equal(r.ch, "-"); assert.match(r.val, /^\d+ bytes F0 42 /); assert.ok(r.val.length < 60); } } assert.deepEqual([...dirs].sort(), ["IN", "OUT"]);
});
await check("Active Sensing is hidden by default; filter, pause, clear and copy work", async () => {
  await until(async () => (await X("progress").count()) === 0, "the bank pull to finish", 30000); await X("dock-mon-clear").click(); assert.equal(await X("dock-mon-active-sensing").isChecked(), false); await inject([0xfe]); await inject([0xb0, 7, 90]); await inject([0x90, 60, 100]); await until(async () => (await count()) === 2, "two rows, Active Sensing hidden"); assert.equal((await lastRow()).type, "Note On");
  await X("dock-mon-active-sensing").check(); await until(async () => (await count()) === 3, "Active Sensing shown"); assert.equal((await row(0)).type, "Active Sensing"); await X("dock-mon-active-sensing").uncheck(); await until(async () => (await count()) === 2, "hidden again");
  await X("dock-mon-filter").fill("control"); await until(async () => (await count()) === 1, "filtered"); assert.equal((await row(0)).val, "cc 7 = 90"); await X("dock-mon-filter").fill("");
  await until(async () => (await count()) === 2, "unfiltered"); await X("dock-mon-pause").click(); assert.equal(await X("dock-mon-pause").getAttribute("aria-pressed"), "true"); await inject([0xc0, 9]); await wait(300); assert.equal(await count(), 2, "table moved while paused");
  await X("dock-mon-pause").click(); await until(async () => (await count()) === 3, "paused message appears after resume"); assert.deepEqual(await lastRow(), { dir: "IN", ch: "1", type: "Program Change", val: "prog 9" });
  await X("dock-mon-copy").click(); let clip = ""; await until(async () => { clip = await g.state.app.evaluate(({ clipboard }) => clipboard.readText()); return clip.includes("Program Change"); }, "clipboard text");
  const lines = clip.split("\n"); assert.equal(lines.length, 3); assert.deepEqual(lines[2].split("\t").slice(1), ["IN", "1", "Program Change", "prog 9"]); assert.ok(lines[0].split("\t").includes("Control Change") || lines[0].split("\t").includes("Note On"));
  await X("dock-mon-clear").click(); await until(async () => (await count()) === 0, "cleared"); assert.equal(await win.locator('[data-testid^="dock-mon-row-"]').count(), 0);
});
await check("a flood keeps 2000 rows, the newest ones, and does not freeze the window", async () => {
  await X("dock-mon-clear").click(); const t0 = Date.now(); const ms = await win.evaluate(() => { const t = performance.now(); for (let i = 0; i < 2500; i++) window.__kronosE2E.injectMidi([0xb0, 7, i % 128]); return performance.now() - t; }); assert.ok(ms < 1500, `injecting 2500 messages blocked the page for ${Math.round(ms)} ms`);
  await until(async () => (await count()) === 2000, "2000 rows", 15000); await wait(400); assert.equal(await count(), 2000); assert.equal((await lastRow()).val, `cc 7 = ${2499 % 128}`); assert.equal((await row(0)).val, `cc 7 = ${500 % 128}`);
  const pong = await win.evaluate(() => new Promise((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); })); assert.ok(pong < 500, `a frame took ${Math.round(pong)} ms after the flood`); assert.ok(Date.now() - t0 < 20000);
});
await ui.noErrors();
await finish();
