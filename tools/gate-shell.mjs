// Acceptance gate for the app-wide shell: command palette, shortcuts, recent files, window state, reopen, drop, undo history.
// Owned by the architect: builders must not edit it. Run: node tools/gate-shell.mjs
//
// PURE EXPORTS (src/core/fuzzy.ts, plus src/core/fuzzy.test.ts):
//   fuzzyScore(query: string, text: string): number | null
//     null when query is not a case-insensitive subsequence of text; empty/blank query gives 0 (matches all).
//     Higher is better: a consecutive run, a match at the start of text or of a word beats scattered letters.
//   fuzzyFilter<T>(query: string, items: readonly T[], text: (item: T) => string, limit?: number): T[]
//     Matching items only, best score first, ties keep input order; limit caps the length. Blank query returns items in order.
//
// TEST-ONLY ENV (set by this gate): KRONOS_E2E=1 and APPDATA (from gate-kit launch; userData lives under it, so the recent list,
//   window state and settings are in the temp folder). KRONOS_E2E_OPEN is read by the main process at each Open click
//   (this gate changes process.env.KRONOS_E2E_OPEN at runtime, as gate-midiweb does), KRONOS_E2E_SAVE is the Save As target.
//   Recent items open without any dialog, by id. The reopen-last-file launch reads the recent list; no extra env is needed.
//
// DATA-TESTIDS (all new ones start with "shell-"; existing ones are used as they are):
//   shell-help-button      top-bar button that opens the shortcut sheet (same as the ? key)
//   shell-shortcuts        the shortcut sheet; its text names every shortcut: Ctrl+K Ctrl+O Ctrl+S Ctrl+Shift+S Ctrl+Z Ctrl+Y Ctrl+F Esc ?
//   shell-palette          the command palette dialog (Ctrl+K); closed by Esc
//   shell-palette-input    its text input, focused on open
//   shell-palette-row-N    result rows, best first, N from 0. Text = the command title or the sound name. Row 0 is the one Enter runs.
//                          Attribute data-kind is "command" or "sound". Command titles include "Open", "Save", "Save As", "Undo", "Redo",
//                          "Show Shortcuts". Sound rows cover every Program, Combi, Drum Kit and Set List name in the open file.
//   shell-palette-empty    shown when nothing matches (Enter then does nothing and the palette stays open)
//   shell-recent-button    top-bar button that opens the Recent Files menu (the menu also holds the reopen setting)
//   shell-recent-menu      the menu; closes on Esc
//   shell-recent-item-N    entry N, newest first, at most 10. Text = file name only. Attribute data-id = opaque id (no path, no slash).
//   shell-recent-empty     shown when the list is empty
//   shell-reopen-last      checkbox inside the open Recent menu: reopen the last file at start. On by default since 2026-11-10 (an explicit off stays off).
//   shell-history-button   top-bar button that toggles the Undo History panel
//   shell-history          the panel
//   shell-history-item-N   one undo step, newest first (0 is the next undo). Text contains the step label. A slot rename is labelled
//                          so that the label contains the new name. Clicking item N restores the state right after that step.
// Dropping a .PCG: a "drop" event with dataTransfer.files on document.body. The renderer reads the bytes; the file counts as unnamed.
// Existing ids used: open-file save-file save-as undo redo search file-name error-message confirm-ok confirm-cancel
//   bank-<key> row-N row-name-N rename-input.
// Window state and reopen data live as JSON in userData; the gate checks behaviour through a second launch on the same APPDATA.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, sha, testsAndTypes, FACTORY } from "./gate-kit.mjs";

const g = gate("SHELL"), { check, finish } = g, C = await core(g);
let F; try { F = await load("src/core/fuzzy.ts"); } catch (e) { g.fails.push(`cannot load fuzzy.ts: ${e.message}`); await finish(); }

