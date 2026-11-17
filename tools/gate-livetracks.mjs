// Acceptance gate for per-track instruments and live editing. Owned by the architect: builders must not edit it.
//
// Pure exports:
//   core/midi/match.ts    suggestSounds({channel, trackName, program}, idx, limit = 8): Match[], Programs only, best first
//                         searchPrograms(query, idx, limit = 30): Match[], Programs only, every query word found in the name
//   core/midi/player.ts   seqModeBytes(channel): Uint8Array, Mode Change to Sequencer
//                         auditionEvents(events, channels?: Set<number>): drops Bank Select and Program Change, only on those channels when given
//   core/device/live.ts   class Latest<T> { constructor(send: (v: T) => Promise<void>, onError: (e: unknown) => void); push(v: T): void }
// Testids (n is the channel, 1..16):
//   tracks-search-<n>      text box: search Programs for this track
//   tracks-best-<n>        button: list this track's best matches
//   tracks-result-<n>-<i>  one result; shows soundLabel; a click assigns it and closes the list
//   midimatch-ch-sound-<n> the sound this track will play (existing testid)
//   midi-channel           the channel menu gains the option value "tracks"
//   live-edit              checkbox in the editor header, on by default, only for Programs and Combis
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("LIVETRACKS"), { check, finish } = g, C = await core(g);
let M, P, L;
try { M = await load("src/core/midi/match.ts"); P = await load("src/core/midi/player.ts"); L = await load("src/core/device/live.ts"); } catch (e) { g.fails.push(`cannot load modules: ${e.message}`); await finish(); }

const idx = () => M.buildIndex([
  { key: "program:INT-A", index: 0, name: "Deep Bass", kind: "program" },
  { key: "combi:INT-A", index: 1, name: "Deep Bass Combi", kind: "combi" },
  { key: "program:INT-A", index: 2, name: "Slap Bass", kind: "program" },
  { key: "program:INT-A", index: 3, name: "Studio Drum Kit", kind: "program" },
  { key: "program:INT-A", index: 4, name: "Grand Piano", kind: "program" },
]);
await check("best matches are Programs only, ranked, and limited", () => {
  const r = M.suggestSounds({ channel: 0, trackName: "Bass", program: 33 }, idx());
  assert.deepEqual(r.map((m) => m.name).sort(), ["Deep Bass", "Slap Bass"]);
  assert.ok(r.every((m) => m.kind === "program"));
  assert.equal(M.suggestSounds({ channel: 0, trackName: "Bass", program: 33 }, idx(), 1).length, 1);
});
await check("instrument words match even though song titles ignore them", () => assert.equal(M.suggestSounds({ channel: 0, trackName: "Piano", program: 0 }, idx())[0]?.name, "Grand Piano"));
await check("a track with no useful name falls back to its GM instrument", () => assert.equal(M.suggestSounds({ channel: 0, trackName: "zzq", program: 0 }, idx())[0]?.name, "Grand Piano"));
await check("channel 10 suggests a drum sound", () => assert.equal(M.suggestSounds({ channel: 9, trackName: "crash", program: null }, idx())[0]?.name, "Studio Drum Kit"));
await check("nothing useful gives an empty list", () => assert.deepEqual(M.suggestSounds({ channel: 0, trackName: "zzq", program: null }, idx()), []));
await check("search finds parts of words, needs every word, and skips Combis", () => {
  assert.deepEqual(M.searchPrograms("pia", idx()).map((m) => m.name), ["Grand Piano"]);
  assert.deepEqual(M.searchPrograms("DEEP bas", idx()).map((m) => m.name), ["Deep Bass"]);
  assert.deepEqual(M.searchPrograms("deep zzz", idx()), []);
  assert.deepEqual(M.searchPrograms("   ", idx()), []);
  assert.equal(M.searchPrograms("bass", idx(), 1).length, 1);
});
await check("Sequencer Mode Change bytes", () => assert.deepEqual([...P.seqModeBytes(3)], [0xf0, 0x42, 0x33, 0x68, 0x4e, 4, 0xf7]));
await check("only the chosen channels lose their own sound changes", () => {
  const e = [[0xc0, 5], [0xb0, 0, 1], [0xb0, 32, 2], [0xb0, 7, 90], [0xc1, 6], [0xb1, 0, 3], [0x90, 60, 100]].map((data) => ({ ms: 0, data }));
  assert.deepEqual(P.auditionEvents(e, new Set([0])).map((x) => x.data), [[0xb0, 7, 90], [0xc1, 6], [0xb1, 0, 3], [0x90, 60, 100]]);
  assert.deepEqual(P.auditionEvents(e).map((x) => x.data), [[0xb0, 7, 90], [0x90, 60, 100]]);
});
const tick = () => new Promise((r) => setTimeout(r, 0));
await check("live sends never overlap, and only the newest waiting edit is sent", async () => {
  const sent = [], done = [];
  const s = new L.Latest((v) => { sent.push(v); return new Promise((r) => done.push(r)); }, () => assert.fail("no error expected"));
  s.push(1); s.push(2); s.push(3);
  assert.deepEqual(sent, [1]);
  done.shift()(); await tick();
  assert.deepEqual(sent, [1, 3]);
  done.shift()(); await tick();
  assert.deepEqual(sent, [1, 3]);
  s.push(4);
  assert.deepEqual(sent, [1, 3, 4]);
});
await check("a failed live send is reported and later edits still go out", async () => {
  const sent = [], errs = [];
  const s = new L.Latest((v) => { sent.push(v); return v === 1 ? Promise.reject(new Error("x")) : Promise.resolve(); }, (e) => errs.push(e));
  s.push(1); await tick(); await tick();
  assert.equal(errs.length, 1);
  s.push(2); await tick();
  assert.deepEqual(sent, [1, 2]);
});
await testsAndTypes(g, ["core/midi/match.test.ts", "core/device/live.test.ts"]);
if (g.fails.length) await finish();

