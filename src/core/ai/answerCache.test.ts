import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, emptyStore, enforce, getAnswer, isHedged, MAX_ANSWER, MAX_BYTES, MAX_ENTRIES, parseStore, putAnswer, serialize, shouldCache, stats, type KeyParts } from "./answerCache.ts";
import { describeControl, type ExplainCtx } from "./explain.ts";
import { setParamDocs } from "./paramDocs.ts";

const base: KeyParts = { namespace: "explain", question: "Explain the control Cutoff", kind: "Program", engine: "SGX-2", lang: "en", length: "normal" };
const key = (n: number): string => n.toString(16).padStart(28, "0");
const ANSWER = "It opens or closes the filter, so the sound gets brighter or darker as you raise it.";

test("the key varies with engine, language, length, kind, namespace and question, and is stable", () => {
  const k = cacheKey(base);
  assert.match(k, /^[0-9a-f]{28}$/);
  assert.equal(cacheKey({ ...base }), k);
  assert.equal(cacheKey({ ...base, question: "Explain  the control   Cutoff\n" }), k, "whitespace does not matter");
  for (const change of [{ engine: "EP-1" }, { lang: "pt" as const }, { length: "brief" as const }, { kind: "Combi" }, { namespace: "ask" as const }, { question: "Explain the control Resonance" }]) assert.notEqual(cacheKey({ ...base, ...change }), k, JSON.stringify(change));
});

test("the key ignores the sound's name and the current value: the same control on another sound of the engine hits", () => {
  setParamDocs(null);
  const ctx: ExplainCtx = { label: "Poly Legato", kind: "checkbox", group: "Voice Assign Mode", page: "Program Basic", soundKind: "Program", engine: "SGX-2", min: 0, max: 1 };
  const a = describeControl({ ...ctx, soundName: "Berlin Grand", value: "On" });
  const b = describeControl({ ...ctx, soundName: "Concert Piano", value: "Off" });
  assert.equal(a.question, b.question);
  assert.ok(!a.question.includes("Berlin") && !a.question.includes("Current value"));
  const part = (q: string): KeyParts => ({ namespace: "explain", question: q, kind: "Program", engine: "SGX-2", lang: "en", length: "normal" });
  assert.equal(cacheKey(part(a.question)), cacheKey(part(b.question)));
  assert.match(a.valueLine, /On/);
  assert.notEqual(cacheKey(part(describeControl({ ...ctx, engine: "AL-1" }).question)), cacheKey(part(a.question)), "another engine misses");
});

test("hedged answers are recognised in English, Portuguese and Spanish, and plain ones are not", () => {
  for (const t of ["I'm unsure how SGX-2 responds.", "I am not sure about that.", "It is not entirely certain.", "I don't know.", "Não tenho certeza se isso funciona.", "Não sei ao certo.", "No tengo certeza.", "Poly Legato does something; I'm unsure about the SGX-2."]) assert.ok(isHedged(t), t);
  for (const t of [ANSWER, "Poly Legato makes overlapping notes use the legato start point.", "Mantenha em Normal para ataques previsíveis."]) assert.ok(!isHedged(t), t);
});

test("shouldCache: only finished, plain, non-hedged model answers about the control", () => {
  const ok = { status: "done", text: ANSWER, tools: [] as string[] };
  assert.ok(shouldCache(ok));
  assert.ok(shouldCache({ ...ok, tools: ["lookup_param_help"] }));
  assert.ok(!shouldCache({ ...ok, status: "error" }));
  assert.ok(!shouldCache({ ...ok, status: "cancelled" }));
  assert.ok(!shouldCache({ ...ok, fallback: true }));
  assert.ok(!shouldCache({ ...ok, text: "   " }));
  assert.ok(!shouldCache({ ...ok, text: "Short." }));
  assert.ok(!shouldCache({ ...ok, text: `${ANSWER} I'm unsure about the SGX-2.` }));
  assert.ok(!shouldCache({ ...ok, tools: ["describe_sound"] }));
  assert.ok(!shouldCache({ ...ok, tools: ["lookup_param_help", "show_param"] }));
  assert.ok(!shouldCache({ ...ok, soundName: "Brighter", text: ANSWER.replace("brighter", "Brighter") }), "an answer that repeats the sound's name is about that sound");
  assert.ok(shouldCache({ ...ok, soundName: "Berlin Grand" }));
  assert.ok(!shouldCache({ ...ok, text: "x".repeat(MAX_ANSWER + 1) }));
});

