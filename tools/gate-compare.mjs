// Acceptance gate for comparing files and sounds. Owned by the architect: builders must not edit it.
//
// TEST-ONLY ENV VAR (set by this gate, read by the main process only when KRONOS_E2E=1):
//   KRONOS_E2E_COMPARE = path of the file that "Open compare file" returns (the real app shows a dialog; the renderer never sends a path).
//
// IPC: window.kronos.compareOpen(): Promise<OpenedFile | null>   (no arguments; bytes only; the main process never keeps the file writable)
//
// PURE EXPORTS of src/core/pcg/compare.ts (a = the open file, b = the compare file; no node: imports):
//   type SlotRef  = { key: string; index: number }
//   type CopyItem = { from: SlotRef; to: SlotRef }              // from is read in the compare file, to is written in the open file
//   type BankDiff = { key: string; label: string; count: number; differing: number }
//   type SlotDiff = { index: number; nameA: string; nameB: string; differs: boolean }
//   type ParamDiff = { group: string; name: string; a: string; b: string }   // a and b are formatValue(row, value, tables) text
//   compareBanks(a: PcgFile, b: PcgFile): BankDiff[]            // banks in both files with the same count; differing = slots whose entry bytes differ; order of listBanks(a)
//   compareSlots(a: PcgFile, b: PcgFile, key: string, differingOnly?: boolean): SlotDiff[]   // one row per slot (only differing ones when differingOnly), ascending index
//   copyBlocker(dst: PcgFile, src: PcgFile, item: CopyItem): string | null   // null if allowed, else the reason; uses the copy rules (same kind, engine type, entry size) and index range
//   copyFromCompare(dst: PcgFile, src: PcgFile, items: CopyItem[]): void     // all-or-nothing: validates every item first and throws (dst untouched) if any is blocked; src is never changed; checksums updated
//   changedTargets(current: PcgFile, saved: PcgFile, items: CopyItem[]): CopyItem[]   // the items whose target slot in current differs from the same slot in saved (last-saved bytes)
//   diffSounds(tables: ParamTables, a: { type: ParamType; entry: Uint8Array }, b: { type: ParamType; entry: Uint8Array }): ParamDiff[]
//       // only parameters whose raw value differs (rows from paramsFor); a is the first sound, b the second; rows of one group are adjacent, groups in row order; identical sounds give []
//
// data-testid TABLE (all names must exist):
//   compare-open            button (toolbar): opens the compare file through window.kronos.compareOpen()
//   compare-file-name       text: the compare file's name, shown once it is open
//   compare-panel           the compare panel (visible once a compare file is open)
//   compare-count-<key>     text inside the panel: number of differing slots in bank <key>, for example compare-count-program:INT-B -> "2"
//   compare-bank-<key>      button: shows that bank's slots in the compare list
//   compare-only-diff       checkbox: differing-only filter (off by default)
//   compare-row-<index>     one row per listed slot of the chosen bank, <index> = slot index in the bank
//   compare-name-a-<index>  text: name in the open file;  compare-name-b-<index>  text: name in the compare file
//   compare-select-<index>  checkbox: selects the slot for copying
//   compare-target-bank     <select>: bank in the open file that receives the copy (default: same bank as listed)
//   compare-target          <input type=number>: first selected slot goes to this slot index (empty = same slots)
//   compare-copy-selected   button: copy selected slots from the compare file into the open file as ONE undo step
//   compare-error           text: reason shown when a copy is refused (nothing is changed)
//   compare-ref-a / compare-ref-b   <input>: a sound, as "<side>|<bankkey>|<index>" with side open or compare, e.g. "compare|program:INT-B|5"
//   compare-diff-go         button: builds the parameter diff of ref A against ref B
//   compare-param-count     text: number of rows in the diff table
//   compare-param-row-<n>   row n (0-based);  compare-param-group-<n>, compare-param-name-<n>, compare-param-a-<n>, compare-param-b-<n>  its cells
//   compare-toggle          button (in the editor): shows the last-saved values of the current sound / switches back; aria-pressed="true" while showing saved values
// The existing confirm dialog (confirm-message, confirm-ok, confirm-cancel) is used for the overwrite confirm. Existing ids (value-<k>, input-<k>, row-name-<i>, changes-count, undo, redo) are reused.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate, core, launch, load, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("COMPARE"), { check, finish } = g, C = await core(g), { T, P, L, Q, raw } = C;
let M; try { M = await load("src/core/pcg/compare.ts"); } catch (e) { g.fails.push(`cannot load compare.ts: ${String(e.message).slice(0, 300)}`); await finish(); }

