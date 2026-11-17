// Acceptance gate for the Backup Manager. Owned by the architect: builders must not edit it.
//
// PURE EXPORTS, src/core/backup/manifest.ts (tests in manifest.test.ts):
//   type BackupSummary = { created: string; os: string; banks: number; objects: number; failed: string[] };
//   summarizeManifest(m: unknown): BackupSummary        // banks = m.banks.length, objects = m.objects.length, failed = m.failed; throws Error if m is not a manifest
//   parseManifest(text: string): unknown                // JSON.parse + validation (same throw as above); returns the manifest object
//   expectedFiles(m: unknown): { file: string; sha256: string }[]   // the pcg first, then every object, in manifest order
//   verifyFiles(m: unknown, read: (file: string) => Uint8Array | null): { ok: boolean; checked: number; problems: { file: string; kind: "missing" | "mismatch" | "unsafe" }[] }
//        // sha256 (lowercase hex) of read(file) against the manifest; null = missing; a file that is absolute, has "..", a backslash, or a drive letter is "unsafe" and read() is NOT called for it
//   isBackupFolderName(name: string): boolean           // "Kronos Backup " prefix + a plain segment (letters, digits, space . _ ( ) -), no separators, no ".."
//
// WINDOW API (window.kronos), every name is a plain folder name, never a path; each rejects for a bad name:
//   backupList(): Promise<{ name: string; bytes: number; summary: BackupSummary | null }[]>   // summary null = manifest missing or damaged
//   backupVerify(name: string): Promise<{ ok: boolean; checked: number; problems: { file: string; kind: string }[] }>
//   backupOpen(name: string): Promise<{ name: string; bytes: Uint8Array } | null>   // reads manifest.pcg.file only; the app then loads it as an UNNAMED document
//   backupReveal(name: string): Promise<void>
//   backupDelete(name: string): Promise<void>            // shell.trashItem on the folder (the renderer asks the confirm dialog first)
//
// TEST-ONLY ENV VARS (read only when KRONOS_E2E=1; this gate sets them in the running main process before use):
//   KRONOS_E2E_BACKUP_DIR  already exists: the Backups folder (set by launch()).
//   KRONOS_E2E_TRASH_DIR   when set, backupDelete MOVES the folder into this directory instead of calling shell.trashItem. Read at call time.
//   KRONOS_E2E_REVEAL_LOG  when set, backupReveal appends the absolute folder path plus a newline to this file instead of showItemInFolder. Read at call time.
//
// data-testid TABLE (N = row index; rows sorted by manifest "created", newest first; folders with a missing or damaged manifest come last):
//   backupmgr-open-panel     button: shows the panel (listing refreshes on open)
//   backupmgr-refresh        button: re-reads the folder list
//   backupmgr-empty          text shown when there are no backups
//   backupmgr-row-N          one backup; its text contains the folder name
//   backupmgr-date-N         created date as text containing the ISO date (YYYY-MM-DD)
//   backupmgr-os-N           OS text, e.g. "Kronos OS 3.1.2"
//   backupmgr-banks-N        bank count, text is just the number
//   backupmgr-objects-N      object count, text is just the number
//   backupmgr-size-N         human size text; attribute data-bytes holds the exact total bytes of every file in the folder, recursive
//   backupmgr-failed-N       failed items: text is the count ("" or "0" when none); the failed messages are in its title attribute
//   backupmgr-damaged-N      visible only when the manifest is missing or unreadable (row still listed, Open and Verify disabled)
//   backupmgr-verify-N       button; backupmgr-verify-result-N: "Verified" on success, otherwise one line per problem containing the file name and "missing" or "mismatch"
//   backupmgr-open-N         button: load the backup PCG as a new unnamed document (the existing unsaved-changes confirm applies)
//   backupmgr-reveal-N       button: show in Explorer
//   backupmgr-delete-N       button: opens the confirm dialog (confirm-message names the folder; confirm-ok / confirm-cancel), OK trashes
// There is NO restore, no backupmgr-restore-*, and no write to the keyboard anywhere in the panel.
// The Send and Store confirm dialogs (confirm-message) must also say "Disk mode" and "Save All".
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, sha, PCG_DIR, testsAndTypes } from "./gate-kit.mjs";

const g = gate("BACKUPMGR"), { check, finish } = g, C = await core(g), { L, raw, parsed } = C;
let M; try { M = await load("src/core/backup/manifest.ts"); } catch (e) { g.fails.push(`cannot load manifest.ts: ${e.message}`); await finish(); }

