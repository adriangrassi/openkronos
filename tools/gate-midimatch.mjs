// Acceptance gate for matching MIDI files to sounds by name. Owned by the architect: builders must not edit it.
//
// PURE EXPORTS the builder must provide
//   src/core/midi/match.ts
//     type SoundRef = { key: string; index: number; name: string; kind: "program" | "combi" }   (key is a BankInfo key such as "program:U-AA")
//     type Match = SoundRef & { score: number }
//     type SoundIndex = opaque; names are normalised once here, never again per query
//     buildIndex(sounds: SoundRef[]): SoundIndex
//     candidateTitles(title: string): string[]   lower-case, extension/brackets/separators removed, one entry per " - " segment, or the part before a bracket
//     matchSong(title: string, idx: SoundIndex): Match[]   ranked, best first, scores strictly descending between match classes;
//                                                          exact candidate = 1, then all-words-contained, then partial; below the threshold: [] (a wrong match is worse than none)
//     gmInstrument(program: number): { name: string; family: string }   General MIDI 1 (0 "Acoustic Grand Piano" ... 127), standard names and the 16 families
//     suggestSound(ch: { trackName: string | null; program: number | null }, idx: SoundIndex): Match | null   track name first, else GM name, else GM family
//   src/core/midi/smf.ts (parseSmf keeps its API)
//     parseSmfChannels(bytes: Uint8Array): { channel: number; trackName: string | null; program: number | null; notes: number }[]
//         channel is 0..15, channels with a note-on or a named track that sends on them, ascending; notes is the note-on count (0 for an empty track); trackName is the name (meta FF 03) of the first track that plays it;
//         program is that channel's first Program Change (0..127), else null
//
// DATA-TESTID names (all inside the MIDI Player section unless noted)
//   midimatch-use          checkbox "Use matching sound"; default checked; remembered in localStorage
//   midimatch-status       status line shown after Play used the song match; contains the sound's name; absent or empty when the match was not used
//   midimatch-song         the loaded file's song match, text contains "<bank label> <slot> <name>" (for example "U-AA 078 Jump"); absent when the file has no match
//   midimatch-ch-<n>       one row per channel of the loaded file, n = channel number 1..16
//   midimatch-ch-track-<n> that row's track name text (empty if none)
//   midimatch-ch-sound-<n> that row's suggested sound, "<bank label> <slot> <name>" (empty if none)
//   midimatch-ch-use-<n>   Use button: selects the sound in the list and calls it up on the keyboard
//   midimatch-hit-<i>      small button "Match: U-AA 078 Jump" in MIDI browser search row i (same i as midi-hit-row-<i>); absent when no match
//   midimatch-lib-<i>      the same button in Library row i (same i as midi-lib-row-<i>)
//   Clicking a match button selects that slot: the bank button bank-<key> gets aria-current and row-<index> gets aria-selected="true".
//
// Test-only env vars: none new. The gate uses the existing KRONOS_E2E_MIDI (file Play/open reads), KRONOS_E2E_MIDI_DIR (library folder) and KRONOS_E2E_MIDI_WEB (search fixtures), set through the main process as gate-midiweb does.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("MIDIMATCH"), { check, finish } = g, C = await core(g);
let M, S, PL; try { [M, S, PL] = await Promise.all([load("src/core/midi/match.ts"), load("src/core/midi/smf.ts"), load("src/core/midi/player.ts")]); } catch (e) { g.fails.push(`cannot load modules: ${e.message}`); await finish(); }

const f0 = C.parsed(), sounds = [];
for (const b of C.L.listBanks(f0)) if (b.kind === "program" || b.kind === "combi") for (let i = 0; i < b.count; i++) sounds.push({ key: b.key, index: i, name: C.L.getName(f0, b.key, i), kind: b.kind });
const names = (r) => r.map((m) => m.name);
const mk = (...n) => M.buildIndex(n.map((name, index) => ({ key: "program:U-AA", index, name, kind: "program" })));

const vlq = (n) => { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; };
const trk = (b) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, b.length, ...b];
const meta = (name) => [0, 0xff, 3, name.length, ...Buffer.from(name)];
const END = [0, 0xff, 0x2f, 0];
const track = (name, ch, prog) => [...(name ? meta(name) : []), ...(prog == null ? [] : [0, 0xc0 | ch, prog]), 0, 0x90 | ch, 60, 100, 0x60, 0x80 | ch, 60, 0, ...END];
const smf = (...tracks) => Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, 1, 0xe0, ...tracks.flatMap(trk)]);
const SONG = smf(track("Zebra Bass", 0, 33), track("Quartz Strings", 1, 48), track(null, 2, 56), track("No Program", 3, null));

