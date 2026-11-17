import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndex, candidateTitles, gmInstrument, matchSong, suggestSound } from "./match.ts";

const idx = (...n: string[]) => buildIndex(n.map((name, index) => ({ key: "program:U-AA", index, name, kind: "program" as const })));

test("candidate titles drop extension, brackets and case", () => {
  assert.deepEqual(candidateTitles("Jump (Van Halen)"), ["jump"]);
  assert.deepEqual(candidateTitles("Van Halen - Jump.MID").sort(), ["jump", "van halen"]);
});

test("exact beats all-words, and a single shared word never matches", () => {
  const r = matchSong("Jump (Van Halen)", idx("Jump Start", "Jump", "Jumbo"));
  assert.deepEqual(r.map((m) => [m.name, m.score]), [["Jump", 1], ["Jump Start", 0.7]]);
  assert.deepEqual(matchSong("Final Countdown", idx("Final Boss", "Countdown Clock")), []);
});

test("stop-word-only and 1-2 letter titles never match", () => {
  assert.deepEqual(matchSong("The Midi Song Cover", idx("Song of the Wind")), []);
  assert.deepEqual(matchSong("U2", idx("U2", "U2 Lead")), []);
});

test("GM names, families and track-name priority", () => {
  assert.deepEqual(gmInstrument(56), { name: "Trumpet", family: "Brass" });
  assert.equal(gmInstrument(127).name, "Gunshot");
  assert.equal(suggestSound({ trackName: null, program: 57 }, idx("Fat Bass", "Brass Section"))?.name, "Brass Section");
  assert.equal(suggestSound({ trackName: "Bass", program: 56 }, idx("Solo Trumpet", "Fat Bass"))?.name, "Fat Bass");
});

test("the artist segment of Artist - Title never matches a longer sound name by itself", () => {
  assert.deepEqual(matchSong("Journey - Don't Stop Believin", idx("Galactic Journey", "Keyboard Journey")), []);
  assert.equal(matchSong("Journey - Don't Stop Believin", idx("Galactic Journey", "Journey"))[0]?.name, "Journey");
  assert.equal(matchSong("Jump (Van Halen)", idx("Jump Start Pad"))[0]?.name, "Jump Start Pad");
});

test("weak titles don't pick a wrong sound", () => {
  assert.deepEqual(matchSong("Love Song", idx("Send Her My Love Piano", "Love On Train")), []);
  assert.deepEqual(matchSong("Rock & Roll Night", idx("Rock & Roll Warrior")), []);
});

test("the title after an artist can suggest a sound, but not confidently", () => {
  const r = matchSong("Toto - Africa.mid", idx("Africa Brass", "Toto Lead"));
  assert.equal(r[0]?.name, "Africa Brass");
  assert.ok(r[0].score < 0.9);
});

test("one wrong letter in a long word still matches", () => {
  assert.equal(matchSong("Head Over Heals", idx("Head Over Heels Piano"))[0]?.score, 0.9);
});
