// Acceptance gate for crash recovery (autosave). Owned by the architect: builders must not edit it.
//
// TEST-ONLY ENV VARS (read only when KRONOS_E2E=1; this gate sets both):
//   KRONOS_E2E_RECOVERY_DIR  replaces ~/OpenKronos/Recovery (main process, read at call time)
//   KRONOS_E2E_AUTOSAVE_MS   autosave interval in ms instead of 60000 (the gate uses 400)
//
// PURE EXPORTS of src/core/pcg/recovery.ts (file names are "<docId>.<seq>.recovery"; docId matches /^[a-z0-9]{6,32}$/, seq is an integer >= 0):
//   RECOVERY_KEEP: number                                  // 3
//   recoveryFileName(docId: string, seq: number): string   // throws on a bad docId or seq
//   parseRecoveryFileName(name: string): { docId: string; seq: number } | null   // null for anything that is not exactly that shape
//   planRotation(names: string[], docId: string, keep?: number): { write: string; remove: string[] }
//       // names = the folder listing. write = file name for seq (highest existing seq of docId + 1, or 0 if none).
//       // remove = the OLDEST existing names of docId so that at most `keep` remain once `write` exists. Other docs and foreign names are never listed.
//   isValidRecovery(bytes: Uint8Array): boolean            // true only for a parseable .PCG of sane size
//
// IPC (window.kronos, preload): recoveryWrite(docId: string, bytes: Uint8Array): Promise<void>
//   Validates docId and bytes in main (isValidRecovery), writes atomically (temp file then rename) into the recovery folder, rotates with planRotation. Rejects on invalid input. Never takes a path.
//   The app's own autosave uses the same path with the document's own id (only while dirty, and only when the content changed since the last copy).
//   The app also removes that document's files on Save/Save As and on a clean close. Files that are not valid recovery names are never touched.
//
// DATA-TESTIDS (all in the renderer):
//   autosave-offer     the Restore/Discard prompt shown at launch when a valid recovery copy exists (absent when none, or when the folder holds only invalid files)
//   autosave-restore   button: open the newest recovery copy as an unnamed, dirty file
//   autosave-discard   button: delete the recovery copies and carry on with no file open
// A restored file shows the existing "file-name" text containing "Recovered"; Save (save-file) then goes through the Save As path.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gate, core, launch, load, sha, testsAndTypes, FACTORY } from "./gate-kit.mjs";

const g = gate("AUTOSAVE"), { check, finish } = g, C = await core(g);
let R; try { R = await load("src/core/pcg/recovery.ts"); } catch (e) { g.fails.push(`cannot load recovery.ts: ${e.message}`); await finish(); }

await check("file names round-trip and bad ones are rejected", () => {
  assert.equal(R.RECOVERY_KEEP, 3);
  assert.equal(R.recoveryFileName("abc123", 7), "abc123.7.recovery");
  assert.deepEqual(R.parseRecoveryFileName("abc123.7.recovery"), { docId: "abc123", seq: 7 });
  for (const n of ["abc123.7.recovery.tmp", "../abc123.7.recovery", "abc123.-1.recovery", "abc123.1.5.recovery", "ABC123.1.recovery", "abc.1.recovery", "notes.txt", "", "abc123.x.recovery", "a/b123456.1.recovery"]) assert.equal(R.parseRecoveryFileName(n), null, n);
  for (const [d, s] of [["../x", 1], ["abc", 1], ["abc123", -1], ["abc123", 1.5], ["a b c d e f", 1], ["x".repeat(40), 1]]) assert.throws(() => R.recoveryFileName(d, s), `${d} ${s}`);
});
await check("rotation keeps 3 per document and leaves others alone", () => {
  const f = (d, s) => R.recoveryFileName(d, s), A = "docaaa1", B = "docbbb2";
  assert.deepEqual(R.planRotation([], A), { write: f(A, 0), remove: [] });
  assert.deepEqual(R.planRotation([f(A, 0), f(A, 1)], A), { write: f(A, 2), remove: [] });
  const p = R.planRotation([f(A, 0), f(A, 1), f(A, 2)], A); assert.equal(p.write, f(A, 3)); assert.deepEqual(p.remove, [f(A, 0)]);
  const q = R.planRotation([f(A, 8), f(B, 99), "notes.txt", f(A, 5), f(A, 7), f(A, 6)], A); assert.equal(q.write, f(A, 9)); assert.deepEqual([...q.remove].sort(), [f(A, 5), f(A, 6)].sort());
  assert.equal(R.planRotation([f(A, 1), f(A, 2)], A, 1).remove.length, 2);
});
await check("only a real .PCG counts as a recovery copy", () => {
  assert.equal(R.isValidRecovery(C.raw), true);
  for (const bad of [new Uint8Array(0), new TextEncoder().encode("<html>not a pcg</html>"), C.raw.subarray(0, 1000), C.raw.subarray(0, C.raw.length - 5000)]) assert.equal(R.isValidRecovery(bad), false);
});
await testsAndTypes(g, ["core/pcg/recovery.test.ts"]);
if (g.fails.length) await finish();