await check("titles are cleaned into candidates", () => {
  const c = (t) => M.candidateTitles(t).sort();
  assert.deepEqual(c("Albin Myers - Jump.mid"), ["albin myers", "jump"]); assert.deepEqual(c("Jump (Van Halen)"), ["jump"]); assert.deepEqual(c("Van Halen - Jump"), ["jump", "van halen"]); assert.deepEqual(c("Final Countdown ( Cover )"), ["final countdown"]);
  assert.ok(M.candidateTitles("Journey - Don't Stop Believin").length === 2);
});
await check("exact outranks all-words outranks partial", () => {
  let r = M.matchSong("Jump (Van Halen)", mk("Jump Start Pad", "Jump", "Jumbo Pad", "Strings"));
  assert.deepEqual(names(r).slice(0, 2), ["Jump", "Jump Start Pad"]); assert.equal(r[0].score, 1); assert.ok(r[0].score > r[1].score);
  r = M.matchSong("Final Countdown ( Cover )", mk("Final Boss", "Final Countdown Brass", "Countdown Clock", "Final Countdown"));
  assert.deepEqual(names(r).slice(0, 2), ["Final Countdown", "Final Countdown Brass"]);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].score <= r[i - 1].score);
  const b = names(r).indexOf("Final Boss"); if (b >= 0) assert.ok(b > 1, "a partial match must come after the all-words match");
  assert.deepEqual(r[0], { key: "program:U-AA", index: 3, name: "Final Countdown", kind: "program", score: 1 });
});
await check("a segment, an apostrophe and case still match", () => {
  const r = M.matchSong("Journey - Don't Stop Believin.MID", mk("Wide Pad", "Don't Stop Believin"));
  assert.equal(r[0]?.name, "Don't Stop Believin"); assert.equal(M.matchSong("VAN HALEN - JUMP", mk("jump"))[0]?.name, "jump");
});
await check("stop words and tiny tokens never match", () => {
  assert.deepEqual(M.matchSong("The Midi Song Cover", mk("Song of the Wind", "Midi Cover Pad")), []);
  assert.deepEqual(M.matchSong("Piano Cover", mk("Grand Piano", "Piano Pad", "Live Organ")), []);
  assert.deepEqual(M.matchSong("Song of the Sea", mk("Song of the Wind", "The Sea Of Tears Song")).filter((m) => !/sea/i.test(m.name)), []);
  assert.deepEqual(M.matchSong("U2", mk("U2 Lead", "U2")), []); assert.deepEqual(M.matchSong("Piano Man", mk("Grand Piano")), []);
  assert.equal(M.matchSong("Piano Man", mk("Piano Man Pad"))[0]?.name, "Piano Man Pad");
});
await check("real factory names: exact hit by key and index, nothing for nonsense", () => {
  const all = M.buildIndex(sounds), want = sounds.find((s) => s.name === "Concert in the Castle");
  assert.ok(want, "factory has Concert in the Castle"); assert.equal(want.kind, "combi");
  const r = M.matchSong("Concert In The Castle (Live).mid", all); assert.deepEqual({ ...r[0], score: 0 }, { ...want, score: 0 }); assert.equal(r[0].score, 1);
  assert.deepEqual(M.matchSong("Zxqv Wombat Anthem.mid", all), []);
  for (const m of M.matchSong("Albin Myers - Jump.mid", all)) assert.match(m.name, /jump|albin|myers/i);
});
await check("4,000 names are indexed once and queries stay fast", () => {
  const big = [...sounds, ...Array.from({ length: 4000 - sounds.length }, (_, i) => ({ key: "program:U-A", index: i % 128, name: `Synth Sound ${i} Pad`, kind: "program" }))];
  const idx = M.buildIndex(big); const t0 = performance.now();
  for (let i = 0; i < 100; i++) M.matchSong(i % 2 ? "Journey - Don't Stop Believin" : "Final Countdown ( Cover )", idx);
  const ms = performance.now() - t0; assert.ok(ms < 600, `100 queries took ${Math.round(ms)} ms`); return `${Math.round(ms)} ms`;
});
await check("channels: track names and GM programs are read from a file", () => {
  assert.deepEqual(S.parseSmfChannels(SONG), [{ channel: 0, trackName: "Zebra Bass", program: 33, notes: 1 }, { channel: 1, trackName: "Quartz Strings", program: 48, notes: 1 }, { channel: 2, trackName: null, program: 56, notes: 1 }, { channel: 3, trackName: "No Program", program: null, notes: 1 }]);
  assert.equal(S.parseSmf(SONG).events.length, 11);
  assert.deepEqual([0, 33, 56, 80].map((p) => M.gmInstrument(p).name), ["Acoustic Grand Piano", "Electric Bass (finger)", "Trumpet", "Lead 1 (square)"]);
  assert.deepEqual([0, 33, 56, 40].map((p) => M.gmInstrument(p).family), ["Piano", "Bass", "Brass", "Strings"]);
});
await check("a sound is suggested by track name, else GM name, else GM family", () => {
  const sg = (trackName, program, ...n) => M.suggestSound({ trackName, program }, mk(...n))?.name ?? null;
  assert.equal(sg("Lead Synth", null, "Bass Machine", "Synth Lead Bright", "Brass"), "Synth Lead Bright");
  assert.equal(sg("Bass", 56, "Solo Trumpet", "Fat Bass"), "Fat Bass");
  assert.equal(sg(null, 56, "Fat Bass", "Solo Trumpet"), "Solo Trumpet");
  assert.equal(sg(null, 57, "Fat Bass", "Brass Section"), "Brass Section");
  assert.equal(sg("Kazoo Zzz", null, "Fat Bass", "Solo Trumpet"), null); assert.equal(sg(null, null, "Fat Bass"), null);
});
await testsAndTypes(g, ["core/midi/match.test.ts"]);
if (g.fails.length) await finish();