const BI = "program:INT-B", BA = "program:INT-A", BC = "combi:INT-A";
const fresh = () => P.parsePcg(new Uint8Array(raw));
const pan = T.programHd1.find((r) => r.ofs === 92 && r.name === "Panpot"), key = (r) => `${r.ofs}.${r.bitLo ?? 0}`, panKey = key(pan);
const origPan = Q.readParam(L.getEntry(fresh(), BI, 5), pan), newPan = origPan === 64 ? 63 : 64, editPan = origPan === 10 ? 11 : 10;
// The compare file: factory with slot 5 of INT-B renamed and its Panpot changed, slot 9 of INT-B renamed, slot 2 of combi INT-A renamed.
const variant = () => { const f = fresh(); L.setName(f, BI, 5, "Cmp Five"); Q.writeParam(L.viewEntry(f, BI, 5), pan, newPan); L.commitBank(f, BI); L.setName(f, BI, 9, "Cmp Nine"); L.setName(f, BC, 2, "Cmp Combi"); return f; };
const V = variant(), VBYTES = P.serializePcg(V);
const nameOf = (f, k, i) => L.getName(f, k, i);
const allEntries = (f) => L.listBanks(f).filter((b) => b.kind !== "setlist").flatMap((b) => Array.from({ length: b.count }, (_, i) => [b.key, i]));
const snap = (f) => sha(P.serializePcg(f));
const it = (fk, fi, tk, ti) => ({ from: { key: fk, index: fi }, to: { key: tk, index: ti } });