const vlq = (n) => { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; };
const trk = (b) => [0x4d, 0x54, 0x72, 0x6b, (b.length >>> 24) & 255, (b.length >>> 16) & 255, (b.length >>> 8) & 255, b.length & 255, ...b];
const track = (name, ch, prog, note) => trk([...(name ? [0, 0xff, 0x03, name.length, ...Buffer.from(name)] : []), ...(prog === null ? [] : [0, 0xc0 | ch, prog]), 0, 0x90 | ch, note, 100, ...vlq(7680), 0x80 | ch, note, 0, 0, 0xff, 0x2f, 0]);
const SONG = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, 1, 0xe0, ...track("Bass", 0, 33, 40), ...track("Zebra", 1, 127, 60), ...track(null, 9, null, 36)]);
const MODE = (m) => [0xf0, 0x42, 0x30, 0x68, 0x4e, m, 0xf7];

const ui = await launch(g, C, { KRONOS_E2E_MIDI: "PLACEHOLDER" }), { X, seen, text, until, win, tmp } = ui;
const MID = path.join(tmp, "zzqx.mid");
writeFileSync(MID, SONG);
await g.state.app.evaluate((_e, p) => { process.env.KRONOS_E2E_MIDI = p; }, MID);
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const same = (x, m) => x.length === m.length && x.every((b, i) => b === m[i]);
const has = (l, m) => l.some((x) => same(x, m));
const at = (l, m) => l.findIndex((x) => same(x, m));
const noteOn = (m) => (m[0] & 0xf0) === 0x90 && m[2] > 0;
const select = (s, ch) => P.selectBytes(s.key, s.index, ch).map((b) => [...b]);
const parse = (t) => { const m = t.match(/(INT-[A-F]|U-[A-Z]{1,2}) (\d{3})/); assert.ok(m, `no slot in "${t}"`); return { key: `program:${m[1]}`, index: Number(m[2]) }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = async (n, query) => { await X(`tracks-search-${n}`).fill(query); await seen(`tracks-result-${n}-0`); const t = await text(`tracks-result-${n}-0`); await X(`tracks-result-${n}-0`).click(); return t; };

await ui.openFile();
await ui.connectSim();
// Style A hosts the MIDI player in the dock's MIDI player tab, so the gate opens that tab first (a second click on an open tab would close it).
if (!(await X("midi-open").isVisible())) await X("dock-tab-player").click();
await X("midi-open").click();
await seen("midimatch-ch-sound-2");
let picked;

await check("searching a track and clicking a result replaces its instrument", async () => {
  picked = await pick(2, "japanese");
  await until(async () => (await text("midimatch-ch-sound-2")).includes(picked.trim().split(/\s+/).pop()), "row shows the pick");
  assert.equal(await X("tracks-result-2-0").count(), 0, "the list stayed open");
  assert.equal(await X("midi-channel").inputValue(), "tracks");
});
await check("Play switches to Sequencer mode, sends each track's sound first, and keeps each channel", async () => {
  const n = (await log()).length, s = parse(picked), sel = select(s, 1);
  await X("midi-play").click();
  await ui.ok(); // asked once, because it resets the song open on the Kronos
  await until(async () => (await log()).slice(n).some(noteOn), "notes", 10000);
  await wait(200);
  const l = (await log()).slice(n), mode = at(l, MODE(4)), last = at(l, sel[2]), first = l.findIndex(noteOn);
  assert.ok(mode >= 0, "no Mode Change to Sequencer");
  assert.ok(last > mode, "the track's sound was not sent after the mode change");
  assert.ok(first > last, "notes came before the sound");
  const gmOn = at(l, [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]);
  assert.ok(gmOn > mode && gmOn < last, "GM System On must come between the mode change and the sounds");
  for (const m of [[0xb0, 0, 0x79], [0xb0, 32, 0], [0xc0, 33], [0xb9, 0, 0x78], [0xc9, 0]]) assert.ok(has(l, m), `General MIDI setup ${m} missing`);
  for (const m of [[0x90, 40, 100], [0x91, 60, 100], [0x99, 36, 100]]) assert.ok(has(l, m), `note ${m} missing`);
  assert.ok(!has(l, [0xc1, 127]), "the file's own program change reached a replaced track");
});
await check("replacing a track while it plays changes only that track, at once", async () => {
  const n = (await log()).length, t = await pick(1, "bass"), s = parse(t);
  await until(async () => has((await log()).slice(n), select(s, 0)[2]), "program change on channel 1", 5000);
  const l = (await log()).slice(n);
  assert.ok(!has(l, MODE(4)), "a second Mode Change would cut the song");
  assert.ok(!has(l, [0x90, 40, 100]), "the song restarted");
  await X("midi-stop").click();
});
await check("Best lists matches and one click assigns the top one", async () => {
  await X("tracks-best-1").click();
  await seen("tracks-result-1-0");
  const t = await text("tracks-result-1-0");
  await X("tracks-result-1-0").click();
  await until(async () => (await text("midimatch-ch-sound-1")).includes(String(parse(t).index).padStart(3, "0")), "row shows the best match");
  assert.equal(await X("tracks-result-1-0").count(), 0);
});
await check("Revert puts a track back on the file's own instrument, at once while playing", async () => {
  await X("tracks-revert-1").click();
  await until(async () => (await text("midimatch-ch-sound-1")).includes("GM: Electric Bass"), "row back on the file's instrument");
  assert.equal(await X("tracks-revert-1").count(), 0, "nothing left to revert");
  await X("midi-play").click();
  await wait(2800); // past the setup steps, so only the revert can send this
  const n = (await log()).length;
  await X("tracks-revert-2").click();
  await until(async () => has((await log()).slice(n), [0xc1, 127]), "the file's own program is back", 5000);
  assert.ok(has((await log()).slice(n), [0xb1, 0, 0x79]), "General MIDI bank");
  await X("midi-stop").click();
});
await check("replacing a track while playing on one sound moves to per-track playback", async () => {
  await X("midi-channel").selectOption("keyboard");
  await X("midi-open").click(); // Stop keeps the position, and this song only has notes at the start
  await wait(500);
  const n = (await log()).length;
  await X("midi-play").click();
  await until(async () => (await log()).slice(n).some(noteOn), "notes", 10000);
  assert.ok(!has((await log()).slice(n), MODE(4)), "keyboard mode must not enter Sequencer mode");
  const m = (await log()).length;
  await pick(2, "japanese");
  await until(async () => has((await log()).slice(m), MODE(4)), "Sequencer mode", 5000);
  assert.equal(await X("midi-channel").inputValue(), "tracks");
  await X("midi-stop").click();
});
await check("after per-track playback, one-sound playback returns to Program mode", async () => {
  await X("midi-channel").selectOption("keyboard");
  await X("bank-program:INT-C").click();
  await X("row-1").click();
  const n = (await log()).length;
  await X("midi-test").click();
  await until(async () => has((await log()).slice(n), MODE(2)), "Program mode", 5000);
  await X("midi-all-stop").click();
});
await check("a newly loaded file doesn't keep the old file's picks", async () => {
  await X("midi-open").click();
  await until(async () => !(await text("midimatch-ch-sound-2")).includes(picked.trim().split(/\s+/).pop()), "picks cleared");
});

const dumps = (l) => l.filter((m) => m[0] === 0xf0 && m[3] === 0x68 && m[4] === 0x75);
const edit = async (bank, row) => { await X(`bank-${bank}`).click(); await X(`row-${row}`).click(); await X("edit-params").click(); await seen("editor-title"); };
// The knob is a range input, or holds one; set it the way a drag does.
const setKnob = (v) => win.evaluate((v) => {
  const el = document.querySelector('[data-testid="macro-Attack"]'), i = el.matches("input") ? el : el.querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, String(v));
  i.dispatchEvent(new Event("input", { bubbles: true }));
  i.dispatchEvent(new Event("change", { bubbles: true }));
  // Knob commits an edit on key up (a drag commits on pointer up), so the edit is recorded only with this.
  i.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
}, v);
let d0;

