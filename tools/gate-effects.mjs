// Acceptance gate for per-effect parameter pages (IFX1-12, MFX1-2, TFX1-2). Owned by the architect: builders must not edit it.
//
// FILES THE BUILDER CREATES
//   scripts/gen-effects.ts          run as `node scripts/gen-effects.ts`; reads research/korg-sysex/midiimp/MIDI implementation/Effect.txt and writes src/generated/effects.json
//   src/core/params/effects.ts      pure, no node: imports, exports below
//   src/core/params/effects.test.ts node:test unit tests for effects.ts
//
// src/generated/effects.json = { types: EffectTypeEntry[198] }, index = id = Effect Type value (same order as params.json effectTypes)
//   EffectTypeEntry = { id: number, name: string, params: EffectParamDef[] | null }
//   EffectParamDef  = { pid: number, name: string, ofs: number, bitHi: number, bitLo: number, rawMin: number, rawMax: number, signed: boolean, fixed: boolean, valueText: string }
//   Only named rows are listed (blank continuation rows are not). ofs/bitHi/bitLo = the FIRST byte of the field relative to the effect's parameter block (Effect.txt OFS, 0 = Bypass).
//   rawMin/rawMax = Effect.txt DATA(hex) range read as numbers (signed when `signed`, e.g. D8~00 is -40..0 ; 0005~0140 is 5..320). valueText = the Value column, e.g. "1.0:1~Inf:1".
//   "No Effect" (id 0) has params = []. params = null means the table could not be determined for that type.
//
// PURE EXPORTS of src/core/params/effects.ts (Row and ParamTables are the types from params.ts)
//   type EffectKind = "program" | "combi"
//   type EffectSlot = { id: string; label: string; typeOfs: number }
//     ids: "ifx1".."ifx12", "mfx1", "mfx2", "tfx1", "tfx2" in that order; labels: "Insert Effect 1".."Insert Effect 12", "Master Effect 1", "Master Effect 2", "Total Effect 1", "Total Effect 2"
//     typeOfs = the offset of the slot's Effect Type byte in the object dump (found from the params.json rows named "Effect Type" of group Insert Effect<n> / Master Effect<n> / Total Effect<n>)
//   effectSlots(tables: ParamTables, kind: EffectKind): EffectSlot[]
//   effectTypeName(tables: ParamTables, id: number): string                          the Kronos's own name (params.json effectTypes), "" for an id outside 0..197
//   effectParamRows(tables: ParamTables, kind: EffectKind, slotId: string, typeId: number): Row[] | null
//     Rows usable with readParam/writeParam/formatValue/isEditable of params.ts: name = Effect.txt name, group = the slot label (the EffectSlot label, e.g. "Insert Effect 1"),
//     ofs/bitHi/bitLo/parts ABSOLUTE in the dump (the parameter block start is slot-specific; consecutive Insert slots are 74 bytes apart),
//     rawMin/rawMax/signed/fixed/valueText from the table, continuation false.
//     [] for typeId 0, null for an unknown slot id, a typeId outside 0..197 or non-integer, or a type whose params are null.
//
// UI (a button on the program editor opens the page; works for combinations too, but only programs are tested here)
//   data-testid  meaning
//   effects-open          button in the open program editor that shows the effects page
//   effects-page          the page container
//   effects-slot-<id>     one button per slot, id as above (16 of them); aria-pressed="true" on the chosen one
//   effects-type          native <select> for the chosen slot; option value = type id (string), option text = the Kronos's own name; changing it commits the Effect Type byte
//   effects-type-name     text of the name of the chosen slot's current type
//   effects-param-<pid>   one row per named parameter of the chosen type (pid from effects.json); omitted entirely when the type is generic
//   effects-label-<pid>   the parameter's name
//   effects-input-<pid>   a text input; typing a value and pressing Enter commits it (same format as the param editor: the shown value, e.g. 37, or 5.5 for Reverb Time)
//   effects-value-<pid>   the shown value text (formatValue of the row)
//   effects-generic       shown only when the chosen type's parameters can't be determined; its text says the controls are generic
// Every change = one undo step through the normal commit path (the top bar's `undo` button). Changing the type may rewrite only bytes of that slot's own dump region.
// TEST-ONLY ENV VAR: KRONOS_E2E_EFFECTS_UNKNOWN="3" (comma list of type ids) makes the page treat those types as undeterminable (generic), so the fallback can be tested.
// Nothing here may send to the keyboard: editing effects must add nothing to window.__kronosE2E.midiLog().
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, onlyBits, root, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("EFFECTS"), { check, finish } = g, C = await core(g), { T, P, L, Q, raw } = C;
const GEN = path.join(root, "src/generated/effects.json");
let E, F;
try {
  const r = spawnSync(process.execPath, ["scripts/gen-effects.ts"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gen-effects failed: ${(r.stdout + r.stderr).slice(-500)}`);
  E = JSON.parse(readFileSync(GEN, "utf8")); F = await load("src/core/params/effects.ts");
} catch (e) { g.fails.push(`cannot load the feature: ${e.message}`); await finish(); }

const file = P.parsePcg(raw), banks = L.listBanks(file);
const programs = banks.filter((b) => b.kind === "program").flatMap((b) => Array.from({ length: b.count }, (_, i) => L.getEntry(file, b.key, i)));
const IDS = [...Array.from({ length: 12 }, (_, i) => `ifx${i + 1}`), "mfx1", "mfx2", "tfx1", "tfx2"];
const prow = (slot, type, name) => { const r = F.effectParamRows(T, "program", slot, type); assert.ok(r, `no rows for ${slot} type ${type}`); const x = r.find((q) => q.name === name); assert.ok(x, `no ${name} in type ${type}`); return x; };
const names = (id) => E.types[id].params.map((p) => p.name);

await check("the generated table covers all 198 effect types with Kronos names", () => {
  assert.equal(E.types.length, 198);
  E.types.forEach((t, i) => { assert.equal(t.id, i); assert.equal(t.name, T.effectTypes[i]); });
  assert.equal(E.types[0].name, "No Effect"); assert.deepEqual(E.types[0].params, []); assert.equal(E.types[2].name, "Stereo Compressor"); assert.equal(E.types[101].name, "Reverb Hall");
  const known = E.types.filter((t) => t.params && t.params.length > 0).length; assert.ok(known >= 150, `only ${known} types have named parameters`);
  for (const t of E.types) for (const p of t.params ?? []) { assert.ok(p.name.length > 0, t.name); assert.ok(p.rawMin <= p.rawMax, `${t.name}/${p.name}`); assert.ok(p.bitHi >= p.bitLo && p.bitHi <= 7 && p.bitLo >= 0, `${t.name}/${p.name} bits`); }
});
await check("Stereo Compressor has its real names and ranges", () => {
  const p = (n) => E.types[2].params.find((x) => x.name === n); assert.ok(p("Ratio") && p("Threshold") && p("Release") && p("Input Trim"));
  assert.deepEqual(names(2).slice(0, 8), ["Bypass", "Wet/Dry", "Wet/Dry Mod.Source", "Wet/Dry Mod.Intensity", "Input Trim", "Envelope Source", "Envelope Select", "Fx Control Trim"]);
  assert.ok(names(2).includes("Side EQ Frequency") && names(2).includes("Gain Adjust Mod.Intensity") && !names(2).includes("Pre LEQ Gain"));
  assert.deepEqual([p("Ratio").rawMin, p("Ratio").rawMax, p("Ratio").valueText], [0, 0x83, "1.0:1~Inf:1"]);
  assert.deepEqual([p("Threshold").rawMin, p("Threshold").rawMax, p("Threshold").signed], [-40, 0, true]);
  assert.deepEqual([p("Release").rawMin, p("Release").rawMax], [5, 320]); assert.equal(p("Input Trim").fixed, true); assert.deepEqual([p("Wet/Dry").rawMin, p("Wet/Dry").rawMax, p("Wet/Dry").valueText], [0, 100, "Dry~Wet"]);
});
await check("Reverb Hall has its real names", () => assert.deepEqual(names(101), ["Bypass", "Wet/Dry", "Wet/Dry Mod.Source", "Wet/Dry Mod.Intensity", "Input Trim", "Reverb Time", "High Damp", "Pre Delay", "Pre Delay Thru", "Pre LEQ Gain", "Pre HEQ Gain", "Pre LEQ Fc", "Pre HEQ Fc"]));
await check("the 16 slots are found in programs and combinations", () => {
  const s = F.effectSlots(T, "program"); assert.deepEqual(s.map((x) => x.id), IDS);
  assert.deepEqual(s.map((x) => x.label), [...Array.from({ length: 12 }, (_, i) => `Insert Effect ${i + 1}`), "Master Effect 1", "Master Effect 2", "Total Effect 1", "Total Effect 2"]);
  assert.deepEqual([s[0].typeOfs, s[1].typeOfs, s[12].typeOfs, s[14].typeOfs], [88, 162, 976, 1116]);
  const find = (rows, grp) => rows.find((r) => r.group === grp && r.name === "Effect Type").ofs;
  for (const kind of ["program", "combi"]) { const rows = kind === "program" ? T.programHd1 : T.combi, sl = F.effectSlots(T, kind); sl.forEach((x, i) => assert.equal(x.typeOfs, find(rows, i < 12 ? `Insert Effect${i + 1}` : i < 14 ? `Master Effect${i - 11}` : `Total Effect${i - 13}`), `${kind} ${x.id}`)); }
});
await check("effect names and parameter rows resolve, and bad input is refused", () => {
  assert.equal(F.effectTypeName(T, 2), "Stereo Compressor"); assert.equal(F.effectTypeName(T, 197), T.effectTypes[197]); assert.equal(F.effectTypeName(T, 198), ""); assert.equal(F.effectTypeName(T, -1), "");
  assert.deepEqual(F.effectParamRows(T, "program", "ifx1", 0), []);
  for (const [slot, t] of [["ifx1", 198], ["ifx1", -1], ["ifx1", 1.5], ["ifx1", NaN], ["ifx13", 2], ["", 2], ["evil", 2]]) assert.equal(F.effectParamRows(T, "program", slot, t), null, `${slot} ${t}`);
  const r = F.effectParamRows(T, "program", "ifx1", 2); assert.deepEqual(r.map((x) => x.name), names(2)); assert.ok(r.every((x) => x.group === "Insert Effect 1" && x.continuation === false));
  assert.equal(Q.formatValue(prow("ifx1", 2, "Ratio"), 0, T), "1.0:1"); assert.equal(Q.formatValue(prow("ifx1", 2, "Threshold"), -12, T), "-12");
});
await check("rows sit inside their slot and slots are 74 bytes apart", () => {
  const a = prow("ifx1", 2, "Wet/Dry"), b = prow("ifx2", 2, "Wet/Dry"), z = prow("ifx12", 2, "Wet/Dry"); assert.deepEqual(a.parts, [[a.ofs, 7, 1]]);
  assert.ok(a.ofs >= 24 && a.ofs < 88, `ifx1 Wet/Dry at ${a.ofs}`); assert.equal(b.ofs - a.ofs, 74); assert.equal(z.ofs - a.ofs, 74 * 11);
  assert.equal(prow("ifx1", 2, "Ratio").ofs, a.ofs + 5); assert.equal(prow("ifx1", 2, "Release").parts[0][0], a.ofs + 8);
  const rows = F.effectParamRows(T, "program", "ifx1", 2).filter((r) => !r.fixed), own = new Map();
  for (const r of rows) for (const [o, h, l] of r.parts) { assert.ok(o >= 24 && o < 88, `${r.name} at ${o}`); for (let k = l; k <= h; k++) { const at = `${o}.${k}`; assert.ok(!own.has(at), `${at}: ${own.get(at)} and ${r.name}`); own.set(at, r.name); } }
  const m = prow("mfx1", 101, "Wet/Dry"), t = prow("tfx2", 101, "Wet/Dry"); assert.ok(m.ofs >= 912 && m.ofs < 976, `mfx1 at ${m.ofs}`); assert.ok(t.ofs >= 1120 && t.ofs < 1184, `tfx2 at ${t.ofs}`);
});
await check("every factory Program reads in range in every effect slot, and fixed values match", () => {
  const slots = F.effectSlots(T, "program"), bad = [], used = new Set(); let reads = 0;
  for (const e of programs) for (const s of slots) {
    const t = e[s.typeOfs]; if (t === 0) continue; const rows = F.effectParamRows(T, "program", s.id, t); if (!rows) continue; used.add(t);
    for (const r of rows) { reads++; const v = Q.readParam(e, r); if (v < r.rawMin || v > r.rawMax) bad.push(`${s.id} type ${t} ${r.name} = ${v}`); }
  }
  assert.ok(reads > 5000 && used.size > 20, `only ${reads} reads of ${used.size} types`);
  assert.deepEqual(bad.slice(0, 5), []);
});
await check("writing an effect parameter changes only its own bits and reads back", () => {
  const e = programs[0], rows = [["ifx1", 2, "Ratio", 77], ["ifx3", 2, "Threshold", -12], ["ifx1", 101, "Reverb Time", 55], ["mfx2", 101, "Wet/Dry", 33], ["tfx1", 2, "Release", 300]];
  for (const [s, t, n, v] of rows) { const r = prow(s, t, n), before = e.slice(), w = e.slice(); Q.writeParam(w, r, v); assert.equal(Q.readParam(w, r), v, `${s} ${n}`); onlyBits(w, before, r.parts); }
});

await testsAndTypes(g, ["core/params/effects.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C, { KRONOS_E2E_EFFECTS_UNKNOWN: "3" }), { X, seen, text, until, win } = ui;
const KEY = "program:INT-A", IDX = 0, orig = L.getEntry(file, KEY, IDX);
const entry = async () => L.getEntry(P.parsePcg(await ui.saved()), KEY, IDX);
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const diff = (a, b) => { const d = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d.push(i); return d; };
const pick = async (slot, type) => { await X(`effects-slot-${slot}`).click(); await X("effects-type").selectOption(String(type)); await until(async () => (await text("effects-type-name")) === T.effectTypes[type], `type ${type} shown`); };
const setVal = async (pid, v) => { await X(`effects-input-${pid}`).fill(String(v)); await X(`effects-input-${pid}`).press("Enter"); };

await ui.openFile();
await ui.connectSim();
await ui.editSlot(KEY, IDX);
// Live editing is on by default since 2026-11-08; this check is about the offline path, so switch it off first.
if (await X("live-edit").isChecked()) await X("live-edit").uncheck();
const sent0 = (await log()).length;
await check("the effects page opens with 16 slots and the Kronos's type names", async () => {
  await X("effects-open").click(); await seen("effects-page");
  for (const id of IDS) await seen(`effects-slot-${id}`, 3000);
  assert.equal(await win.locator('[data-testid^="effects-slot-"]').count(), 16);
  await X("effects-slot-ifx1").click(); assert.equal(await X("effects-slot-ifx1").getAttribute("aria-pressed"), "true");
  const opts = await win.locator('[data-testid="effects-type"] option').allTextContents(); assert.equal(opts[0], "No Effect"); assert.ok(opts.includes("Stereo Compressor") && opts.includes("Reverb Hall"));
  assert.equal(await text("effects-type-name"), T.effectTypes[orig[88]]);
});
await check("choosing a type commits it and shows its named controls", async () => {
  await pick("ifx1", 2); await seen("effects-param-1");
  for (const [pid, n] of [[1, "Wet/Dry"], [9, "Ratio"], [10, "Threshold"], [13, "Release"]]) assert.equal(await text(`effects-label-${pid}`), n);
  assert.equal(await win.locator('[data-testid="effects-generic"]').count(), 0);
  const e = await entry(); assert.equal(e[88], 2); const d = diff(e, orig); assert.ok(d.length > 0 && d.every((i) => i >= 24 && i <= 88), `changed outside IFX1: ${d.filter((i) => i < 24 || i > 88).slice(0, 5)}`);
});
await check("editing a named control writes exactly that field", async () => {
  const before = await entry(), r = prow("ifx1", 2, "Wet/Dry"); await setVal(1, 37); await until(async () => /37/.test(await text("effects-value-1")), "value shown");
  const after = await entry(); assert.equal(Q.readParam(after, r), 37); onlyBits(after, before, r.parts);
});
await check("a decimal control takes its shown format and an out-of-range value is refused", async () => {
  await pick("mfx1", 101); await seen("effects-param-5"); assert.equal(await text("effects-label-5"), "Reverb Time");
  const r = prow("mfx1", 101, "Reverb Time"), before = await entry(); await setVal(5, "5.5"); await until(async () => /5\.5/.test(await text("effects-value-5")), "5.5 shown");
  const after = await entry(); assert.equal(Q.readParam(after, r), 55); onlyBits(after, before, r.parts);
  await setVal(5, "99"); await new Promise((x) => setTimeout(x, 400)); assert.deepEqual(diff(await entry(), after), [], "an out-of-range value changed the file"); assert.match(await text("effects-value-5"), /5\.5/);
});
await check("a type whose parameters can't be determined shows generic controls and says so", async () => {
  await pick("ifx2", 3); await seen("effects-generic"); assert.match(await text("effects-generic"), /generic/i); assert.equal(await win.locator('[data-testid^="effects-param-"]').count(), 0);
  assert.equal((await entry())[162], 3);
  await pick("ifx1", 2); await seen("effects-param-1"); assert.equal(await win.locator('[data-testid="effects-generic"]').count(), 0);
});
await check("each change is one undo step and everything undoes back to the original bytes", async () => {
  // steps so far: ifx1 type, ifx1 Wet/Dry, mfx1 type, mfx1 Reverb Time, ifx2 type = 5
  const undo = async () => { await X("undo").click(); await new Promise((x) => setTimeout(x, 300)); };
  await undo(); assert.equal((await entry())[162], orig[162], "ifx2 type not undone"); assert.equal((await entry())[976], 101, "undo went too far");
  await undo(); assert.equal(Q.readParam(await entry(), prow("mfx1", 101, "Reverb Time")), Q.readParam(orig, prow("mfx1", 101, "Reverb Time")));
  for (let i = 0; i < 3; i++) await undo();
  assert.equal(sha(await ui.saved()), sha(raw), "not back to the original file");
});
await check("editing effects sends nothing to the keyboard", async () => assert.equal((await log()).length, sent0, "something was sent"));
await ui.noErrors();
await finish();
