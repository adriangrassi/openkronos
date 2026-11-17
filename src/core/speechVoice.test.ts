import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_VOICE_HINT, pickSystemVoice, voicesFor, type SysVoice } from "./speechVoice.ts";

const V = (name: string, lang: string, o: Partial<SysVoice> = {}): SysVoice => ({ name, lang, localService: true, ...o });
const pick = (vs: SysVoice[], l: "en" | "pt", p?: string) => pickSystemVoice(vs, l, p)?.name ?? null;

test("the saved voice wins while it is still installed and speaks the language", () => {
  const vs = [V("Zira", "en-US"), V("David", "en-US"), V("Maria", "pt-BR")];
  assert.equal(pick(vs, "en", "David"), "David");
  assert.equal(pick(vs, "en", "Gone"), "Zira", "no longer installed: automatic");
  assert.equal(pick(vs, "en", "Maria"), "Zira", "a voice of the other language is never used");
  assert.equal(pick(vs, "pt", "Maria"), "Maria");
});
test("English prefers en-US, then en-GB, then any en", () => {
  assert.equal(pick([V("Au", "en-AU"), V("Gb", "en-GB"), V("Us", "en-US")], "en"), "Us");
  assert.equal(pick([V("Au", "en-AU"), V("Gb", "en-GB")], "en"), "Gb");
  assert.equal(pick([V("Au", "en-AU")], "en"), "Au");
  assert.equal(pick([V("Us", "en_US")], "en"), "Us", "an underscore tag counts");
});
test("Portuguese prefers pt-BR, then pt-PT, then any pt", () => {
  assert.equal(pick([V("Pt", "pt-PT"), V("Br", "pt-BR")], "pt"), "Br");
  assert.equal(pick([V("Pt", "pt-PT"), V("Ang", "pt-AO")], "pt"), "Pt");
  assert.equal(pick([V("Ang", "pt-AO")], "pt"), "Ang");
});
test("a voice on this computer beats an online one, and Natural/Neural counts only for a local voice", () => {
  assert.equal(pick([V("Online Natural", "en-US", { localService: false }), V("Plain", "en-US")], "en"), "Plain");
  assert.equal(pick([V("Plain", "en-US"), V("Aria Natural", "en-US")], "en"), "Aria Natural");
  assert.equal(pick([V("Zed Neural", "en-US", { localService: false }), V("Alan", "en-US", { localService: false, default: true })], "en"), "Alan", "online Neural gets no bonus");
  assert.equal(pick([V("Online", "en-US", { localService: false })], "en"), "Online", "an online voice is still better than none");
  assert.equal(pick([V("Gb Natural", "en-GB"), V("Us", "en-US")], "en"), "Us", "the region ranks above Natural");
});
test("the system default breaks a tie, and a missing localService counts as local", () => {
  assert.equal(pick([V("A", "en-US"), V("B", "en-US", { default: true })], "en"), "B");
  assert.equal(pick([{ name: "Mac", lang: "en-US" }, V("Net", "en-US", { localService: false })], "en"), "Mac");
});
test("no voice for the language gives null, never another language", () => {
  assert.equal(pickSystemVoice([V("Maria", "pt-BR")], "en"), null);
  assert.equal(pickSystemVoice([V("Zira", "en-US"), V("Ens", "ensemble")], "pt"), null, "a tag that only starts with the letters is not a match");
  assert.equal(pickSystemVoice([], "en"), null);
  assert.deepEqual(voicesFor([V("Zira", "en-US"), V("Maria", "pt-BR")], "pt").map((v) => v.name), ["Maria"]);
  assert.match(NO_VOICE_HINT("pt"), /^No Portuguese voice is installed on this computer: add one in Windows Settings > Time & language > Speech, or in macOS System Settings > Accessibility > Spoken Content$/);
  assert.match(NO_VOICE_HINT("en"), /^No English voice/);
});
