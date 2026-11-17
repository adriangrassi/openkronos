// Acceptance gate for MIDI file analysis (info panel and chord strip). Owned by the architect: builders must not edit it.
//
// PURE EXPORTS of src/core/midi/analysis.ts
//   analyzeMidi(bytes: Uint8Array): MidiAnalysis   throws (SmfError or Error) on bytes that are not a Standard MIDI File; never throws on a valid file with no notes
//   barAtMs(a: MidiAnalysis, ms: number): number   index into a.bars of the bar containing ms; ms < 0 gives 0; ms past the end gives the last index; -1 when a.bars is empty
//   MidiAnalysis = {
//     durationMs: number,                                                    length of the song in ms, tempo map applied (end = last event incl. end-of-track)
//     ppq: number,
//     tempoMap: { tick: number, bpm: number, ms: number }[],                 one entry per tempo change; first is tick 0 (120 bpm when the file has none); bpm may be fractional
//     timeSignature: { num: number, den: number },                           the first one (4/4 when none)
//     bars: { index: number, startTick: number, startMs: number, endMs: number, chord: string | null }[],   bars cover the song; the last ends at durationMs
//     noteCounts: { channel: number, notes: number }[],                      channel is 0-15, ascending, only channels with notes; note-on with velocity 0 is NOT a note
//     peakPolyphony: number,                                                 most notes sounding at once over all channels; a note-off and note-on on the same tick do not overlap
//     key: { tonic: string, mode: "major" | "minor", name: string } | null,  Krumhansl-Schmuckler on note durations (drums, channel 9, ignored); tonic uses sharps (C C# D D# E F F# G G# A A# B); name = "C major" / "A minor"; null with no pitched notes
//   }
//   chord names: root + suffix, suffix one of "" (major), "m", "dim", "aug", "7" (dominant), "maj7", "m7"; e.g. "C", "Am", "G7", "Am7". null when a bar has no notes.
//   Triads and sevenths are matched on pitch classes sounding in the bar, weighted by duration; the lowest-note root is preferred on a tie.
//
// DATA-TESTIDs (all inside the MIDI panel, shown only while a MIDI file is loaded)
//   midiinfo-panel        container of the info panel
//   midiinfo-duration     text "m:ss" (rounded to the second), e.g. "0:08"
//   midiinfo-tempo        text containing the first tempo as a whole number of bpm, e.g. "120 bpm"; when the tempo changes it also contains the changed value ("60")
//   midiinfo-timesig      text exactly e.g. "4/4"
//   midiinfo-bars         text exactly the number of bars, e.g. "4"
//   midiinfo-key          text exactly e.g. "C major"
//   midiinfo-polyphony    text exactly the peak polyphony, e.g. "5"
//   midiinfo-channel-<n>  one row per channel with notes, n = 0-15 channel; text contains the note count
//   midiinfo-chords       the bar-by-bar chord strip
//   midiinfo-chord-<i>    one cell per bar i (0-based), text exactly the chord name (or "-" when null); attribute data-current="true" on the bar being played, "false" on the others; during playback exactly one is current
// Test-only env vars used here: KRONOS_E2E=1, KRONOS_E2E_OPEN (set by the kit), KRONOS_E2E_MIDI (path the "MIDI File..." button reads in e2e; changed between loads via the main process).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("MIDIINFO"), { check, finish } = g, C = await core(g);
let A; try { A = await load("src/core/midi/analysis.ts"); } catch (e) { g.fails.push(`cannot load analysis.ts: ${e.message}`); await finish(); }

