// Acceptance gate for bank tools (batch rename, find duplicates, find empties, CSV/HTML export). Owned by the architect: builders must not edit it.
//
// PURE EXPORTS of src/core/pcg/banktools.ts (PcgFile comes from ./pcg.ts; slot indexes are 0-based):
//   type NameOptions = { find?: string; replace?: string; ignoreCase?: boolean; prefix?: string; suffix?: string;
//     numbering?: { start: number; pad: number; at: "prefix" | "suffix"; sep: string }; letterCase?: "keep" | "upper" | "lower" | "title" }
//   planRename(names: string[], o: NameOptions): { from: string; to: string; error: string | null }[]
//     Same length and order as `names`. Steps run in this order: find/replace (literal text, every occurrence, case-sensitive unless
//     ignoreCase, an empty find does nothing), letterCase, prefix, suffix, numbering (number = start + position, zero-padded to `pad`,
//     joined to the name by `sep`). `to` is always the computed string; `error` is non-null (a message) when setName would refuse it:
//     empty, over 24 characters, not printable ASCII, or trailing space. Nothing is truncated or trimmed silently.
//   applyRenames(file: PcgFile, key: string, changes: { index: number; name: string }[]): number
//     All or nothing: if any name or index is bad it throws and the file bytes stay as they were. Returns how many names actually changed.
//   findDuplicates(file: PcgFile): { kind: string; type: "exi" | "hd1" | null; slots: { key: string; index: number; name: string }[] }[]
//     Groups of 2+ slots with the same kind and engine type whose bytes are identical after the 24-byte name (names may differ).
//     Slots inside a group, and the groups, are in file order (bank order from listBanks, then index). Set lists and the global are skipped.
//   findEmpties(file: PcgFile): { key: string; index: number; name: string; reason: "name" | "data" }[]
//     reason "name": the name starts with the word Init (case-insensitive). reason "data": the name is something else but the bytes after the
//     name equal those of an Init-named slot of the same kind and engine type. File order. Set lists and the global are skipped.
//   toCsv(file: PcgFile, key: string | null): string      key null = the whole file. Header `bank,index,name`, one row per slot, rows end with \r\n,
//     RFC 4180 quoting (a field with a comma, quote or line break is wrapped in quotes, quotes doubled). Every bank of listBanks is included.
//   toHtml(file: PcgFile, key: string | null, title?: string): string   A complete document starting `<!doctype html`, with a table of the same rows
//     and a print style. Every name, bank key and the title are HTML-escaped (& < > " ' at least the first four).
//
// IPC (preload API): window.kronos.bankToolsExport(format: "csv" | "html", content: string): Promise<string | null>
//   The main process shows a save dialog (the renderer sends no path), writes the text, returns the file's base name, or null when cancelled.
//   It refuses (rejects) any format other than csv/html and any non-string content. Under KRONOS_E2E=1 the dialog is replaced by the
//   path in process.env.KRONOS_E2E_EXPORT, read at CALL time (the gate changes it between exports); no value means cancelled (null).
//   Test-only env var used here: KRONOS_E2E_EXPORT (set by the gate through app.evaluate after launch).
//
// data-testid table (everything is inside one panel; the sections are all visible at once, no tabs):
//   banktools-open            button in the slot list of an open bank: opens the panel; the slot rows stay clickable while it is open
//   banktools-panel           the panel itself;  banktools-close  closes it
//   banktools-scope-selected  radio: rename the selected slots;  banktools-scope-bank  radio: rename the whole open bank
//   banktools-find, banktools-replace, banktools-prefix, banktools-suffix   text inputs;  banktools-case  select with values keep|upper|lower|title
//   banktools-number          checkbox turning numbering on;  banktools-number-start, banktools-number-pad  number inputs;
//   banktools-number-at       select prefix|suffix;  banktools-number-sep  text input
//   banktools-preview-row-N   preview table row N (N counts from 0 in the table); its text contains the old name and the new name
//   banktools-preview-error-N the error message inside row N, only present when that row's new name is refused
//   banktools-apply           button: applies the preview; disabled when no row changes or any row has an error; one undo step
//   banktools-dup-scan        button: scans all banks;  banktools-dup-count  text is the number of groups found
//   banktools-dup-group-G     group G (from 0);  banktools-dup-item-G-I  button for slot I of group G: opens its bank and selects that slot
//   banktools-empty-scan      button: scans;  banktools-empty-count  text is the number of empty slots found
//   banktools-empty-item-N    button for the Nth empty slot: opens its bank and selects that slot
//   banktools-export-scope-bank  radio: export the open bank;  banktools-export-scope-file  radio: export the whole file
//   banktools-export-csv, banktools-export-html  buttons: export through the save dialog;  banktools-export-status  text naming the saved file
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("BANKTOOLS"), { check, finish } = g, C = await core(g);
let D; try { D = await load("src/core/pcg/banktools.ts"); } catch (e) { g.fails.push(`cannot load banktools.ts: ${e.message}`); await finish(); }
const { L, P } = C, bytesOf = (f) => P.serializePcg(f);
const ONE = (names, o) => D.planRename(names, o).map((r) => r.to);
const parseCsv = (s) => { const rows = []; let row = [], f = "", q = false; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\r") { /* skip */ } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else f += c; } if (f !== "" || row.length) { row.push(f); rows.push(row); } return rows; };
const editable = (f) => L.listBanks(f).filter((b) => b.kind !== "setlist");

await check("find and replace is literal, replaces every match, and can ignore case", () => {
  assert.deepEqual(ONE(["Brass Lead", "Piano"], { find: "Brass", replace: "Wind" }), ["Wind Lead", "Piano"]);
  assert.deepEqual(ONE(["a-a", "A.B.C"], { find: "a", replace: "b" }), ["b-b", "A.B.C"]);
  assert.deepEqual(ONE(["A.B.C"], { find: ".", replace: "_" }), ["A_B_C"]);
  assert.deepEqual(ONE(["BRASS brass"], { find: "brass", replace: "x", ignoreCase: true }), ["x x"]);
  assert.deepEqual(ONE(["abc"], { find: "", replace: "zzz" }), ["abc"]);
  assert.deepEqual(ONE(["brASS lEAD", "x"], { letterCase: "title" }), ["Brass Lead", "X"]);
  assert.deepEqual([ONE(["brASS lEAD"], { letterCase: "upper" })[0], ONE(["brASS lEAD"], { letterCase: "lower" })[0], ONE(["brASS lEAD"], { letterCase: "keep" })[0]], ["BRASS LEAD", "brass lead", "brASS lEAD"]);
});
await check("prefix, suffix, numbering and case combine in a fixed order", () => {
  assert.deepEqual(ONE(["Brass Lead", "Piano"], { prefix: "X ", suffix: " Y" }), ["X Brass Lead Y", "X Piano Y"]);
  assert.deepEqual(ONE(["Brass Lead", "Piano"], { numbering: { start: 1, pad: 3, at: "suffix", sep: " " } }), ["Brass Lead 001", "Piano 002"]);
  assert.deepEqual(ONE(["Brass Lead", "Piano"], { numbering: { start: 7, pad: 1, at: "prefix", sep: "-" } }), ["7-Brass Lead", "8-Piano"]);
  assert.deepEqual(ONE(["Brass Lead", "Piano"], { find: "Brass", replace: "wind", letterCase: "upper", prefix: "a-", numbering: { start: 9, pad: 2, at: "suffix", sep: "_" } }), ["a-WIND LEAD_09", "a-PIANO_10"]);
});
await check("a new name that setName would refuse is reported, never truncated", () => {
  const r = D.planRename(["x".repeat(20), "x".repeat(21), "ok", "abc"], { numbering: { start: 1, pad: 3, at: "suffix", sep: " " } });
  assert.deepEqual(r.map((x) => x.error === null), [true, false, true, true], "24 characters pass, 25 fail");
  assert.equal(r[1].to, `${"x".repeat(21)} 002`); assert.equal(typeof r[1].error, "string");
  assert.notEqual(D.planRename(["abc"], { prefix: "Café " })[0].error, null, "non-ASCII");
  assert.notEqual(D.planRename(["abc"], { suffix: " " })[0].error, null, "trailing space");
  assert.notEqual(D.planRename(["abc"], { find: "abc", replace: "" })[0].error, null, "empty name");
  assert.notEqual(D.planRename(["abc"], { suffix: "\t" })[0].error, null, "control character");
  assert.equal(D.planRename(["abc"], {})[0].error, null);
});
await check("applyRenames writes only names, keeps checksums valid, and fails as a whole", () => {
  const f = C.parsed(), key = "program:INT-A", before = bytesOf(f), snap = (i) => L.getEntry(f, key, i).slice(24), others = [0, 1, 2, 3].map(snap);
  assert.equal(D.applyRenames(f, key, [{ index: 0, name: "Alpha" }, { index: 1, name: L.getName(f, key, 1) }, { index: 2, name: "Gamma" }]), 2);
  assert.deepEqual([0, 1, 2].map((i) => L.getName(f, key, i)), ["Alpha", L.getName(C.parsed(), key, 1), "Gamma"]);
  assert.deepEqual(P.verifyChecksums(f), []); assert.deepEqual([0, 1, 2, 3].map(snap), others, "bytes after each name are untouched");
  const g2 = C.parsed(), b2 = bytesOf(g2);
  for (const bad of [[{ index: 0, name: "Fine" }, { index: 1, name: "x".repeat(25) }], [{ index: 0, name: "Fine" }, { index: 999, name: "Ok" }], [{ index: 0, name: "Fine" }, { index: 1, name: "bad " }]]) { assert.throws(() => D.applyRenames(g2, key, bad)); assert.deepEqual(bytesOf(g2), b2, "file unchanged after a refused batch"); }
  assert.notDeepEqual(bytesOf(f), before);
});
await check("duplicates are found across banks of one type, names ignored", () => {
  const groups = D.findDuplicates(C.parsed());
  assert.deepEqual(groups.map((x) => x.slots.length), [9, 2, 2, 2, 7]);
  assert.deepEqual(groups[0].slots.map((s) => `${s.key}#${s.index}`), [7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => `drumkit:U-C#${i}`)); assert.equal(groups[0].slots[0].name, "Init Drum Kit");
  assert.deepEqual(groups[1].slots.map((s) => `${s.key}#${s.index}:${s.name}`), ["waveseq:INT#63:Pulstronik Bass 1", "waveseq:INT#64:Pulstronik Bass 2"]);
  assert.deepEqual(groups[4].slots.map((s) => `${s.key}#${s.index}`), ["waveseq:INT#149", ...[26, 27, 28, 29, 30, 31].map((i) => `waveseq:U-F#${i}`)]);
  const f = C.parsed(); L.copyEntry(f, "program:INT-A", 0, "program:U-B", 5); L.setName(f, "program:U-B", 5, "Renamed Copy");
  const more = D.findDuplicates(f), mine = more.find((x) => x.slots.some((s) => s.key === "program:U-B" && s.index === 5));
  assert.ok(mine, "the copy is grouped with its original although the name differs"); assert.deepEqual(mine.slots.map((s) => `${s.key}#${s.index}`), ["program:INT-A#0", "program:U-B#5"]); assert.equal(mine.type, "exi");
  assert.equal(more.length, 6);
  const f2 = C.parsed(); L.setName(f2, "program:INT-B", 3, L.getName(f2, "program:INT-A", 0));
  assert.equal(D.findDuplicates(f2).length, 5, "the same name on different data is not a duplicate");
});
await check("empties are Init-style names or data equal to an initialised slot", () => {
  const e = D.findEmpties(C.parsed()), id = (x) => `${x.key}#${x.index}`;
  assert.deepEqual(e.map(id), [...[7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => `drumkit:U-C#${i}`), "waveseq:INT#149", ...[26, 27, 28, 29, 30, 31].map((i) => `waveseq:U-F#${i}`)]);
  assert.ok(e.every((x) => x.reason === "name"));
  const f = C.parsed(); L.setName(f, "program:INT-A", 5, "init program"); L.copyEntry(f, "drumkit:U-C", 7, "drumkit:U-A", 3); L.setName(f, "drumkit:U-A", 3, "Mine");
  const m = new Map(D.findEmpties(f).map((x) => [id(x), x.reason]));
  assert.equal(m.get("program:INT-A#5"), "name"); assert.equal(m.get("drumkit:U-A#3"), "data"); assert.equal(m.has("program:INT-A#0"), false); assert.equal(m.size, 18);
});
await check("CSV round-trips every name in the file, including tricky ones", () => {
  const f = C.parsed(); L.setName(f, "program:INT-A", 0, 'a,"b",c'); L.setName(f, "program:INT-A", 1, '"'); L.setName(f, "combi:INT-A", 2, " lead,");
  const csv = D.toCsv(f, null), rows = parseCsv(csv), total = L.listBanks(f).reduce((n, b) => n + b.count, 0);
  assert.deepEqual(rows[0], ["bank", "index", "name"]); assert.equal(rows.length, total + 1); assert.ok(csv.endsWith("\r\n"));
  let k = 1; for (const b of L.listBanks(f)) for (let i = 0; i < b.count; i++, k++) assert.deepEqual(rows[k], [b.key, String(i), L.getName(f, b.key, i)], `${b.key} ${i}`);
  assert.ok(csv.includes('program:INT-A,0,"a,""b"",c"\r\n'));
  const one = parseCsv(D.toCsv(f, "program:INT-B")); assert.equal(one.length, 129); assert.ok(one.slice(1).every((r) => r[0] === "program:INT-B"));
  assert.throws(() => D.toCsv(f, "program:NOPE"));
});
await check("HTML is a printable document with every value escaped", () => {
  const f = C.parsed(); L.setName(f, "program:INT-A", 0, `<script>x</script>&"'`);
  const h = D.toHtml(f, "program:INT-A", "Bank <A> & more");
  assert.match(h, /^\s*<!doctype html/i); assert.ok(!h.includes("<script>x"), "name not escaped"); assert.ok(h.includes("&lt;script&gt;x&lt;/script&gt;&amp;&quot;"), "escaped form missing");
  assert.ok(h.includes("Bank &lt;A&gt; &amp; more") && !h.includes("Bank <A>")); assert.ok(/@media print|@page/.test(h), "print style");
  assert.ok(h.includes("German Dark Grand") && !h.includes("Stereo Concert Piano"), "only the chosen bank");
  const all = D.toHtml(f, null); assert.ok(all.includes("Stereo Concert Piano") && all.includes("German Dark Grand"));
  assert.equal((all.match(/<tr/g) ?? []).length >= L.listBanks(f).reduce((n, b) => n + b.count, 0), true);
});
await testsAndTypes(g, ["core/pcg/banktools.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { X, seen, text, until, win, tmp } = ui;
const EXP = path.join(tmp, "export.out"), setExport = (p) => g.state.app.evaluate((_e, a) => { if (a) process.env.KRONOS_E2E_EXPORT = a; else delete process.env.KRONOS_E2E_EXPORT; }, p ?? null);
const names = async (n) => Promise.all(Array.from({ length: n }, (_, i) => text(`row-name-${i}`)));
const previewCount = () => win.locator('[data-testid^="banktools-preview-row-"]').count();
const jumped = async (key, i) => { await until(async () => (await X(`bank-${key}`).getAttribute("aria-current")) === "true" && (await X(`row-${i}`).getAttribute("aria-selected")) === "true", `${key} slot ${i} selected`, 8000); };
await ui.openFile(); await ui.connectSim();
const midi0 = await win.evaluate(() => window.__kronosE2E.midiLog().length);
await ui.openBank("program:INT-A"); const orig = await names(4);

await check("the panel opens from the bank list and previews before anything changes", async () => {
  await X("banktools-open").click(); await seen("banktools-panel");
  await X("row-0").click(); await X("row-1").click({ modifiers: ["Control"] }); await X("banktools-scope-selected").check(); await X("banktools-prefix").fill("Z-");
  await until(async () => (await previewCount()) === 2, "two preview rows");
  const t0 = await text("banktools-preview-row-0"); assert.ok(t0.includes(orig[0]) && t0.includes(`Z-${orig[0]}`), t0);
  assert.deepEqual(await names(2), orig.slice(0, 2), "preview must not change the file"); assert.equal(await X("banktools-apply").isEnabled(), true);
});
await check("a name over the limit shows an error and blocks Apply", async () => {
  await X("row-2").click({ modifiers: ["Control"] }); await until(async () => (await previewCount()) === 3, "three preview rows");
  assert.equal(await X("banktools-preview-error-2").isVisible(), true); assert.ok((await text("banktools-preview-error-2")).length > 3); assert.equal(await win.locator('[data-testid="banktools-preview-error-0"]').count(), 0);
  assert.equal(await X("banktools-apply").isDisabled(), true);
  await X("row-2").click({ modifiers: ["Control"] }); await until(async () => (await previewCount()) === 2 && (await X("banktools-apply").isEnabled()), "apply enabled again");
});
await check("Apply renames the selected slots as one undo step", async () => {
  await X("banktools-apply").click(); await until(async () => (await text("row-name-0")) === `Z-${orig[0]}`, "renamed");
  assert.deepEqual(await names(4), [`Z-${orig[0]}`, `Z-${orig[1]}`, orig[2], orig[3]]);
  await X("undo").click(); await until(async () => (await text("row-name-0")) === orig[0], "undone");
  assert.deepEqual(await names(4), orig, "one undo restores both names"); await X("redo").click(); await until(async () => (await text("row-name-1")) === `Z-${orig[1]}`, "redone"); await X("undo").click(); await until(async () => (await text("row-name-1")) === orig[1], "undone again");
});
await check("the whole bank can be previewed, with numbering, and bad rows block it", async () => {
  await X("banktools-prefix").fill(""); await X("banktools-scope-bank").check(); await X("banktools-number").check(); await X("banktools-number-start").fill("1"); await X("banktools-number-pad").fill("3"); await X("banktools-number-at").selectOption("suffix"); await X("banktools-number-sep").fill(" ");
  await until(async () => (await previewCount()) === 128, "128 preview rows"); assert.ok((await text("banktools-preview-row-0")).includes(`${orig[0]} 001`));
  assert.equal(await X("banktools-apply").isDisabled(), true, "several 21+ character names go over 24 with the number");
  await X("banktools-number").uncheck(); await X("banktools-scope-selected").check();
});
await check("duplicates are listed in groups and clicking jumps to the slot", async () => {
  await X("banktools-dup-scan").click(); await until(async () => (await text("banktools-dup-count")) === "5", "five groups");
  assert.equal(await win.locator('[data-testid^="banktools-dup-group-"]').count(), 5); assert.ok(/Pulstronik Bass 2/.test(await text("banktools-dup-group-1")));
  await X("banktools-dup-item-0-3").click(); await jumped("drumkit:U-C", 10);
  await X("banktools-dup-item-4-0").click(); await jumped("waveseq:INT", 149);
});
await check("empties are listed and clicking jumps to the slot", async () => {
  await X("banktools-empty-scan").click(); await until(async () => (await text("banktools-empty-count")) === "16", "sixteen empties");
  assert.ok(/Init Drum Kit/.test(await text("banktools-empty-item-0"))); await X("banktools-empty-item-0").click(); await jumped("drumkit:U-C", 7);
  await X("banktools-empty-item-15").click(); await jumped("waveseq:U-F", 31);
});
await check("CSV export of the open bank goes through the save dialog and is escaped", async () => {
  await ui.openBank("program:INT-A"); await X("row-0").click(); await X("banktools-scope-selected").check(); await X("banktools-prefix").fill(""); await X("banktools-find").fill("German"); await X("banktools-replace").fill('<b>&"x",');
  await until(async () => (await previewCount()) >= 1, "preview"); await X("banktools-apply").click(); await until(async () => (await text("row-name-0")) === 'KRONOS <b>&"x", Grand', "renamed with special characters");
  await X("banktools-find").fill(""); await X("banktools-replace").fill("");
  await X("banktools-export-scope-bank").check(); await setExport(EXP); await X("banktools-export-csv").click(); await until(async () => existsSync(EXP), "csv written", 10000); await until(async () => (await text("banktools-export-status")).length > 0, "status");
  const csv = readFileSync(EXP, "utf8"), rows = parseCsv(csv); assert.deepEqual(rows[0], ["bank", "index", "name"]); assert.equal(rows.length, 129);
  assert.ok(csv.includes('program:INT-A,0,"KRONOS <b>&""x"", Grand"\r\n'), csv.slice(0, 200)); assert.deepEqual(rows[2], ["program:INT-A", "1", orig[1]]);
  rmSync(EXP); await X("banktools-export-scope-file").check(); await X("banktools-export-csv").click(); await until(async () => existsSync(EXP), "whole file csv", 10000);
  const all = parseCsv(readFileSync(EXP, "utf8")); assert.equal(all.length, L.listBanks(C.parsed()).reduce((n, b) => n + b.count, 0) + 1); assert.ok(all.some((r) => r[0] === "waveseq:U-F" && r[1] === "31" && r[2] === "Init Wave Sequence"));
});
await check("HTML export is escaped, and cancelling the dialog writes nothing and shows no error", async () => {
  rmSync(EXP); await X("banktools-export-scope-bank").check(); await X("banktools-export-html").click(); await until(async () => existsSync(EXP), "html written", 10000);
  const h = readFileSync(EXP, "utf8"); assert.match(h, /^\s*<!doctype html/i); assert.ok(h.includes("KRONOS &lt;b&gt;&amp;&quot;x&quot;, Grand") && !h.includes("<b>&"), h.slice(0, 300));
  rmSync(EXP); await setExport(null); await X("banktools-export-csv").click(); await new Promise((r) => setTimeout(r, 700)); assert.equal(existsSync(EXP), false); assert.equal(await win.locator('[data-testid="error-message"]').count(), 0);
});
await check("the renderer cannot choose a path, a format or non-text content", async () => {
  await setExport(EXP); rmSync(EXP, { force: true });
  for (const a of [["exe", "x"], ["../../x.csv", "x"], ["csv", 42], ["html", { a: 1 }], ["csv", null]]) { const r = await win.evaluate(([f, c]) => window.kronos.bankToolsExport(f, c).then(() => "ok", () => "refused"), a); assert.equal(r, "refused", JSON.stringify(a)); }
  assert.equal(existsSync(EXP), false, "a refused export writes nothing");
  const n = await win.evaluate(() => window.kronos.bankToolsExport("csv", "a,b\r\n")); assert.equal(n, path.basename(EXP)); assert.equal(readFileSync(EXP, "utf8"), "a,b\r\n");
});
await check("nothing was sent to the keyboard by any of these tools", async () => { assert.equal(await win.evaluate(() => window.__kronosE2E.midiLog().length), midi0); });
await ui.noErrors();
await finish();
