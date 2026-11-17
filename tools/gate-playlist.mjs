// Acceptance gate for the MIDI Library playlist. Owned by the architect: builders must not edit it.
//
// TEST-ONLY ENV (honoured only when KRONOS_E2E=1, read at call time):
//   KRONOS_E2E_MIDI_DIR  = existing: the MIDI library folder.
//   KRONOS_E2E_PLAYLIST  = NEW: full path of the playlist.json to use instead of ~/OpenKronos/playlist.json.
// File format of playlist.json: {"version":1,"items":["a.mid","b.mid"]}  (items are library file names, in queue order).
//
// IPC (window.kronos): playlistLoad(): Promise<string[]>   playlistSave(items: string[]): Promise<void>
//   Both validate: save rejects a non-array, a non-string, or any name that is not a plain *.mid file name (no path, no "..", no slashes). The renderer never sends a path.
//
// PURE EXPORTS of src/core/midi/playlist.ts  (Queue = { items: string[]; current: number | null; shuffle: boolean; repeat: "off" | "all" | "one"; played: number[] };
//   rnd is () => number in [0,1). All functions return a NEW Queue and never mutate their input. current === null means stopped / finished.)
//   emptyQueue(): Queue                          items [], current null, shuffle false, repeat "off", played []
//   addTrack(q, name): Queue                     appends (duplicates allowed)
//   removeTrack(q, i): Queue                     out of range = unchanged; removing the current song makes current null; earlier removals shift current down
//   moveTrack(q, from, to): Queue                the song ends at index `to`; current keeps pointing at the same song
//   begin(q, rnd): Queue                         Play All: current = 0, or a random index when shuffle; played = [current]; empty queue -> current null
//   advance(q, rnd, auto): Queue                 next song. auto=true is "the song ended", auto=false is the Next button.
//                                                repeat "one" + auto stays on the same song (Next button still moves on). Sequential: after the last song -> repeat "all" wraps to 0, otherwise current null.
//                                                shuffle: picks only songs not yet in `played` (via rnd), when all were played -> repeat "all" starts a new round (played reset to [new]), otherwise null.
//   retreat(q): Queue                            Previous: current - 1; at index 0 it wraps to the last song with repeat "all", otherwise stays 0. A stopped queue stays stopped.
//   parsePlaylist(json: unknown): string[]       accepts the parsed file or anything else; returns only valid names (plain *.mid, no path chars), [] for garbage
//   serializePlaylist(items: string[]): string   JSON text in the format above
//
// data-testid table (all inside the MIDI Library tab, i.e. after clicking midi-browse then midi-tab-library):
//   playlist-panel      the playlist section
//   playlist-add-{i}    "Add to playlist" button on library row i (same index as midi-lib-row-i)
//   playlist-row-{i}    queue row i, top to bottom
//   playlist-title-{i}  text of row i: exactly the file name, e.g. "c.mid"
//   playlist-skip-{i}   note on row i shown only when that file was missing and skipped (text contains "missing")
//   playlist-handle-{i} drag handle of row i (mouse drag onto another row reorders)
//   playlist-remove-{i} removes row i from the queue (not from the library)
//   playlist-play-all   Play All (disabled without a keyboard connection)
//   playlist-stop       Stop the queue and silence the keyboard
//   playlist-next / playlist-prev   Next and Previous buttons
//   playlist-shuffle    toggle; attribute aria-pressed="true"/"false"
//   playlist-repeat     cycles off -> all -> one -> off; attribute data-repeat = "off" | "all" | "one"
//   playlist-current    text contains the current song's file name while playing, and no queue file name once stopped
//   playlist-note       status line; after a skip its text contains the missing file name
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("PLAYLIST"), { check, finish } = g, C = await core(g);
let Q; try { Q = await load("src/core/midi/playlist.ts"); } catch (e) { g.fails.push(`cannot load playlist.ts: ${e.message}`); await finish(); }

const mk = (...names) => names.reduce((q, n) => Q.addTrack(q, n), Q.emptyQueue());
const cur = (q) => (q.current === null ? null : q.items[q.current]);
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

