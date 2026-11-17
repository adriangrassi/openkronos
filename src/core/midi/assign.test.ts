import { test } from "node:test";
import assert from "node:assert/strict";
import { assignByName, suggestWord } from "./assign.ts";
import { buildIndex, type SoundRef } from "./match.ts";
import type { SmfChannelFacts } from "./smf.ts";

const prog = (index: number, name: string): SoundRef => ({ key: "program:U-FF", index, name, kind: "program" });
const SOUNDS = buildIndex([
  prog(0, "Prayer Synth Strings"), prog(1, "Prayer Lead Guitar"), prog(2, "Prayer Strings"), prog(3, "Prayer Celesta"),
  prog(4, "Prayer Flute"), prog(5, "Prayer Clav"), prog(6, "Prayer Nylon"), prog(7, "Prayer Rock Drums"),
  prog(8, "Prayer Brass"), prog(9, "Prayer Rhythm Guitar"), prog(10, "Prayer Choir"), prog(11, "Prayer Pick Bass"),
  prog(12, "Prayer Acoustic Bass"), prog(13, "Prayer Synth Voice"),
  prog(14, "Berlin Grand SW2 U.C."), prog(15, "Acoustic Bass Factory"),
  { key: "combi:U-FF", index: 0, name: "Prayer Combi", kind: "combi" },
]).entries;

// The owner's 1-based channel numbers, with the GM program each one plays.
const ch = (n: number, program: number, notes = 10, trackName: string | null = null): SmfChannelFacts =>
  ({ channel: n - 1, trackName, program, notes });
const FILE: SmfChannelFacts[] = [
  ch(3, 8), ch(4, 73), ch(5, 54), ch(6, 32), ch(7, 7), ch(9, 24), ch(10, 0), ch(11, 61),
  ch(12, 29), ch(13, 30), ch(14, 52), ch(15, 0, 0),
];

// Result as "owner channel -> Program name" so the expectations read like the panel.
function named(r: ReturnType<typeof assignByName>) {
  return Object.fromEntries(r.picks.map((p) => [p.channel + 1, p.name]));
}

test("each track gets the Program with its instrument's name", () => {
  const r = assignByName(FILE, SOUNDS, "Prayer");
  assert.deepEqual(named(r), {
    3: "Prayer Celesta", 4: "Prayer Flute", 5: "Prayer Synth Voice", 6: "Prayer Acoustic Bass",
    7: "Prayer Clav", 9: "Prayer Nylon", 10: "Prayer Rock Drums", 11: "Prayer Brass",
    12: "Prayer Lead Guitar", 13: "Prayer Rhythm Guitar", 14: "Prayer Choir",
  });
});

test("no Program is used twice, the empty channel is ignored, and nothing is left alone", () => {
  const r = assignByName(FILE, SOUNDS, "Prayer");
  assert.equal(new Set(r.picks.map((p) => p.key + p.index)).size, r.picks.length);
  assert.equal(r.picks.every((p) => p.index !== 14 && p.index !== 15), true);
  assert.deepEqual(r.unmatched, []);
});

test("only Programs are picked, and a word nothing contains gives no picks", () => {
  assert.equal(assignByName(FILE, SOUNDS, "Prayer").picks.every((p) => p.name.startsWith("Prayer") && !p.name.includes("Combi")), true);
  const none = assignByName(FILE, SOUNDS, "Zzzz");
  assert.deepEqual(none.picks, []);
  assert.deepEqual(none.unmatched, [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]);
});

test("the word is case-insensitive and the result is identical on a second run", () => {
  const a = assignByName(FILE, SOUNDS, "PRAYER");
  assert.deepEqual(a, assignByName(FILE, SOUNDS, "prayer"));
  assert.deepEqual(a, assignByName(FILE, SOUNDS, "prayer"));
});

// Suggested word from a file name: user-bank Programs only, whole-word matches.
const pg = (key: string, index: number, name: string): SoundRef => ({ key, index, name, kind: "program" });
const userNamed = (word: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => pg("program:U-AA", from + i, `${word} Sound ${i}`));
const factoryNamed = (word: string, n: number) =>
  Array.from({ length: n }, (_, i) => pg("program:INT-A", 500 + i, `${word} Factory ${i}`));

test("suggestWord takes the word that names the most user Programs, ignoring factory ones", () => {
  const sounds = buildIndex([
    ...Array.from({ length: 14 }, (_, i) => pg("program:U-FF", i, `Prayer ${["Synth", "Lead", "Choir", "Celesta", "Flute", "Clav", "Nylon", "Brass", "Strings", "Bass", "Rock", "Pick", "Voice", "Piano"][i]}`)),
    pg("program:INT-A", 20, "Prayer Piano Factory"),
    pg("program:INT-A", 21, "Berlin Grand"),
  ]).entries;
  assert.deepEqual(suggestWord("Bon Jovi - Living on a Prayer.mid", sounds), { word: "prayer", count: 14 });
});

test("suggestWord gives null when no file word matches, or only 2 Programs match", () => {
  assert.equal(suggestWord("Bon Jovi - Living on a Prayer.mid", buildIndex([pg("program:U-FF", 0, "Berlin Grand")]).entries), null);
  assert.equal(suggestWord("Lovely Night.mid", buildIndex(userNamed("Lovely", 2)).entries), null);
});

test("suggestWord gives null above 40 matches, a generic word", () => {
  assert.equal(suggestWord("Lovely Night.mid", buildIndex(userNamed("Lovely", 41)).entries), null);
  assert.deepEqual(suggestWord("Lovely Night.mid", buildIndex(userNamed("Lovely", 40)).entries), { word: "lovely", count: 40 });
});

test("suggestWord counts user Programs only, and Init sounds are never counted", () => {
  const sounds = buildIndex([
    ...userNamed("Love", 3),
    ...factoryNamed("Love", 60),
    pg("program:U-AA", 90, "Init Love"),
    pg("program:U-AA", 91, "Init Love Two"),
  ]).entries;
  assert.deepEqual(suggestWord("Show Me Love.mid", sounds), { word: "love", count: 3 });
});