await check("bank summary counts the differing slots", () => {
  const same = M.compareBanks(fresh(), fresh()); assert.ok(same.length >= 30, `${same.length} banks`); assert.ok(same.every((d) => d.differing === 0 && d.count > 0 && typeof d.label === "string"));
  const d = M.compareBanks(fresh(), V), by = Object.fromEntries(d.map((x) => [x.key, x.differing]));
  assert.equal(by[BI], 2); assert.equal(by[BC], 1); assert.equal(by[BA], 0); assert.equal(d.filter((x) => x.differing > 0).length, 2); assert.equal(d.find((x) => x.key === BI).count, 128);
});
await check("slot list shows both names and filters to the differences", () => {
  const a = fresh(), all = M.compareSlots(a, V, BI), few = M.compareSlots(a, V, BI, true);
  assert.equal(all.length, 128); assert.deepEqual(few.map((s) => s.index), [5, 9]); assert.ok(few.every((s) => s.differs)); assert.equal(all.filter((s) => s.differs).length, 2);
  assert.deepEqual(few[1], { index: 9, nameA: nameOf(a, BI, 9), nameB: "Cmp Nine", differs: true }); assert.equal(few[0].nameB, "Cmp Five"); assert.equal(all[0].differs, false); assert.equal(all[0].nameA, all[0].nameB);
});
await check("the parameter diff lists exactly the changed settings by value", () => {
  const A = { type: "hd1", entry: L.getEntry(fresh(), BI, 5) }, B = { type: "hd1", entry: L.getEntry(V, BI, 5) }, d = M.diffSounds(T, A, B);
  const p = d.find((x) => x.name === "Panpot" && x.group === pan.group); assert.ok(p, "no Panpot row"); assert.equal(p.a, Q.formatValue(pan, origPan, T)); assert.equal(p.b, Q.formatValue(pan, newPan, T)); assert.notEqual(p.a, p.b);
  assert.ok(d.every((x) => x.a !== x.b && x.group && x.name)); assert.ok(d.length <= 3, `${d.length} rows: only the name and Panpot differ`); assert.deepEqual(M.diffSounds(T, A, A), []);
  const r = M.diffSounds(T, B, A).find((x) => x.name === "Panpot"); assert.equal(r.a, p.b); assert.equal(r.b, p.a);
  const x = M.diffSounds(T, { type: "exi", entry: L.getEntry(fresh(), BA, 0) }, { type: "hd1", entry: L.getEntry(fresh(), BI, 0) }); assert.ok(x.length > 50, "different programs differ in many settings");
  const seen = new Set(); let last = null; for (const row of x) { if (row.group !== last) { assert.ok(!seen.has(row.group), `group ${row.group} is split`); seen.add(row.group); last = row.group; } }
});
await check("copy rules: only compatible types and engines, real slots", () => {
  const a = fresh();
  assert.equal(M.copyBlocker(a, V, it(BI, 5, BI, 5)), null); assert.equal(M.copyBlocker(a, V, it(BI, 5, "program:INT-C", 70)), null); assert.equal(M.copyBlocker(a, V, it(BC, 2, "combi:INT-B", 1)), null);
  for (const bad of [it(BA, 0, BI, 0), it(BI, 0, BA, 0), it(BI, 5, BC, 5), it(BC, 2, BI, 2), it(BI, 128, BI, 0), it(BI, 0, BI, 128), it(BI, -1, BI, 0), it(BI, 0, "program:NOPE", 0), it("program:NOPE", 0, BI, 0)]) { const r = M.copyBlocker(a, V, bad); assert.equal(typeof r, "string", JSON.stringify(bad)); assert.ok(r.length > 3); }
});
await check("copying changes only the chosen slots and keeps the compare file", () => {
  const a = fresh(), before = snap(a), vs = snap(V), orig = new Map(allEntries(a).map(([k, i]) => [`${k}#${i}`, L.getEntry(a, k, i)]));
  M.copyFromCompare(a, V, [it(BI, 5, BI, 5), it(BI, 9, BI, 20), it(BC, 2, "combi:INT-C", 0)]);
  assert.deepEqual(L.getEntry(a, BI, 5), L.getEntry(V, BI, 5)); assert.deepEqual(L.getEntry(a, BI, 20), L.getEntry(V, BI, 9)); assert.deepEqual(L.getEntry(a, "combi:INT-C", 0), L.getEntry(V, BC, 2));
  assert.equal(nameOf(a, BI, 20), "Cmp Nine"); assert.deepEqual(P.verifyChecksums(a), []); assert.equal(snap(V), vs); assert.notEqual(snap(a), before);
  const touched = new Set([`${BI}#5`, `${BI}#20`, "combi:INT-C#0"]); for (const [k, i] of allEntries(a)) if (!touched.has(`${k}#${i}`)) assert.deepEqual(L.getEntry(a, k, i), orig.get(`${k}#${i}`), `${k} ${i} changed`);
});
await check("one blocked item stops the whole copy and leaves the file untouched", () => {
  const a = fresh(), before = snap(a);
  assert.throws(() => M.copyFromCompare(a, V, [it(BI, 5, BI, 5), it(BC, 2, BI, 6)])); assert.equal(snap(a), before);
  assert.throws(() => M.copyFromCompare(a, V, [it(BI, 5, BI, 5), it(BI, 9, BI, 999)])); assert.equal(snap(a), before);
});
await check("changed targets are found against the last-saved file", () => {
  const saved = fresh(), cur = fresh(), items = [it(BI, 5, BI, 5), it(BI, 9, BI, 9), it(BI, 5, BI, 20)];
  assert.deepEqual(M.changedTargets(cur, saved, items), []); L.setName(cur, BI, 9, "Edited"); Q.writeParam(L.viewEntry(cur, BI, 20), pan, editPan); L.commitBank(cur, BI);
  assert.deepEqual(M.changedTargets(cur, saved, items), [items[1], items[2]]);
});
await testsAndTypes(g, ["core/pcg/compare.test.ts"]);
if (g.fails.length) await finish();

// ---- the real app ----
const CMPDIR = mkdtempSync(path.join(os.tmpdir(), "kronos-cmp-")), CMP = path.join(CMPDIR, "other.PCG"); writeFileSync(CMP, VBYTES); const cmpSha = sha(VBYTES);
const ui = await launch(g, C, { KRONOS_E2E_COMPARE: CMP }), { X, seen, text, until, win } = ui;
const orig = (k, i) => L.getEntry(fresh(), k, i);
const savedFile = async () => P.parsePcg(await ui.saved());
const rowName = async (i) => text(`row-name-${i}`);
const count = async (id, n) => until(async () => (await text(id)) === String(n), `${id} = ${n}`);
const midi = () => win.evaluate(() => window.__kronosE2E.midiLog().length);

