// Acceptance gate for the MIDI Player transport upgrade. Owned by the architect: builders must not edit it.
//
// Test-only env vars: none new. It reuses KRONOS_E2E=1 (set by launch()) and KRONOS_E2E_MIDI (path the "MIDI File..." button reads, changed
// between files with process.env inside the main process, exactly as gate-midi.mjs does).
//
// PURE EXPORTS the builder must implement (src/core/midi/player.ts and smf.ts):
//   transposeNote(note: number, semitones: number, channel: number): number | null
//        channel is 0..15. Channel 9 (MIDI channel 10, drums) returns note unchanged. Otherwise note + semitones, or null when the result is outside 0..127.
//   MidiPlayer.play(events: PlayEvent[], opts: { channel: number | null; onEnd?: () => void; startMs?: number; tempo?: number; transpose?: number; muted?: number[]; loop?: boolean }): void
//        startMs is a song position in ms (clamped to 0..end); tempo is a scale (1 = normal, 2 = twice as fast); transpose is in semitones;
//        muted is a list of 0-based channels (after the "channel" remap); loop restarts at the time of the last event, onEnd is not called while looping.
//   MidiPlayer.setTempo(scale: number): void        MidiPlayer.setTranspose(semitones: number): void
//   MidiPlayer.setMuted(channels: number[]): void   MidiPlayer.setLoop(loop: boolean): void
//   MidiPlayer.seek(ms: number): void               moves the song position (clamped; past the end ends playback and calls onEnd)
//   MidiPlayer.positionMs(): number                 song position in song ms (real elapsed time times tempo); keeps its value after the song ends or stops
//   Every setter and seek first sends Note Off for each held note, then applies the change. A note-on that was transposed is turned off with the
//   pitch it was started at. A note whose transposed pitch is outside 0..127 is dropped, with its Note Off.
//   parseSmf(bytes).channels: { channel: number; name: string; notes: number }[]
//        sorted by channel, only channels with at least one note-on (velocity > 0); name is the Track Name meta event (FF 03) of the first track that
//        uses the channel ("" if none); notes counts those note-ons. Existing fields stay.
//
// data-testid table (all inside the player panel, visible once a MIDI file is loaded; "n" is the 1-based channel number, 1..16):
//   playerpro-transport      container; attribute data-playing = "true" while a song is playing, else "false"
//   playerpro-pos            <input type=range>, min 0, max = song length in whole ms, value = song position in ms; changing it seeks
//   playerpro-time-cur       current position text, m:ss (for example 0:15)
//   playerpro-time-total     song length text, m:ss
//   playerpro-loop           checkbox, Loop
//   playerpro-tempo          <input type=number>, percent, clamped to 25..200 on blur, default 100
//   playerpro-transpose      <input type=number>, semitones, clamped to -24..24 on blur, default 0
//   playerpro-chan-n-name    track name of the channel (the file's name, or text containing "Ch n" if the file has none)
//   playerpro-chan-n-notes   note count of the channel, text is the bare number
//   playerpro-chan-n-mute    button, aria-pressed "true" when muted
//   playerpro-chan-n-solo    button, aria-pressed "true" when soloed; while any channel is soloed only soloed channels sound
//   playerpro-roll           the piano-roll <canvas> of the whole song; attribute data-notes = number of notes drawn, data-draws = how many times the
//                            note layer has been fully drawn (must stay 1 while playing or seeking); clicking at x fraction f of its width seeks to f * song length
//   playerpro-playhead       the moving playhead element; attribute data-ms = its position in ms, updated while playing
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("PLAYERPRO"), { check, finish } = g, C = await core(g);
let S, M; try { S = await load("src/core/midi/smf.ts"); M = await load("src/core/midi/player.ts"); } catch (e) { g.fails.push(`cannot load midi modules: ${e.message}`); await finish(); }

