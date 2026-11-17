// Acceptance gate for the Set List pad-grid editor. Owned by the architect: builders must not edit it.
// No test-only env vars are needed beyond those launch() sets (KRONOS_E2E, _OPEN, _SAVE). It needs no keyboard except the simulator.
//
// PURE EXPORTS of src/core/pcg/setlist.ts (no node: imports; f is a PcgFile; setIndex is 0..127 into the Set List bank; slot is 0..127).
// Slot layout inside a Set List entry (SBK1): slot s starts at 24 + 542*s. +0..23 own name (NUL padded Latin-1); +24 type byte (low 2 bits: 0 Combi, 1 Program,
// other bits kept as they are); +25 bank column (low 5 bits, as refs.ts uses); +26 number; +27 Color 0..15; +28 Volume 0..127; +29 Transpose (signed byte, -12..12 must work);
// +30..541 comment, NUL terminated (at most 511 characters).
//   export const SLOTS = 128, PADS_PER_PAGE = 16, PAGES = 8
//   export type SetSlot = { slot: number; name: string; refName: string; kind: "program" | "combi" | "other"; key: string | null; number: number;
//                           volume: number; transpose: number; color: number; comment: string }
//     name = own name field when it is not empty, otherwise refName. refName = getName of the referenced sound, or "" when kind is "other" or the bank is not in the file.
//     key = "program:INT-A" style key (refs.ts programKey / "combi:INT-A") or null.
//   export function readSlot(f, setIndex, slot): SetSlot
//   export function slotAt(page, pad): number          page 0..7, pad 0..15 -> slot = page*16+pad (throws outside)
//   export function padOf(slot): { page: number; pad: number }
//   export function editSlot(f, setIndex, slot, patch: Partial<{ volume: number; transpose: number; color: number; comment: string }>): void
//     writes only those fields through setSetList (checksums updated); throws PcgError for non-integers or out of range values (volume 0..127, color 0..15, transpose -12..12 at least, comment > 511 chars).
//   export function assignSound(f, setIndex, slot, key: string, index: number): void
//     points the slot at a Program or Combi (type, bank, number; other bits kept) and sets the own name field to that sound's name (cut to 24); throws for keys that are not tracked
//     (not program/combi), banks not in the file, or an index outside the bank.
//   export function swapSlots(f, setIndex, a, b): void    swaps the two slots (and their SDB1 companion data) inside one Set List; throws outside 0..127.
//
// DATA-TESTIDS (all in the renderer):
//   setlists-open          button in the app that shows the editor (visible once a file with a Set List bank is open)
//   setlists-panel         the editor root; visible after setlists-open
//   setlists-set           select choosing which Set List (value = index "0".."127"); starts at "0"
//   setlists-page-0..7     buttons for pages 1..8; the active one has data-active="true"
//   setlists-pad-0..15     the 16 pads of the current page. Text contains the slot name and its comment (if any). Attributes: data-slot (0..127 absolute),
//                          data-color (0..15), data-selected="true" when selected. Draggable: dropping one on another swaps the two slots.
//   setlists-volume, setlists-transpose, setlists-color   inputs for the selected slot (value shows the number); a value is committed on blur or Enter;
//                          an invalid one is rejected: it shows setlists-error and nothing is written
//   setlists-comment       textarea for the selected slot comment (committed on blur)
//   setlists-error         visible text explaining a rejected value
//   setlists-pick          button opening the sound picker for the selected slot; setlists-pick-q filter input (case-insensitive substring of the name);
//                          setlists-pick-row-<i> rows (Programs and Combis of the open file) whose text contains the name; clicking a row assigns it and closes the picker
// Edits are normal undo steps (the app's existing "undo" button) and never write to the keyboard.
import assert from "node:assert/strict";
import { gate, core, launch, load, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("SETLISTS"), { check, finish } = g, C = await core(g), { L, P } = C;
let S, R;
try { S = await load("src/core/pcg/setlist.ts"); R = await load("src/core/pcg/refs.ts"); } catch (e) { g.fails.push(`cannot load setlist.ts: ${e.message}`); await finish(); }

const OFF = (s) => 24 + 542 * s, fresh = () => C.parsed(), E = (f, i = 0) => L.getSetList(f, i).entry;
const diffIdx = (a, b) => { const d = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i); return d; };
const sameOthers = (f, orig, set) => { for (const i of [0, 1, 2, 5, 127].filter((k) => k !== set)) assert.deepEqual(L.getSetList(f, i).entry, L.getSetList(orig, i).entry, `set list ${i} changed`); assert.deepEqual(L.getEntry(f, "program:INT-A", 3), L.getEntry(orig, "program:INT-A", 3)); };
const thrown = (fn, what) => assert.throws(fn, undefined, what);

