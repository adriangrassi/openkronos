import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLang, dropSoundOpener, looksEnglish, looksPortuguese, MAX_CHUNK, MAX_TOTAL, speakIds, stripMarkdown, toSpeech } from "./speakText.ts";

test("markdown, code fences, links and urls are stripped", () => {
  const md = "# Cutoff\n**Raise** the `Cutoff` a little.\n```json\n{\"a\":1}\n```\n- first tip\n- second tip\n1. third tip\nSee [the manual](https://example.com/x) or https://korg.com now.";
  const s = stripMarkdown(md);
  for (const bad of ["#", "**", "`", "{", "http", "](", "- ", "1."]) assert.ok(!s.includes(bad), bad);
  assert.match(s, /Raise the Cutoff a little\./);
  assert.match(s, /first tip\./);
  assert.match(s, /See the manual or now\./);
});

test("tool trace lines are dropped, the answer stays", () => {
  const md = 'Read "Piano" INT-A 000 · Filter\nlist_effect_types: ok\nsearch_sounds refused: nope\nSearched "piano": 4 found\nRead the cutoff first, then lower it.';
  assert.deepEqual(toSpeech(md, "en"), ["Read the cutoff first, then lower it."]);
});

test("note names and bank ids become short and speakable", () => {
  assert.equal(speakIds("Play C4 and F#3 and Bb2.", "en"), "Play C 4 and F sharp 3 and B flat 2.");
  assert.equal(speakIds("Open INT-A 000 or U-AA 078.", "en"), "Open Internal A 0 or User A A 78.");
  assert.equal(speakIds("Use INT-B 005 e C#4.", "pt"), "Use Interno B 5 e C sustenido 4.");
  assert.equal(speakIds("A plain A and 4 are untouched.", "en"), "A plain A and 4 are untouched.");
});

test("chunks end at sentence boundaries and stay within the limit", () => {
  const sentence = "This sentence is about fifty characters long, ok.";
  const chunks = toSpeech(Array(30).fill(sentence).join(" "), "en");
  assert.ok(chunks.length > 1);
  for (const c of chunks) { assert.ok(c.length <= MAX_CHUNK, String(c.length)); assert.ok(c.endsWith("."), c); }
  assert.equal(chunks.join(" ").split("ok.").length - 1, 30);
});

test("one very long sentence is cut at commas or spaces", () => {
  const chunks = toSpeech(`${Array(80).fill("word, more").join(" ")}.`, "en");
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= MAX_CHUNK);
});

test("a long answer is capped with a spoken note, in the right language", () => {
  const long = Array(120).fill("Raise the filter cutoff a little to open the sound up.").join(" ");
  const en = toSpeech(long, "en"), pt = toSpeech(long, "pt");
  assert.equal(en.at(-1), "The rest is on screen.");
  assert.equal(pt.at(-1), "O resto está na tela.");
  assert.ok(en.slice(0, -1).join(" ").length <= MAX_TOTAL + en.length);
  assert.deepEqual(toSpeech("Short answer.", "en"), ["Short answer."]);
});

test("empty or markup-only input gives nothing", () => {
  for (const x of ["", "   \n ", "```\ncode\n```", "list_effect_types: ok"]) assert.deepEqual(toSpeech(x, "pt"), []);
});

test("non-ASCII text is preserved", () => {
  assert.deepEqual(toSpeech("**Aumente** o corte: ação, coração e é útil.", "pt"), ["Aumente o corte: ação, coração e é útil."]);
});

test("looksPortuguese / looksEnglish: stopword ratio, short or empty text is ok", () => {
  assert.equal(detectLang("Raise the Cutoff a little. It opens the sound up, as on C4."), "en");
  assert.equal(detectLang("Aumente o corte para abrir o som, e não esqueça de uma nota."), "pt");
  assert.equal(looksPortuguese("It is the best of the sound for you and it."), false);
  assert.equal(looksEnglish("Aumente o corte para abrir o som, e não esqueça."), false);
  for (const t of ["", "Cutoff 64", "ok"]) { assert.equal(looksPortuguese(t), true); assert.equal(looksEnglish(t), true); }
});

test("dropSoundOpener removes a leading sound name or slot id only", () => {
  const n = "Berlin Dark Grand SW2 UC";
  assert.equal(dropSoundOpener(`For "${n}," Assign Mode chooses the pad.`, n), "Assign Mode chooses the pad.");
  assert.equal(dropSoundOpener(`In "${n}", the filter is open.`, n), "The filter is open.");
  assert.equal(dropSoundOpener(`For ${n}: the filter is open.`, n), "The filter is open.");
  assert.equal(dropSoundOpener(`"${n}" (INT-A 005) has a bright top.`, n), "Has a bright top.");
  assert.equal(dropSoundOpener(`Para "${n}", o filtro está aberto.`, n), "O filtro está aberto.");
  assert.equal(dropSoundOpener("INT-A 005: the filter is open.", ""), "The filter is open.");
  assert.equal(dropSoundOpener(`The filter of ${n} is open.`, n), `The filter of ${n} is open.`);
  assert.equal(dropSoundOpener("In Piano mode, it is dark. Piano again.", "Piano"), "In Piano mode, it is dark. Piano again.");
  assert.equal(dropSoundOpener("Raise the Cutoff.", n), "Raise the Cutoff.");
  assert.equal(dropSoundOpener("Raise the Cutoff.", ""), "Raise the Cutoff.");
  assert.deepEqual(toSpeech(`For "${n}," Raise the Cutoff.`, "en", n), ["Raise the Cutoff."]);
});
test("a shorter chunk limit cuts and merges at that limit, and the default is unchanged", () => {
  const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} of the answer.`).join(" ");
  const small = toSpeech(long, "en", "", 200);
  assert.ok(small.length > toSpeech(long, "en").length && small.every((c) => c.length <= 200), "every chunk fits 200");
  assert.ok(toSpeech(long, "en").every((c) => c.length <= 300));
  const one = `${"word ".repeat(80)}end.`;
  assert.ok(toSpeech(one, "en", "", 200).every((c) => c.length <= 200));
});
