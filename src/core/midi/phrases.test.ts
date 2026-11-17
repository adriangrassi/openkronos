import { test } from "node:test";
import assert from "node:assert/strict";
import { autoPhrase, phrase, PHRASE_KINDS } from "./phrases.ts";

test("every phrase balances its notes and uses the given channel", () => {
  for (const k of PHRASE_KINDS) {
    const ev = phrase(k, 5);
    assert.ok(ev.every((e) => (e.data[0] & 15) === 5));
    assert.equal(ev.filter((e) => e.data[0] >> 4 === 9).length, ev.filter((e) => e.data[0] >> 4 === 8).length);
  }
});

test("auto picks by name, then category", () => {
  assert.equal(autoPhrase("Fat Bass"), "bass");
  assert.equal(autoPhrase("x", "Drums"), "drums");
  assert.equal(autoPhrase("Fat Bass", "Lead"), "bass");
  assert.equal(autoPhrase("Pad"), "chord");
});