const BK = "program:INT-A", names = (n) => { const f = C.parsed(); return Array.from({ length: n }, (_, i) => C.L.getName(f, BK, i)); };
await check("fuzzy: subsequence, case, empty query, ranking", () => {
  assert.notEqual(F.fuzzyScore("sve", "Save As"), null); assert.notEqual(F.fuzzyScore("SAVE", "save as"), null);
  assert.ok(F.fuzzyScore("vas", "Save As") !== null, "vas is a subsequence of save as"); assert.equal(F.fuzzyScore("sav", "Save As") !== null && F.fuzzyScore("asv", "Save") , null, "order matters"); assert.equal(F.fuzzyScore("zzz", "Save As"), null); assert.equal(F.fuzzyScore("saves", "Save"), null);
  assert.equal(F.fuzzyScore("", "anything"), 0); assert.equal(F.fuzzyScore("   ", "anything"), 0);
  assert.ok(F.fuzzyScore("sav", "Save") > F.fuzzyScore("sav", "Set A Value"), "consecutive beats scattered");
  assert.ok(F.fuzzyScore("sa", "Save") > F.fuzzyScore("sa", "Undo Save"), "start of text beats later");
  assert.deepEqual(F.fuzzyFilter("sa", ["Redo", "Undo Save", "Save As", "Save"], (s) => s), ["Save", "Save As", "Undo Save"]);
  assert.deepEqual(F.fuzzyFilter("", ["b", "a"], (s) => s), ["b", "a"]); assert.deepEqual(F.fuzzyFilter("a", ["a1", "a2", "a3"], (s) => s, 2), ["a1", "a2"]);
});
await check("fuzzy finds real factory sound names", () => {
  const all = names(128).filter((n) => n.trim().length > 3); assert.ok(all.length > 50);
  for (const n of all.slice(0, 40)) {
    assert.ok(F.fuzzyFilter(n, all, (s) => s).includes(n), `full name ${n}`);
    const sparse = [...n].filter((_, i) => i % 2 === 0).join("").toLowerCase().replace(/\s+/g, "");
    if (sparse) assert.ok(F.fuzzyFilter(sparse, all, (s) => s).includes(n), `sparse ${sparse} of ${n}`);
  }
  const probe = all.find((n, i) => all.indexOf(n) === i && all.filter((m) => m === n).length === 1); assert.equal(F.fuzzyFilter(probe, all, (s) => s)[0], probe);
});
await testsAndTypes(g, ["core/fuzzy.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { X, seen, text, until, win, tmp, OPEN, SAVE } = ui;
const ORIG = names(8), press = (k) => win.keyboard.press(k), settle = () => new Promise((r) => setTimeout(r, 250));
const E = (name, p) => g.state.app.evaluate((_e, a) => { process.env[a[0]] = a[1]; }, [name, p]);
const vis = async (id, ms = 1500) => { try { await X(id).waitFor({ state: "visible", timeout: ms }); return true; } catch { return false; } };
const fileName = () => text("file-name"), bytesOf = (p) => new Uint8Array(readFileSync(p));
const mt = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const cleanOpen = async (p) => { await E("KRONOS_E2E_OPEN", p); await X("open-file").click(); if (await vis("confirm-ok", 700)) await X("confirm-ok").click(); await until(async () => (await fileName()) === path.basename(p), "opened " + p); await settle(); };
const rename = async (i, v) => { await X(`row-${i}`).dblclick(); await X("rename-input").fill(v); await X("rename-input").press("Enter"); await until(async () => (await text(`row-name-${i}`)) === v, `renamed ${v}`); };
const click = () => X("file-name").click();
const COPIES = Array.from({ length: 12 }, (_, i) => path.join(tmp, `f${String(i + 1).padStart(2, "0")}.PCG`)); for (const p of COPIES) copyFileSync(FACTORY, p);
const recentCount = () => win.locator('[data-testid^="shell-recent-item-"]').count();
const openRecent = async () => { if (!(await vis("shell-recent-menu", 200))) await X("shell-recent-button").click(); await seen("shell-recent-menu"); };
const closeMenu = async () => { await press("Escape"); await settle(); };

await check("recent menu starts empty, reopen is on by default, and no path reaches the page", async () => {
  assert.equal(await fileName(), "No file open"); await openRecent(); await seen("shell-recent-empty"); assert.equal(await X("shell-reopen-last").isChecked(), true); await closeMenu();
  await ui.openFile(); await settle(); await openRecent(); assert.equal(await text("shell-recent-item-0"), "work.PCG"); const id = await X("shell-recent-item-0").getAttribute("data-id");
  assert.ok(id && !/[\\/:]/.test(id), `id ${id}`); const html = await win.evaluate(() => document.documentElement.outerHTML + document.body.innerText);
  assert.ok(!html.includes(tmp) && !html.toLowerCase().includes("kronos-gate"), "a path is visible in the page"); await closeMenu();
});
await check("recent list keeps the newest 10, as JSON in userData, with names only on screen", async () => {
  for (const p of COPIES) await cleanOpen(p);
  await openRecent(); assert.equal(await recentCount(), 10); assert.equal(await text("shell-recent-item-0"), "f12.PCG"); assert.equal(await text("shell-recent-item-9"), "f03.PCG");
  const list = []; for (let i = 0; i < 10; i++) list.push(await text(`shell-recent-item-${i}`)); assert.ok(!list.includes("work.PCG") && !list.includes("f01.PCG") && !list.includes("f02.PCG"), list.join());
  const jsons = readdirSync(path.join(tmp, "appdata"), { recursive: true }).map(String).filter((f) => f.endsWith(".json")).map((f) => path.join(tmp, "appdata", f));
  const hit = jsons.map((f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }).filter((v) => v && JSON.stringify(v).includes("f12.PCG")); assert.ok(hit.length >= 1, "no JSON file in userData lists f12.PCG");
  await closeMenu();
});
await check("a recent file that has gone is reported and removed; another opens by click", async () => {
  rmSync(COPIES[11]); await openRecent(); await X("shell-recent-item-0").click(); await seen("error-message"); assert.match(await text("error-message"), /f12/i);
  await openRecent(); assert.equal(await recentCount(), 9); assert.equal(await text("shell-recent-item-0"), "f11.PCG");
  await X("shell-recent-item-1").click(); await until(async () => (await fileName()) === "f10.PCG", "f10 opened"); await ui.openBank(BK); assert.equal(await text("row-name-0"), ORIG[0]);
});

const SND = { name: C.L.getName(C.parsed(), "combi:INT-F", 5), key: "combi:INT-F" };
const selectedRow = () => win.locator('[data-testid^="row-"][aria-selected="true"]');
await check("Ctrl+K opens the palette; a sound name jumps to that sound", async () => {
  await click(); await press("Control+K"); await seen("shell-palette"); assert.equal(await X("shell-palette-input").evaluate((e) => e === document.activeElement), true);
  await X("shell-palette-input").fill(SND.name); await seen("shell-palette-row-0"); const t = await text("shell-palette-row-0"); assert.ok(t.includes(SND.name), t); assert.equal(await X("shell-palette-row-0").getAttribute("data-kind"), "sound");
  await press("Enter"); await X("shell-palette").waitFor({ state: "hidden", timeout: 5000 }); await until(async () => (await selectedRow().count()) === 1, "one row selected");
  const n = (await selectedRow().getAttribute("data-testid")).replace("row-", ""); assert.equal(await text(`row-name-${n}`), SND.name);
});
await check("the palette runs a command with Enter", async () => {
  rmSync(SAVE, { force: true }); await click(); await press("Control+K"); await seen("shell-palette"); await X("shell-palette-input").fill("save as"); await seen("shell-palette-row-0");
  assert.equal((await text("shell-palette-row-0")).trim(), "Save As"); assert.equal(await X("shell-palette-row-0").getAttribute("data-kind"), "command");
  await press("Enter"); await until(async () => existsSync(SAVE), "Save As ran", 15000); assert.equal(C.P.verifyChecksums(C.P.parsePcg(bytesOf(SAVE))).length, 0);
});
await check("palette: no match shows a message and Enter does nothing; Esc closes it", async () => {
  await click(); await press("Control+K"); await seen("shell-palette"); await X("shell-palette-input").fill("qqzzxxww"); await seen("shell-palette-empty"); assert.equal(await win.locator('[data-testid^="shell-palette-row-"]').count(), 0);
  await press("Enter"); await settle(); assert.equal(await vis("shell-palette", 300), true); await press("Escape"); await X("shell-palette").waitFor({ state: "hidden", timeout: 5000 });
});
await check("Ctrl+O, Ctrl+S and Ctrl+Shift+S act like the buttons", async () => {
  await cleanOpen(OPEN); await ui.openBank(BK); await rename(2, "Key Save"); const before = sha(bytesOf(OPEN)), m0 = mt(SAVE);
  await click(); await press("Control+S"); await until(async () => sha(bytesOf(OPEN)) !== before, "Ctrl+S wrote the open file", 15000);
  assert.equal(C.L.getName(C.P.parsePcg(bytesOf(OPEN)), BK, 2), "Key Save"); await press("Control+Shift+S"); await until(async () => mt(SAVE) !== m0, "Ctrl+Shift+S wrote the Save As target", 15000);
  await E("KRONOS_E2E_OPEN", COPIES[10]); await press("Control+O"); await until(async () => (await fileName()) === "f11.PCG", "Ctrl+O opened a file", 15000);
});
await check("Ctrl+Z, Ctrl+Y and Ctrl+F work, and are ignored while typing", async () => {
  copyFileSync(FACTORY, OPEN); await cleanOpen(OPEN); await ui.openBank(BK); await rename(1, "Short One"); await click(); await press("Control+Z"); await until(async () => (await text("row-name-1")) === ORIG[1], "undone");
  await press("Control+Y"); await until(async () => (await text("row-name-1")) === "Short One", "redone"); await press("Control+F"); assert.equal(await X("search").evaluate((e) => e === document.activeElement), true);
  await X("search").type("abc"); await press("Control+Z"); await press("?"); await settle();
  assert.equal(await vis("shell-shortcuts", 300), false, "? typed into search must not open the sheet"); assert.ok((await X("search").inputValue()).includes("?")); await X("search").fill(""); await until(async () => (await text("row-name-1")) === "Short One", "Ctrl+Z in a text field must not undo the document");
  await click(); await press("Control+Z"); await until(async () => (await text("row-name-1")) === ORIG[1], "undone again");
});
await check("? and the Help button show the shortcut sheet; Esc closes it", async () => {
  await click(); await press("?"); await seen("shell-shortcuts"); const t = await text("shell-shortcuts"); for (const k of ["Ctrl+K", "Ctrl+O", "Ctrl+S", "Ctrl+Shift+S", "Ctrl+Z", "Ctrl+Y", "Ctrl+F", "Esc"]) assert.ok(t.includes(k), `${k} missing from sheet`);
  await press("Escape"); await X("shell-shortcuts").waitFor({ state: "hidden", timeout: 5000 }); await X("shell-help-button").click(); await seen("shell-shortcuts"); await press("Escape"); await X("shell-shortcuts").waitFor({ state: "hidden", timeout: 5000 });
});
await check("Undo History lists the steps and clicking one goes back to it", async () => {
  copyFileSync(FACTORY, OPEN); await cleanOpen(OPEN); await ui.openBank(BK); await rename(1, "Aaa One"); await rename(2, "Bbb Two"); await rename(3, "Ccc Three");
  await X("shell-history-button").click(); await seen("shell-history"); const items = win.locator('[data-testid^="shell-history-item-"]'); await until(async () => (await items.count()) === 3, "three steps");
  const t = [await text("shell-history-item-0"), await text("shell-history-item-1"), await text("shell-history-item-2")]; assert.ok(t[0].includes("Ccc Three") && t[1].includes("Bbb Two") && t[2].includes("Aaa One"), t.join(" | "));
  await X("shell-history-item-1").click(); await until(async () => (await text("row-name-3")) === ORIG[3], "later step undone"); assert.equal(await text("row-name-2"), "Bbb Two"); assert.equal(await text("row-name-1"), "Aaa One");
  await X("undo").click(); await until(async () => (await text("row-name-2")) === ORIG[2], "plain undo continues from there"); assert.equal(await text("row-name-1"), "Aaa One"); await X("shell-history-button").click();
});

const PCGB64 = Buffer.from(bytesOf(FACTORY)).toString("base64");
const drop = (b64, name) => win.evaluate(([b, n]) => { const bin = Uint8Array.from(atob(b), (c) => c.charCodeAt(0)), dt = new DataTransfer(); dt.items.add(new File([bin], n)); for (const t of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt })); }, [b64, name]);
await check("dropping a .PCG opens it as unnamed, honours the unsaved guard, and refuses junk", async () => {
  copyFileSync(FACTORY, OPEN); await cleanOpen(OPEN); await ui.openBank(BK); await rename(4, "Dirty Edit"); await drop(PCGB64, "dropped.PCG"); await seen("confirm-ok"); await X("confirm-cancel").click(); await settle();
  assert.equal(await text("row-name-4"), "Dirty Edit"); assert.equal(await fileName(), "work.PCG");
  await drop(PCGB64, "dropped.PCG"); await ui.ok(); await until(async () => (await text("row-name-4")) === ORIG[4], "dropped file replaced the edit");
  rmSync(SAVE, { force: true }); const open0 = sha(bytesOf(OPEN)); await X("save-file").click(); await until(async () => existsSync(SAVE), "Save behaved like Save As", 15000); assert.equal(sha(bytesOf(OPEN)), open0, "the previously open file must not be overwritten");
  await drop(Buffer.from("this is not a pcg file").toString("base64"), "junk.PCG"); await seen("error-message"); assert.equal(await text("row-name-4"), ORIG[4]);
});
await ui.noErrors();

