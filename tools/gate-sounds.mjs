// Acceptance gate for the Sound Browser. Owned by the architect: builders must not edit it.
//
// CONTRACT (implement to exactly this)
//
// Pure module src/core/pcg/catalog.ts. Imports use .ts extensions. Exports:
//   type Engine = "HD-1" | "EXi"
//   type Kind = "program" | "combi"
//   type Sound = { order: number; key: string; index: number; bank: string; kind: Kind; engine: Engine | null; name: string; category: number }
//       key = BankInfo.key (e.g. "program:INT-A"), bank = BankInfo.label (e.g. "INT-A"), engine is null for combis,
//       category = the 5-bit "Category" row (programHd1 / programExiCommon / combi tables) read with readParam, order = position in the list.
//   type Meta = { favorite?: true; tags?: string[]; note?: string }
//   type LibraryData = { version: 1; sounds: Record<string, Meta> }
//   type Filter = { kind?: Kind; engine?: Engine; category?: number; favoritesOnly?: boolean; tag?: string; text?: string }
//   buildCatalog(f: PcgFile, tables: ParamTables): Sound[]                 programs and combis only, bank order of listBanks then slot order
//   categoryNames(f: PcgFile, tables: ParamTables, kind: Kind): string[]   18 entries read from the Global block ("Program Category NN" / "Combi Category NN",
//                                                                            first 24 characters of the group, trimmed); "" where the file has no Global or the name is blank
//   categoryLabel(names: string[], n: number): string                       the name when names[n] is non-empty, otherwise String(n)
//   soundKey(s: { name: string; engine: Engine | null }): string            `${name}|${engine ?? "Combi"}`  (no bank or slot in it)
//   filterSounds(list: Sound[], f: Filter, lib: LibraryData): Sound[]       all given criteria must hold; text = case-insensitive substring of name, any tag or the note; tag = exact tag;
//                                                                            favoritesOnly uses lib; order preserved
//   sortSounds(list: Sound[], by: "name" | "bank"): Sound[]                 new array; name = case-insensitive, ties by order; bank = by order
//   parseLibrary(text: string | null): { data: LibraryData; corrupt: boolean }
//                                                                            null (no file) -> empty, corrupt false; bad JSON or wrong shape -> empty, corrupt true.
//                                                                            Valid: version 1; sounds keys match /^[ -~]{1,24}\|(HD-1|EXi|Combi)$/; tags: at most 12 strings of 1..24 chars; note: string of at most 200 chars.
//   (empty library = { version: 1, sounds: {} })
//
// File and IPC. Library file = <folder>/library.json, JSON of LibraryData, entries with no favorite, tag or note are left out. Written atomically (temp file, then rename;
// nothing else may be left in the folder except library.json and library.json.bad). Corrupt file: renamed to library.json.bad, app starts empty.
//   window.kronos.soundLibraryLoad(): Promise<{ data: LibraryData; corrupt: boolean }>
//   window.kronos.soundLibrarySave(data: LibraryData): Promise<void>        validates with the same rules as parseLibrary; invalid data rejects and leaves the file as it was
// TEST-ONLY ENV (read only when KRONOS_E2E=1): KRONOS_E2E_SOUNDS_DIR = the folder that holds library.json (replaces ~/OpenKronos). The gate sets it.
//
// data-testid table (all inside the view unless noted)
//   sounds-open            top-bar button; opens the Sound Browser, and closes it again when it is open (toggle)
//   sounds-view            root of the browser
//   sounds-count           number of rows matching the filters, text is just the integer
//   sounds-list            the scrolling container of the rows (virtualised: only the rows near the viewport exist in the DOM)
//   sounds-row-{n}         the n-th row of the CURRENT result (0-based, after filters and sort). Click selects the slot in the normal bank list; double-click opens the editor
//   sounds-rowname-{n}     text = sound name
//   sounds-rowbank-{n}     text = bank label, one space, slot number padded to 3 digits, e.g. "INT-B 005"
//   sounds-rowstar-{n}     button inside the row; toggles favorite; aria-pressed "true"/"false"; must not select or open the row
//   sounds-filter-kind     <select> values all | program | combi
//   sounds-filter-engine   <select> values all | HD-1 | EXi
//   sounds-filter-category <select> values all | 0..17; option text = categoryLabel(names of the kind, n) (with kind all, program names are used)
//   sounds-filter-fav      checkbox, favorites only
//   sounds-filter-tag      <select> values all | each tag in use
//   sounds-search          text input
//   sounds-sort            <select> values name | bank (default bank)
//   sounds-detail          panel for the sound last clicked in the browser; shows sounds-detail-name (the sound name)
//   sounds-tag-input       text input; Enter or sounds-tag-add adds the tag to the sound in the detail panel
//   sounds-tag-add         button
//   sounds-tag-{tag}       a tag chip (text contains the tag);   sounds-tag-del-{tag} removes it
//   sounds-note            textarea for the note;   sounds-note-save  button that stores it
//   sounds-corrupt-notice  shown when the library file was corrupt (text mentions library.json.bad)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate, core, launch, load, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("SOUNDS"), { check, finish } = g, C = await core(g);
let K; try { K = await load("src/core/pcg/catalog.ts"); } catch (e) { g.fails.push(`cannot load catalog.ts: ${e.message}`); await finish(); }

