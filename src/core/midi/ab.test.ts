import { test } from "node:test";
import assert from "node:assert/strict";
import { abPlan, AB_CHOICES, nextVariant } from "./ab.ts";
import { phrase, PHRASE_KINDS, PHRASE_VARIANTS } from "./phrases.ts";

const kindOf = (name: string, category = "", engine: string | null = "HD-1") => abPlan({ name, category, engine }).kind;

test("name and category pick the phrase kind for 12+ realistic sounds", () => {
  const want: [string, string, string][] = [
    ["Concert Grand", "Keyboard", "chord"],
    ["Suitcase EP", "Keyboard", "chord"],
    ["Warm Pad", "Synth Pad/Strings", "chord"],
    ["Full Strings", "Strings", "chord"],
    ["Church Organ", "Organ", "chord"],
    ["Fat Moog Bass", "Bass", "bass"],
    ["Sub 808", "Bass", "bass"],
    ["Saw Lead", "Synth Lead", "lead"],
    ["Brass Section", "Brass/Reed", "lead"],
    ["Solo Flute", "", "lead"],
    ["Alto Sax", "Brass/Reed", "lead"],
    ["Pluck Seq", "Synth", "arpeggio"],
    ["Nylon Guitar", "Guitar/Plucked", "arpeggio"],
    ["Vibes", "Bell/Mallet", "arpeggio"],
    ["Rock Kit", "Drums/Perc", "drums"],
    ["Zzz", "Drums", "drums"],
  ];
  for (const [n, c, k] of want) assert.equal(kindOf(n, c), k, `${n} / ${c}`);
});

test("unknown names fall back to chord, and a name hint beats the category", () => {
  assert.equal(kindOf("", ""), "chord");
  assert.equal(kindOf("Zzz Qqq", "???"), "chord");
  assert.equal(kindOf("Fat Bass", "Synth Lead"), "bass");
});

test("the engine only decides when the name and category are silent", () => {
  assert.equal(abPlan({ name: "Zzz", category: "", engine: "STR-1" }).kind, "arpeggio");
  assert.equal(abPlan({ name: "Zzz", category: "", engine: "EXi" }).kind, "chord");
  assert.equal(abPlan({ name: "Fat Bass", category: "", engine: "STR-1" }).kind, "bass");
});

test("a forced kind overrides auto; auto and undefined behave the same", () => {
  for (const k of PHRASE_KINDS) assert.equal(abPlan({ name: "Fat Bass", category: "", engine: "HD-1", kind: k }).kind, k);
  assert.equal(abPlan({ name: "Fat Bass", category: "", engine: "HD-1", kind: "auto" }).kind, "bass");
  assert.deepEqual([...AB_CHOICES], ["auto", ...PHRASE_KINDS]);
});

test("piano and electric piano get the chord with a melody variant first", () => {
  const p = abPlan({ name: "Concert Grand", category: "Keyboard", engine: "HD-1" });
  const pad = abPlan({ name: "Warm Pad", category: "", engine: "HD-1" });
  assert.equal(p.variant, 1);
  assert.equal(pad.variant, 0);
});

test("variants rotate deterministically and differ from each other", () => {
  assert.equal(PHRASE_VARIANTS, 2);
  assert.deepEqual([0, 1, 2, 3].map(nextVariant), [1, 0, 1, 0]);
  for (const kind of PHRASE_KINDS) {
    const a = phrase(kind, 0, 0), b = phrase(kind, 0, 1);
    assert.notDeepEqual(a, b, kind);
    assert.deepEqual(phrase(kind, 0), a, "variant 0 is the default");
    const q = (v: number) => abPlan({ name: "Zzz", category: "", engine: "HD-1", kind, variant: v }).events;
    assert.deepEqual(q(2), q(0), `${kind}: variant wraps`);
    assert.deepEqual(q(3), q(1));
  }
});

test("every variant is balanced, sorted, on its channel and in its range", () => {
  for (const kind of PHRASE_KINDS) for (let v = 0; v < PHRASE_VARIANTS; v++) {
    const ev = phrase(kind, 3, v), on = ev.filter((e) => e.data[0] >> 4 === 9), off = ev.filter((e) => e.data[0] >> 4 === 8);
    assert.equal(on.length, off.length, `${kind}/${v}`);
    assert.ok(ev.every((e, i) => !i || e.ms >= ev[i - 1].ms), `${kind}/${v} unsorted`);
    assert.ok(ev.every((e) => (e.data[0] & 15) === 3 && e.data.slice(1).every((b) => b >= 0 && b < 128)));
    const notes = on.map((e) => e.data[1]);
    if (kind === "bass") assert.ok(notes.every((n) => n < 55));
    if (kind === "lead") assert.ok(notes.every((n) => n >= 60));
    if (kind === "drums") assert.ok(notes.every((n) => n >= 35 && n <= 59));
    if (kind === "chord") assert.ok(on.filter((e) => e.ms === on[0].ms).length >= 3);
    if (kind === "arpeggio") assert.ok(new Set(on.map((e) => e.ms)).size >= 4);
    assert.ok(ev.at(-1)!.ms <= 8200, `${kind}/${v} too long`);
  }
});

test("the sample variant is a few bars long and has more than scale notes", () => {
  for (const kind of PHRASE_KINDS) {
    const ev = phrase(kind, 0, 1);
    assert.ok(ev.at(-1)!.ms >= 6000, `${kind} is ${ev.at(-1)!.ms} ms`);
    assert.ok(new Set(ev.filter((e) => e.data[0] >> 4 === 9).map((e) => e.data[1])).size >= 3, kind);
  }
});

test("A and B get the very same events: one plan, same length", () => {
  const plan = abPlan({ name: "Concert Grand", category: "Keyboard", engine: "HD-1", channel: 2 });
  const again = abPlan({ name: "Concert Grand", category: "Keyboard", engine: "HD-1", channel: 2 });
  assert.deepEqual(plan.events, again.events);
  assert.equal(plan.length, plan.events.at(-1)!.ms);
  assert.ok(plan.events.every((e) => (e.data[0] & 15) === 2));
  assert.equal(plan.events.length % 2, 0);
});
