// Acceptance gate for the File Overview dashboard. Owned by the architect: builders must not edit it.
//
// PURE EXPORTS of src/core/pcg/overview.ts (no DOM, no node imports; Sound, Kind from catalog.ts; PcgFile from pcg.ts; ParamTables = the gen-params tables, as buildCatalog takes):
//   type SlotRef = { key: string; index: number }
//   type Overview = {
//     banks:      { program: number; combi: number; drumkit: number; waveseq: number; setlist: number }   number of banks of each kind (listBanks)
//     slots:      { program: number; combi: number; drumkit: number; waveseq: number; setlist: number }   sum of bank counts per kind
//     engines:    { hd1: number; exi: number }        Program SLOTS by engine (bank type "hd1" / "exi"); combis are not counted
//     categories: { program: number[]; combi: number[] }   each exactly 18 numbers, index = the Category row value (0..17), from buildCatalog
//     edited:     number    distinct slots in the `edited` argument, by key+index; entries with key "global" or index < 0 are ignored
//     empty:      number    Program and Combi slots whose name matches /^(init|empty)\b/i
//     setLists:   { index: number; name: string }[]   every set list slot whose name does NOT match /^(init|empty)\b/i, in index order
//   }
//   buildOverview(f: PcgFile, tables: ParamTables, edited?: SlotRef[]): Overview      edited defaults to []
//   soundsInCategory(f: PcgFile, tables: ParamTables, kind: "program" | "combi", category: number): Sound[]    catalog order; [] for a category outside 0..17
//   Set list bank key is "setlist:SET" (library.ts getName/setName work on it); combi bank keys look like "combi:INT-A", program keys "program:INT-A" (the key listBanks gives).
//
// UI. Top bar (App.tsx) gets one button; the panel needs no connected keyboard and may stay open or close when a sound is clicked.
//   overview-open        top-bar button; absent or disabled while no file is open
//   overview-panel       the dashboard;  overview-close  closes it
//   overview-count-program | -combi | -drumkit | -waveseq | -setlist   text is exactly the SLOT total of that kind (digits only)
//   overview-engine-hd1 | overview-engine-exi    text is exactly the Program slot count for that engine (digits only)
//   overview-edited      text is exactly the number of edited slots (digits only), from the workspace's changes (Global change excluded), 0 right after opening a file
//   overview-empty       text is exactly the Init-style/empty slot count (digits only), same rule as the pure `empty`
//   overview-kind-program | overview-kind-combi    buttons choosing which chart is drawn (Program chart is the default)
//   overview-bars        the inline <svg> chart (no dependency, no <canvas>); it contains exactly 18 bars
//   overview-bar-N       clickable bar for category N (0..17): attribute data-count = its count, aria-label = "<category name>: <count>" (name from categoryNames/categoryLabel); a click lists that category's sounds
//   overview-list-count  text is exactly the number of sounds listed after a bar click (digits only)
//   overview-sound-I     I-th listed sound (from 0, catalog order), text contains the sound name; a click opens its bank and selects that slot in the bank list
//                        (bank-<key> gets aria-current="true", row-<index> gets aria-selected="true")
//   overview-setlist-I   I-th listed Set List (from 0, same order as `setLists`), text contains its name
// Test-only env vars: none beyond what launch() sets (KRONOS_E2E, KRONOS_E2E_OPEN, ...). Nothing in this feature may write to the keyboard.
import assert from "node:assert/strict";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("OVERVIEW"), { check, finish } = g, C = await core(g);
let O; try { O = await load("src/core/pcg/overview.ts"); } catch (e) { g.fails.push(`cannot load overview.ts: ${e.message}`); await finish(); }
const CAT = await load("src/core/pcg/catalog.ts"), { L, T } = C, sum = (a) => a.reduce((x, y) => x + y, 0);
const PROG = [315, 137, 95, 82, 69, 83, 85, 119, 181, 126, 198, 147, 259, 91, 67, 122, 0, 0], COMBI = [137, 19, 28, 51, 48, 53, 24, 40, 71, 29, 29, 109, 74, 18, 25, 13, 0, 0];
const KINDS = ["program", "combi", "drumkit", "waveseq", "setlist"];
const bankKey = (kind, label) => L.listBanks(C.parsed()).find((b) => b.kind === kind && b.label === label).key;