const f0 = C.parsed(), list = K.buildCatalog(f0, C.T), EMPTY = { version: 1, sounds: {} };
const count = (fn) => list.filter(fn).length;
const uniq = (s) => count((x) => K.soundKey(x) === K.soundKey(s)) === 1;
const sound = (fn) => { const s = list.find((x) => uniq(x) && fn(x)); assert.ok(s, "no suitable sound in the factory file"); return s; };

await check("the catalog lists every program and combi of the file", () => {
  assert.equal(list.length, 2944); assert.equal(count((s) => s.kind === "program"), 2176); assert.equal(count((s) => s.kind === "combi"), 768);
  assert.equal(count((s) => s.engine === "HD-1"), 1152); assert.equal(count((s) => s.engine === "EXi"), 1024); assert.ok(list.filter((s) => s.kind === "combi").every((s) => s.engine === null));
  assert.deepEqual(list.slice(0, 2).map((s) => [s.key, s.index, s.bank, s.name, s.engine, s.order]), [["program:INT-A", 0, "INT-A", "KRONOS German Grand", "EXi", 0], ["program:INT-A", 1, "INT-A", "German Dark Grand", "EXi", 1]]);
  const labels = new Map(C.L.listBanks(f0).map((b) => [b.key, b.label]));
  for (const s of list) { assert.equal(s.name, C.L.getName(f0, s.key, s.index)); assert.equal(s.bank, labels.get(s.key)); }
  assert.deepEqual(list.map((s) => s.order), list.map((_, i) => i));
});
await check("the Category is read through the parameter tables", () => {
  const row = (t) => t.find((r) => r.name === "Category");
  for (const s of list) { const e = C.L.getEntry(f0, s.key, s.index), r = s.kind === "combi" ? row(C.T.combi) : s.engine === "HD-1" ? row(C.T.programHd1) : row(C.T.programExiCommon); assert.equal(s.category, C.Q.readParam(e, r), `${s.key} ${s.index}`); }
  assert.ok(new Set(list.map((s) => s.category)).size > 8, "factory sounds should spread over many categories");
});
await check("category names come from the Global block, else the number", () => {
  const p = K.categoryNames(f0, C.T, "program"), c = K.categoryNames(f0, C.T, "combi");
  assert.equal(p.length, 18); assert.equal(c.length, 18); assert.deepEqual(p.slice(0, 4), ["Keyboard", "Organ", "Bell/Mallet", "Strings"]); assert.deepEqual(c.slice(3, 6), ["Strings", "Brass/Reed", "Orchestral"]);
  assert.equal(K.categoryLabel(p, 1), "Organ"); assert.equal(K.categoryLabel(["", "x"], 0), "0"); assert.equal(K.categoryLabel([], 7), "7");
});
await check("filters combine, and search covers name, tags and note", () => {
  const a = sound((s) => s.engine === "HD-1"), b = sound((s) => s.kind === "combi" && s.category === 1), kA = K.soundKey(a), kB = K.soundKey(b);
  const lib = { version: 1, sounds: { [kA]: { favorite: true, tags: ["warm", "pad"] }, [kB]: { tags: ["warm"], note: "Church Wedding" } } };
  const ids = (r) => r.map((s) => s.order);
  assert.equal(K.filterSounds(list, {}, lib).length, 2944); assert.deepEqual(ids(K.filterSounds(list, { favoritesOnly: true }, lib)), [a.order]);
  assert.deepEqual(ids(K.filterSounds(list, { tag: "warm" }, lib)), [a.order, b.order].sort((x, y) => x - y)); assert.deepEqual(ids(K.filterSounds(list, { tag: "war" }, lib)), []);
  assert.deepEqual(ids(K.filterSounds(list, { tag: "warm", kind: "combi" }, lib)), [b.order]); assert.deepEqual(ids(K.filterSounds(list, { text: "church wed" }, lib)), [b.order]); assert.ok(K.filterSounds(list, { text: a.name.toUpperCase() }, lib).some((s) => s.order === a.order));
  assert.equal(K.filterSounds(list, { kind: "combi" }, lib).length, 768); assert.equal(K.filterSounds(list, { engine: "EXi" }, lib).length, 1024); assert.equal(K.filterSounds(list, { kind: "combi", engine: "EXi" }, lib).length, 0);
  assert.equal(K.filterSounds(list, { category: 1 }, lib).length, count((s) => s.category === 1)); assert.equal(K.filterSounds(list, { kind: "program", engine: "HD-1", category: 1 }, lib).length, count((s) => s.kind === "program" && s.engine === "HD-1" && s.category === 1));
  assert.deepEqual(K.filterSounds([], { text: "x" }, lib), []);
});
await check("sorting by name ignores case; by bank restores slot order; input is untouched", () => {
  const mixed = [{ order: 0, name: "banjo" }, { order: 1, name: "Apple" }, { order: 2, name: "apple" }, { order: 3, name: "Cello" }];
  assert.deepEqual(K.sortSounds(mixed, "name").map((s) => s.order), [1, 2, 0, 3]); assert.deepEqual(K.sortSounds(K.sortSounds(mixed, "name"), "bank").map((s) => s.order), [0, 1, 2, 3]); assert.deepEqual(mixed.map((s) => s.order), [0, 1, 2, 3]);
  const n = K.sortSounds(list, "name").map((s) => s.name.toLowerCase()); for (let i = 1; i < n.length; i++) assert.ok(n[i - 1] <= n[i], `${n[i - 1]} > ${n[i]}`);
});
await check("a favorite's key survives moving the sound; the library reader rejects bad data", () => {
  const f = C.parsed(), s = list.find((x) => x.key === "program:INT-B" && x.index === 3), before = K.soundKey(s);
  C.L.copyEntry(f, "program:INT-B", 3, "program:INT-C", 100); const moved = K.buildCatalog(f, C.T).find((x) => x.key === "program:INT-C" && x.index === 100);
  assert.equal(K.soundKey(moved), before); assert.equal(before, `${s.name}|HD-1`); assert.equal(K.soundKey({ name: "X", engine: null }), "X|Combi");
  assert.deepEqual(K.parseLibrary(null), { data: EMPTY, corrupt: false });
  const ok = { version: 1, sounds: { "Pad|HD-1": { favorite: true, tags: ["a"], note: "n" }, "Bell|Combi": { tags: [] } } }; assert.deepEqual(K.parseLibrary(JSON.stringify(ok)), { data: ok, corrupt: false });
  const bad = ["{not json", "", "[]", "null", '{"version":2,"sounds":{}}', '{"version":1}', '{"version":1,"sounds":{"NoEngine":{}}}', '{"version":1,"sounds":{"A|HD-1":{"tags":"x"}}}', JSON.stringify({ version: 1, sounds: { "A|HD-1": { tags: ["x".repeat(25)] } } }),
    JSON.stringify({ version: 1, sounds: { "A|HD-1": { tags: Array.from({ length: 13 }, (_, i) => `t${i}`) } } }), JSON.stringify({ version: 1, sounds: { "A|HD-1": { note: "n".repeat(201) } } }), JSON.stringify({ version: 1, sounds: { "A|HD-1": { favorite: "yes" } } })];
  for (const t of bad) assert.deepEqual(K.parseLibrary(t), { data: EMPTY, corrupt: true }, t.slice(0, 50));
});
await testsAndTypes(g, ["core/pcg/catalog.test.ts"]);
if (g.fails.length) await finish();