const vlq = (n) => { const out = [n & 127]; while ((n >>= 7)) out.unshift((n & 127) | 128); return out; };
const trk = (bytes) => { const n = bytes.length; return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...bytes]; };
const END = [0, 0xff, 0x2f, 0];
const smf = (fmt, div, ...tracks) => Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, fmt, 0, tracks.length, (div >> 8) & 255, div & 255, ...tracks.flatMap(trk)]);
const name = (s) => [0, 0xff, 3, s.length, ...[...s].map((c) => c.charCodeAt(0))];
const on = (ch, n, v = 100) => [0x90 | ch, n, v], off = (ch, n) => [0x80 | ch, n, 0];

// Song: "Lead" on channel 1 plays pitch 40+i every half second for 20 s (40 notes); "Kit" on channel 10 hits note 36 every second (20 hits).
const lead = [...name("Lead")]; for (let i = 0; i < 40; i++) lead.push(...vlq(0), ...on(0, 40 + i), ...vlq(480), ...off(0, 40 + i));
const kit = [...name("Kit")]; for (let i = 0; i < 20; i++) kit.push(...vlq(i ? 480 : 0), ...on(9, 36), ...vlq(480), ...off(9, 36));
const SONG = smf(1, 480, [...lead, ...END], [...kit, ...END]);
// 30000 notes (60000 events), 10 ticks apart, about 312 s.
const big = []; for (let i = 0; i < 30000; i++) big.push(...vlq(0), ...on(0, 40 + (i % 40)), ...vlq(10), ...off(0, 40 + (i % 40)));
const BIG = smf(0, 480, [...big, ...END]);

// ---- pure logic
const virtual = () => { let t = 0, id = 0; const q = new Map(); return { now: () => t, setTimeout: (fn, ms) => { q.set(++id, { at: t + Math.max(ms, 0), fn }); return id; }, clearTimeout: (i) => q.delete(i), advance(to) { for (;;) { const next = [...q].filter(([, v]) => v.at <= to).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; q.delete(next[0]); t = next[1].at; next[1].fn(); } t = to; } }; };
const rig = () => { const clock = virtual(), sent = [], p = new M.MidiPlayer((d) => sent.push([clock.now(), ...d]), clock); return { clock, sent, p }; };
const isOn = (m) => (m[1] & 0xf0) === 0x90 && m[3] > 0, isOff = (m) => (m[1] & 0xf0) === 0x80 || ((m[1] & 0xf0) === 0x90 && m[3] === 0);
const held = (sent) => { const h = new Set(); for (const m of sent) { const k = (m[1] & 15) * 128 + m[2]; if (isOn(m)) h.add(k); else if (isOff(m)) h.delete(k); } return [...h]; };
const ons = (sent, ch) => sent.filter((m) => isOn(m) && (m[1] & 15) === ch).map((m) => m[2]);
const has = (sent, st, n) => sent.some((m) => m[1] === st && m[2] === n && m[3] === 0);
const EV = [{ ms: 0, data: [0x90, 60, 100] }, { ms: 100, data: [0x91, 64, 90] }, { ms: 300, data: [0x80, 60, 0] }, { ms: 300, data: [0x81, 64, 0] }, { ms: 500, data: [0x90, 62, 100] }, { ms: 700, data: [0x80, 62, 0] }];