await ui.openFile();
await ui.connectSim(); await new Promise((r) => setTimeout(r, 600)); const midi0 = await midi();
await check("opening a compare file shows per-bank counts, names and the differing-only filter", async () => {
  assert.equal(await win.evaluate(() => window.kronos.compareOpen.length), 0, "compareOpen must take no arguments");
  await X("compare-open").click(); await seen("compare-panel"); await until(async () => /other\.PCG/.test(await text("compare-file-name")), "file name");
  await seen(`compare-count-${BI}`); assert.equal(await text(`compare-count-${BI}`), "2"); assert.equal(await text(`compare-count-${BC}`), "1"); assert.equal(await text(`compare-count-${BA}`), "0");
  await X(`compare-bank-${BI}`).click(); await seen("compare-row-0"); assert.equal(await text("compare-name-a-9"), orig(BI, 9) && L.getName(fresh(), BI, 9)); assert.equal(await text("compare-name-b-9"), "Cmp Nine"); assert.equal(await text("compare-name-b-5"), "Cmp Five");
  await X("compare-only-diff").check(); await until(async () => (await win.locator('[data-testid^="compare-row-"]').count()) === 2, "two rows"); await seen("compare-row-5"); await seen("compare-row-9"); assert.equal(await X("compare-row-0").count(), 0);
  await X("compare-only-diff").uncheck(); await seen("compare-row-0"); await X("compare-only-diff").check(); await count("changes-count", 0);
});
await check("the parameter diff table shows A and B for sounds from either file", async () => {
  await X("compare-ref-a").fill(`open|${BI}|5`); await X("compare-ref-b").fill(`compare|${BI}|5`); await X("compare-diff-go").click(); await seen("compare-param-row-0");
  const rows = async () => { const n = Number(await text("compare-param-count")), out = []; for (let i = 0; i < n; i++) out.push([await text(`compare-param-group-${i}`), await text(`compare-param-name-${i}`), await text(`compare-param-a-${i}`), await text(`compare-param-b-${i}`)]); return out; };
  let r = await rows(), p = r.find((x) => x[1] === "Panpot"); assert.ok(p, "no Panpot row"); assert.equal(p[0], pan.group); assert.equal(p[2], Q.formatValue(pan, origPan, T)); assert.equal(p[3], Q.formatValue(pan, newPan, T));
  await X("compare-ref-a").fill(`compare|${BI}|5`); await X("compare-ref-b").fill(`open|${BI}|5`); await X("compare-diff-go").click();
  await until(async () => { const q = (await rows()).find((x) => x[1] === "Panpot"); return q && q[2] === p[3]; }, "A and B swapped"); r = await rows(); assert.equal(r.find((x) => x[1] === "Panpot")[3], p[2]);
  await X("compare-ref-a").fill(`open|${BI}|5`); await X("compare-ref-b").fill(`open|${BI}|5`); await X("compare-diff-go").click(); await count("compare-param-count", 0); await count("changes-count", 0);
});
await check("selected slots copy from the compare file as one undo step, with no confirm for unchanged targets", async () => {
  await X(`compare-bank-${BI}`).click(); await seen("compare-row-5"); await X("compare-select-5").check(); await X("compare-select-9").check(); await X("compare-copy-selected").click();
  await until(async () => (await rowName(9)) === "Cmp Nine" && (await rowName(5)) === "Cmp Five", "names copied", 8000); assert.equal(await X("confirm-ok").count(), 0, "no confirm for unchanged targets");
  await X("undo").click(); await until(async () => (await rowName(9)) === L.getName(fresh(), BI, 9) && (await rowName(5)) === L.getName(fresh(), BI, 5), "one undo reverts both"); await count("changes-count", 0);
  await X("redo").click(); await until(async () => (await rowName(9)) === "Cmp Nine" && (await rowName(5)) === "Cmp Five", "redo"); await X("undo").click(); await until(async () => (await rowName(9)) === L.getName(fresh(), BI, 9), "undone again");
});
await check("a copy can go to a chosen slot, and an incompatible target is refused", async () => {
  await X("compare-select-5").uncheck(); await X("compare-target").fill("20"); await X("compare-copy-selected").click();
  await until(async () => (await rowName(20)) === "Cmp Nine", "copied to slot 20", 8000); assert.equal(await rowName(9), L.getName(fresh(), BI, 9)); assert.equal(await rowName(5), L.getName(fresh(), BI, 5));
  const changes = await text("changes-count"); await X("compare-select-9").uncheck(); await X(`compare-bank-${BA}`).click(); await seen("compare-row-0"); await X("compare-select-0").check(); await X("compare-target").fill(""); await X("compare-target-bank").selectOption(BI);
  await X("compare-copy-selected").click(); await seen("compare-error"); assert.match(await text("compare-error"), /cannot|engine|type|differ|incompatible/i); assert.equal(await text("changes-count"), changes);
  assert.equal(await rowName(0), L.getName(fresh(), BI, 0)); await X("compare-select-0").uncheck();
});
await check("overwriting a changed slot asks first, and the copy sends nothing to the keyboard", async () => {
  await X(`compare-bank-${BI}`).click(); await seen("compare-row-5"); await X("compare-target-bank").selectOption(BI); await X("compare-select-5").check(); await X("compare-target").fill("20"); await X("compare-copy-selected").click();
  await seen("confirm-message"); await X("confirm-cancel").click(); await X("confirm-message").waitFor({ state: "hidden", timeout: 10000 }); assert.equal(await rowName(20), "Cmp Nine");
  await X("compare-copy-selected").click(); await ui.ok(); await until(async () => (await rowName(20)) === "Cmp Five", "overwritten after OK", 8000);
  await X("compare-select-5").uncheck(); await X("compare-target").fill(""); assert.equal(await midi(), midi0, "comparing and copying must not send anything to the keyboard");
});
await check("the editor's Compare button shows the last-saved value and switches back without losing the edit", async () => {
  await ui.editSlot(BI, 5); await X("group-Insert Effect1").click(); await seen(`param-${panKey}`);
  await X(`input-${panKey}`).fill(String(editPan)); await X(`input-${panKey}`).press("Enter"); await until(async () => (await X(`param-${panKey}`).getAttribute("data-changed")) === "true", "edited");
  const edited = Q.formatValue(pan, editPan, T), savedText = Q.formatValue(pan, origPan, T); assert.equal((await text(`value-${panKey}`)), edited);
  await X("compare-toggle").click(); await until(async () => (await text(`value-${panKey}`)) === savedText, "shows saved value"); assert.equal(await X("compare-toggle").getAttribute("aria-pressed"), "true");
  await X("compare-toggle").click(); await until(async () => (await text(`value-${panKey}`)) === edited, "back to the edit"); assert.notEqual(await X("compare-toggle").getAttribute("aria-pressed"), "true");
  await X("compare-toggle").click(); await X("compare-toggle").click(); assert.equal((await text(`value-${panKey}`)), edited); await ui.closeEditor();
});
await check("the saved file has only the copies and the edit, and the compare file is unchanged", async () => {
  const f = await savedFile(), v = fresh();
  assert.deepEqual(L.getEntry(f, BI, 20), L.getEntry(V, BI, 5)); const p5 = L.getEntry(f, BI, 5), o5 = orig(BI, 5); assert.equal(Q.readParam(p5, pan), editPan);
  const m = new Uint8Array(o5); Q.writeParam(m, pan, editPan); assert.deepEqual(p5, m, "slot 5 differs from the original outside Panpot");
  for (const [k, i] of allEntries(v)) if (!(k === BI && (i === 5 || i === 20))) assert.deepEqual(L.getEntry(f, k, i), L.getEntry(v, k, i), `${k} ${i} changed`);
  assert.equal(sha(new Uint8Array(readFileSync(CMP))), cmpSha, "compare file changed on disk");
});
await ui.noErrors();
try { rmSync(CMPDIR, { recursive: true, force: true }); } catch {}
await finish();
