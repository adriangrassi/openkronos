// Acceptance gate for auditioning sounds while browsing the bank list. Owned by the architect: builders must not edit it.
//
// PURE EXPORTS the builder must provide in src/core/midi/phrases.ts (PlayEvent = { ms: number; data: number[] }, from player.ts):
//   export type PhraseKind = "chord" | "arpeggio" | "bass" | "lead" | "drums";
//   export const PHRASE_KINDS: readonly PhraseKind[];                       // exactly the five, in that order
//   export function phrase(kind: PhraseKind, channel: number): PlayEvent[]; // channel 0..15; sorted by ms; every note-on has a later note-off; 1..8 s long
//   export function autoPhrase(name: string, category?: string): PhraseKind; // name hints win, then the category, else "chord"
//     hints (case-insensitive): bass->bass; drum|kit|perc->drums; lead|solo->lead; arp|seq->arpeggio; anything else->chord
//   Ranges: bass notes all < 55; lead notes all >= 60; drums notes 35..59; chord has >= 3 notes starting together; arpeggio has >= 4 notes with distinct starts.
//
// data-testid table (all in the bank list header):
//   audition-toggle  native checkbox "Audition". Disabled with no keyboard connected; checked only while connected and on. On by default.
//   audition-phrase  native <select> with option values none,auto,chord,arpeggio,bass,lead,drums (default none, label "no sample"). Always enabled.
// Existing ids used: row-N (list rows, focusable; ArrowUp/ArrowDown on a focused row move the selection), row-name-N, confirm-ok, confirm-cancel, connect-sim.
// Audition is on by default, so turning it on by hand never shows the confirm dialog.
// Window blur is detected through the DOM "blur" event on window. Test-only env vars: none beyond what launch() sets (KRONOS_E2E=1).
import assert from "node:assert/strict";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("AUDITION"), { check, finish } = g, C = await core(g);
let H; try { H = await load("src/core/midi/phrases.ts"); } catch (e) { g.fails.push(`cannot load phrases.ts: ${e.message}`); await finish(); }
const KINDS = ["chord", "arpeggio", "bass", "lead", "drums"];
const isOn = (m) => (m[0] & 0xf0) === 0x90 && m[2] > 0, isOff = (m) => (m[0] & 0xf0) === 0x80 || ((m[0] & 0xf0) === 0x90 && m[2] === 0);
const notes = (ev) => ev.filter((e) => isOn(e.data));