// ---- UI: the real app, its own library folder (KRONOS_E2E_SOUNDS_DIR), a simulated keyboard.
const DIR = mkdtempSync(path.join(os.tmpdir(), "kronos-sounds-")), LIB = path.join(DIR, "library.json"), BAD = `${LIB}.bad`, CORRUPT = "{not json,,";
writeFileSync(LIB, CORRUPT);
const ui = await launch(g, C, { KRONOS_E2E_SOUNDS_DIR: DIR }), { X, seen, text, until, win } = ui;
const disk = () => JSON.parse(readFileSync(LIB, "utf8")), n3 = (i) => String(i).padStart(3, "0");
const rows = () => win.locator('[data-testid^="sounds-row-"]').count(), total = async () => Number(await text("sounds-count")), midiLog = () => win.evaluate(() => window.__kronosE2E.midiLog());
const open = async () => { if (!(await X("sounds-view").isVisible())) await X("sounds-open").click(); await seen("sounds-view"); };
const close = async () => { if (await X("sounds-view").isVisible()) await X("sounds-open").click(); await X("sounds-view").waitFor({ state: "hidden", timeout: 10000 }); };
const reset = async () => { await X("sounds-filter-kind").selectOption("all"); await X("sounds-filter-engine").selectOption("all"); await X("sounds-filter-category").selectOption("all"); await X("sounds-filter-tag").selectOption("all"); await X("sounds-sort").selectOption("bank"); await X("sounds-search").fill(""); if (await X("sounds-filter-fav").isChecked()) await X("sounds-filter-fav").uncheck(); };
const settle = (n, what) => until(async () => (await total()) === n, `${what}: ${n} rows`);
const rowOf = async (s) => { await reset(); await X("sounds-search").fill(s.name); await settle(K.filterSounds(list, { text: s.name }, EMPTY).length, `search ${s.name}`); const n = await rows(); for (let i = 0; i < n; i++) if ((await text(`sounds-rowbank-${i}`)) === `${s.bank} ${n3(s.index)}`) return i; throw new Error(`row for ${s.name} not found`); };

