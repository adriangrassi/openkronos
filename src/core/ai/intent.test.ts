import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, noteName, promotedPrompt } from "./intent.ts";

const BUILD = [
  "add a pad and a synth over the piano",
  "add string",
  "add strings under it",
  "layer a soft pad",
  "add a bass an octave down",
  "put a synth lead on top",
  "stack a choir over this",
  "double it with brass",
  "another pad please",
  "add a new sound with a warm organ",
  "pluck layer over the piano",
  "split it: bass in the left hand below C3 and the piano above",
  "bass in the left hand below C3 and the piano above",
  "velocity switch between soft pad and bright synth",
  "make a keyboard zone for strings and one for the piano",
  "crossfade the pad into the piano with velocity",
  "add an arpeggio on the synth",
  "give me a funk groove on the left hand",
  "add a drum pattern",
  "set up a chord trigger pad",
  "add a pad and a synth over the piano with an arpeggio on the synth, split at C3",
];
const TWEAK = [
  "make it brighter",
  "add a delay with 4 long repetition",
  "add some reverb",
  "add a bit more chorus",
  "add more bass",
  "make the bass heavier",
  "shorter attack",
  "turn the arp tempo down",
  "make the arp faster",
  "double the attack time",
  "make the pad slower",
  "wider stereo image",
];

for (const t of BUILD) test(`build-layer: ${t}`, () => assert.equal(classifyIntent(t).kind, "build-layer"));
for (const t of TWEAK) test(`tweak: ${t}`, () => assert.equal(classifyIntent(t).kind, "tweak"));

test("noteName uses Kronos numbering: C-1 = 0, C3 = 48, middle C = C4 = 60, G9 = 127", () => {
  assert.deepEqual([0, 48, 60, 127, 61].map(noteName), ["C-1", "C3", "C4", "G9", "C#4"]);
});

test("promotedPrompt names the open sound, keeps it as part 1, and asks for the final list", () => {
  const p = promotedPrompt({ key: "program:INT-A", index: 0, name: "Berlin Grand", engine: "SGX-2", bank: "INT-A" }, "add a pad and a synth over the piano");
  assert.match(p, /INT-A 000 "Berlin Grand" \(program:INT-A 0\), engine SGX-2/);
  assert.match(p, /part 1/); assert.match(p, /never set_params/); assert.match(p, /Combination/);
});
