import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedUrl, decodeEntities, downloadRequest, isMidi, parseResults, safeFileName } from "./sites.ts";

// Synthetic strings only: nothing here is copied from a real site.
test("entities in titles are decoded", () => {
  assert.equal(decodeEntities("A &amp; B &#39;C&#39; &quot;D&quot; &#x41;"), "A & B 'C' \"D\" A");
});

test("result pages are read, and unknown pages give none", () => {
  assert.deepEqual(parseResults("midiworld", '<a href="https://www.midiworld.com/download/5" target="_blank">download</a>'), []);
  assert.deepEqual(parseResults("midiworld", "Tune (Band) - <a href=\"https://www.midiworld.com/download/5\" target=\"_blank\">download</a>"), [{ site: "midiworld", ref: "5", title: "Tune (Band)" }]);
  assert.deepEqual(parseResults("bitmidi", "not json"), []);
});

test("download addresses come only from the reference", () => {
  assert.deepEqual(downloadRequest("bitmidi", "9"), { url: "https://bitmidi.com/uploads/9.mid" });
  assert.throws(() => downloadRequest("bitmidi", "9/../1"));
});

test("only the sites' own https addresses are allowed", () => {
  assert.equal(allowedUrl("https://freemidi.org/getter-1"), true);
  assert.equal(allowedUrl("https://freemidi.org.example.net/getter-1"), false);
  assert.equal(allowedUrl("http://freemidi.org/getter-1"), false);
});

test("file names and MIDI detection", () => {
  assert.equal(safeFileName("AUX"), "_AUX.mid");
  assert.equal(safeFileName("a/b:c"), "a_b_c.mid");
  assert.equal(isMidi(new TextEncoder().encode("MThd\0\0")), true);
  assert.equal(isMidi(new TextEncoder().encode("<html>")), false);
});