test("put and get: a hit returns the text, a replace overwrites, a hedged or empty put is ignored", () => {
  const s = emptyStore();
  putAnswer(s, key(1), ANSWER);
  assert.equal(getAnswer(s, key(1)), ANSWER);
  assert.equal(getAnswer(s, key(2)), null);
  putAnswer(s, key(1), `${ANSWER} Newer.`);
  assert.equal(s.entries.length, 1);
  assert.match(getAnswer(s, key(1))!, /Newer/);
  putAnswer(s, key(3), "I'm unsure about this one.");
  putAnswer(s, key(4), "  ");
  putAnswer(s, "not-a-key", ANSWER);
  assert.equal(s.entries.length, 1);
});

test("LRU: the least recently used entry goes first when the count cap is reached", () => {
  const s = emptyStore();
  for (let i = 1; i <= MAX_ENTRIES; i++) putAnswer(s, key(i), `${ANSWER} ${i}`);
  assert.equal(s.entries.length, MAX_ENTRIES);
  getAnswer(s, key(1)); // entry 1 is now the freshest, entry 2 the oldest
  putAnswer(s, key(MAX_ENTRIES + 1), ANSWER);
  assert.equal(s.entries.length, MAX_ENTRIES);
  assert.ok(getAnswer(s, key(1)), "the touched entry stays");
  assert.equal(getAnswer(s, key(2)), null, "the oldest is evicted");
  assert.ok(getAnswer(s, key(MAX_ENTRIES + 1)));
});

test("the size cap holds: big answers evict the oldest, and the file stays under 2 MB", () => {
  const s = emptyStore();
  const big = "A long answer about a parameter. ".repeat(500).slice(0, 16_000);
  for (let i = 1; i <= 200; i++) putAnswer(s, key(i), `${big}${i}`);
  const out = serialize(s);
  assert.ok(new TextEncoder().encode(out).length <= MAX_BYTES, "under the byte cap");
  assert.ok(s.entries.length < 200 && s.entries.length > 50);
  assert.ok(getAnswer(s, key(200)), "the newest stays");
  assert.equal(getAnswer(s, key(1)), null);
  assert.ok(stats(s).bytes <= MAX_BYTES);
});

test("serialise and parse round-trip; corrupt, wrong-version or odd files read as empty or lose only the bad entry", () => {
  const s = emptyStore();
  putAnswer(s, key(1), ANSWER);
  putAnswer(s, key(2), `${ANSWER} Two.`);
  const back = parseStore(serialize(s));
  assert.deepEqual(back.entries.map((e) => e.k).sort(), [key(1), key(2)]);
  assert.equal(getAnswer(back, key(2)), `${ANSWER} Two.`);
  assert.equal(parseStore("{ not json").entries.length, 0);
  assert.equal(parseStore("").entries.length, 0);
  assert.equal(parseStore(null).entries.length, 0);
  assert.equal(parseStore("[]").entries.length, 0);
  assert.equal(parseStore(JSON.stringify({ v: 999, entries: [{ k: key(1), t: ANSWER, u: 1 }] })).entries.length, 0);
  const mixed = parseStore(JSON.stringify({ v: 1, clock: 5, entries: [{ k: key(1), t: ANSWER, u: 1 }, { k: "bad", t: ANSWER, u: 2 }, { k: key(3), t: 5, u: 3 }, null, { k: key(1), t: "dup dup dup dup dup dup", u: 4 }] }));
  assert.deepEqual(mixed.entries.map((e) => e.k), [key(1)]);
  assert.equal(enforce({ clock: 0, entries: [] }).entries.length, 0);
});

test("a clock that restarts from a saved file keeps counting up", () => {
  const s = emptyStore();
  putAnswer(s, key(1), ANSWER);
  const back = parseStore(serialize(s));
  putAnswer(back, key(2), `${ANSWER} Two.`);
  assert.ok(back.entries.find((x) => x.k === key(2))!.u > back.entries.find((x) => x.k === key(1))!.u);
});
