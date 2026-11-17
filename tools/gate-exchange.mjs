// Acceptance gate for importing and exporting sounds (.ksound packs). Owned by the architect: builders must not edit it.
//
// PURE EXPORTS of src/core/pcg/exchange.ts (the builder implements exactly these):
//   export const MAX_PACK_BYTES: number                       // hard size limit of a pack file (positive, at most 64 MiB; the gate writes a file of MAX_PACK_BYTES + 1 bytes)
//   export type PackSound = { type: "program"|"combi"|"drumkit"|"waveseq"; engine: "exi"|"hd1"|null; name: string; data: string /* base64 of the whole bank entry, getEntry() bytes */; sha256: string /* lowercase hex of those bytes */ }
//   export type SoundPack = { format: "kronos-sounds"; version: 1; name: string; sounds: PackSound[]; programs: PackSound[] /* Programs referenced by exported Combis, deduplicated; [] otherwise */ }
//   export type ImportRow = { index: number /* position in pack.sounds */; key: string; slot: number /* target bank key and slot */; incoming: string; existing: string /* names */; overwrite: boolean; error: string | null /* non-null = incompatible */ }
//   export function exportPack(file: PcgFile, slots: {key: string; index: number}[], name: string): string      // JSON text; sounds in the order of slots
//   export function parsePack(input: string | Uint8Array): SoundPack      // untrusted: throws Error on bad size, JSON, shape, version, type, size per type, sha256 mismatch; never pollutes prototypes
//   export function planImport(file: PcgFile, pack: SoundPack, targets: {key: string; index: number}[]): ImportRow[]   // pack.sounds[i] goes to targets[i]; one row per sound; error when kind, engine or size differs, or the target is missing
//   export function applyImport(file: PcgFile, pack: SoundPack, targets: {key: string; index: number}[]): void       // throws BEFORE writing anything if any row has an error
//
// TEST-ONLY ENV VARS (read only when KRONOS_E2E=1; this gate sets both): KRONOS_E2E_EXCHANGE_SAVE = path the save dialog would return for export; KRONOS_E2E_EXCHANGE_OPEN = path the open dialog would return for import.
//
// data-testid table (all in the renderer):
//   exchange-open           top-level button (disabled with no file open) that toggles the exchange panel
//   exchange-panel          the panel itself
//   exchange-export         exports the currently selected slots of the open bank (button; main process shows the save dialog)
//   exchange-import         picks a pack file, parses it and shows the preview (button); targets = the selected slots in order, or if one slot is selected, consecutive slots from it
//   exchange-status         text of the last result, e.g. "Exported 3 sounds" (must match /Exported 3/)
//   exchange-error          text of a refused file or action (the whole reason, e.g. mentions the size limit or sha256)
//   exchange-preview-row-N  row N of the preview: its text contains the incoming name, the existing name of the target, /overwrite/i if overwrite, /incompatible/i if error
//   exchange-apply          applies the preview as ONE undo step, after the app's confirm dialog (confirm-ok); disabled while the preview has an error row
//   exchange-close          closes the panel
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate, core, launch, load, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("EXCHANGE"), { check, finish } = g, C = await core(g);
let E; try { E = await load("src/core/pcg/exchange.ts"); } catch (e) { g.fails.push(`cannot load exchange.ts: ${e.message}`); await finish(); }
const { L, P } = C, f = () => C.parsed();
const banks = L.listBanks(f());
const exi = banks.filter((b) => b.kind === "program" && b.type === "exi").map((b) => b.key), hd1 = banks.find((b) => b.kind === "program" && b.type === "hd1")?.key, cmb = banks.find((b) => b.kind === "combi").key;
const [A, B] = exi, S = (key, ...ix) => ix.map((index) => ({ key, index }));
const pack = (slots, name = "Test pack") => JSON.parse(E.exportPack(f(), slots, name));
const b64 = (u) => Buffer.from(u).toString("base64");
const reject = (what, text, re) => assert.throws(() => E.parsePack(text), re, what);
// slots whose bytes differ between a saved file and the factory file
const slotDiff = (bytes) => { const a = P.parsePcg(bytes), b = f(), out = []; for (const k of L.listBanks(b)) for (let i = 0; i < k.count; i++) if (Buffer.compare(L.getEntry(a, k.key, i), L.getEntry(b, k.key, i))) out.push(`${k.key}:${i}`); return out; };