await check("transposeNote shifts notes, keeps drums, drops notes that leave the range", () => {
  assert.equal(M.transposeNote(60, 5, 0), 65); assert.equal(M.transposeNote(60, -24, 3), 36); assert.equal(M.transposeNote(36, 5, 9), 36); assert.equal(M.transposeNote(60, -24, 9), 60);
  assert.equal(M.transposeNote(127, 0, 0), 127); assert.equal(M.transposeNote(120, 24, 0), null); assert.equal(M.transposeNote(3, -24, 1), null); assert.equal(M.transposeNote(127, 1, 15), null);
});
await check("the file reader reports each used channel with its track name and note count", () => {
  assert.deepEqual(S.parseSmf(SONG).channels, [{ channel: 0, name: "Lead", notes: 40 }, { channel: 9, name: "Kit", notes: 20 }]);
  const un = S.parseSmf(smf(0, 480, [0, ...on(2, 60), 0, ...on(2, 62, 0), 0, ...on(5, 64), 0, ...off(5, 64), ...END]));
  assert.deepEqual(un.channels, [{ channel: 2, name: "", notes: 1 }, { channel: 5, name: "", notes: 1 }]);
});
await check("tempo scale speeds up playback, from the start and while playing", () => {
  let r = rig(); r.p.play(EV, { channel: null, tempo: 2 }); r.clock.advance(1000); const on64 = r.sent.find((m) => m[1] === 0x91 && m[3] === 90); assert.ok(Math.abs(on64[0] - 50) <= 25, `at ${on64[0]}`);
  r = rig(); r.p.play(EV, { channel: null }); r.clock.advance(100); r.p.setTempo(2); r.clock.advance(1000);
  const t = r.sent.find((m) => m[1] === 0x90 && m[2] === 62 && m[3] === 100)[0]; assert.ok(t >= 275 && t <= 325, `note at ${t}, wanted about 300`);
  r = rig(); r.p.play(EV, { channel: null }); r.clock.advance(100); r.p.setTempo(2); r.clock.advance(250); assert.ok(Math.abs(r.p.positionMs() - 400) <= 40, `position ${r.p.positionMs()}`);
});
await check("start position skips what came before it", () => {
  const { clock, sent, p } = rig(); p.play(EV, { channel: null, startMs: 350 }); assert.ok(Math.abs(p.positionMs() - 350) <= 5); clock.advance(1000);
  assert.deepEqual(ons(sent, 0), [62]); assert.deepEqual(ons(sent, 1), []); const t = sent.find(isOn)[0]; assert.ok(Math.abs(t - 150) <= 25, `first note at ${t}`);
});
await check("transpose changes while playing without a stuck note, and drums stay put", () => {
  const E = [{ ms: 0, data: [0x90, 60, 100] }, { ms: 0, data: [0x99, 36, 100] }, { ms: 300, data: [0x80, 60, 0] }, { ms: 300, data: [0x89, 36, 0] }, { ms: 400, data: [0x90, 62, 100] }, { ms: 400, data: [0x99, 36, 100] }, { ms: 600, data: [0x80, 62, 0] }, { ms: 600, data: [0x89, 36, 0] }];
  const { clock, sent, p } = rig(); p.play(E, { channel: null }); clock.advance(100); const n = sent.length; p.setTranspose(2);
  assert.ok(sent.slice(n).some((m) => m[1] === 0x80 && m[2] === 60), "no Note Off for the held note at the change"); assert.ok(sent.slice(n).some((m) => m[1] === 0x89 && m[2] === 36), "no Note Off for the held drum");
  clock.advance(1000); assert.deepEqual(ons(sent, 0), [60, 64]); assert.deepEqual(ons(sent, 9), [36, 36]); assert.deepEqual(held(sent), []);
  const r = rig(); r.p.play(E, { channel: null, transpose: 5 }); r.clock.advance(1000); assert.deepEqual(ons(r.sent, 0), [65, 67]); assert.deepEqual(ons(r.sent, 9), [36, 36]);
});
await check("a note pushed outside 0..127 by transpose is dropped, never sent as garbage", () => {
  const { clock, sent, p } = rig(); p.play([{ ms: 100, data: [0x90, 120, 100] }, { ms: 200, data: [0x80, 120, 0] }, { ms: 300, data: [0x90, 60, 100] }, { ms: 400, data: [0x80, 60, 0] }], { channel: null, transpose: 24 }); clock.advance(1000);
  assert.ok(sent.every((m) => m.slice(2).every((b) => b >= 0 && b <= 127)), "a data byte left 0..127"); assert.deepEqual(ons(sent, 0), [84]); assert.deepEqual(held(sent), []);
});
await check("muting a channel while playing silences it at once and keeps the rest going", () => {
  const { clock, sent, p } = rig(); p.play(EV, { channel: null }); clock.advance(150); const n = sent.length; p.setMuted([1]);
  assert.ok(sent.slice(n).some((m) => m[1] === 0x81 && m[2] === 64), "held note on the muted channel was left on"); assert.ok(!sent.slice(n).some((m) => m[1] === 0x80 && m[2] === 60), "channel 1 was disturbed");
  clock.advance(1000); assert.deepEqual(ons(sent, 0), [60, 62]); assert.deepEqual(held(sent), []);
  const r = rig(); r.p.play([...EV, { ms: 900, data: [0x91, 66, 90] }, { ms: 950, data: [0x81, 66, 0] }], { channel: null, muted: [1] }); r.clock.advance(150); r.p.setMuted([]); r.clock.advance(2000); assert.deepEqual(ons(r.sent, 1), [66]);
});
await check("loop repeats the song until it is turned off, then the song ends once", () => {
  const { clock, sent, p } = rig(); let ended = 0; p.play(EV.slice(0, 4), { channel: null, loop: true, onEnd: () => ended++ }); clock.advance(1500);
  assert.ok(ons(sent, 0).length >= 3, `only ${ons(sent, 0).length} passes`); assert.equal(p.playing, true); assert.equal(ended, 0);
  p.setLoop(false); clock.advance(3000); assert.equal(p.playing, false); assert.equal(ended, 1); assert.deepEqual(held(sent), []);
});
await check("seeking while playing releases held notes, jumps, and does not replay skipped events", () => {
  const { clock, sent, p } = rig(); p.play(EV, { channel: null }); clock.advance(150); const n = sent.length; p.seek(400);
  assert.ok(has(sent.slice(n), 0x80, 60) && has(sent.slice(n), 0x81, 64), "held notes not released"); assert.ok(Math.abs(p.positionMs() - 400) <= 5);
  clock.advance(600); assert.deepEqual(ons(sent, 0), [60, 62]); assert.deepEqual(ons(sent, 1), [64]); assert.deepEqual(held(sent), []);
  p.seek(-50); assert.ok(p.positionMs() >= 0 && p.positionMs() <= 5); p.stop();
});
await check("seeking past the end ends playback cleanly", () => {
  const { clock, sent, p } = rig(); let ended = 0; p.play(EV, { channel: null, onEnd: () => ended++ }); clock.advance(50); p.seek(999999); clock.advance(2000);
  assert.equal(p.playing, false); assert.equal(ended, 1); assert.deepEqual(ons(sent, 0), [60]); assert.deepEqual(held(sent), []); assert.ok(p.positionMs() <= 800);
});
await testsAndTypes(g, ["core/midi/player.test.ts"]);
const gm = spawnSync(process.execPath, ["tools/gate-midi.mjs"], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 520000 });
await check("the existing tools/gate-midi.mjs still passes", () => assert.equal(gm.status, 0, (gm.stdout + gm.stderr).slice(-600)));
if (g.fails.length) await finish();

