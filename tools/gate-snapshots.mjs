// Acceptance gate for named snapshots per sound. Owned by the architect: builders must not edit it.
//
// TEST-ONLY ENV VAR (set by this gate, read by the main process only when KRONOS_E2E=1):
//   KRONOS_E2E_SNAPSHOTS_DIR = folder that replaces <home>/OpenKronos/Snapshots (the gate creates it and pre-seeds one corrupt file in it).
//
// PURE EXPORTS of src/core/pcg/snapshots.ts (no node: imports; ParamType comes from params.ts; engine is the ParamType of the sound: "hd1" | "exi" | "combi"):
//   const MAX_SNAPSHOTS = 200
//   interface Snapshot { id: string; label: string; time: number /* ms since epoch */; type: ParamType; data: string /* base64 of the sound entry bytes */ }
//   snapshotFile(name: string, engine: ParamType): string   // a file name only (no folder), ends with ".json", never contains / \ : * ? " < > | or "..", at most 100 chars;
//                                                            // same inputs give the same name, a different sound name OR a different engine gives a different name
//   makeSnapshot(label: string, type: ParamType, entry: Uint8Array, time: number): Snapshot   // non-empty unique-per-call id; label trimmed, "" becomes "Snapshot"
//   snapshotEntry(s: Snapshot): Uint8Array                  // exact bytes saved by makeSnapshot
//   addSnapshot(list: readonly Snapshot[], s: Snapshot): Snapshot[]   // new array (input untouched), oldest first, s last; when longer than MAX_SNAPSHOTS the oldest are dropped
//   serializeSnapshots(list: readonly Snapshot[]): string   // JSON text; the JSON is either an array of snapshots or an object holding that array
//   parseSnapshots(text: string): Snapshot[] | null         // null when the text is not valid (bad JSON, wrong shape, bad base64, label/id not strings, time not finite, more than 200); round-trips serializeSnapshots
//   countDiffs(tables: ParamTables, type: ParamType, a: Uint8Array, b: Uint8Array): number   // number of rows of paramsFor(tables, type, a) whose raw value (readParam) differs between a and b
//
// IPC (window.kronos, the renderer never sends a path; the main process picks the file with snapshotFile):
//   snapshotsLoad(name: string, engine: string): Promise<Snapshot[]>   // [] when no file; a corrupt file is renamed to "<snapshotFile>.bad" (kept) and [] is returned; rejects for an engine other than hd1/exi/combi or a non-string name
//   snapshotsSave(name: string, engine: string, list: Snapshot[]): Promise<void>   // validates every field like parseSnapshots, rejects > 200 entries or any bad entry or bad engine, writes atomically (temp file then rename); nothing is written on rejection
//
// data-testid TABLE (all inside the parameter editor of one Program or Combi, visible after the toggle is clicked):
//   snapshots-toggle     button: shows or hides the snapshots panel (aria-expanded "true"/"false")
//   snapshots-panel      the panel
//   snapshots-name       text input: the name for the next snapshot (may be empty)
//   snapshots-save       button: saves the current state of the open sound under that name. Sends nothing to the keyboard
//   snapshots-count      text: number of snapshots stored for this sound and engine, e.g. "2"
//   snapshots-row-<i>    one row per snapshot, i = 0 is the NEWEST
//   snapshots-label-<i>  text: the snapshot's name
//   snapshots-time-<i>   text: when it was saved; contains a clock time such as "14:05"
//   snapshots-diff-<i>   text: the number of parameters that differ between the snapshot and the sound as it is now, e.g. "1"; updates when the sound changes
//   snapshots-restore-<i> button: puts the snapshot's values into the open sound as ONE undo step (no confirm: it is only an editor change)
//   snapshots-error      text: shown when loading or saving the snapshots failed
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("SNAPSHOTS"), { check, finish } = g, C = await core(g), { T, P, L, Q, raw } = C;
let M; try { M = await load("src/core/pcg/snapshots.ts"); } catch (e) { g.fails.push(`cannot load snapshots.ts: ${String(e.message).slice(0, 300)}`); await finish(); }