await check("a queue starts empty and tracks can be added and removed", () => {
  const e = Q.emptyQueue(); assert.deepEqual([e.items, e.current, e.shuffle, e.repeat, e.played], [[], null, false, "off", []]);
  const q = mk("a.mid", "b.mid", "a.mid"); assert.deepEqual(q.items, ["a.mid", "b.mid", "a.mid"]); assert.deepEqual(e.items, [], "the input was mutated");
  let r = Q.advance(Q.begin(q, seq(0)), seq(0), true); r = Q.advance(r, seq(0), true); assert.equal(r.current, 2);
  assert.equal(Q.removeTrack(r, 0).current, 1); assert.equal(cur(Q.removeTrack(r, 0)), "a.mid"); assert.equal(Q.removeTrack(r, 2).current, null); assert.deepEqual(Q.removeTrack(r, 9).items, q.items);
});
await check("moving a track keeps the current song current", () => {
  let q = Q.begin(mk("a.mid", "b.mid", "c.mid", "d.mid"), seq(0)); q = Q.advance(q, seq(0), true); assert.equal(cur(q), "b.mid");
  let m = Q.moveTrack(q, 3, 0); assert.deepEqual(m.items, ["d.mid", "a.mid", "b.mid", "c.mid"]); assert.equal(cur(m), "b.mid");
  m = Q.moveTrack(q, 1, 3); assert.deepEqual(m.items, ["a.mid", "c.mid", "d.mid", "b.mid"]); assert.equal(cur(m), "b.mid");
  m = Q.moveTrack(q, 0, 2); assert.deepEqual(m.items, ["b.mid", "c.mid", "a.mid", "d.mid"]); assert.equal(cur(m), "b.mid");
});
await check("Play All, auto-advance and repeat modes", () => {
  const q = mk("a.mid", "b.mid", "c.mid"), r0 = seq(0.5); let s = Q.begin(q, r0); assert.equal(cur(s), "a.mid");
  s = Q.advance(s, r0, true); s = Q.advance(s, r0, true); assert.equal(cur(s), "c.mid"); assert.equal(Q.advance(s, r0, true).current, null, "should stop after the last song");
  assert.equal(Q.begin(Q.emptyQueue(), r0).current, null);
  const all = { ...s, repeat: "all" }; assert.equal(cur(Q.advance(all, r0, true)), "a.mid");
  const one = { ...s, repeat: "one" }; assert.equal(cur(Q.advance(one, r0, true)), "c.mid", "repeat one repeats on auto"); assert.equal(Q.advance(one, r0, false).current, null, "Next still moves on");
  assert.equal(cur(Q.advance({ ...Q.begin(q, r0), repeat: "one" }, r0, false)), "b.mid");
});
await check("Previous goes back, and wraps only with repeat all", () => {
  const q = mk("a.mid", "b.mid", "c.mid"); let s = Q.advance(Q.begin(q, seq(0)), seq(0), true); assert.equal(cur(Q.retreat(s)), "a.mid");
  s = Q.begin(q, seq(0)); assert.equal(cur(Q.retreat(s)), "a.mid"); assert.equal(cur(Q.retreat({ ...s, repeat: "all" })), "c.mid");
  assert.equal(Q.retreat({ ...s, current: null }).current, null);
});
await check("shuffle plays every song once before the queue ends or a new round starts", () => {
  const names = ["a.mid", "b.mid", "c.mid", "d.mid", "e.mid"], rnd = seq(0.93, 0.1, 0.77, 0.4, 0.02, 0.6, 0.99);
  let s = Q.begin({ ...mk(...names), shuffle: true }, rnd); const seen = [cur(s)];
  for (let i = 0; i < 4; i++) { s = Q.advance(s, rnd, true); assert.notEqual(s.current, null); seen.push(cur(s)); }
  assert.deepEqual([...seen].sort(), names, `repeated or missed a song: ${seen}`); assert.equal(Q.advance(s, rnd, true).current, null);
  const n = Q.advance({ ...s, repeat: "all" }, rnd, true); assert.ok(n.current >= 0 && n.current < 5); assert.deepEqual(n.played, [n.current]);
});
await check("the saved file format is validated", () => {
  const txt = Q.serializePlaylist(["a.mid", "b b.mid"]); assert.deepEqual(JSON.parse(txt), { version: 1, items: ["a.mid", "b b.mid"] });
  assert.deepEqual(Q.parsePlaylist(JSON.parse(txt)), ["a.mid", "b b.mid"]);
  assert.deepEqual(Q.parsePlaylist({ version: 1, items: ["ok.mid", "../x.mid", "a/b.mid", "a\\b.mid", "C:\\w.mid", "x.txt", "", 5, null, "..", "dir/", "fine.MID"] }), ["ok.mid", "fine.MID"]);
  for (const bad of [null, undefined, 7, "x", [], {}, { items: "a.mid" }, { items: {} }]) assert.deepEqual(Q.parsePlaylist(bad), [], JSON.stringify(bad));
});
await testsAndTypes(g, ["core/midi/playlist.test.ts"]);
if (g.fails.length) await finish();