await check("constants and pad/slot arithmetic", () => {
  assert.deepEqual([S.SLOTS, S.PADS_PER_PAGE, S.PAGES], [128, 16, 8]);
  assert.equal(S.slotAt(0, 0), 0); assert.equal(S.slotAt(1, 0), 16); assert.equal(S.slotAt(7, 15), 127); assert.deepEqual(S.padOf(37), { page: 2, pad: 5 }); assert.deepEqual(S.padOf(127), { page: 7, pad: 15 });
  for (const [p, q] of [[8, 0], [0, 16], [-1, 0], [0, -1]]) thrown(() => S.slotAt(p, q), `${p},${q}`);
});
await check("a real slot is read: name, sound, volume, colour, comment", () => {
  const f = fresh(), a = S.readSlot(f, 0, 0), raw = E(f), o = OFF(0);
  assert.equal(a.slot, 0); assert.equal(a.name, "SGX-2"); assert.equal(a.kind, "program"); assert.equal(a.key, R.programKey(raw[o + 25] & 31)); assert.equal(a.number, raw[o + 26]);
  assert.equal(a.refName, L.getName(f, a.key, a.number)); assert.equal(a.volume, 127); assert.equal(a.color, 6); assert.equal(a.transpose, 0); assert.match(a.comment, /^This is the 5th KORG SGX Grand Piano, highly acclaimed/);
  const b = S.readSlot(f, 0, 5); assert.equal(b.kind, "program"); assert.equal(b.key, "program:INT-A"); assert.equal(b.number, 34); assert.equal(b.volume, 120); assert.equal(b.refName, L.getName(f, "program:INT-A", 34));
});
await check("an empty slot reads as empty text, not garbage", () => { const s = S.readSlot(fresh(), 0, 127); assert.equal(s.comment, ""); assert.equal(s.name, s.refName); assert.ok(!/[\u0000-\u0008]/.test(s.name)); });
await check("editSlot changes only the chosen field's bytes and keeps checksums valid", () => {
  const f = fresh(), orig = fresh(), o = OFF(5);
  S.editSlot(f, 0, 5, { volume: 100 }); assert.deepEqual(diffIdx(E(f), E(orig)), [o + 28]); assert.equal(E(f)[o + 28], 100);
  S.editSlot(f, 0, 5, { color: 3, transpose: -7 }); assert.equal(E(f)[o + 27], 3); assert.equal(E(f)[o + 29], 249);
  const r = S.readSlot(f, 0, 5); assert.deepEqual([r.volume, r.color, r.transpose], [100, 3, -7]);
  S.editSlot(f, 0, 5, { transpose: 12 }); assert.equal(S.readSlot(f, 0, 5).transpose, 12);
  S.editSlot(f, 0, 5, { comment: "Hello" }); const e = E(f); assert.equal(Buffer.from(e.slice(o + 30, o + 35)).toString("latin1"), "Hello"); assert.ok(e.slice(o + 35, o + 542).every((x) => x === 0), "rest of comment not cleared");
  assert.equal(S.readSlot(f, 0, 5).comment, "Hello"); S.editSlot(f, 0, 6, { comment: "x".repeat(511) }); assert.equal(S.readSlot(f, 0, 6).comment.length, 511);
  assert.deepEqual(P.verifyChecksums(f), []); sameOthers(f, orig, 0);
});
await check("bad values are refused and leave the file untouched", () => {
  const f = fresh(), h = sha(f.bytes);
  for (const p of [{ volume: 128 }, { volume: -1 }, { volume: 1.5 }, { color: 16 }, { color: -1 }, { transpose: 100 }, { transpose: 0.5 }, { comment: "x".repeat(512) }, { volume: NaN }]) thrown(() => S.editSlot(f, 0, 5, p), JSON.stringify(p));
  thrown(() => S.editSlot(f, 0, 128, { volume: 1 }), "slot 128"); thrown(() => S.editSlot(f, 128, 0, { volume: 1 }), "set 128"); thrown(() => S.editSlot(f, 0, -1, { volume: 1 }), "slot -1"); assert.equal(sha(f.bytes), h);
});
await check("assignSound points a slot at a Program or Combi and names it", () => {
  const f = fresh(), orig = fresh(), o = OFF(2), t0 = E(orig)[o + 24], b0 = E(orig)[o + 25];
  S.assignSound(f, 0, 2, "program:INT-B", 5); let e = E(f), s = S.readSlot(f, 0, 2);
  assert.equal(e[o + 24] & 3, 1); assert.equal(e[o + 24] & ~3, t0 & ~3); assert.equal(e[o + 25] & 31, 1); assert.equal(e[o + 25] & ~31, b0 & ~31); assert.equal(e[o + 26], 5);
  assert.deepEqual([s.kind, s.key, s.number, s.name, s.refName], ["program", "program:INT-B", 5, L.getName(f, "program:INT-B", 5).slice(0, 24), L.getName(f, "program:INT-B", 5)]);
  S.assignSound(f, 0, 3, "combi:INT-C", 7); e = E(f); assert.equal(e[OFF(3) + 24] & 3, 0); assert.equal(e[OFF(3) + 25] & 31, 2); assert.equal(e[OFF(3) + 26], 7); assert.equal(S.readSlot(f, 0, 3).key, "combi:INT-C");
  assert.deepEqual(P.verifyChecksums(f), []); sameOthers(f, orig, 0);
  for (const [k, i, s2] of [["drumkit:INT", 0, 2], ["waveseq:INT", 0, 2], ["program:U-G", 0, 2], ["program:INT-A", 128, 2], ["program:INT-A", -1, 2], ["combi:INT-A", 200, 2], ["nope", 0, 2], ["program:INT-A", 0, 128]]) { const h = sha(f.bytes); thrown(() => S.assignSound(f, 0, s2, k, i), `${k} ${i}`); assert.equal(sha(f.bytes), h); }
});
await check("swapSlots swaps two slots only, and twice is the identity", () => {
  const f = fresh(), orig = fresh(), a = E(orig).slice(OFF(0), OFF(1)), b = E(orig).slice(OFF(20), OFF(21)); assert.notDeepEqual(a, b);
  S.swapSlots(f, 0, 0, 20); const e = E(f); assert.deepEqual(e.slice(OFF(0), OFF(1)), b); assert.deepEqual(e.slice(OFF(20), OFF(21)), a);
  assert.deepEqual(diffIdx(e, E(orig)).filter((i) => i < OFF(0) || (i >= OFF(1) && i < OFF(20)) || i >= OFF(21)), [], "bytes outside the two slots changed");
  assert.deepEqual(P.verifyChecksums(f), []); sameOthers(f, orig, 0);
  S.swapSlots(f, 0, 0, 20); assert.equal(sha(f.bytes), sha(orig.bytes)); const h = sha(f.bytes); thrown(() => S.swapSlots(f, 0, 0, 128), "128"); thrown(() => S.swapSlots(f, 0, -1, 2), "-1"); assert.equal(sha(f.bytes), h);
});
await testsAndTypes(g, ["core/pcg/setlist.test.ts"]);
if (g.fails.length) await finish();

