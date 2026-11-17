import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSong, openingMessage, picksFromTracks, type SongFacts } from "./song.ts";
import { DEFAULT_SYSTEM } from "./agent.ts";

// Synthetic facts only: the shape the MIDI panel already computes for a loaded file.
const song = (facts: SongFacts["facts"], extra: Partial<SongFacts["analysis"]> = {}): SongFacts => ({
  name: "Demo Song",
  analysis: { tempoMap: [{ bpm: 130 }], timeSignature: { num: 4, den: 4 }, key: { name: "D minor" }, ...extra },
  facts,
});
const bass = { channel: 4, trackName: "bass", program: 32, notes: 52 };
const chordBass = { channel: 5, trackName: "chord bass", program: null, notes: 44 };
const kick = { channel: 9, trackName: "Kick", program: null, notes: 0 };

test("describeSong gives tempo, key, meter and every named or noted channel, 1-based", () => {
  const text = describeSong(song([bass, chordBass, kick]));
  assert.match(text, /^Loaded MIDI file: "Demo Song", 130 bpm, 4\/4, key D minor\./);
  assert.match(text, /ch 5 "bass" GM Acoustic Bass, 52 notes/);
  assert.match(text, /ch 6 "chord bass", 44 notes/);
  assert.match(text, /ch 10 "Kick", EMPTY \(0 notes\)/);
});

test("describeSong caps a 40-channel file and says how many more", () => {
  const many = Array.from({ length: 40 }, (_, c) => ({ channel: c % 16, trackName: `track name ${c}`, program: 0, notes: 3 }));
  const text = describeSong(song(many));
  assert.match(text, /and \d+ more/);
  assert.ok(text.length < 1400, `length ${text.length}`);
});

test("describeSong is empty when no file is loaded", () => {
  assert.equal(describeSong(null), "");
});

test("openingMessage puts the song block before the owner's sentence only when a file is loaded", () => {
  const withSong = openingMessage("Make it brassy", song([bass]));
  assert.ok(withSong.startsWith("Loaded song (ground truth, trust it over your memory of the song):\n"));
  assert.match(withSong, /ch 5 "bass"/);
  assert.ok(withSong.endsWith("Make it brassy"));
  assert.equal(openingMessage("Make it brassy", null), "Make it brassy");
});

test("picksFromTracks maps trackSounds whose track is a channel of the file, and ignores the rest", () => {
  const tracks = [
    { track: 5, key: "program:U-AA", index: 7 },
    { track: 6, key: "program:U-BB", index: 8 },
    { track: 20, key: "program:U-CC", index: 1 },
    { track: 4, key: "program:U-DD", index: 2 },
  ];
  assert.deepEqual(picksFromTracks(tracks, song([bass, chordBass, kick])), [
    { channel: 4, key: "program:U-AA", index: 7 },
    { channel: 5, key: "program:U-BB", index: 8 },
  ]);
  assert.deepEqual(picksFromTracks(tracks, null), []);
});

test("describeSong no longer tells the model to subtract one, and the system prompt asks for playable parts", () => {
  assert.doesNotMatch(describeSong(song([bass])), /minus 1/);
  assert.match(describeSong(song([bass])), /trackSounds/);
  assert.match(DEFAULT_SYSTEM, /Keep every Combi part on the keyboard's own channel/);
  assert.doesNotMatch(DEFAULT_SYSTEM, /set each part's MIDI channel to the channel of the song track/);
});