const DIR = mkdtempSync(path.join(os.tmpdir(), "kronos-rec-")), REC = path.join(DIR, "Recovery"); mkdirSync(REC);
const env = { KRONOS_E2E_RECOVERY_DIR: REC, KRONOS_E2E_AUTOSAVE_MS: "400" };
const recs = () => (existsSync(REC) ? readdirSync(REC).filter((n) => R.parseRecoveryFileName(n)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HD = "program:INT-B", HI = 5, orig = C.L.getEntry(C.parsed(), HD, HI).subarray(0, 4960);
const pan = C.T.programHd1.find((r) => r.ofs === 92 && r.name === "Panpot"), pk = `${pan.ofs}.${pan.bitLo ?? 0}`, to = C.Q.readParam(orig, pan) === 64 ? 63 : 64;
const crash = () => spawnSync("taskkill", ["/PID", String(g.state.app.process().pid), "/T", "/F"]);
const makeDirty = async (ui) => { await ui.editSlot(HD, HI); await ui.X(`input-${pk}`).fill(String(to)); await ui.X(`input-${pk}`).press("Enter"); await ui.until(async () => (await ui.X(`param-${pk}`).getAttribute("data-changed")) === "true", "changed"); await ui.closeEditor(); };
const gone = async (proc) => { const t0 = Date.now(); while (proc.exitCode === null && proc.signalCode === null) { if (Date.now() - t0 > 20000) throw new Error("app did not exit"); await sleep(100); } };
const tmps = [];

// Launch 1: autosave writing, rotation, validation, removal on save, then a crash.
let ui = await launch(g, C, env); tmps.push(ui.tmp);
await ui.openFile();
await check("a file with no changes writes no recovery copy", async () => { await sleep(1600); assert.deepEqual(recs(), []); });
let recBytes, appDoc;
await check("an edit produces a recovery copy that is exactly the edited file", async () => {
  await makeDirty(ui); await ui.until(() => recs().length >= 1, "recovery copy written", 15000); await sleep(1200);
  const names = recs(); appDoc = R.parseRecoveryFileName(names[0]).docId; assert.ok(names.every((n) => R.parseRecoveryFileName(n).docId === appDoc), "one document, one id");
  assert.equal(readdirSync(REC).length, names.length, "no temp files left behind");
  const newest = names.sort((a, b) => R.parseRecoveryFileName(a).seq - R.parseRecoveryFileName(b).seq).at(-1); recBytes = new Uint8Array(readFileSync(path.join(REC, newest)));
  assert.equal(R.isValidRecovery(recBytes), true); assert.equal(C.Q.readParam(C.L.getEntry(C.P.parsePcg(recBytes), HD, HI), pan), to);
  assert.equal(recBytes.length, C.raw.length); let diff = 0; for (let i = 0; i < recBytes.length; i++) if (recBytes[i] !== C.raw[i]) diff++;
  assert.ok(diff >= 1 && diff <= 8, `${diff} bytes differ from the factory file`);
});
await check("no new copy is written when nothing changed since the last one", async () => { const a = recs().sort().join(); await sleep(1500); assert.equal(recs().sort().join(), a); });
await check("rotation through the real IPC keeps only 3 copies per document", async () => {
  // ship the 30 MB file into the page once, as base64 (Array.from made a 30M-element array per call and killed the window)
  await ui.win.evaluate((b64) => { window.__raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }, Buffer.from(C.raw).toString("base64"));
  for (let i = 0; i < 5; i++) await ui.win.evaluate((d) => window.kronos.recoveryWrite(d, window.__raw), "gatedoc01");
  const seqs = recs().map((n) => R.parseRecoveryFileName(n)).filter((x) => x.docId === "gatedoc01").map((x) => x.seq).sort((a, b) => a - b);
  assert.equal(seqs.length, 3); assert.equal(seqs[2] - seqs[0], 2); assert.ok(recs().some((n) => n.startsWith(appDoc)), "the app's own copy is untouched");
});
await check("recovery IPC refuses bad ids and non-PCG bytes", async () => {
  const snap = () => readdirSync(DIR).concat(readdirSync(REC)).sort().join(), before = snap();
  for (const [d, k] of [["../evil", "raw"], ["..\evil1", "raw"], ["ab", "raw"], ["gatedoc02", "hello"], ["gatedoc02", "empty"], ["gatedoc02", "short"]]) {
    const r = await ui.win.evaluate(([x, k]) => { const R = window.__raw, y = k === "raw" ? R : k === "hello" ? new TextEncoder().encode("hello") : k === "empty" ? new Uint8Array(0) : R.subarray(0, 900); return window.kronos.recoveryWrite(x, y).then(() => "ok", () => "refused"); }, [d, k]); assert.equal(r, "refused", d);
  }
  assert.equal(await ui.win.evaluate(() => window.kronos.recoveryWrite("gatedoc02", "not bytes").then(() => "ok", () => "refused")), "refused");
  assert.equal(snap(), before, "nothing new written anywhere");
});
await check("saving removes that document's copies and never touches the .PCG it came from", async () => {
  const shaOpen = sha(readFileSync(ui.OPEN)), bytes = await ui.saved();
  assert.equal(C.Q.readParam(C.L.getEntry(C.P.parsePcg(bytes), HD, HI), pan), to); assert.deepEqual(bytes, recBytes, "what Save writes equals the last recovery copy");
  await ui.until(() => !recs().some((n) => n.startsWith(appDoc)), "app copies removed", 10000); assert.equal(sha(readFileSync(ui.OPEN)), shaOpen);
  await sleep(1500); assert.ok(!recs().some((n) => n.startsWith(appDoc)), "not rewritten while clean");
});
for (const n of readdirSync(REC)) rmSync(path.join(REC, n));
await ui.openFile(); await makeDirty(ui); await ui.until(() => recs().length >= 1, "copy after the second edit", 15000); await sleep(800); crash(); await sleep(1500);

// Launch 2: the offer after a crash, Restore, Save As behaviour, clean close.
ui = await launch(g, C, env); tmps.push(ui.tmp); const { X } = ui;
await check("after a crash the app offers Restore or Discard", async () => { await ui.seen("autosave-offer", 30000); await ui.seen("autosave-restore"); await ui.seen("autosave-discard"); assert.ok(recs().length >= 1, "nothing deleted before the user chooses"); });
await check("Restore opens an unnamed dirty file with the edit in it", async () => {
  await X("autosave-restore").click(); await X("autosave-offer").waitFor({ state: "hidden", timeout: 15000 }); await ui.until(async () => /recovered/i.test(await ui.text("file-name")), "unnamed file", 15000);
  assert.ok(Number(await ui.text("changes-count")) >= 1, "dirty"); await ui.editSlot(HD, HI); assert.equal(await X(`param-${pk}`).getAttribute("data-changed"), "true"); assert.equal(await X(`input-${pk}`).inputValue(), String(to)); await ui.closeEditor();
});
await check("Save on a restored file behaves like Save As and never overwrites the .PCG", async () => {
  const shaOpen = sha(readFileSync(ui.OPEN)); assert.equal(shaOpen, sha(readFileSync(FACTORY)));
  await X("save-file").click(); await ui.until(() => existsSync(ui.SAVE), "saved to the chosen file", 30000); await sleep(500);
  assert.equal(C.Q.readParam(C.L.getEntry(C.P.parsePcg(new Uint8Array(readFileSync(ui.SAVE))), HD, HI), pan), to); assert.equal(sha(readFileSync(ui.OPEN)), shaOpen);
  await ui.until(() => recs().length === 0, "recovery removed after saving", 10000);
});
await check("a clean close removes the recovery copy", async () => {
  await ui.openFile(); await makeDirty(ui); await ui.until(() => recs().length >= 1, "copy written", 15000); const proc = g.state.app.process();
  await g.state.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); }); await ui.seen("confirm-ok"); await ui.X("confirm-ok").click(); await gone(proc); assert.deepEqual(recs(), []);
});