await check("export writes a versioned pack with real bytes, names and sha256", () => {
  const p = pack(S(A, 0, 1, 2)); assert.equal(p.format, "kronos-sounds"); assert.equal(p.version, 1); assert.equal(p.name, "Test pack"); assert.equal(p.sounds.length, 3); assert.deepEqual(p.programs, []);
  p.sounds.forEach((s, i) => { const d = L.getEntry(f(), A, i); assert.equal(s.type, "program"); assert.equal(s.engine, "exi"); assert.equal(s.name, L.getName(f(), A, i)); assert.equal(s.data, b64(d)); assert.equal(s.sha256, sha(d)); });
});
await check("the engine is recorded for HD-1 Programs and Combis", () => {
  assert.ok(hd1, "factory has an HD-1 bank"); const h = pack(S(hd1, 0)).sounds[0]; assert.equal(h.engine, "hd1"); assert.equal(h.type, "program"); assert.equal(Buffer.from(h.data, "base64").length, banks.find((b) => b.key === hd1).entrySize);
  const c = pack(S(cmb, 0)).sounds[0]; assert.equal(c.type, "combi"); assert.equal(c.engine, null);
});
await check("a Combi export carries the Programs it uses, once each", () => {
  const p = pack(S(cmb, 0, 1)); assert.ok(p.programs.length > 0, "no referenced programs"); const known = new Set(); for (const k of L.listBanks(f())) if (k.kind === "program") for (let i = 0; i < k.count; i++) known.add(sha(L.getEntry(f(), k.key, i)));
  for (const s of p.programs) { assert.equal(s.type, "program"); assert.ok(known.has(s.sha256), `${s.name} is not a factory Program`); assert.equal(sha(Buffer.from(s.data, "base64")), s.sha256); }
  assert.equal(new Set(p.programs.map((s) => s.sha256)).size, p.programs.length, "duplicates");
});
await check("a pack parses back to the same content, from text or bytes", () => { const txt = E.exportPack(f(), S(A, 3, 4), "Round"); const p = E.parsePack(txt), q = E.parsePack(new TextEncoder().encode(txt)); assert.deepEqual(p, JSON.parse(txt)); assert.deepEqual(q, p); });
await check("an untrusted file is refused: size, JSON, shape, version, type", () => {
  assert.ok(Number.isInteger(E.MAX_PACK_BYTES) && E.MAX_PACK_BYTES > 0 && E.MAX_PACK_BYTES <= 64 * 1048576);
  reject("too large", " ".repeat(E.MAX_PACK_BYTES + 1), /too large|size|limit/i); reject("not json", "{nope", /./); reject("array", "[]", /./); reject("empty", "", /./);
  const ok = pack(S(A, 0));
  for (const [what, mut] of [["version", (o) => { o.version = 2; }], ["format", (o) => { o.format = "other"; }], ["type", (o) => { o.sounds[0].type = "banana"; }], ["sounds missing", (o) => { delete o.sounds; }], ["data not base64", (o) => { o.sounds[0].data = "***"; }], ["name not string", (o) => { o.sounds[0].name = 5; }], ["engine", (o) => { o.sounds[0].engine = "hd9"; }]]) { const o = structuredClone(ok); mut(o); reject(what, JSON.stringify(o), /./); }
});
await check("a wrong sha256 or a wrong size for the type is refused", () => {
  const o = pack(S(A, 0)); const bad = structuredClone(o); bad.sounds[0].sha256 = "0".repeat(64); reject("sha", JSON.stringify(bad), /sha256|hash|checksum/i);
  const flip = structuredClone(o), d = Buffer.from(flip.sounds[0].data, "base64"); d[100] ^= 1; flip.sounds[0].data = b64(d); reject("tampered", JSON.stringify(flip), /sha256|hash|checksum/i);
  const short = structuredClone(o), t = Buffer.from(short.sounds[0].data, "base64").subarray(0, 100); short.sounds[0].data = b64(t); short.sounds[0].sha256 = sha(t); reject("size", JSON.stringify(short), /size|bytes|length/i);
  const asCombi = structuredClone(o); asCombi.sounds[0].type = "combi"; reject("type size", JSON.stringify(asCombi), /size|bytes|length|sha256|engine/i);
  const refd = pack(S(cmb, 0)); refd.programs[0].sha256 = "f".repeat(64); reject("referenced program sha", JSON.stringify(refd), /sha256|hash|checksum/i);
});
await check("no prototype pollution from __proto__, constructor or prototype keys", () => {
  const txt = E.exportPack(f(), S(A, 0), "P").replace(/^\{/, '{"__proto__":{"polluted":"top"},"constructor":{"prototype":{"polluted":"ctor"}},').replace(/"type":"program"/, '"__proto__":{"polluted":"item"},"type":"program"');
  let p; try { p = E.parsePack(txt); } catch { /* refusing is fine */ }
  assert.equal({}.polluted, undefined); assert.equal(Object.getPrototypeOf(p ?? {}), Object.prototype);
  if (p) for (const o of [p, ...p.sounds]) { assert.equal(Object.hasOwn(o, "__proto__"), false); assert.equal(o.polluted, undefined); }
  E.parsePack(E.exportPack(f(), S(A, 0), "ok")); assert.equal({}.polluted, undefined);
});
await check("the import preview marks overwrites and incompatible targets", () => {
  const p = E.parsePack(E.exportPack(f(), S(A, 0, 1), "X")), rows = E.planImport(f(), p, S(B, 5, 6));
  rows.forEach((r, i) => { assert.equal(r.index, i); assert.equal(r.key, B); assert.equal(r.slot, 5 + i); assert.equal(r.incoming, L.getName(f(), A, i)); assert.equal(r.existing, L.getName(f(), B, 5 + i)); assert.equal(r.overwrite, true); assert.equal(r.error, null); });
  assert.ok(E.planImport(f(), p, S(cmb, 0, 1)).every((r) => typeof r.error === "string" && r.error.length > 0), "Program into a Combi bank");
  assert.ok(E.planImport(f(), p, S(hd1, 0, 1)).every((r) => r.error), "EXi Program into an HD-1 bank");
  assert.ok(E.planImport(f(), p, S(B, 127, 500))[1].error, "missing target slot");
  const c = E.parsePack(E.exportPack(f(), S(cmb, 0), "C")); assert.equal(E.planImport(f(), c, S(cmb, 3))[0].error, null); assert.ok(E.planImport(f(), c, S(A, 3))[0].error);
});
await check("applying changes only the target slots and keeps the file valid", () => {
  const file = f(), orig = f(), p = E.parsePack(E.exportPack(file, S(A, 0, 1), "X")); E.applyImport(file, p, S(B, 5, 6));
  [5, 6].forEach((i) => assert.equal(Buffer.compare(L.getEntry(file, B, i), L.getEntry(orig, A, i - 5)), 0)); assert.deepEqual(P.verifyChecksums(file), []);
  for (const k of L.listBanks(file)) for (let i = 0; i < k.count; i++) if (!(k.key === B && (i === 5 || i === 6))) assert.equal(Buffer.compare(L.getEntry(orig, k.key, i), L.getEntry(file, k.key, i)), 0, `${k.key}:${i}`);
});
await check("an import with any incompatible row writes nothing at all", () => {
  const file = f(), before = Buffer.from(file.bytes), p = E.parsePack(E.exportPack(f(), [...S(A, 0), ...S(cmb, 0)], "Mixed")); assert.throws(() => E.applyImport(file, p, [...S(B, 5), ...S(A, 1)]));
  assert.deepEqual(Buffer.from(file.bytes), before);
});
await testsAndTypes(g, ["core/pcg/exchange.test.ts"]);
if (g.fails.length) await finish();

const SAVEP = path.join(os.tmpdir(), `gate-exchange-${process.pid}-out.ksound`), OPENP = path.join(os.tmpdir(), `gate-exchange-${process.pid}-in.ksound`);
const ui = await launch(g, C, { KRONOS_E2E_EXCHANGE_SAVE: SAVEP, KRONOS_E2E_EXCHANGE_OPEN: OPENP });
const { X, seen, text, until, win } = ui;
const names = async (n) => { const o = []; for (let i = 0; i < n; i++) o.push(await text(`row-name-${i}`)); return o; };
const rowsCount = () => win.locator('[data-testid^="exchange-preview-row-"]').count();
const openPanel = async () => { if (!(await X("exchange-panel").isVisible().catch(() => false))) await X("exchange-open").click(); await seen("exchange-panel"); };
const pick = async (key, ...ix) => { await ui.openBank(key); await X(`row-${ix[0]}`).click(); for (const i of ix.slice(1)) await X(`row-${i}`).click({ modifiers: ["Control"] }); };
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const srcNames = [0, 1, 2].map((i) => L.getName(f(), A, i)), oldNames = [5, 6, 7].map((i) => L.getName(f(), B, i));
const want = (list) => async () => (await names(8)).slice(5).join("|") === list.join("|");

await ui.openFile();
await check("Export saves the selected slots as a valid pack", async () => {
  await pick(A, 0, 1, 2); await openPanel(); await X("exchange-export").click(); await until(async () => /Exported 3/.test(await text("exchange-status")), "export status");
  const p = E.parsePack(new Uint8Array(readFileSync(SAVEP))); assert.deepEqual(p.sounds.map((s) => s.name), srcNames); assert.equal(p.sounds[1].sha256, sha(L.getEntry(f(), A, 1)));
  copyFileSync(SAVEP, OPENP);
});
await check("Import previews the target slots with overwrite warnings and changes nothing yet", async () => {
  await pick(B, 5); await openPanel(); await X("exchange-import").click(); await seen("exchange-preview-row-0"); await until(async () => (await rowsCount()) === 3, "three rows");
  for (let i = 0; i < 3; i++) { const t = await text(`exchange-preview-row-${i}`); assert.ok(t.includes(srcNames[i]), t); assert.ok(t.includes(oldNames[i]), t); assert.match(t, /overwrite/i); }
  assert.equal(await X("exchange-apply").isDisabled(), false); await ui.openBank(B); assert.deepEqual((await names(8)).slice(5), oldNames);
});
await check("Apply asks to confirm, then writes the three sounds as ONE undo step", async () => {
  await openPanel(); if ((await rowsCount()) === 0) { await pick(B, 5); await X("exchange-import").click(); await seen("exchange-preview-row-0"); }
  await X("exchange-apply").click(); await ui.ok(); await ui.openBank(B); await until(want(srcNames), "new names");
  const bytes = await ui.saved(); assert.deepEqual(slotDiff(bytes), [5, 6, 7].map((i) => `${B}:${i}`)); [0, 1, 2].forEach((i) => assert.equal(Buffer.compare(L.getEntry(P.parsePcg(bytes), B, 5 + i), L.getEntry(f(), A, i)), 0));
  await X("undo").click(); await until(want(oldNames), "undone"); assert.equal(await X("undo").isDisabled(), true, "needed more than one undo");
  assert.deepEqual(slotDiff(await ui.saved()), []);
});
await check("a tampered pack is refused with a reason and shows no preview", async () => {
  const o = JSON.parse(readFileSync(SAVEP, "utf8")); o.sounds[0].sha256 = "0".repeat(64); writeFileSync(OPENP, JSON.stringify(o));
  await pick(B, 5); await openPanel(); await X("exchange-import").click(); await seen("exchange-error"); assert.match(await text("exchange-error"), /sha256|hash|checksum/i); assert.equal(await rowsCount(), 0);
});
await check("a pack over the size limit is refused", async () => {
  writeFileSync(OPENP, Buffer.alloc(E.MAX_PACK_BYTES + 1, 32)); await pick(B, 5); await openPanel(); await X("exchange-import").click();
  await until(async () => /too large|size|limit/i.test(await text("exchange-error").catch(() => "")), "size error"); assert.equal(await rowsCount(), 0);
});
await check("Programs into a Combi bank are flagged incompatible and cannot be applied", async () => {
  copyFileSync(SAVEP, OPENP); await pick(cmb, 0); await openPanel(); await X("exchange-import").click(); await seen("exchange-preview-row-0");
  for (let i = 0; i < 3; i++) assert.match(await text(`exchange-preview-row-${i}`), /incompatible/i);
  assert.equal(await X("exchange-apply").isDisabled(), true); await ui.openBank(cmb); assert.equal((await names(1))[0], L.getName(f(), cmb, 0));
});
await check("importing never sends anything to a connected keyboard", async () => {
  await ui.connectSim(); const before = (await log()).length; await pick(B, 5); await openPanel(); await X("exchange-import").click(); await seen("exchange-preview-row-0");
  await X("exchange-apply").click(); await ui.ok(); await ui.openBank(B); await until(want(srcNames), "applied"); await new Promise((r) => setTimeout(r, 500));
  assert.equal((await log()).length, before, "MIDI was sent by the import");
});
await ui.noErrors();
await finish();