let ui2;
await check("window size and position come back after a restart", async () => {
  await g.state.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setBounds({ x: 137, y: 91, width: 1013, height: 677 }); });
  await new Promise((r) => setTimeout(r, 2000)); copyFileSync(FACTORY, OPEN); await cleanOpen(OPEN); await openRecent(); await X("shell-reopen-last").check(); assert.equal(await X("shell-reopen-last").isChecked(), true); await closeMenu(); await new Promise((r) => setTimeout(r, 1500));
  const old = g.state.app, first = g.state.tmp; await Promise.race([old.close(), new Promise((r) => setTimeout(r, 15000))]).catch(() => {}); try { old.process().kill(); } catch {}
  await new Promise((r) => setTimeout(r, 1500)); ui2 = await launch(g, C, { APPDATA: path.join(first, "appdata") });
  const b = await g.state.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), near = (a, e) => Math.abs(a - e) <= 20;
  assert.ok(near(b.x, 137) && near(b.y, 91) && near(b.width, 1013) && near(b.height, 677), JSON.stringify(b));
});
await check("the last file reopens at start when the setting is on", async () => {
  assert.ok(ui2, "no second launch"); await ui2.until(async () => (await ui2.text("file-name")) === "work.PCG", "reopened work.PCG", 20000);
  await ui2.seen("bank-program:INT-A"); await ui2.openBank(BK); assert.equal(await ui2.text("row-name-0"), ORIG[0]);
  await ui2.X("shell-recent-button").click(); await ui2.seen("shell-recent-menu"); assert.equal(await ui2.X("shell-reopen-last").isChecked(), true);
});
await finish();