await check("factory counts by bank type and engine are real", () => {
  const o = O.buildOverview(C.parsed(), T);
  assert.deepEqual(o.slots, { program: 2176, combi: 768, drumkit: 88, waveseq: 214, setlist: 128 });
  assert.deepEqual(o.banks, Object.fromEntries(KINDS.map((k) => [k, L.listBanks(C.parsed()).filter((b) => b.kind === k).length])));
  assert.equal(o.banks.program, 17); assert.deepEqual(o.engines, { hd1: 1152, exi: 1024 });
  assert.equal(o.edited, 0); assert.equal(o.empty, 0);
});
await check("category counts match the Category row of every sound", () => {
  const o = O.buildOverview(C.parsed(), T);
  assert.deepEqual(o.categories.program, PROG); assert.deepEqual(o.categories.combi, COMBI);
  assert.equal(sum(PROG), 2176); assert.equal(sum(COMBI), 768);
});
await check("a category lists exactly its sounds, in catalog order", () => {
  const f = C.parsed(), cat = CAT.buildCatalog(f, T);
  for (const [kind, n] of [["program", 12], ["combi", 11], ["program", 16]]) {
    const got = O.soundsInCategory(f, T, kind, n), want = cat.filter((s) => s.kind === kind && s.category === n);
    assert.equal(got.length, (kind === "program" ? PROG : COMBI)[n]); assert.deepEqual(got.map((s) => [s.key, s.index, s.name]), want.map((s) => [s.key, s.index, s.name]));
  }
  for (const bad of [-1, 18, 99, 1.5]) assert.deepEqual(O.soundsInCategory(f, T, "program", bad), [], String(bad));
});
await check("edited, empty and Set Lists react to the data and tolerate odd input", () => {
  const f = C.parsed(), pk = bankKey("program", "INT-A"), pk2 = bankKey("program", "INT-B"), ck = bankKey("combi", "INT-A"), sk = bankKey("setlist", "SET");
  L.setName(f, pk, 0, "Init Program"); L.setName(f, pk2, 5, "Empty"); L.setName(f, pk, 1, "Initial D"); L.setName(f, ck, 3, "init combi"); L.setName(f, sk, 0, "Init");
  const o = O.buildOverview(f, T, [{ key: pk, index: 0 }, { key: pk, index: 0 }, { key: pk2, index: 5 }, { key: "global", index: -1 }, { key: pk, index: -1 }]);
  assert.equal(o.empty, 3, "Initial D is not Init-style"); assert.equal(o.edited, 2); assert.equal(o.setLists.length, 127);
  assert.equal(o.setLists[0].index, 1); assert.equal(o.setLists[0].name, L.getName(f, sk, 1));
  assert.equal(O.buildOverview(C.parsed(), T, []).setLists.length, 128); assert.equal(O.buildOverview(C.parsed(), T).setLists[0].name, "Preload Set List K3");
});
await check("the 30 MB factory file is summarised in under 500 ms", () => {
  const f = C.parsed(); O.buildOverview(f, T); const ms = [];
  for (let i = 0; i < 3; i++) { const t = performance.now(); O.buildOverview(f, T); ms.push(performance.now() - t); }
  const best = Math.min(...ms); assert.ok(best < 500, `best of 3 took ${best.toFixed(0)} ms`); return `${best.toFixed(0)} ms`;
});
await testsAndTypes(g, ["core/pcg/overview.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { X, seen, text, until, win } = ui;
const cat = CAT.buildCatalog(C.parsed(), T), cats = CAT.categoryNames(C.parsed(), T, "program");
const log = () => win.evaluate(() => window.__kronosE2E.midiLog().length);
await check("the Overview button is not usable before a file is open", async () => { const n = await X("overview-open").count(); assert.ok(n === 0 || (await X("overview-open").isDisabled())); });
await ui.openFile(); await ui.connectSim(); const sent0 = await log();
await check("the dashboard shows the real counts", async () => {
  await X("overview-open").click(); await seen("overview-panel");
  for (const [k, n] of [["program", 2176], ["combi", 768], ["drumkit", 88], ["waveseq", 214], ["setlist", 128]]) assert.equal(await text(`overview-count-${k}`), String(n), k);
  assert.equal(await text("overview-engine-hd1"), "1152"); assert.equal(await text("overview-engine-exi"), "1024"); assert.equal(await text("overview-edited"), "0"); assert.equal(await text("overview-empty"), "0");
  await seen("overview-setlist-0"); assert.match(await text("overview-setlist-0"), /Preload Set List K3/); assert.equal(await win.locator('[data-testid^="overview-setlist-"]').count(), 128);
});
await check("the chart is an inline SVG with one bar per category and the true heights", async () => {
  assert.equal(await X("overview-bars").evaluate((e) => e.tagName.toLowerCase()), "svg"); assert.equal(await win.locator('[data-testid="overview-bars"] canvas').count(), 0);
  assert.equal(await win.locator('[data-testid^="overview-bar-"]').count(), 18);
  for (const n of [0, 12, 16]) assert.equal(await X(`overview-bar-${n}`).getAttribute("data-count"), String(PROG[n]), `bar ${n}`);
  assert.equal(await X("overview-bar-12").getAttribute("aria-label"), `${cats[12]}: 259`);
  await X("overview-kind-combi").click(); await until(async () => (await X("overview-bar-11").getAttribute("data-count")) === "109", "combi chart");
  await X("overview-kind-program").click(); await until(async () => (await X("overview-bar-11").getAttribute("data-count")) === "147", "program chart again");
});
await check("clicking a bar lists those sounds; an empty category lists none", async () => {
  await X("overview-bar-12").click(); await until(async () => (await text("overview-list-count")) === "259", "259 listed");
  const want = cat.filter((s) => s.kind === "program" && s.category === 12); assert.ok((await text("overview-sound-0")).includes(want[0].name));
  assert.equal(await win.locator('[data-testid^="overview-sound-"]').count(), 259);
  await X("overview-bar-16").click(); await until(async () => (await text("overview-list-count")) === "0", "none listed"); assert.equal(await win.locator('[data-testid^="overview-sound-"]').count(), 0);
});
await check("clicking a sound selects it in its bank", async () => {
  await X("overview-bar-12").click(); await until(async () => (await text("overview-list-count")) === "259", "listed");
  const want = cat.filter((s) => s.kind === "program" && s.category === 12), s = want[200]; await seen("overview-sound-200"); await X("overview-sound-200").click();
  await until(async () => (await X(`bank-${s.key}`).getAttribute("aria-current")) === "true", `bank ${s.key} open`);
  await until(async () => (await X(`row-${s.index}`).getAttribute("aria-selected")) === "true", `row ${s.index} selected`); assert.equal(await text(`row-name-${s.index}`), s.name);
});
await check("edited and Init-style counts follow a rename", async () => {
  if (await X("overview-panel").isVisible()) { await X("overview-close").click(); await X("overview-panel").waitFor({ state: "hidden", timeout: 10000 }); }
  await ui.openBank("combi:INT-A"); await X("row-3").dblclick(); await X("rename-input").fill("Init Lead"); await X("rename-input").press("Enter"); await until(async () => (await text("row-name-3")) === "Init Lead", "renamed");
  await X("overview-open").click(); await seen("overview-panel"); await until(async () => (await text("overview-edited")) === "1", "edited 1");
  assert.equal(await text("overview-empty"), "1");
});
await check("opening the dashboard and clicking in it never wrote to the keyboard", async () => { assert.equal(await log(), sent0); });
await ui.noErrors();
await finish();