await check("the five phrase kinds are listed", () => assert.deepEqual([...H.PHRASE_KINDS], KINDS));
await check("every phrase is well formed and balanced", () => {
  for (const k of KINDS) {
    const ev = H.phrase(k, 0); assert.ok(notes(ev).length >= 3, k); assert.equal(notes(ev).length, ev.filter((e) => isOff(e.data)).length, `${k} notes left on`);
    assert.ok(ev.every((e, i) => !i || e.ms >= ev[i - 1].ms), `${k} unsorted`); assert.ok(ev.at(-1).ms >= 1000 && ev.at(-1).ms <= 8000, `${k} length ${ev.at(-1).ms}`);
    for (const e of ev) assert.ok(e.data.slice(1).every((b) => Number.isInteger(b) && b >= 0 && b < 128), k);
    for (const e of notes(ev)) assert.ok(e.data[2] <= 127);
    const open = new Set(); for (const e of ev) { if (isOn(e.data)) open.add(e.data[1]); else if (isOff(e.data)) assert.ok(open.delete(e.data[1]), `${k} off without on`); } assert.equal(open.size, 0, `${k} held`);
  }
});
await check("each phrase sits in its own range and shape", () => {
  assert.ok(notes(H.phrase("bass", 0)).every((e) => e.data[1] < 55)); assert.ok(notes(H.phrase("lead", 0)).every((e) => e.data[1] >= 60));
  assert.ok(notes(H.phrase("drums", 0)).every((e) => e.data[1] >= 35 && e.data[1] <= 59));
  const c = notes(H.phrase("chord", 0)); assert.ok(c.filter((e) => e.ms === c[0].ms).length >= 3, "chord should start together");
  const a = notes(H.phrase("arpeggio", 0)); assert.ok(a.length >= 4 && new Set(a.map((e) => e.ms)).size === a.length, "arpeggio notes should be one after another");
});
await check("phrases use the channel they are given", () => { for (const ch of [0, 3, 15]) for (const k of KINDS) assert.ok(H.phrase(k, ch).every((e) => (e.data[0] & 0x0f) === ch), `${k} ${ch}`); });
await check("Auto picks from the name, then the category", () => {
  for (const [n, c, want] of [["Fat Bass 1", undefined, "bass"], ["Studio DRUM Kit", undefined, "drums"], ["Saw Lead", undefined, "lead"], ["Arp Dream", undefined, "arpeggio"], ["Warm Pad", undefined, "chord"], ["Zzz", undefined, "chord"], ["", undefined, "chord"], ["Zzz", "Bass", "bass"], ["Zzz", "Drums/Percussion", "drums"], ["Fat Bass", "Lead", "bass"]]) assert.equal(H.autoPhrase(n, c), want, `${n}/${c}`);
});
await check("Auto gives a valid phrase for every factory name and finds the bass sounds", () => {
  const f = C.parsed(), got = new Set(); let basses = 0;
  for (const b of C.L.listBanks(f).filter((x) => x.key.startsWith("program:") || x.key.startsWith("combi:"))) for (let i = 0; i < b.count; i++) { const n = C.L.getName(f, b.key, i), k = H.autoPhrase(n); assert.ok(KINDS.includes(k), `${n} -> ${k}`); got.add(k); if (/\bbass\b/i.test(n)) { basses++; assert.equal(k, "bass", n); } }
  assert.ok(basses >= 5, `only ${basses} bass names`); assert.ok(got.size >= 3, `Auto only ever picked ${[...got]}`);
});
await testsAndTypes(g, ["core/midi/phrases.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { X, seen, text, until, win, openBank } = ui;
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const since = async (n) => (await log()).slice(n);
const has = (l, m) => l.some((x) => x.length === m.length && x.every((b, i) => b === m[i]));
const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const sel = (i) => win.locator(`[data-testid="row-${i}"]`).getAttribute("aria-selected");
const modeMsg = (l, kind) => l.filter((m) => m[0] === 0xf0 && m[3] === 0x68 && m[4] === 0x4e).map((m) => m[5]).includes(kind === "program" ? 2 : 0);
await ui.openFile(); await openBank("program:INT-B");
await check("Audition needs a keyboard, so it reads as off until one is connected", async () => { await seen("audition-toggle"); assert.equal(await X("audition-toggle").isDisabled(), true); assert.equal(await X("audition-toggle").isChecked(), false); });
await ui.connectSim();
await check("on by default, selecting calls the sound up but plays no sample", async () => {
  assert.equal(await X("audition-toggle").isDisabled(), false); assert.equal(await X("audition-toggle").isChecked(), true); assert.equal(await X("audition-phrase").inputValue(), "none");
  const n = (await log()).length; await X("row-6").click(); await until(async () => has(await since(n), [0xc0, 6]), "program change 6", 5000); await settle(500);
  assert.ok(!(await since(n)).some(isOn), "a sample played with no phrase chosen");
});
await check("turning it off by hand sends nothing on selection, and it asks nothing", async () => {
  await X("audition-toggle").click(); await settle(200); assert.equal(await win.getByTestId("confirm-ok").count(), 0); assert.equal(await X("audition-toggle").isChecked(), false);
  const n = (await log()).length; await X("row-7").click(); await settle(); assert.equal((await log()).length, n);
});
await check("a chosen phrase plays once Audition is turned back on, without asking", async () => {
  await X("audition-toggle").click(); await settle(200); assert.equal(await win.getByTestId("confirm-ok").count(), 0); assert.equal(await X("audition-toggle").isChecked(), true); await X("audition-phrase").selectOption("bass");
  const n = (await log()).length; await X("row-9").click(); await until(async () => has(await since(n), [0xc0, 9]), "program change", 5000); const l = await since(n);
  assert.ok(has(l, [0xb0, 0, 0]) && has(l, [0xb0, 32, 1]), "bank select for INT-B"); await until(async () => (await since(n)).some(isOn), "phrase notes", 8000);
  const all = await since(n); assert.ok(all.filter(isOn).every((m) => m[1] < 55), "bass phrase expected"); assert.ok(all.findIndex((m) => m[0] === 0xc0) < all.findIndex(isOn), "notes before the sound change");
});
await check("turning it off and on by hand never asks", async () => { await X("audition-toggle").click(); await settle(200); await X("audition-toggle").click(); await settle(300); assert.equal(await win.getByTestId("confirm-ok").count(), 0); assert.equal(await X("audition-toggle").isChecked(), true); });
await check("the last of several quick selections wins, and arrow keys move the selection", async () => {
  await X("audition-phrase").selectOption("chord"); await X("row-20").click(); await settle(700); const n = (await log()).length;
  await win.keyboard.press("ArrowDown"); await win.keyboard.press("ArrowDown"); await win.keyboard.press("ArrowDown");
  await until(async () => (await sel(23)) === "true", "selection moved to 23", 3000); await until(async () => has(await since(n), [0xc0, 23]), "program change 23", 5000); await settle(500);
  assert.deepEqual((await since(n)).filter((m) => m[0] === 0xc0).map((m) => m[1]), [23], "only the last selection should be sent");
  await win.keyboard.press("ArrowUp"); await until(async () => (await sel(22)) === "true", "ArrowUp moved to 22", 3000);
});
await check("a Mode Change is sent only when the mode differs", async () => {
  await X("row-30").click(); await settle(600); let n = (await log()).length; await X("row-31").click(); await until(async () => has(await since(n), [0xc0, 31]), "pc 31", 5000); assert.ok(!(await since(n)).some((m) => m[0] === 0xf0), "needless mode change");
  await openBank("combi:INT-A"); n = (await log()).length; await X("row-2").click(); await until(async () => has(await since(n), [0xc0, 2]), "combi pc", 5000); assert.ok(modeMsg(await since(n), "combi"), "no mode change to Combi");
  n = (await log()).length; await X("row-3").click(); await until(async () => has(await since(n), [0xc0, 3]), "pc 3", 5000); assert.ok(!(await since(n)).some((m) => m[0] === 0xf0), "needless mode change");
  await openBank("program:INT-A"); n = (await log()).length; await X("row-1").click(); await until(async () => has(await since(n), [0xc0, 1]), "pc back", 5000); assert.ok(modeMsg(await since(n), "program"), "no mode change back to Program");
});
await check("the previous notes stop before the next sound is called up", async () => {
  await X("audition-phrase").selectOption("chord"); await X("row-40").click(); await until(async () => (await log()).slice(-12).some(isOn), "chord playing", 8000); const n = (await log()).length;
  await X("row-41").click(); await until(async () => has(await since(n), [0xc0, 41]), "pc 41", 5000); const l = await since(n), stop = l.findIndex((m) => (m[0] & 0xf0) === 0xb0 && m[1] === 123 && m[2] === 0);
  assert.ok(stop >= 0 && stop < l.findIndex((m) => m[0] === 0xc0 && m[1] === 41), "All Notes Off must come before the program change");
});
await check("Lead and Auto phrases follow the choice and the sound's name", async () => {
  await X("audition-phrase").selectOption("lead"); let n = (await log()).length; await X("row-50").click(); await until(async () => (await since(n)).some(isOn), "lead notes", 8000); assert.ok((await since(n)).filter(isOn).every((m) => m[1] >= 60));
  await X("audition-phrase").selectOption("auto"); const name = await text("row-name-51"), want = H.autoPhrase(name); n = (await log()).length; await X("row-51").click(); await until(async () => (await since(n)).some(isOn), "auto notes", 8000);
  const ref = notes(H.phrase(want, 0)).map((e) => e.data[1]), got = (await since(n)).filter(isOn).map((m) => m[1]); assert.ok(got.length >= 3 && got.every((x) => ref.includes(x)), `Auto for "${name}" should play ${want}`);
});
await check("turning it off silences everything and stops reacting", async () => {
  await X("audition-phrase").selectOption("chord"); await X("row-60").click(); await until(async () => (await log()).slice(-12).some(isOn), "playing", 8000); const n = (await log()).length;
  await X("audition-toggle").click(); await until(async () => has(await since(n), [0xb0, 123, 0]), "all notes off", 3000); assert.equal((await since(n)).filter(isOn).length, 0); await settle(800); const m = (await log()).length;
  await X("row-61").click(); await settle(500); assert.equal((await log()).length, m, "still reacting while off");
});
await check("losing window focus silences it and no stray notes follow", async () => {
  await X("audition-toggle").click(); await settle(200); assert.equal(await X("audition-toggle").isChecked(), true); await X("audition-phrase").selectOption("chord"); await X("row-70").click(); await until(async () => (await log()).slice(-12).some(isOn), "playing", 8000);
  const n = (await log()).length; await win.evaluate(() => window.dispatchEvent(new Event("blur"))); await until(async () => has(await since(n), [0xb0, 123, 0]), "all notes off on blur", 3000); await settle(1500);
  assert.equal((await since(n)).filter(isOn).length, 0, "notes started after blur"); await X("audition-toggle").click();
});
await ui.noErrors();
await finish();