const BI = "program:INT-B", fresh = () => P.parsePcg(new Uint8Array(raw));
const pan = T.programHd1.find((r) => r.ofs === 92 && r.name === "Panpot"), key = (r) => `${r.ofs}.${r.bitLo ?? 0}`, panKey = key(pan);
const origPan = Q.readParam(L.getEntry(fresh(), BI, 5), pan), editPan = origPan === 10 ? 11 : 10;
const entryWith = (i, v) => { const e = new Uint8Array(L.getEntry(fresh(), BI, i)); Q.writeParam(e, pan, v); return e; };
const nameOf = (i) => L.getName(fresh(), BI, i);

await check("file names are safe, stable and keyed by sound plus engine", () => {
  const a = M.snapshotFile("Warm Pad", "hd1");
  assert.equal(a, M.snapshotFile("Warm Pad", "hd1")); assert.notEqual(a, M.snapshotFile("Warm Pad", "exi")); assert.notEqual(a, M.snapshotFile("Warm Pad 2", "hd1"));
  for (const n of ["../../x", "a/b\\c:d*e?f\"g<h>i|j", "", "...", "x".repeat(400), "CON"]) { const f = M.snapshotFile(n, "combi"); assert.ok(f.endsWith(".json"), f); assert.ok(f.length <= 100, f); assert.ok(!/[\/\\:*?"<>|]/.test(f) && !f.includes(".."), f); }
});
await check("a snapshot keeps the exact bytes of a real sound", () => {
  const e = L.getEntry(fresh(), BI, 5), s = M.makeSnapshot("  Before  ", "hd1", e, 1700000000000);
  assert.equal(s.label, "Before"); assert.equal(s.time, 1700000000000); assert.equal(s.type, "hd1"); assert.ok(s.id && typeof s.id === "string"); assert.deepEqual(M.snapshotEntry(s), e);
  assert.notEqual(M.makeSnapshot("x", "hd1", e, 1).id, M.makeSnapshot("x", "hd1", e, 1).id); assert.equal(M.makeSnapshot("   ", "hd1", e, 1).label, "Snapshot");
});
await check("at most 200 are kept, oldest dropped, input untouched", () => {
  const e = L.getEntry(fresh(), BI, 5); let list = []; for (let i = 0; i < 200; i++) list = M.addSnapshot(list, M.makeSnapshot(`s${i}`, "hd1", e, i));
  assert.equal(list.length, 200); const before = list.slice(), next = M.addSnapshot(list, M.makeSnapshot("new", "hd1", e, 999));
  assert.equal(M.MAX_SNAPSHOTS, 200); assert.equal(next.length, 200); assert.equal(next[0].label, "s1"); assert.equal(next[199].label, "new"); assert.deepEqual(list, before);
});
await check("saved text round-trips and anything damaged is refused", () => {
  const e = L.getEntry(fresh(), BI, 5), list = [M.makeSnapshot("a", "hd1", e, 5), M.makeSnapshot("b", "hd1", e, 6)];
  assert.deepEqual(M.parseSnapshots(M.serializeSnapshots(list)), list); assert.deepEqual(M.parseSnapshots(M.serializeSnapshots([])), []);
  const j = JSON.parse(M.serializeSnapshots(list));
  for (const t of ["", "{", "null", "[]x", JSON.stringify({}), JSON.stringify("x")]) assert.equal(M.parseSnapshots(t), null, t);
  const arr = (c) => (Array.isArray(c) ? c : Object.values(c).find(Array.isArray)), mut = (f) => { const c = structuredClone(j); f(arr(c)[0]); return JSON.stringify(c); };
  assert.equal(M.parseSnapshots(mut((s) => { s.data = "***not base64***"; })), null); assert.equal(M.parseSnapshots(mut((s) => { s.label = 5; })), null); assert.equal(M.parseSnapshots(mut((s) => { s.time = "soon"; })), null);
  const many = Array.from({ length: 201 }, (_, i) => M.makeSnapshot("m", "hd1", e, i)); assert.equal(M.parseSnapshots(M.serializeSnapshots(many)), null);
});
await check("the difference count is the number of changed parameters", () => {
  const a = L.getEntry(fresh(), BI, 5), b = entryWith(5, editPan);
  assert.equal(M.countDiffs(T, "hd1", a, a), 0); assert.equal(M.countDiffs(T, "hd1", a, b), 1); assert.equal(M.countDiffs(T, "hd1", b, a), 1);
  const rows = Q.paramsFor(T, "hd1", a), other = rows.find((r) => r.ofs !== 92 && r.name !== "Name" && r.rawMax > 3 && (r.parts?.length ?? 1) === 1 && (r.ofs < 88 || r.ofs > 96));
  const c = new Uint8Array(b), ov = Q.readParam(c, other); Q.writeParam(c, other, ov === other.rawMin ? other.rawMin + 1 : other.rawMin); assert.equal(M.countDiffs(T, "hd1", a, c), 2);
  assert.ok(M.countDiffs(T, "hd1", L.getEntry(fresh(), BI, 0), L.getEntry(fresh(), BI, 1)) > 20);
});
await testsAndTypes(g, ["core/pcg/snapshots.test.ts"]);
if (g.fails.length) await finish();

// ---- the real app ----
const SNAP = mkdtempSync(path.join(os.tmpdir(), "kronos-snap-")), file = (i) => path.join(SNAP, M.snapshotFile(nameOf(i), "hd1"));
const GARBAGE = "{ this is not json <<<"; writeFileSync(file(7), GARBAGE);
const ui = await launch(g, C, { KRONOS_E2E_SNAPSHOTS_DIR: SNAP }), { X, seen, text, until, win } = ui;
const count = (n) => until(async () => (await text("snapshots-count")) === String(n), `snapshots-count = ${n}`);
const diff = async (i) => text(`snapshots-diff-${i}`), val = async () => text(`value-${panKey}`);
const setPan = async (v) => { await X("param-search").fill("Panpot"); await seen(`input-${panKey}`); await X(`input-${panKey}`).fill(String(v)); await X(`input-${panKey}`).press("Enter"); await until(async () => (await val()) === Q.formatValue(pan, v, T), "panpot shown"); };
const openSnaps = async () => { await seen("snapshots-toggle"); if ((await X("snapshots-toggle").getAttribute("aria-expanded")) !== "true") await X("snapshots-toggle").click(); await seen("snapshots-panel"); };
const midiN = () => win.evaluate(() => window.__kronosE2E.midiLog().length);
const diskList = (i) => M.parseSnapshots(readFileSync(file(i), "utf8"));

await ui.openFile(); await ui.connectSim(); await new Promise((r) => setTimeout(r, 600));
await ui.editSlot(BI, 5); await openSnaps();
await check("a new sound starts with no snapshots and Save adds one without touching the keyboard", async () => {
  await count(0); await X("snapshots-name").fill("Before"); const m0 = await midiN(); await X("snapshots-save").click(); await count(1); await new Promise((r) => setTimeout(r, 400));
  assert.equal(await text("snapshots-label-0"), "Before"); assert.match(await text("snapshots-time-0"), /\d{1,2}:\d{2}/); assert.equal(await diff(0), "0"); assert.equal(await midiN(), m0, "Save sent MIDI to the keyboard");
});
await check("the file on disk is written atomically under the chosen folder with the exact sound bytes", async () => {
  await until(async () => existsSync(file(5)), "file written"); const l = diskList(5); assert.equal(l.length, 1); assert.equal(l[0].label, "Before"); assert.deepEqual(M.snapshotEntry(l[0]), L.getEntry(fresh(), BI, 5));
  assert.deepEqual(readdirSync(SNAP).filter((n) => !/\.json$|\.bad$/.test(n)), [], "leftover temp files");
});
await check("the difference count follows edits, and the newest snapshot is listed first", async () => {
  await setPan(editPan); await until(async () => (await diff(0)) === "1", "diff = 1");
  await X("snapshots-name").fill("After"); await X("snapshots-save").click(); await count(2);
  assert.equal(await text("snapshots-label-0"), "After"); assert.equal(await text("snapshots-label-1"), "Before"); assert.equal(await diff(0), "0"); assert.equal(await diff(1), "1");
});
await check("Restore puts the old values back as one undo step", async () => {
  await X("snapshots-restore-1").click(); await until(async () => (await val()) === Q.formatValue(pan, origPan, T), "restored"); await until(async () => (await diff(1)) === "0" && (await diff(0)) === "1", "diffs swapped");
  await X("undo").click(); await until(async () => (await val()) === Q.formatValue(pan, editPan, T), "one undo returns the edit"); await X("redo").click(); await until(async () => (await val()) === Q.formatValue(pan, origPan, T), "redo restores again");
  await X("undo").click(); await until(async () => (await val()) === Q.formatValue(pan, editPan, T), "undone"); assert.equal(await text("snapshots-count"), "2");
});
await check("snapshots belong to one sound and survive leaving and returning", async () => {
  await X("param-search").fill(""); await ui.closeEditor(); await ui.editSlot(BI, 6); await openSnaps(); await count(0); assert.equal(existsSync(file(6)), false);
  await ui.closeEditor(); await ui.editSlot(BI, 5); await openSnaps(); await count(2); assert.equal(await text("snapshots-label-1"), "Before");
});
await check("a corrupt file is kept as .bad and treated as empty, and saving works afterwards", async () => {
  await ui.closeEditor(); await ui.editSlot(BI, 7); await openSnaps(); await count(0); const bad = file(7) + ".bad"; await until(async () => existsSync(bad), ".bad kept");
  assert.equal(readFileSync(bad, "utf8"), GARBAGE); await X("snapshots-name").fill("Fresh"); await X("snapshots-save").click(); await count(1); await until(async () => existsSync(file(7)) && (diskList(7) ?? []).length === 1, "valid file written");
  assert.equal(readFileSync(bad, "utf8"), GARBAGE);
});
await check("the 200 limit holds in the app: one more drops the oldest", async () => {
  const e = L.getEntry(fresh(), BI, 8); let list = []; for (let i = 0; i < 200; i++) list = M.addSnapshot(list, M.makeSnapshot(`old${i}`, "hd1", e, 1000 + i));
  await win.evaluate(([n, l]) => window.kronos.snapshotsSave(n, "hd1", l), [nameOf(8), list]);
  await ui.closeEditor(); await ui.editSlot(BI, 8); await openSnaps(); await count(200); await X("snapshots-name").fill("Newest"); await X("snapshots-save").click(); await until(async () => (await text("snapshots-label-0")) === "Newest", "newest first"); await count(200);
  await until(async () => { const l = diskList(8); return l && l.length === 200 && l[199].label === "Newest" && l[0].label === "old1"; }, "disk holds 200 without old0");
});
await check("the main process refuses bad requests and writes nothing for them", async () => {
  const e = L.getEntry(fresh(), BI, 9), one = M.makeSnapshot("ok", "hd1", e, 5), many = Array.from({ length: 201 }, (_, i) => M.makeSnapshot("m", "hd1", e, i));
  const r = (fn, a) => win.evaluate(([f, x]) => window.kronos[f](...x).then(() => "ok", () => "refused"), [fn, a]), before = readdirSync(SNAP).sort().join();
  assert.equal(await r("snapshotsLoad", ["x", "../evil"]), "refused"); assert.equal(await r("snapshotsLoad", [5, "hd1"]), "refused");
  assert.equal(await r("snapshotsSave", ["Zed", "evil", [one]]), "refused"); assert.equal(await r("snapshotsSave", ["Zed", "hd1", many]), "refused");
  assert.equal(await r("snapshotsSave", ["Zed", "hd1", "nope"]), "refused"); assert.equal(await r("snapshotsSave", ["Zed", "hd1", [{ ...one, data: "***" }]]), "refused"); assert.equal(await r("snapshotsSave", ["Zed", "hd1", [{ ...one, time: "x" }]]), "refused");
  assert.equal(readdirSync(SNAP).sort().join(), before, "files appeared for refused requests");
  assert.equal(await r("snapshotsSave", ["../../Zed", "hd1", [one]]), "ok"); assert.equal(readdirSync(SNAP).length, before.split(",").length + 1, "a hostile name must still land inside the folder");
  assert.equal(existsSync(path.join(SNAP, "..", "Zed.json")), false); assert.equal(existsSync(path.join(SNAP, "..", "..", "Zed.json")), false);
});
await ui.noErrors();
await finish();