// UI: slot 78 of U-AA is renamed Jump, so the owner's example is exact.
const PCG = C.P.parsePcg(C.raw);
C.L.setName(PCG, "program:U-AA", 78, "Jump"); C.L.setName(PCG, "program:U-CC", 40, "Zebra Bass"); C.L.setName(PCG, "combi:INT-F", 9, "Quartz Strings");
const EDITED = C.P.serializePcg(PCG);
const BIT = JSON.stringify({ result: { results: [{ id: 1, name: "Jump (Van Halen).mid", url: "/a", downloadUrl: "/u/1.mid" }, { id: 2, name: "Wombat Zzxq.mid", url: "/b", downloadUrl: "/u/2.mid" }] } });
const ui = await launch(g, C, { KRONOS_E2E_MIDI_WEB: JSON.stringify({ bitmidi: { search: BIT }, midiworld: { search: "" }, freemidi: { search: "" }, files: {} }) });
const { X, seen, text, until, win, tmp } = ui;
const LIB = path.join(tmp, "midi"), SONGS = path.join(tmp, "songs"); mkdirSync(LIB); mkdirSync(SONGS);
const JUMP = path.join(SONGS, "Van Halen - Jump.mid"), ODD = path.join(SONGS, "Wombat Zzxq.mid");
writeFileSync(JUMP, SONG); writeFileSync(ODD, SONG); writeFileSync(path.join(LIB, "Van Halen - Jump.mid"), SONG); writeFileSync(path.join(LIB, "Wombat Zzxq.mid"), SONG);
writeFileSync(ui.OPEN, EDITED);
const setMidi = (p) => g.state.app.evaluate((_e, a) => { process.env.KRONOS_E2E_MIDI_DIR = a[0]; process.env.KRONOS_E2E_MIDI = a[1]; }, [LIB, p]);
await setMidi(JUMP);
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const pcs = (l) => l.flatMap((m, pos) => (m[0] & 0xf0) === 0xc0 ? [{ pos, ch: m[0] & 15, prog: m[1] }] : []);
const firstNote = (l) => l.findIndex((m) => (m[0] & 0xf0) === 0x90 && m[2] > 0);
const picked = async (key, i) => (await X(`bank-${key}`).getAttribute("aria-current")) === "true" && (await X(`row-${i}`).getAttribute("aria-selected")) === "true";
const play = async () => { const n = (await log()).length; await X("midi-play").click(); await until(async () => firstNote((await log()).slice(n)) >= 0, "notes played", 10000); return (await log()).slice(n); };
const usedBefore = (slice) => { const nt = firstNote(slice); return pcs(slice).filter((p) => p.pos < nt).at(-1)?.prog; };
const sel = async (key, i) => { await X(`bank-${key}`).click(); await X(`row-${i}`).click(); };