// ---- synthetic songs ----
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const be = (n, k) => Array.from({ length: k }, (_, i) => (n >> (8 * (k - 1 - i))) & 0xff);
// notes: [tick, len, note, channel, zeroOff]; metas: [tick, bytes]. Offs sort before ons on the same tick.
function smf(ppq, notes, metas = [], endTick) {
  const ev = metas.map(([t, b]) => ({ t, o: 1, b }));
  for (const [t, len, n, ch, zero] of notes) { ev.push({ t, o: 2, b: [0x90 | ch, n, 100] }); ev.push({ t: t + len, o: 0, b: zero ? [0x90 | ch, n, 0] : [0x80 | ch, n, 0] }); }
  const last = endTick ?? Math.max(0, ...ev.map((e) => e.t)); ev.push({ t: last, o: 3, b: [0xff, 0x2f, 0] });
  ev.sort((a, b) => a.t - b.t || a.o - b.o);
  let prev = 0; const body = ev.flatMap((e) => { const d = vlq(e.t - prev); prev = e.t; return [...d, ...e.b]; });
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ...be(ppq, 2), 0x4d, 0x54, 0x72, 0x6b, ...be(body.length, 4), ...body]);
}
const tempo = (bpm) => [0xff, 0x51, 3, ...be(Math.round(60000000 / bpm), 3)];
const tsig = (num, den) => [0xff, 0x58, 4, num, Math.log2(den), 24, 8];
// One chord per bar on channel 0; optional bass roots on channel 1 (notes off written as note-on velocity 0).
function song({ ppq = 480, barTicks, chords, bass, metas }) {
  const notes = [];
  chords.forEach((c, i) => { for (const n of c) notes.push([i * barTicks, barTicks, n, 0, false]); if (bass) notes.push([i * barTicks, barTicks, bass[i], 1, true]); });
  return smf(ppq, notes, metas, chords.length * barTicks);
}
const songC = song({ barTicks: 1920, chords: [[60, 64, 67], [65, 69, 72], [55, 59, 62, 65], [60, 64, 67]], bass: [36, 41, 43, 36], metas: [[0, tempo(120)], [0, tsig(4, 4)]] }); // C F G7 C
const songAm = song({ barTicks: 1440, chords: [[57, 60, 64, 67], [50, 53, 57], [52, 56, 59], [57, 60, 64]], metas: [[0, tempo(90)], [0, tsig(3, 4)]] }); // Am7 Dm E Am, 3/4, 90 bpm
const songSlow = song({ barTicks: 1920, chords: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]], metas: [[0, tempo(120)], [3840, tempo(60)], [0, tsig(4, 4)]] });
const songSev = song({ barTicks: 1920, chords: [[62, 65, 69, 72], [59, 62, 65], [60, 64, 68], [60, 64, 67, 71]] }); // Dm7 Bdim Caug Cmaj7
const songNone = smf(480, [], [[0, tempo(120)]], 960);
const chordsOf = async (n, t) => { const got = []; for (let i = 0; i < n; i++) got.push(await t(`midiinfo-chord-${i}`)); return got; };

// ---- pure logic ----
await check("duration, tempo, time signature and bars of a plain 4/4 song", () => {
  const a = A.analyzeMidi(songC);
  assert.equal(a.durationMs, 8000); assert.equal(a.ppq, 480);
  assert.deepEqual(a.tempoMap.map((t) => [t.tick, Math.round(t.bpm), t.ms]), [[0, 120, 0]]);
  assert.deepEqual(a.timeSignature, { num: 4, den: 4 });
  assert.deepEqual(a.bars.map((b) => [b.index, b.startTick, b.startMs, b.endMs]), [[0, 0, 0, 2000], [1, 1920, 2000, 4000], [2, 3840, 4000, 6000], [3, 5760, 6000, 8000]]);
});
await check("a tempo change moves the bar times and the duration", () => {
  const a = A.analyzeMidi(songSlow);
  assert.equal(a.durationMs, 12000);
  assert.deepEqual(a.tempoMap.map((t) => [t.tick, Math.round(t.bpm), t.ms]), [[0, 120, 0], [3840, 60, 4000]]);
  assert.deepEqual(a.bars.map((b) => [b.startMs, b.endMs]), [[0, 2000], [2000, 4000], [4000, 8000], [8000, 12000]]);
});
await check("3/4 bars are three beats long; no tempo or meter in the file means 120 bpm and 4/4", () => {
  const a = A.analyzeMidi(songAm);
  assert.deepEqual(a.timeSignature, { num: 3, den: 4 }); assert.equal(a.bars.length, 4); assert.equal(a.bars[1].startTick, 1440); assert.equal(Math.round(a.bars[1].startMs), 2000); assert.equal(Math.round(a.durationMs), 8000);
  const d = A.analyzeMidi(song({ barTicks: 1920, chords: [[60, 64, 67]] }));
  assert.deepEqual(d.timeSignature, { num: 4, den: 4 }); assert.equal(Math.round(d.tempoMap[0].bpm), 120); assert.equal(d.durationMs, 2000);
});
await check("notes per channel (velocity-0 note-offs are not notes) and peak polyphony", () => {
  const a = A.analyzeMidi(songC);
  assert.deepEqual(a.noteCounts, [{ channel: 0, notes: 13 }, { channel: 1, notes: 4 }]);
  assert.equal(a.peakPolyphony, 5); // G7 (4 notes) over its bass note; the hand-over at each bar line adds nothing
  assert.equal(A.analyzeMidi(songAm).peakPolyphony, 4);
});
await check("the key of a song in C major and one in A minor", () => {
  const k = A.analyzeMidi(songC).key; assert.deepEqual([k.tonic, k.mode, k.name], ["C", "major", "C major"]);
  const m = A.analyzeMidi(songAm).key; assert.deepEqual([m.tonic, m.mode, m.name], ["A", "minor", "A minor"]);
});
await check("one chord per bar: triads, dominant seventh, minor seventh", () => {
  assert.deepEqual(A.analyzeMidi(songC).bars.map((b) => b.chord), ["C", "F", "G7", "C"]);
  assert.deepEqual(A.analyzeMidi(songAm).bars.map((b) => b.chord), ["Am7", "Dm", "E", "Am"]);
});
await check("diminished, augmented, major seventh and minor seventh are told apart", () => {
  assert.deepEqual(A.analyzeMidi(songSev).bars.map((b) => b.chord), ["Dm7", "Bdim", "Caug", "Cmaj7"]);
});
await check("barAtMs finds the bar being played and clamps at both ends", () => {
  const a = A.analyzeMidi(songSlow);
  assert.deepEqual([-50, 0, 1999, 2000, 3999, 4000, 7999, 8000, 11999, 99999].map((ms) => A.barAtMs(a, ms)), [0, 0, 0, 1, 1, 2, 2, 3, 3, 3]);
});
await check("a song with no notes has no key and no chords; bytes that are not MIDI are refused", () => {
  const a = A.analyzeMidi(songNone); assert.equal(a.key, null); assert.equal(a.peakPolyphony, 0); assert.deepEqual(a.noteCounts, []); assert.ok(a.bars.every((b) => b.chord === null));
  for (const bad of [new Uint8Array(0), new TextEncoder().encode("<html>not midi</html>"), songC.slice(0, 20)]) assert.throws(() => A.analyzeMidi(bad));
});
await testsAndTypes(g, ["core/midi/analysis.test.ts"]);
if (g.fails.length) await finish();