const orig = fresh(), O0 = (s) => S.readSlot(orig, 0, s);
const ui = await launch(g, C), { X, seen, text, until, win, saved, drag, connectSim } = ui;
const pads = () => win.evaluate(() => [...document.querySelectorAll("[data-testid]")].filter((e) => /^setlists-pad-\d+$/.test(e.getAttribute("data-testid"))).length);
const slotNow = async (s, set = 0) => S.readSlot(P.parsePcg(await saved()), set, s);
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const undo = async () => { await X("undo").click(); await new Promise((r) => setTimeout(r, 200)); };
const nameOf = (s) => O0(s).name;

await ui.openFile();
await check("the editor opens with 16 pads showing real names, colours and comments", async () => {
  await seen("setlists-open"); await X("setlists-open").click(); await seen("setlists-panel"); await until(async () => (await pads()) === 16, "16 pads");
  assert.equal(await X("setlists-set").inputValue(), "0"); const p0 = X("setlists-pad-0"); assert.equal(await p0.getAttribute("data-slot"), "0"); assert.equal(await p0.getAttribute("data-color"), "6");
  assert.ok((await text("setlists-pad-0")).includes("SGX-2")); assert.ok((await text("setlists-pad-0")).includes("5th KORG SGX Grand Piano"));
  assert.ok((await text("setlists-pad-5")).includes(nameOf(5)));
});
await check("eight pages cover the 128 slots", async () => {
  for (const pg of [1, 7]) { await X(`setlists-page-${pg}`).click(); await until(async () => (await X("setlists-pad-0").getAttribute("data-slot")) === String(pg * 16), `page ${pg}`); assert.equal(await X("setlists-page-" + pg).getAttribute("data-active"), "true"); assert.equal(await pads(), 16); assert.ok((await text("setlists-pad-3")).includes(nameOf(pg * 16 + 3).slice(0, 24))); }
  assert.equal(await X("setlists-pad-15").getAttribute("data-slot"), "127"); await X("setlists-page-0").click(); await until(async () => (await X("setlists-pad-0").getAttribute("data-slot")) === "0", "back");
});
await check("clicking a pad selects it and shows its fields", async () => {
  await X("setlists-pad-5").click(); await until(async () => (await X("setlists-pad-5").getAttribute("data-selected")) === "true", "selected"); assert.notEqual(await X("setlists-pad-0").getAttribute("data-selected"), "true");
  assert.equal(await X("setlists-volume").inputValue(), "120"); assert.equal(await X("setlists-color").inputValue(), "6"); assert.equal(await X("setlists-transpose").inputValue(), "0"); assert.match(await X("setlists-comment").inputValue(), /^The EP-1 sound engine/);
});
await connectSim(); const sent0 = (await log()).length;
await check("volume, transpose, colour and comment edits reach the file, undo restores it exactly", async () => {
  await X("setlists-volume").fill("90"); await X("setlists-volume").press("Enter"); await X("setlists-transpose").fill("-5"); await X("setlists-transpose").press("Enter"); await X("setlists-color").fill("2"); await X("setlists-color").press("Enter");
  await X("setlists-comment").fill("Gate note"); await X("setlists-comment").blur();
  await until(async () => (await X("setlists-pad-5").getAttribute("data-color")) === "2", "pad colour"); await until(async () => (await text("setlists-pad-5")).includes("Gate note"), "pad comment");
  const s = await slotNow(5); assert.deepEqual([s.volume, s.transpose, s.color, s.comment], [90, -5, 2, "Gate note"]);
  for (let i = 0; i < 4; i++) await undo();
  const b = P.parsePcg(await saved()); assert.equal(sha(b.bytes), sha(C.raw), "undo did not restore every byte");
});
await check("an invalid value is rejected with a message and writes nothing", async () => {
  await X("setlists-volume").fill("300"); await X("setlists-volume").press("Enter"); await seen("setlists-error"); assert.ok((await text("setlists-error")).length > 3);
  const b = await saved(); assert.equal(sha(b), sha(C.raw));
});
await check("dragging a pad onto another swaps the two slots, undo swaps back", async () => {
  await X("setlists-page-0").click(); await X("setlists-pad-0").click();
  const b1 = await X("setlists-pad-1").boundingBox(), b0 = await X("setlists-pad-0").boundingBox(); await drag("setlists-pad-0", b1.x - b0.x, b1.y - b0.y);
  await until(async () => (await text("setlists-pad-0")).includes(nameOf(1)) && !(await text("setlists-pad-0")).includes("5th KORG"), "swapped on screen");
  const f = P.parsePcg(await saved()); assert.deepEqual(E(f).slice(OFF(0), OFF(1)), E(orig).slice(OFF(1), OFF(2))); assert.deepEqual(E(f).slice(OFF(1), OFF(2)), E(orig).slice(OFF(0), OFF(1))); assert.deepEqual(P.verifyChecksums(f), []);
  assert.deepEqual(E(f).slice(OFF(2)), E(orig).slice(OFF(2)), "slots after the pair changed"); await undo(); assert.equal(sha(P.parsePcg(await saved()).bytes), sha(C.raw));
});
await check("the picker assigns a sound chosen by name", async () => {
  const seenNames = new Map(); for (const b of L.listBanks(orig).filter((x) => x.kind === "program" || x.kind === "combi")) for (let i = 0; i < b.count; i++) { const n = L.getName(orig, b.key, i); seenNames.set(n, [...(seenNames.get(n) ?? []), [b.key, i]]); }
  const [name, [[key, idx]]] = [...seenNames.entries()].filter(([n, v]) => v.length === 1 && n.trim().length >= 6 && v[0][0] === "program:INT-D")[0];
  await X("setlists-pad-2").click(); await X("setlists-pick").click(); await seen("setlists-pick-q"); await X("setlists-pick-q").fill(name.toLowerCase());
  await seen("setlists-pick-row-0"); assert.ok((await text("setlists-pick-row-0")).includes(name.trim())); await X("setlists-pick-row-0").click(); await X("setlists-pick-q").waitFor({ state: "hidden", timeout: 10000 });
  const s = await slotNow(2); assert.deepEqual([s.key, s.number, s.refName], [key, idx, name]); assert.ok((await text("setlists-pad-2")).includes(name.slice(0, 24).trim())); await undo();
});
await check("no edit sent anything to the keyboard", async () => { const l = await log(); assert.equal(l.length, sent0, `${l.length - sent0} messages sent without a click on a write button`); });
await ui.noErrors();
await finish();