// Songs are one second long. a.mid ends while note 60 is still held, to prove nothing is left sounding between songs.
const vlq = (n) => { const out = [n & 127]; while ((n >>= 7)) out.unshift((n & 127) | 128); return out; };
const trk = (b) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, b.length, ...b];
const smf = (...ev) => Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, ...trk([...ev.flat(), 0, 0xff, 0x2f, 0])]);
const song = (n, hold) => smf([0, 0x90, n, 100], hold ? [...vlq(960), 0xe0, 0, 64] : [...vlq(960), 0x80, n, 0]);
const tmp = mkdtempSync(path.join(os.tmpdir(), "kronos-pl-")), LIB = path.join(tmp, "midi"), PL = path.join(tmp, "OpenKronos", "playlist.json");
mkdirSync(LIB); mkdirSync(path.dirname(PL));
for (const [n, note, hold] of [["a.mid", 60, true], ["b.mid", 62, false], ["c.mid", 64, false]]) writeFileSync(path.join(LIB, n), song(note, hold));
writeFileSync(PL, JSON.stringify({ version: 1, items: ["a.mid", "ghost.mid", "b.mid"] }));
const saved = () => JSON.parse(readFileSync(PL, "utf8")).items;

const ui = await launch(g, C, { KRONOS_E2E_MIDI_DIR: LIB, KRONOS_E2E_PLAYLIST: PL });
const { X, seen, text, until, win } = ui;
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const ons = (l) => l.filter((m) => (m[0] & 0xf0) === 0x90 && m[2] > 0).map((m) => m[1]);
const held = (l) => { const h = new Set(); for (const m of l) { const t = m[0] & 0xf0; if (t === 0x90 && m[2] > 0) h.add((m[0] & 0x0f) * 256 + m[1]); else if (t === 0x80 || t === 0x90) h.delete((m[0] & 0x0f) * 256 + m[1]); else if (t === 0xb0 && (m[1] === 123 || m[1] === 120)) for (const k of [...h]) if (k >> 8 === (m[0] & 0x0f)) h.delete(k); } return [...h]; };
const rows = () => win.locator('[data-testid^="playlist-row-"]').count();
const names = async () => { const o = []; for (let i = 0, n = await rows(); i < n; i++) o.push(await text(`playlist-title-${i}`)); return o; };
const cycle = async (want) => { for (let i = 0; i < 3 && (await X("playlist-repeat").getAttribute("data-repeat")) !== want; i++) await X("playlist-repeat").click(); assert.equal(await X("playlist-repeat").getAttribute("data-repeat"), want); };
const playing = async (note, ms = 8000) => until(async () => ons(await log()).includes(note), `note ${note}`, ms);