// ---- the real app
const ui = await launch(g, C, { KRONOS_E2E_MIDI: "PLACEHOLDER" });
const { X, seen, text, until, win } = ui, SONG_PATH = path.join(ui.tmp, "song.mid"), BIG_PATH = path.join(ui.tmp, "big.mid");
const setPath = (p) => g.state.app.evaluate((_e, a) => { process.env.KRONOS_E2E_MIDI = a; }, p);
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const lon = (l, ch) => l.filter((m) => m[0] === (0x90 | ch) && m[2] > 0).map((m) => m[1]);
const heldIn = (l) => { const h = new Set(); for (const m of l) { const k = (m[0] & 15) * 128 + m[1]; if ((m[0] & 0xf0) === 0x90 && m[2] > 0) h.add(k); else if ((m[0] & 0xf0) === 0x80 || (m[0] & 0xf0) === 0x90) h.delete(k); } return [...h]; };
const playing = async () => (await X("playerpro-transport").getAttribute("data-playing")) === "true";
const ms = async () => Number(await X("playerpro-playhead").getAttribute("data-ms"));
const startSong = async () => { await X("midi-play").click(); await until(playing, "playing", 8000); };
const stop = async () => { await X("midi-stop").click(); await until(async () => !(await playing()), "stopped", 5000); };
const wait = (t) => new Promise((r) => setTimeout(r, t));
await ui.openFile(); await ui.connectSim(); writeFileSync(SONG_PATH, SONG); writeFileSync(BIG_PATH, BIG); await setPath(SONG_PATH);
await X("midi-open").click(); await until(async () => /song\.mid/i.test(await text("midi-file-name")), "file name");
await X("midi-channel").selectOption("auto"); // these checks need the song on its own channels; the default is "keyboard"