await check("Live is on by default: opening a sound calls it up and fills the edit buffer", async () => {
  const n = (await log()).length;
  await edit("program:INT-B", 5);
  await X("view-simple").click();
  await seen("macro-Attack");
  assert.equal(await X("live-edit").isChecked(), true);
  await until(async () => dumps((await log()).slice(n)).length >= 1, "edit buffer dump", 5000);
  const l = (await log()).slice(n);
  d0 = dumps(l)[0];
  assert.ok(has(l, MODE(2)), "no Mode Change to Program");
  assert.ok(at(l, select({ key: "program:INT-B", index: 5 }, 0)[2]) < l.findIndex((m) => same(m, d0)), "the sound must be called up before the dump");
  assert.equal(d0[5], 0, "object type is Program");
  assert.equal(d0.at(-1), 0xf7);
  assert.equal(d0.length, 8 + 4236, "an HD-1 Program is 3,706 bytes before 7-bit encoding");
});
await check("each edit updates the edit buffer, with no mode change", async () => {
  const n = (await log()).length;
  await setKnob(30);
  await until(async () => dumps((await log()).slice(n)).length >= 1, "dump after the edit", 5000);
  const l = (await log()).slice(n);
  assert.notDeepEqual(dumps(l).at(-1), d0);
  assert.ok(!has(l, MODE(2)), "a Mode Change on every edit would cut the sound");
});
await check("Undo reaches the keyboard too", async () => {
  await win.getByRole("button", { name: "Undo", exact: true }).click();
  await until(async () => same(dumps(await log()).at(-1), d0), "the dump matches the original", 5000);
});
await check("with Live off, an edit sends nothing", async () => {
  await X("live-edit").click();
  const n = (await log()).length;
  await setKnob(-20);
  await wait(600);
  assert.equal(dumps((await log()).slice(n)).length, 0);
  await win.getByRole("button", { name: "Undo", exact: true }).click();
});
await check("Live also works on Combis; turning it on again by hand asks once", async () => {
  await X("close-editor").click();
  await edit("combi:INT-A", 0);
  const n = (await log()).length;
  await X("live-edit").click();
  await ui.ok();
  await until(async () => dumps((await log()).slice(n)).some((m) => m[5] === 1), "Combi dump", 5000);
  assert.ok(has((await log()).slice(n), MODE(0)), "no Mode Change to Combination");
});
await check("with Live on, opening another sound calls it up", async () => {
  await X("close-editor").click();
  const n = (await log()).length;
  await edit("program:INT-B", 6);
  await until(async () => has((await log()).slice(n), select({ key: "program:INT-B", index: 6 }, 0)[2]), "program change", 5000);
  await until(async () => dumps((await log()).slice(n)).length >= 1, "dump", 5000);
});
await check("Live is not offered for other editors", async () => {
  await X("close-editor").click();
  await edit("drumkit:INT", 0);
  assert.equal(await X("live-edit").count(), 0);
  await X("close-editor").click();
});
await ui.noErrors();
await finish();