const alt = new Uint8Array(readFileSync(path.join(PCG_DIR, "PRELOAD.PCG")));
const banks = L.listBanks(parsed()).map((b) => b.key);
const objA = Uint8Array.from({ length: 90 }, (_, i) => (i * 7 + 1) & 255), objB = Uint8Array.from({ length: 64 }, (_, i) => (i * 5 + 9) & 255);
const mk = (pcgFile, pcg, created, os, failed) => ({ created, os, pcg: { file: pcgFile, sha256: sha(pcg), size: pcg.length }, banks, objects: [{ obj: 6, bank: 0, index: 0, version: 1, file: "objects/6-0-0.bin", sha256: sha(objA) }, { obj: 7, bank: 1, index: 0, version: 2, file: "objects/7-1-0.bin", sha256: sha(objB) }], notIncluded: ["Samples."], failed });
const NA = "Kronos Backup 2026-01-01-10-00-00", NB = "Kronos Backup 2026-02-01-10-00-00", ND = "Kronos Backup 2026-03-01-10-00-00";
const mA = mk(`${NA}.PCG`, raw, "2026-01-01T10:00:00.000Z", "Kronos OS 3.1.2", []);
const mB = mk(`${NB}.PCG`, alt, "2026-02-01T10:00:00.000Z", "Kronos OS 3.0.1", ["KARMA 0/1: no reply", "Song 2: timeout"]);
const files = (m, pcg) => ({ [m.pcg.file]: pcg, "objects/6-0-0.bin": objA, "objects/7-1-0.bin": objB });
const readFrom = (f) => (n) => f[n] ?? null;

