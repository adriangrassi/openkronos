// Acceptance gate for sound variations (mutate, morph, A/B/C candidates). Owned by the architect: builders must not edit it.
//
// TEST-ONLY ENV (set by this gate through launch()): KRONOS_E2E_VARIATIONS_SEED=<uint32>  the renderer's first Generate uses this seed; Generate click number n (0-based, counted since the panel was opened)
//   uses seed SEED+n. Without the variable the app picks its own random seed. launch() also sets KRONOS_E2E=1 and the file/backup paths.
//
// PURE MODULE src/core/params/variations.ts, exact exports (tables = the ParamTables from src/generated/params.json; entry = one Program's bytes; never mutated, results are new Uint8Arrays of the same length):
//   type ProgType = "hd1" | "exi"
//   engineOf(tables: ParamTables, type: ProgType, entry: Uint8Array): string          "HD-1" for hd1; for exi the two engines from exiEngines() joined with "+", e.g. "AL-1+Off"
//   isEnumerated(r: Row): boolean                                                      true for list/choice/switch rows (any row with r.list, and every row whose rawMax - rawMin === 1); false for plain numbers
//   mutate(tables, type: ProgType, entry, strength: number, seed: number): Uint8Array  strength 0..1 (else RangeError, also NaN); seed is a uint32. Same inputs give the same bytes. strength 0 returns bytes equal to entry.
//        Only changes isEditable rows that are sound-shaping (filter, EG/envelope, LFO, effect sends) and never structural/routing ones (oscillator mode, voice/assign mode, MIDI/controller assignments, multisample, scale, any Source/Assign/Bus/Type/Mode/Routing row).
//        Every changed value stays in rawMin..rawMax, and no byte outside the changed rows' bits changes (name included). Higher strength moves values further on average.
//   morph(tables, type, a: Uint8Array, b: Uint8Array, amount: number): Uint8Array      amount 0..100 (else RangeError); throws when engineOf(a) !== engineOf(b).
//        Every isEditable row: numeric rows become round(a + (b - a) * amount / 100) (+-1 allowed in the gate), enumerated rows keep a's value below 50 and take b's value from 50 up. Bytes outside editable rows (the name, UUIDs) stay a's. 0 gives a's bytes, 100 gives b's values.
//   candidates(tables, type, entry, strength: number, seed: number): [Uint8Array, Uint8Array, Uint8Array]   three mutations, deterministic in (entry, strength, seed), pairwise different at strength 0.5
//
// data-testid table (all inside the Program editor of the open file, reached with ui.editSlot("program:INT-A", 0))
//   variations-open        button in the editor that opens the variations panel
//   variations-panel       the panel container, visible after variations-open
//   variations-strength    input type=range 0..100, step 1, default 30; strength passed to candidates() is value / 100
//   variations-generate    button: makes three new candidates from the ORIGINAL program (never from an applied preview) and shows the pads
//   variations-pad-A, -B, -C   the three pads, visible after Generate (absent before); clicking one applies that candidate to the open file as a preview (data-selected="1" on the chosen pad, "0" on the others); clicking another pad replaces the preview, it never stacks
//   variations-morph-with  select listing every OTHER Program of the open file with the SAME engine as the original (option value "<bankKey>|<index>", e.g. "program:INT-B|7"); programs with another engine are not listed
//   variations-morph-amount  input type=range 0..100, step 1, default 0; with a partner chosen, setting it applies morph(original, partner, value) as the preview
//   variations-state       text: "idle" (no preview), "preview" (a pad or morph is applied but not kept), "kept"
//   variations-keep        button, enabled only while state is "preview": the preview stays and counts as exactly ONE undo step (the app's own undo button, data-testid "undo")
//   variations-discard     button, enabled only while state is "preview": restores the original bytes exactly and leaves nothing on the undo stack
// A preview changes only the open file in memory; nothing is written to a connected keyboard. Previews are not undo steps until Keep.
import assert from "node:assert/strict";
import { gate, core, launch, load, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("VARIATIONS"), { check, finish } = g, C = await core(g), { T, P, L, Q, raw } = C;
let V; try { V = await load("src/core/params/variations.ts"); } catch (e) { g.fails.push(`cannot load variations.ts: ${e.message}`); await finish(); }

const f0 = C.parsed();
const SOUND = /filter|\beg\b|envelope|lfo|send|cutoff|resonance/i;
const STRUCT = /midi|controller|assign|multisample|\bms\b|scale|oscillator mode|algorithm|effect type|routing|bus|source|\btype\b|mode/i;
const progs = [];
for (const b of L.listBanks(f0)) if (b.kind === "program") for (let i = 0; i < b.count; i++) progs.push({ key: b.key, i, type: b.type, entry: new Uint8Array(L.getEntry(f0, b.key, i)) });
const eng = (p) => (p.type === "hd1" ? "HD-1" : Q.exiEngines(T, p.entry).join("+"));
const rowsOf = (p) => Q.paramsFor(T, p.type, p.entry).filter(Q.isEditable);
const val = (bytes, r) => Q.readParam(bytes, r);
const hd = progs.filter((p) => p.type === "hd1"), ex = progs.filter((p) => p.type === "exi");
assert.ok(hd.length > 4 && ex.length > 4, "factory file lacks programs");
const samples = [...hd.slice(0, 3), ...ex.slice(0, 3)];
const changedRows = (p, out) => rowsOf(p).filter((r) => val(out, r) !== val(p.entry, r));
const spanSum = (p, out) => changedRows(p, out).reduce((a, r) => a + Math.abs(val(out, r) - val(p.entry, r)) / Math.max(1, r.rawMax - r.rawMin), 0);
const sameEngPair = (type) => { const l = progs.filter((p) => p.type === type); for (const a of l) { const b = l.find((x) => x !== a && eng(x) === eng(a) && sha(x.entry) !== sha(a.entry) && (type === "hd1" || eng(a) !== "Off+Off")); if (b) return [a, b]; } throw new Error(`no ${type} pair`); };

await check("engineOf names the engine", () => { assert.equal(V.engineOf(T, "hd1", hd[0].entry), "HD-1"); for (const p of ex.slice(0, 20)) assert.equal(V.engineOf(T, "exi", p.entry), eng(p)); assert.ok(new Set(ex.map(eng)).size > 1, "need more than one EXi engine in the data"); });
await check("mutate is seeded: same seed same bytes, other seed other bytes, input untouched", () => { for (const p of samples) { const before = sha(p.entry), a = V.mutate(T, p.type, p.entry, 0.6, 42), b = V.mutate(T, p.type, p.entry, 0.6, 42), c = V.mutate(T, p.type, p.entry, 0.6, 43); assert.deepEqual(a, b); assert.notDeepEqual(a, c); assert.equal(a.length, p.entry.length); assert.equal(sha(p.entry), before, "input was modified"); assert.notEqual(a, p.entry); } });
await check("mutate only touches legal sound-shaping values and no other bits", () => {
  for (const p of samples) for (const seed of [1, 2, 3]) {
    const out = V.mutate(T, p.type, p.entry, 1, seed), ch = changedRows(p, out); assert.ok(ch.length >= 3, `${p.key}/${p.i} seed ${seed}: only ${ch.length} rows changed`);
    for (const r of ch) { const v = val(out, r), n = `${r.group} / ${r.name}`; assert.ok(v >= r.rawMin && v <= r.rawMax, `${n} = ${v} outside ${r.rawMin}..${r.rawMax}`); assert.ok(SOUND.test(`${r.group} ${r.name}`), `${n} is not sound-shaping`); assert.ok(!STRUCT.test(`${r.group} ${r.name}`), `${n} is structural`); }
    const mask = new Map(); for (const r of ch) for (const [o, h, l] of r.parts) mask.set(o, (mask.get(o) ?? 0) | (((1 << (h - l + 1)) - 1) << l));
    for (let i = 0; i < out.length; i++) assert.equal((out[i] ^ p.entry[i]) & ~(mask.get(i) ?? 0), 0, `byte ${i} changed outside the changed rows`);
  }
});
await check("strength 0 changes nothing and a higher strength moves values further", () => {
  for (const p of samples) { assert.deepEqual(V.mutate(T, p.type, p.entry, 0, 7), p.entry); let lo = 0, hi = 0; for (let s = 1; s <= 6; s++) { lo += spanSum(p, V.mutate(T, p.type, p.entry, 0.15, s)); hi += spanSum(p, V.mutate(T, p.type, p.entry, 1, s)); } assert.ok(hi > lo * 1.5, `${p.key}/${p.i}: strength 1 moved ${hi.toFixed(2)}, strength 0.15 moved ${lo.toFixed(2)}`); }
});
await check("bad strength, bad amount and mismatched engines are refused", () => {
  const p = hd[0]; for (const s of [-0.1, 1.1, NaN]) assert.throws(() => V.mutate(T, p.type, p.entry, s, 1), RangeError, `strength ${s}`);
  const [a, b] = sameEngPair("hd1"); for (const m of [-1, 101, NaN]) assert.throws(() => V.morph(T, "hd1", a.entry, b.entry, m), RangeError, `amount ${m}`);
  const other = ex.find((x) => eng(x) !== "Off+Off"); assert.throws(() => V.morph(T, "hd1", a.entry, other.entry, 50), undefined, "hd1 with exi");
  const e2 = ex.find((x) => eng(x) !== eng(other)); assert.throws(() => V.morph(T, "exi", other.entry, e2.entry, 50), undefined, "exi engines differ");
});
await check("morph 0 is the first program and 100 takes every editable value of the second, keeping the first's name", () => {
  for (const type of ["hd1", "exi"]) { const [a, b] = sameEngPair(type); assert.deepEqual(V.morph(T, type, a.entry, b.entry, 0), a.entry); const m = V.morph(T, type, a.entry, b.entry, 100); for (const r of rowsOf(a)) assert.equal(val(m, r), val(b.entry, r), `${r.group} / ${r.name}`); assert.deepEqual(m.slice(0, 24), a.entry.slice(0, 24)); assert.ok(a.entry.some((x, i) => x !== b.entry[i])); }
});
await check("morph blends numbers and switches choices at 50 percent", () => {
  let nums = 0, enums = 0;
  for (const type of ["hd1", "exi"]) {
    const [a, b] = sameEngPair(type), at = (n) => V.morph(T, type, a.entry, b.entry, n);
    for (const r of rowsOf(a)) {
      const x = val(a.entry, r), y = val(b.entry, r); if (r.rawMax - r.rawMin === 1) assert.equal(V.isEnumerated(r), true, `${r.name} is a switch`); if (x === y) continue;
      if (V.isEnumerated(r)) { enums++; assert.equal(val(at(49), r), x, `${r.name} at 49`); assert.equal(val(at(50), r), y, `${r.name} at 50`); }
      else { nums++; for (const [n, w] of [[25, 0.25], [50, 0.5], [75, 0.75]]) assert.ok(Math.abs(val(at(n), r) - (x + (y - x) * w)) <= 1, `${r.name} at ${n}: ${val(at(n), r)} from ${x} to ${y}`); }
    }
  }
  assert.ok(nums > 10 && enums > 0, `compared ${nums} numeric and ${enums} enumerated rows`);
});
await check("candidates are three different, repeatable mutations", () => {
  for (const p of samples) { const c = V.candidates(T, p.type, p.entry, 0.5, 99); assert.equal(c.length, 3); assert.deepEqual(c, V.candidates(T, p.type, p.entry, 0.5, 99)); assert.notDeepEqual(c[0], c[1]); assert.notDeepEqual(c[1], c[2]); assert.notDeepEqual(c[0], c[2]); for (const x of c) { assert.notDeepEqual(x, p.entry); assert.equal(x.length, p.entry.length); } assert.notDeepEqual(c, V.candidates(T, p.type, p.entry, 0.5, 100)); }
});
await testsAndTypes(g, ["core/params/variations.test.ts"]);
if (g.fails.length) await finish();

const SEED = 1234, STRENGTH = 40;
const target = progs.find((p) => p.key === "program:INT-A" && p.i === 0); assert.ok(target, "INT-A slot 0 missing");
const partner = progs.find((x) => x !== target && x.type === target.type && eng(x) === eng(target) && sha(x.entry) !== sha(target.entry));
const foreign = progs.find((x) => eng(x) !== eng(target));
assert.ok(partner && foreign, "no morph partner in the data");
const ui = await launch(g, C, { KRONOS_E2E_VARIATIONS_SEED: String(SEED) }), { X, seen, until, text, win } = ui;
const entryNow = async () => { const f = P.parsePcg(await ui.saved()); return { file: f, entry: new Uint8Array(L.getEntry(f, target.key, target.i)) }; };
const undoOff = async () => X("undo").isDisabled();
const state = () => text("variations-state");

await ui.openFile();
await ui.editSlot(target.key, target.i);
await check("the panel opens idle, with no pads before Generate and Keep/Discard off", async () => {
  await X("variations-open").click(); await seen("variations-panel"); assert.equal(await state(), "idle");
  for (const k of "ABC") assert.equal(await X(`variations-pad-${k}`).count(), 0);
  assert.equal(await X("variations-keep").isDisabled(), true); assert.equal(await X("variations-discard").isDisabled(), true); assert.equal(await X("variations-strength").inputValue(), "30");
});
await check("Generate shows A, B and C; choosing a pad applies exactly that seeded candidate, switching replaces it", async () => {
  await X("variations-strength").fill(String(STRENGTH)); await X("variations-generate").click(); for (const k of "ABC") await seen(`variations-pad-${k}`);
  const want = V.candidates(T, target.type, target.entry, STRENGTH / 100, SEED);
  await X("variations-pad-B").click(); await until(async () => (await state()) === "preview", "preview state");
  assert.deepEqual((await entryNow()).entry, want[1]); assert.equal(await X("variations-pad-B").getAttribute("data-selected"), "1"); assert.equal(await X("variations-pad-A").getAttribute("data-selected"), "0");
  await X("variations-pad-C").click(); await until(async () => (await X("variations-pad-C").getAttribute("data-selected")) === "1", "C selected");
  assert.deepEqual((await entryNow()).entry, want[2], "C must be applied to the original, not on top of B");
  assert.equal(await undoOff(), true, "a preview must not be an undo step yet");
});
await check("Discard restores the original file byte for byte", async () => {
  await X("variations-discard").click(); await until(async () => (await state()) === "idle", "idle");
  assert.equal(sha(await ui.saved()), sha(raw)); assert.equal(await undoOff(), true); assert.equal(await X("variations-keep").isDisabled(), true);
});
await check("Keep makes the second generation's candidate permanent as one undo step", async () => {
  await X("variations-generate").click(); const want = V.candidates(T, target.type, target.entry, STRENGTH / 100, SEED + 1);
  await X("variations-pad-A").click(); await until(async () => (await state()) === "preview", "preview"); await X("variations-keep").click(); await until(async () => (await state()) === "kept", "kept");
  const { file, entry } = await entryNow(); assert.deepEqual(entry, want[0]); assert.equal(L.getName(file, target.key, target.i), L.getName(f0, target.key, target.i), "name changed");
  assert.deepEqual(new Uint8Array(L.getEntry(file, target.key, target.i + 1)), new Uint8Array(L.getEntry(f0, target.key, target.i + 1)), "the neighbouring program changed");
  assert.equal(await undoOff(), false); await X("undo").click();
  await until(async () => sha(await ui.saved()) === sha(raw), "one undo restores everything"); assert.equal(await undoOff(), true, "Keep was more than one undo step");
});
await check("Morph lists only same-engine programs and applies the blend of original and partner", async () => {
  const opts = await win.locator('[data-testid="variations-morph-with"] option').evaluateAll((o) => o.map((x) => x.value));
  const pv = `${partner.key}|${partner.i}`, fv = `${foreign.key}|${foreign.i}`;
  assert.ok(opts.includes(pv), `partner ${pv} not listed`); assert.ok(!opts.includes(fv), `${fv} has another engine and must not be listed`); assert.ok(!opts.includes(`${target.key}|${target.i}`), "the program itself is listed");
  for (const o of opts.slice(0, 40)) { const [k, i] = o.split("|"), q = progs.find((x) => x.key === k && x.i === Number(i)); assert.ok(q && q.type === target.type && eng(q) === eng(target), `${o} is another engine`); }
  await X("variations-morph-with").selectOption(pv); await X("variations-morph-amount").fill("50"); await until(async () => (await state()) === "preview", "morph preview");
  assert.deepEqual((await entryNow()).entry, V.morph(T, target.type, target.entry, partner.entry, 50));
  await X("variations-morph-amount").fill("100");
  await until(async () => sha((await entryNow()).entry) === sha(V.morph(T, target.type, target.entry, partner.entry, 100)), "100 percent applied");
  await X("variations-discard").click(); await until(async () => (await state()) === "idle", "idle"); assert.equal(sha(await ui.saved()), sha(raw));
});
await ui.noErrors();
await finish();