const A = sound((s) => s.kind === "program" && s.engine === "HD-1" && s.index < 5), B = sound((s) => s.kind === "combi" && s.index < 5), kA = K.soundKey(A);
await ui.openFile();
await check("the browser opens, starts empty after a corrupt library, and keeps the bad file", async () => {
  await X("sounds-open").click(); await seen("sounds-view"); await settle(2944, "all sounds"); await seen("sounds-corrupt-notice"); assert.match(await text("sounds-corrupt-notice"), /library\.json\.bad/);
  assert.equal(readFileSync(BAD, "utf8"), CORRUPT); await X("sounds-filter-fav").check(); await settle(0, "no favorites"); await X("sounds-filter-fav").uncheck(); await settle(2944, "all again");
});
await check("rows are virtualised and the whole list can be scrolled to the end", async () => {
  const n = await rows(); assert.ok(n > 0 && n < 150, `${n} rows in the DOM for 2944 sounds`); assert.equal(await text("sounds-rowname-0"), "KRONOS German Grand"); assert.equal(await text("sounds-rowbank-0"), "INT-A 000");
  await X("sounds-list").evaluate((e) => { e.scrollTop = e.scrollHeight; }); await seen("sounds-row-2943"); assert.equal(await text("sounds-rowname-2943"), list[2943].name); assert.equal(await text("sounds-rowbank-2943"), `${list[2943].bank} ${n3(list[2943].index)}`);
  assert.ok((await rows()) < 150); await X("sounds-list").evaluate((e) => { e.scrollTop = 0; }); await seen("sounds-row-0");
});
await check("kind, engine, category, search and sort give the same rows as the pure logic", async () => {
  await reset(); await X("sounds-filter-kind").selectOption("combi"); await settle(768, "combis"); await X("sounds-filter-kind").selectOption("program"); await X("sounds-filter-engine").selectOption("EXi"); await settle(1024, "EXi programs");
  await X("sounds-filter-engine").selectOption("HD-1"); await settle(1152, "HD-1 programs"); const want = count((s) => s.engine === "HD-1" && s.category === 1);
  assert.equal(await X("sounds-filter-category").locator("option", { hasText: "Organ" }).count(), 1); await X("sounds-filter-category").selectOption("1"); await settle(want, "HD-1 Organ"); await reset();
  await X("sounds-search").fill("grand"); await settle(K.filterSounds(list, { text: "grand" }, EMPTY).length, "search"); await X("sounds-sort").selectOption("name");
  const w = K.sortSounds(K.filterSounds(list, { text: "grand" }, EMPTY), "name"); for (const i of [0, 1, w.length - 1]) assert.equal(await text(`sounds-rowname-${i}`), w[i].name);
  await X("sounds-sort").selectOption("bank"); assert.equal(await text("sounds-rowname-0"), K.filterSounds(list, { text: "grand" }, EMPTY)[0].name);
});
await check("one click selects the slot in the bank list; double-click opens the editor", async () => {
  const i = await rowOf(A); await X(`sounds-row-${i}`).click(); await until(async () => (await text("sounds-detail-name")) === A.name, "detail shows the sound"); await close();
  await seen("row-name-0"); assert.equal(await X(`bank-${A.key}`).getAttribute("aria-current"), "true"); assert.equal(await X(`row-${A.index}`).getAttribute("aria-selected"), "true"); assert.equal(await text(`row-name-${A.index}`), A.name);
  await open(); const j = await rowOf(B); await X(`sounds-row-${j}`).dblclick(); await seen("editor-title"); assert.ok((await text("editor-title")).includes(B.name), await text("editor-title")); await ui.closeEditor(); await open();
});
await check("the star toggles a favorite, writes the library file, filters, and survives reopening", async () => {
  const i = await rowOf(A); assert.equal(await X(`sounds-rowstar-${i}`).getAttribute("aria-pressed"), "false"); await X(`sounds-rowstar-${i}`).click(); await until(async () => (await X(`sounds-rowstar-${i}`).getAttribute("aria-pressed")) === "true", "star on");
  await until(async () => existsSync(LIB) && JSON.parse(readFileSync(LIB, "utf8")).sounds?.[kA]?.favorite === true, "favorite on disk"); assert.deepEqual(disk(), { version: 1, sounds: { [kA]: { favorite: true } } });
  await reset(); await X("sounds-filter-fav").check(); await settle(1, "one favorite"); assert.equal(await text("sounds-rowname-0"), A.name); await close(); await open(); await X("sounds-filter-fav").check(); await settle(1, "still one favorite after reopening");
  assert.equal(await X("sounds-rowstar-0").getAttribute("aria-pressed"), "true"); await X("sounds-rowstar-0").click(); await settle(0, "favorite off"); await until(async () => !disk().sounds[kA], "entry removed from disk"); await reset();
});
await check("tags and a note are stored, listed in the tag filter, and searchable", async () => {
  const i = await rowOf(A); await X(`sounds-row-${i}`).click(); await seen("sounds-detail"); await X("sounds-tag-input").fill("warm"); await X("sounds-tag-input").press("Enter"); await X("sounds-tag-input").fill("pad"); await X("sounds-tag-add").click(); await seen("sounds-tag-pad");
  await X("sounds-note").fill("For the ballad"); await X("sounds-note-save").click(); await until(async () => disk().sounds?.[kA]?.note === "For the ballad", "note on disk"); assert.deepEqual(disk(), { version: 1, sounds: { [kA]: { tags: ["warm", "pad"], note: "For the ballad" } } });
  await reset(); await X("sounds-filter-tag").selectOption("warm"); await settle(1, "tag warm"); assert.equal(await text("sounds-rowname-0"), A.name); await reset(); await X("sounds-search").fill("for the ballad"); await settle(1, "note search");
  await X("sounds-row-0").click(); await seen("sounds-tag-warm"); await X("sounds-tag-del-warm").click(); await until(async () => JSON.stringify(disk().sounds[kA].tags) === '["pad"]', "tag removed on disk"); await X("sounds-search").fill("");
  assert.equal(await X("sounds-filter-tag").locator('option[value="warm"]').count(), 0, "unused tag leaves the filter");
});
await check("bad data sent over IPC is refused and the library file is left alone", async () => {
  const before = readFileSync(LIB, "utf8"), send = (d) => win.evaluate((x) => window.kronos.soundLibrarySave(x).then(() => "saved", () => "refused"), d);
  const bads = [null, "x", [], { version: 1 }, { version: 2, sounds: {} }, { version: 1, sounds: { "A|Nope": {} } }, { version: 1, sounds: { ["x".repeat(25) + "|HD-1"]: {} } }, { version: 1, sounds: { "A|HD-1": { tags: [1] } } }, { version: 1, sounds: { "A|HD-1": { note: "n".repeat(201) } } }, { version: 1, sounds: { "A|HD-1": { tags: Array.from({ length: 13 }, (_, k) => `t${k}`) } } }];
  for (const b of bads) assert.equal(await send(b), "refused", JSON.stringify(b)); assert.equal(readFileSync(LIB, "utf8"), before);
  const r = await win.evaluate(() => window.kronos.soundLibraryLoad()); assert.equal(r.corrupt, false); assert.deepEqual(r.data, JSON.parse(before));
  assert.equal(await send({ version: 1, sounds: { "Edge|Combi": { favorite: true } } }), "saved"); assert.deepEqual(disk().sounds["Edge|Combi"], { favorite: true });
  assert.deepEqual(readdirSync(DIR).sort(), ["library.json", "library.json.bad"], "no stray temp files");
});
await check("favorites never reach the .PCG or the keyboard", async () => {
  await close(); await ui.connectSim(); await open(); const i = await rowOf(B); await X(`sounds-rowstar-${i}`).click(); await until(async () => disk().sounds?.[K.soundKey(B)]?.favorite === true, "combi favorite on disk");
  await X(`sounds-row-${i}`).dblclick(); await seen("editor-title"); await ui.closeEditor(); assert.deepEqual(await midiLog(), [], "browsing and starring wrote to the keyboard");
  const bytes = await ui.saved(); assert.equal(sha(bytes), sha(C.raw), "the saved .PCG differs from the original");
});
await ui.noErrors();
try { rmSync(DIR, { recursive: true, force: true }); } catch {}
await finish();