// ---- the real app ----
const D = path.join(os.tmpdir(), `kronos-midiinfo-${process.pid}`); mkdirSync(D, { recursive: true });
const f = (n, b) => { const p = path.join(D, n); writeFileSync(p, b); return p; };
const P_C = f("c-major.mid", songC), P_AM = f("a-minor.mid", songAm), P_SLOW = f("slow.mid", songSlow), P_BAD = f("bad.mid", new TextEncoder().encode("not a midi file at all"));
const ui = await launch(g, C, { KRONOS_E2E_MIDI: P_C }), { X, seen, text, until, win } = ui;
const loadFile = async (p) => { await g.state.app.evaluate((_e, a) => { process.env.KRONOS_E2E_MIDI = a; }, p); await X("midi-open").click(); };
const current = () => win.evaluate(() => [...document.querySelectorAll('[data-testid^="midiinfo-chord-"]')].filter((e) => e.getAttribute("data-current") === "true").map((e) => Number(e.getAttribute("data-testid").slice("midiinfo-chord-".length))));

await ui.openFile(); await ui.connectSim();
await check("loading a file shows its numbers in the info panel", async () => {
  await loadFile(P_C); await seen("midiinfo-panel");
  await until(async () => (await text("midiinfo-key")) === "C major", "key shown");
  assert.equal(await text("midiinfo-duration"), "0:08"); assert.match(await text("midiinfo-tempo"), /120/); assert.equal(await text("midiinfo-timesig"), "4/4"); assert.equal(await text("midiinfo-bars"), "4"); assert.equal(await text("midiinfo-polyphony"), "5");
  assert.match(await text("midiinfo-channel-0"), /13/); assert.match(await text("midiinfo-channel-1"), /\b4\b/);
});
await check("the chord strip lists one chord per bar", async () => {
  await seen("midiinfo-chords"); assert.deepEqual(await chordsOf(4, text), ["C", "F", "G7", "C"]);
  assert.equal(await win.locator('[data-testid^="midiinfo-chord-"]').count(), 4);
});
await check("the current bar is highlighted while the song plays, one bar at a time", async () => {
  await X("midi-play").click();
  await until(async () => (await current()).join() === "0", "bar 1 current", 10000);
  await until(async () => (await current()).join() === "1", "bar 2 current", 10000);
  await until(async () => (await current()).join() === "2", "bar 3 current", 10000);
  assert.equal(await text("midiinfo-chord-2"), "G7");
  await X("midi-stop").click();
});
await check("a new file replaces the numbers (3/4, A minor, 90 bpm)", async () => {
  await loadFile(P_AM); await until(async () => (await text("midiinfo-key")) === "A minor", "A minor shown");
  assert.equal(await text("midiinfo-timesig"), "3/4"); assert.match(await text("midiinfo-tempo"), /90/); assert.equal(await text("midiinfo-polyphony"), "4");
  assert.deepEqual(await chordsOf(4, text), ["Am7", "Dm", "E", "Am"]);
});
await check("a tempo change shows both tempos and the longer duration", async () => {
  await loadFile(P_SLOW); await until(async () => (await text("midiinfo-duration")) === "0:12", "0:12 shown");
  const t = await text("midiinfo-tempo"); assert.match(t, /120/); assert.match(t, /60/);
});
await check("a file that is not MIDI is refused and the old information stays", async () => {
  await loadFile(P_BAD); await seen("error-message");
  assert.equal(await text("midiinfo-duration"), "0:12"); assert.equal(await text("midiinfo-key"), "C major");
});
await ui.noErrors();
await finish();