await ui.openFile();
await X("midi-browse").click(); await X("midi-tab-library").click(); await seen("playlist-panel");
await check("the saved playlist loads, and Play All needs a keyboard", async () => { await until(async () => (await rows()) === 3, "three rows"); assert.deepEqual(await names(), ["a.mid", "ghost.mid", "b.mid"]); assert.equal(await X("playlist-play-all").isDisabled(), true); });
await ui.connectSim();
await check("a library file can be added, and the queue is saved to disk", async () => {
  const n = await win.locator('[data-testid^="midi-lib-row-"]').count(); let at = -1; for (let i = 0; i < n; i++) if ((await text(`midi-lib-row-${i}`)).includes("c.mid")) at = i; assert.ok(at >= 0, "c.mid not in the library list");
  await X(`playlist-add-${at}`).click(); await until(async () => (await rows()) === 4, "four rows"); assert.equal((await names())[3], "c.mid"); await until(async () => saved().length === 4, "saved"); assert.deepEqual(saved(), ["a.mid", "ghost.mid", "b.mid", "c.mid"]);
});
await check("dragging a row reorders the queue and the saved file", async () => {
  const top = await X("playlist-row-0").boundingBox(), h = await X("playlist-handle-3").boundingBox(); assert.ok(top && h);
  await ui.drag("playlist-handle-3", 0, top.y + top.height / 4 - (h.y + h.height / 2)); await until(async () => (await names())[0] === "c.mid", "c.mid on top");
  assert.deepEqual(await names(), ["c.mid", "a.mid", "ghost.mid", "b.mid"]); await until(async () => saved()[0] === "c.mid", "saved"); assert.deepEqual(saved(), ["c.mid", "a.mid", "ghost.mid", "b.mid"]);
});
let n0 = 0;
await check("Play All auto-advances, skips the missing file with a note, and leaves no note stuck", async () => {
  n0 = (await log()).length; await X("playlist-play-all").click(); await playing(64); assert.match(await text("playlist-current"), /c\.mid/);
  await playing(62, 12000); const l = (await log()).slice(n0); assert.deepEqual(ons(l).slice(0, 3), [64, 60, 62], "wrong order");
  assert.match(await text("playlist-skip-2"), /missing/i); assert.match(await text("playlist-note"), /ghost\.mid/);
  const i60 = l.findIndex((m) => m[0] === 0x90 && m[1] === 60 && m[2] > 0), i62 = l.findIndex((m) => m[0] === 0x90 && m[1] === 62 && m[2] > 0);
  assert.deepEqual(held(l.slice(0, i62)), [], "a note was still held when the next song started"); assert.ok(i62 > i60);
  await until(async () => !/b\.mid/.test(await text("playlist-current")), "queue finished", 8000); assert.deepEqual(held(await log()), [], "notes left on after the queue ended");
  const c = (await log()).length; await new Promise((r) => setTimeout(r, 1500)); assert.equal(ons((await log()).slice(c)).length, 0, "it kept playing after the end");
});
await check("Next and Previous move through the queue, and Stop silences it", async () => {
  n0 = (await log()).length; await X("playlist-play-all").click(); await playing(64); const after = async () => ons((await log()).slice(n0));
  await X("playlist-next").click(); await until(async () => /a\.mid/.test(await text("playlist-current")), "a.mid current"); await until(async () => (await after()).includes(60), "a.mid sounds");
  await X("playlist-next").click(); await until(async () => /b\.mid/.test(await text("playlist-current")), "b.mid current (ghost skipped)"); await until(async () => (await after()).includes(62), "b.mid sounds");
  await X("playlist-prev").click(); await until(async () => /a\.mid/.test(await text("playlist-current")), "back on a.mid");
  await X("playlist-stop").click(); await until(async () => !/[abc]\.mid/.test(await text("playlist-current")), "stopped"); await until(async () => held((await log()).slice(n0)).length === 0, "silenced");
  const c = (await log()).length; await new Promise((r) => setTimeout(r, 1500)); assert.equal(ons((await log()).slice(c)).length, 0, "notes after Stop");
});
await check("Repeat All wraps from the last song to the first", async () => {
  await cycle("all"); n0 = (await log()).length; await X("playlist-play-all").click(); await playing(64);
  await X("playlist-next").click(); await X("playlist-next").click(); await until(async () => /b\.mid/.test(await text("playlist-current")), "last song");
  await until(async () => ons((await log()).slice(n0)).filter((x) => x === 64).length >= 2, "wrapped to c.mid", 8000); assert.match(await text("playlist-current"), /c\.mid|a\.mid/);
  await X("playlist-stop").click(); await cycle("off");
});
await check("Shuffle plays each song once and then ends", async () => {
  await X("playlist-shuffle").click(); assert.equal(await X("playlist-shuffle").getAttribute("aria-pressed"), "true"); n0 = (await log()).length;
  await X("playlist-play-all").click(); await until(async () => !/[abc]\.mid/.test(await text("playlist-current")) && ons((await log()).slice(n0)).length >= 3, "queue finished", 12000);
  assert.deepEqual([...ons((await log()).slice(n0))].sort(), [60, 62, 64]); await X("playlist-shuffle").click(); assert.equal(await X("playlist-shuffle").getAttribute("aria-pressed"), "false");
});
await check("a row can be removed from the queue and the saved file, not from the library", async () => {
  await X("playlist-remove-2").click(); await until(async () => (await rows()) === 3, "three rows"); assert.deepEqual(await names(), ["c.mid", "a.mid", "b.mid"]); await until(async () => saved().length === 3, "saved"); assert.deepEqual(saved(), ["c.mid", "a.mid", "b.mid"]);
  assert.ok(existsSync(path.join(LIB, "a.mid")));
});
await check("the app refuses a playlist that names paths or non-MIDI files", async () => {
  for (const bad of [["../../work.PCG"], ["..\\x.mid"], ["C:\\Windows\\win.ini"], ["sub/a.mid"], [5], "a.mid", { items: [] }]) { const r = await win.evaluate((b) => window.kronos.playlistSave(b).then(() => "saved", () => "refused"), bad); assert.equal(r, "refused", JSON.stringify(bad)); }
  assert.deepEqual(saved(), ["c.mid", "a.mid", "b.mid"], "a refused save changed the file"); assert.deepEqual(await win.evaluate(() => window.kronos.playlistLoad()), ["c.mid", "a.mid", "b.mid"]);
});
await ui.noErrors();
await finish();