// Launch 3: Discard, and files that are not ours are left alone.
writeFileSync(path.join(REC, R.recoveryFileName("seeded01", 4)), readFileSync(FACTORY)); writeFileSync(path.join(REC, "notes.txt"), "mine"); writeFileSync(path.join(REC, "seeded02.1.recovery"), "garbage");
ui = await launch(g, C, env); tmps.push(ui.tmp);
await check("Discard deletes the recovery copy and leaves unrelated files alone", async () => {
  await ui.seen("autosave-offer", 30000); await ui.X("autosave-discard").click(); await ui.X("autosave-offer").waitFor({ state: "hidden", timeout: 15000 });
  await ui.until(() => !existsSync(path.join(REC, R.recoveryFileName("seeded01", 4))), "copy deleted", 10000); assert.equal(readFileSync(path.join(REC, "notes.txt"), "utf8"), "mine");
  assert.match(await ui.text("file-name"), /no file open/i);
});
await check("a folder holding only an invalid copy offers nothing", async () => {
  await ui.win.reload(); await ui.X("open-file").waitFor({ timeout: 20000 }); await sleep(1500); assert.equal(await ui.X("autosave-offer").count(), 0);
});
await ui.noErrors();
rmSync(DIR, { recursive: true, force: true });
await finish();
// shortcut: tmp folders of launches 1-2 are left to the OS temp cleaner (launch() tracks only the last), when that matters add cleanup to gate-kit.