await check("the transport shows the song length, and one row per used channel with name and notes", async () => {
  await seen("playerpro-transport"); assert.equal(await text("playerpro-time-total"), "0:20"); assert.equal(await text("playerpro-time-cur"), "0:00"); assert.equal(await X("playerpro-pos").getAttribute("max"), "20000");
  assert.equal(await text("playerpro-chan-1-name"), "Lead"); assert.equal(await text("playerpro-chan-1-notes"), "40"); assert.equal(await text("playerpro-chan-10-name"), "Kit"); assert.equal(await text("playerpro-chan-10-notes"), "20");
  assert.equal(await X("playerpro-chan-2-name").count(), 0, "an unused channel is listed"); assert.equal(await X("playerpro-roll").getAttribute("data-notes"), "60");
});
await check("the controls clamp: tempo 25..200 percent, transpose -24..+24", async () => {
  for (const [id, v, want] of [["playerpro-tempo", "500", "200"], ["playerpro-tempo", "3", "25"], ["playerpro-tempo", "100", "100"], ["playerpro-transpose", "99", "24"], ["playerpro-transpose", "-99", "-24"], ["playerpro-transpose", "0", "0"]]) { await X(id).fill(v); await X(id).blur(); await until(async () => (await X(id).inputValue()) === want, `${id} ${v} -> ${want}`, 3000); }
});
await check("playing shows a moving position, and tempo 200 percent plays twice as fast", async () => {
  await X("playerpro-tempo").fill("200"); await X("playerpro-tempo").blur(); const n = (await log()).length; await startSong(); await wait(2000); const p = await ms(); await stop();
  assert.ok(p >= 3000 && p <= 5500, `position ${p} after 2 s at 200 percent`); assert.match(await text("playerpro-time-cur"), /^0:0[3-5]$/); assert.ok(lon((await log()).slice(n), 0).length >= 6, "too few notes at double speed");
  await X("playerpro-tempo").fill("100"); await X("playerpro-tempo").blur();
});
await check("transpose during playback: new notes shift, drums do not, and nothing is left sounding", async () => {
  await X("playerpro-pos").fill("0"); const n0 = (await log()).length; await startSong(); await wait(700); await X("playerpro-transpose").fill("5"); await X("playerpro-transpose").blur();
  const n = (await log()).length; await wait(1800); await stop(); const l = (await log()).slice(n); const lead = lon(l, 0), kitN = lon(l, 9);
  assert.ok(lead.length >= 2 && lead.every((x) => x >= 45 && x <= 84), `lead notes ${lead}`); assert.ok(kitN.length >= 1 && kitN.every((x) => x === 36), `drum notes ${kitN}`); assert.deepEqual(heldIn((await log()).slice(n0)), []);
  await X("playerpro-transpose").fill("0"); await X("playerpro-transpose").blur();
});
await check("mute and solo act at once, with no stuck notes", async () => {
  await X("playerpro-pos").fill("0"); const n0 = (await log()).length; await startSong(); await wait(500); await X("playerpro-chan-1-mute").click(); assert.equal(await X("playerpro-chan-1-mute").getAttribute("aria-pressed"), "true");
  const n = (await log()).length; await wait(1600); let l = (await log()).slice(n); assert.deepEqual(lon(l, 0), [], "muted channel still sounds"); assert.ok(lon(l, 9).length >= 1, "drums stopped too");
  await X("playerpro-chan-1-mute").click(); await X("playerpro-chan-10-solo").click(); assert.equal(await X("playerpro-chan-10-solo").getAttribute("aria-pressed"), "true"); const m = (await log()).length; await wait(1600); l = (await log()).slice(m);
  assert.deepEqual(lon(l, 0), [], "an unsoloed channel sounds"); assert.ok(lon(l, 9).length >= 1); await X("playerpro-chan-10-solo").click(); await stop(); assert.deepEqual(heldIn((await log()).slice(n0)), []);
});
await check("the position slider and a piano-roll click both seek", async () => {
  await X("playerpro-pos").fill("0"); await startSong(); const n = (await log()).length; await X("playerpro-pos").fill("15000"); await until(async () => lon((await log()).slice(n), 0).some((x) => x >= 70), "a note from the later part", 4000);
  const b = await X("playerpro-roll").boundingBox(); assert.ok(b && b.width > 100, "no roll"); await win.mouse.click(b.x + b.width * 0.25, b.y + b.height / 2); await wait(250); const p = await ms(); assert.ok(Math.abs(p - 5000) <= 1500, `playhead ${p} after a click at 25 percent`);
  const m = (await log()).length; await wait(1200); assert.ok(lon((await log()).slice(m), 0).some((x) => x >= 48 && x <= 54), "playback did not continue from the clicked spot"); await stop();
});
await check("Loop restarts the song at the end; without it the song stops", async () => {
  await X("playerpro-pos").fill("19000"); await startSong(); await until(async () => !(await playing()), "song ends without loop", 6000); await wait(400); const k = (await log()).length; await wait(900); assert.equal((await log()).length, k, "kept sending after the end");
  await X("playerpro-loop").check(); await X("playerpro-pos").fill("19000"); const n = (await log()).length; await startSong(); await until(async () => lon((await log()).slice(n), 0).includes(40), "first note again", 6000); assert.equal(await playing(), true); await X("playerpro-loop").uncheck(); await stop();
});
await check("changes during playback never leave a note stuck, even when made rapidly", async () => {
  await X("playerpro-pos").fill("0"); const n0 = (await log()).length; await startSong();
  for (const [t, tr] of [[100, "3"], [150, "-7"], [120, "12"], [90, "0"]]) { await X("playerpro-transpose").fill(tr); await X("playerpro-transpose").blur(); await X("playerpro-chan-1-mute").click(); await wait(t); await X("playerpro-chan-1-mute").click(); await X("playerpro-pos").fill(String(t * 40)); }
  await stop(); assert.deepEqual(heldIn((await log()).slice(n0)), []);
});
await check("a 60000-event file is drawn once and stays smooth while playing and seeking", async () => {
  await setPath(BIG_PATH); await X("midi-open").click(); await until(async () => /big\.mid/i.test(await text("midi-file-name")), "big file name", 30000); await seen("playerpro-roll");
  await until(async () => (await X("playerpro-roll").getAttribute("data-notes")) === "30000", "30000 notes drawn", 15000); await startSong();
  const frames = await win.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
  assert.ok(frames >= 20, `only ${frames} frames in a second`); const p0 = await ms(); await wait(1200); assert.ok((await ms()) > p0 + 800, "playhead did not move");
  const b = await X("playerpro-roll").boundingBox(); await win.mouse.click(b.x + b.width * 0.6, b.y + b.height / 2); await wait(300); assert.equal(await X("playerpro-roll").getAttribute("data-draws"), "1", "the note layer was redrawn"); await stop();
});
await ui.noErrors();
await finish();