await ui.openFile(); await ui.connectSim();
await check("the player shows the song match and a list of channels", async () => {
  await X("midi-open").click(); await until(async () => /Jump/.test(await text("midi-file-name")), "file loaded");
  await seen("midimatch-song"); assert.match(await text("midimatch-song"), /U-AA 078 Jump/);
  assert.equal(await win.locator('[data-testid^="midimatch-ch-track-"]').count(), 4);
  assert.equal(await text("midimatch-ch-track-1"), "Zebra Bass"); assert.equal(await text("midimatch-ch-sound-1"), "U-CC 040 Zebra Bass");
  assert.equal(await text("midimatch-ch-track-2"), "Quartz Strings"); assert.equal(await text("midimatch-ch-sound-2"), "INT-F 009 Quartz Strings");
  assert.equal(await text("midimatch-ch-track-3"), ""); assert.match(await text("midimatch-ch-sound-3"), /trumpet|brass|horn/i);
});
await check("Use selects the channel's sound and calls it up on the keyboard", async () => {
  await sel("program:INT-A", 3); const n = (await log()).length;
  await X("midimatch-ch-use-1").click(); await until(async () => pcs((await log()).slice(n)).length > 0, "program change sent");
  const l = (await log()).slice(n), p = pcs(l)[0], want = PL.selectBytes("program:U-CC", 40, p.ch);
  assert.equal(p.prog, 40); assert.deepEqual([l[p.pos - 2], l[p.pos - 1], l[p.pos]], want.map((b) => [...b]));
  await until(() => picked("program:U-CC", 40), "slot selected in the list");
});
await check("Play uses the song match when it is on (default) and says so", async () => {
  assert.equal(await X("midimatch-use").isChecked(), true); await sel("program:INT-B", 5);
  const l = await play(); assert.equal(usedBefore(l), 78); assert.match(await text("midimatch-status"), /Jump/); await until(() => picked("program:U-AA", 78), "match selected in the list");
});
await check("with the checkbox off Play uses the current selection", async () => {
  await X("midimatch-use").uncheck(); await sel("program:INT-B", 5); await win.waitForTimeout(100);
  const l = await play(); assert.equal(usedBefore(l), 5); assert.ok(!/Jump/.test(await X("midimatch-status").textContent().catch(() => "")), "status must not claim a match");
  await X("midimatch-use").check();
});
await check("channel mode file and a file with no match behave as before", async () => {
  await X("midi-channel").selectOption("file"); await X("midi-open").click(); await new Promise((r) => setTimeout(r, 500)); const n0 = (await log()).length; await sel("program:INT-B", 5); await X("midi-play").click(); await until(async () => firstNote((await log()).slice(n0)) >= 0, "played", 10000);
  const l = (await log()).slice(n0); assert.ok(!pcs(l).some((p) => p.prog === 78), "file mode must not call up the match"); assert.ok(!l.some((m) => m[0] === 0xf0 && m[4] === 0x4e), "file mode sends no Mode Change"); await X("midi-stop").click();
  await X("midi-channel").selectOption("keyboard"); await setMidi(ODD); await X("midi-open").click(); await until(async () => /Wombat/.test(await text("midi-file-name")), "odd file loaded");
  assert.equal(await win.locator('[data-testid="midimatch-song"]').count(), 0); await sel("program:INT-B", 5); assert.equal(usedBefore(await play()), 5);
});
await check("MIDI browser search rows show a Match button that selects the slot", async () => {
  await X("midi-browse").click(); await seen("midi-q"); await X("midi-q").fill("jump"); await X("midi-q-go").click(); await until(async () => (await win.locator('[data-testid^="midi-hit-row-"]').count()) === 2, "two results");
  const rows = []; for (let i = 0; i < 2; i++) rows.push(await text(`midi-hit-row-${i}`)); const j = rows.findIndex((r) => /Jump/.test(r)), w = 1 - j;
  assert.equal((await text(`midimatch-hit-${j}`)).replace(/\s+/g, " "), "Match: U-AA 078 Jump"); assert.equal(await win.locator(`[data-testid="midimatch-hit-${w}"]`).count(), 0);
  await sel("program:INT-C", 4); await X(`midimatch-hit-${j}`).click(); await until(() => picked("program:U-AA", 78), "slot selected");
});
await check("Library rows show the same Match button", async () => {
  await X("midi-tab-library").click(); await until(async () => (await win.locator('[data-testid^="midi-lib-row-"]').count()) === 2, "two library files");
  const rows = []; for (let i = 0; i < 2; i++) rows.push(await text(`midi-lib-row-${i}`)); const j = rows.findIndex((r) => /Van Halen/.test(r)), w = 1 - j;
  assert.equal((await text(`midimatch-lib-${j}`)).replace(/\s+/g, " "), "Match: U-AA 078 Jump"); assert.equal(await win.locator(`[data-testid="midimatch-lib-${w}"]`).count(), 0);
  await sel("program:INT-C", 4); await X(`midimatch-lib-${j}`).click(); await until(() => picked("program:U-AA", 78), "slot selected");
});
await check("the Use matching sound choice is remembered", async () => {
  await X("midimatch-use").uncheck(); await win.reload(); await ui.openFile(); await ui.connectSim(); await seen("midimatch-use");
  assert.equal(await X("midimatch-use").isChecked(), false);
});
await ui.noErrors();
await finish();