await check("a manifest is summarised with its real counts", () => {
  assert.deepEqual(M.summarizeManifest(mB), { created: "2026-02-01T10:00:00.000Z", os: "Kronos OS 3.0.1", banks: banks.length, objects: 2, failed: ["KARMA 0/1: no reply", "Song 2: timeout"] });
  assert.equal(M.summarizeManifest(M.parseManifest(JSON.stringify(mA))).banks, 31); assert.deepEqual(M.expectedFiles(mA).map((e) => e.file), [`${NA}.PCG`, "objects/6-0-0.bin", "objects/7-1-0.bin"]);
});
await check("damaged manifests are refused", () => { for (const t of ["", "not json", "[]", "null", JSON.stringify({ ...mA, banks: "x" }), JSON.stringify({ ...mA, pcg: null }), JSON.stringify({ ...mA, objects: [{ file: 5 }] })]) assert.throws(() => M.summarizeManifest(M.parseManifest(t)), t.slice(0, 30)); });
await check("verify passes an intact backup against real hashes", () => assert.deepEqual(M.verifyFiles(mA, readFrom(files(mA, raw))), { ok: true, checked: 3, problems: [] }));
await check("verify reports each mismatch and each missing file", () => {
  const f = files(mA, raw); f["objects/6-0-0.bin"] = Uint8Array.from(objA, (b, i) => (i === 40 ? b ^ 1 : b)); delete f["objects/7-1-0.bin"]; const r = M.verifyFiles(mA, readFrom(f));
  assert.equal(r.ok, false); assert.equal(r.checked, 3); assert.deepEqual(r.problems, [{ file: "objects/6-0-0.bin", kind: "mismatch" }, { file: "objects/7-1-0.bin", kind: "missing" }]);
});
await check("verify never reads a path that leaves the folder", () => {
  const seen = [], bad = ["../x.bin", "/etc/x", "C:\\x.bin", "a\\..\\b", "objects/../../x"];
  const m = { ...mA, objects: bad.map((file) => ({ obj: 6, bank: 0, index: 0, version: 1, file, sha256: sha(objA) })) };
  const r = M.verifyFiles(m, (n) => { seen.push(n); return n === `${NA}.PCG` ? raw : objA; }); assert.deepEqual(seen, [`${NA}.PCG`]); assert.deepEqual(r.problems.filter((p) => p.kind === "unsafe").map((p) => p.file), bad); assert.equal(r.ok, false);
});
await check("only backup folder names are accepted", () => { assert.equal(M.isBackupFolderName(NA), true); for (const n of ["", "Kronos Backup", "My Backup 1", "Kronos Backup ../x", "Kronos Backup a/b", "Kronos Backup a\\b", "..", "C:\\Kronos Backup x", `Kronos Backup ${"x".repeat(200)}`]) assert.equal(M.isBackupFolderName(n), false, n); });
await testsAndTypes(g, ["core/backup/manifest.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C, {}), { X, seen, text, until, win, tmp, BACKUPS, SAVE, OPEN } = ui;
const TRASH = path.join(tmp, "trash"), RLOG = path.join(tmp, "reveal.log"); mkdirSync(TRASH);
await g.state.app.evaluate((_e, a) => { process.env.KRONOS_E2E_TRASH_DIR = a[0]; process.env.KRONOS_E2E_REVEAL_LOG = a[1]; }, [TRASH, RLOG]);
const put = (name, m, f) => { const d = path.join(BACKUPS, name); mkdirSync(path.join(d, "objects"), { recursive: true }); for (const [n, b] of Object.entries(f)) writeFileSync(path.join(d, n), b); writeFileSync(path.join(d, "manifest.json"), JSON.stringify(m, null, 2)); return d; };
const dirA = put(NA, mA, files(mA, raw)), dirB = put(NB, mB, files(mB, alt));
mkdirSync(path.join(BACKUPS, ND)); writeFileSync(path.join(BACKUPS, ND, "manifest.json"), "{ not json");
mkdirSync(path.join(BACKUPS, "Holiday photos")); // not a backup, must be ignored
const total = (d) => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).reduce((s, e) => s + readFileSync(path.join(e.parentPath ?? e.path, e.name)).length, 0);
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const rows = () => win.locator('[data-testid^="backupmgr-row-"]').count();
const gone = (id) => X(id).waitFor({ state: "hidden", timeout: 10000 });
const SAVEALL = /Disk mode[\s\S]*Save All|Save All[\s\S]*Disk mode/i;
// Row order: 0 = B (Feb), 1 = A (Jan), 2 = damaged (Mar, but unreadable so last).

await ui.openFile();
await check("the list shows three backups, newest valid first, damaged last, other folders ignored", async () => {
  await X("backupmgr-open-panel").click(); await until(async () => (await rows()) === 3, "three rows");
  assert.match(await text("backupmgr-row-0"), new RegExp(NB)); assert.match(await text("backupmgr-row-1"), new RegExp(NA)); assert.match(await text("backupmgr-row-2"), new RegExp(ND));
});
await check("each row shows its own manifest values and exact size", async () => {
  assert.match(await text("backupmgr-date-0"), /2026-02-01/); assert.match(await text("backupmgr-os-0"), /3\.0\.1/); assert.equal(await text("backupmgr-banks-0"), String(banks.length)); assert.equal(await text("backupmgr-objects-0"), "2"); assert.equal(await text("backupmgr-failed-0"), "2");
  assert.match((await X("backupmgr-failed-0").getAttribute("title")) ?? "", /KARMA 0\/1: no reply[\s\S]*Song 2: timeout/); assert.equal(Number(await X("backupmgr-size-0").getAttribute("data-bytes")), total(dirB)); assert.match(await text("backupmgr-size-0"), /\d/);
  assert.match(await text("backupmgr-date-1"), /2026-01-01/); assert.match(await text("backupmgr-os-1"), /3\.1\.2/); assert.ok(["", "0"].includes(await text("backupmgr-failed-1"))); assert.equal(Number(await X("backupmgr-size-1").getAttribute("data-bytes")), total(dirA));
});
await check("a damaged manifest is still listed, flagged, and can't be opened or verified", async () => { await seen("backupmgr-damaged-2"); assert.equal(await X("backupmgr-open-2").isDisabled(), true); assert.equal(await X("backupmgr-verify-2").isDisabled(), true); });
await check("Verify says Verified for an intact backup", async () => { await X("backupmgr-verify-1").click(); await until(async () => /Verified/.test(await text("backupmgr-verify-result-1")), "verified"); });
await check("Verify names every file that was changed or removed", async () => {
  const p = path.join(dirA, "objects", "6-0-0.bin"), q = path.join(dirA, "objects", "7-1-0.bin"), b = readFileSync(p); b[10] ^= 255; writeFileSync(p, b); rmSync(q);
  await X("backupmgr-verify-1").click(); await until(async () => /mismatch/i.test(await text("backupmgr-verify-result-1")), "problems shown");
  const t = await text("backupmgr-verify-result-1"); assert.match(t, /6-0-0\.bin[^\n]*mismatch|mismatch[^\n]*6-0-0\.bin/i); assert.match(t, /7-1-0\.bin[^\n]*missing|missing[^\n]*7-1-0\.bin/i); assert.doesNotMatch(t, /Verified/);
  writeFileSync(p, objA); writeFileSync(q, objB);
});
await check("Reveal shows exactly that backup folder", async () => { await X("backupmgr-reveal-1").click(); await until(async () => existsSync(RLOG), "reveal logged"); assert.equal(path.resolve(readFileSync(RLOG, "utf8").trim()), path.resolve(dirA)); });
await check("the app refuses names that are not plain backup folders", async () => {
  for (const bad of ["..", "../x", "..\\..", "C:\\Windows", "Holiday photos", "Kronos Backup ../..", ""]) for (const fn of ["backupVerify", "backupOpen", "backupReveal", "backupDelete"]) { const r = await win.evaluate(([f, n]) => window.kronos[f](n).then(() => "ok", () => "refused"), [fn, bad]); assert.equal(r, "refused", `${fn}(${JSON.stringify(bad)})`); }
  assert.ok(existsSync(path.join(BACKUPS, "Holiday photos")) && existsSync(dirA) && existsSync(dirB));
});
await check("Open with unsaved changes asks first, and Cancel keeps the document", async () => {
  await ui.openBank("program:INT-A"); await X("row-0").dblclick(); await X("rename-input").fill("Edited One"); await X("rename-input").press("Enter"); await until(async () => (await text("changes-count")) === "1", "one change");
  await X("backupmgr-open-0").click(); await seen("confirm-message"); assert.match(await text("confirm-message"), /discard/i); await X("confirm-cancel").click(); await gone("confirm-cancel");
  assert.equal(await text("changes-count"), "1"); assert.equal(await text("row-name-0"), "Edited One"); assert.match(await text("file-name"), /work\.PCG/);
});
await check("Open loads the backup as an unnamed document, and Save writes a new file", async () => {
  await X("backupmgr-open-0").click(); await ui.ok(); await until(async () => !/work\.PCG/.test(await text("file-name")), "document replaced", 30000);
  const name = await text("file-name"); assert.ok(!name.includes(NB), `document should be unnamed, got "${name}"`); assert.equal(await text("changes-count"), "0");
  assert.equal(existsSync(SAVE), false); const out = await ui.saved();
  assert.equal(sha(out), sha(alt), "saved bytes differ from the backup's PCG"); assert.notEqual(sha(out), sha(raw));
  assert.equal(sha(new Uint8Array(readFileSync(OPEN))), sha(raw), "work.PCG was overwritten"); assert.equal(sha(new Uint8Array(readFileSync(path.join(dirB, mB.pcg.file)))), sha(alt), "the backup itself changed");
});
await check("Delete asks first, Cancel keeps it, OK moves the folder out", async () => {
  await X("backupmgr-delete-1").click(); await seen("confirm-message"); assert.match(await text("confirm-message"), new RegExp(NA)); await X("confirm-cancel").click(); await gone("confirm-cancel"); assert.ok(existsSync(dirA));
  await X("backupmgr-delete-1").click(); await ui.ok(); await until(async () => !existsSync(dirA), "folder gone"); assert.ok(readdirSync(TRASH).includes(NA), `trash has ${readdirSync(TRASH)}`); assert.ok(existsSync(dirB));
  await until(async () => (await rows()) === 2, "row removed"); assert.ok(!(await text("backupmgr-row-0")).includes(NA) && !(await text("backupmgr-row-1")).includes(NA));
});
await check("Send and Store warn to do a Disk mode Save All first", async () => {
  await ui.connectSim(); await ui.openBank("program:INT-A"); await X("store-bank").click(); await seen("confirm-message"); assert.match(await text("confirm-message"), SAVEALL); await X("confirm-cancel").click(); await gone("confirm-cancel");
  await X("row-0").dblclick(); await X("rename-input").fill("Edited Two"); await X("rename-input").press("Enter"); await until(async () => (await text("changes-count")) === "1", "change");
  await X("push-bank").click(); await seen("confirm-message"); assert.match(await text("confirm-message"), SAVEALL); await X("confirm-cancel").click(); await gone("confirm-cancel");
});
await check("the manager has no restore and nothing was written to the keyboard", async () => {
  assert.equal(await win.locator('[data-testid^="backupmgr-restore"], [data-testid^="backupmgr-send"], [data-testid^="backupmgr-write"]').count(), 0);
  assert.equal((await win.locator('[data-testid^="backupmgr-"]').allTextContents()).some((t) => /restore/i.test(t)), false);
  assert.deepEqual((await log()).filter((m) => m[0] === 0xf0 && m[4] !== 0x72 && m[4] !== 0x1e), [], "a write-type message reached the simulator");
});
await ui.noErrors();
await finish();
