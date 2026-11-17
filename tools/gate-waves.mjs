// Acceptance gate for the multisample browser. Owned by the architect: builders must not edit it.
//
// WHAT THE DATA HAS (checked against src/generated/params.json and research): there is NO list of multisample names anywhere,
// only numbers. A program's OSC1 and OSC2 each have 8 "Zone<n> MS" slots at 22-byte strides (OSC1 Zone1 Type at byte 2774, OSC2 Zone1 Type at 3240):
//   +0 MS Type (bits 1..0: 0 off, 1 multisample, 2 wave sequence; upper bits belong to other fields), +1..+17 MS Bank UUID (17 bytes), +18..+19 MS Number (16-bit little endian, 0..16382), +20 level, +21 offset/reverse.
// So a multisample is identified by (bank UUID, number). The picker therefore groups by bank and labels by number.
//
// PURE EXPORTS of src/core/pcg/multisamples.ts (no node: imports; it must also run in the renderer):
//   export const MS_ZONES = 8
//   export type MsRef = { bank: string; number: number }          // bank = the 17 UUID bytes as 34 lowercase hex characters
//   export type Zone = { osc: 1 | 2; zone: number; type: number; ref: MsRef }   // zone is 1..8
//   export function readZones(entry: Uint8Array): Zone[]           // 16 items: OSC1 zones 1..8 then OSC2 zones 1..8, whatever their type
//   export function listMultisamples(f: PcgFile): MsRef[]          // distinct refs of Type 1 zones in every HD-1 program of the file (wave sequences and Off zones excluded), sorted by bank then number
//   export function bankLabel(bank: string): string                // KORG factory banks ("KORG" + 8 zero bytes + "MS", bytes 14..16 = 00 nn 00): `KORG MS ${nn}` (nn decimal). Any other bank: `Bank ${bank.slice(0, 8)}-${bank.slice(28)}`
//   export function msLabel(ref: MsRef): string                    // `${bankLabel(ref.bank)} #${ref.number}`
//   export function groupMultisamples(refs: MsRef[]): { bank: string; label: string; items: MsRef[] }[]   // one group per bank, in order of first appearance, items keep their order
//   export function searchMultisamples(refs: MsRef[], query: string): MsRef[]   // case-insensitive; the query is trimmed and split on spaces; every word must occur in msLabel(ref); empty query returns all
//   export function whoUses(f: PcgFile, ref: MsRef): { key: string; index: number; name: string; zones: { osc: 1 | 2; zone: number }[] }[]   // HD-1 programs in the file using ref in a Type 1 zone, in bank and slot order, zones ascending (OSC1 first)
//   export function applyMultisample(entry: Uint8Array, osc: 1 | 2, zone: number, ref: MsRef): Uint8Array   // returns a COPY with that zone set to Type 1 + ref; only the low two bits of the type byte, the 17 UUID bytes and the 2 number bytes may change; throws on osc not 1|2, zone outside 1..8, a bank that is not 34 hex characters, a number outside 0..16382
//
// UI data-testid table (param key k = `${ofs}.${bitLo ?? 0}`, e.g. OSC1 Zone1 MS Number = "2792.0"; the page is group "OSC1 Trigger"):
//   waves-open-<k>   button on the "Zone<n> MS Number" row that opens the picker. Only those rows have it (the Zone MS Level row 2794.0 must not).
//   waves-picker     the open picker (popover or panel); absent when closed
//   waves-q          search input in the picker (typing filters at once; autofocus)
//   waves-count      text is exactly the number of multisamples matching the search, digits only
//   waves-ngroups    text is exactly the number of bank groups among the matches, digits only
//   waves-group-<n>  bank heading n (0-based, in display order); text includes bankLabel
//   waves-opt-<n>    option n (0-based, across all groups, in display order), text includes msLabel; attributes data-bank and data-number carry the ref. Clicking commits it to the edited zone.
//   waves-empty      shown instead of options when nothing matches
//   waves-who-<k>    button on the same row: opens the "Who uses this" list for the multisample the row currently has (reflects unsaved edits, since it searches the open file)
//   waves-who-list   the open list; absent when closed
//   waves-who-count  text is exactly the number of Programs listed, digits only
//   waves-who-row-<n> one Program per row, in whoUses order, text includes the Program name
// Escape closes the picker (or list) without changing anything. A pick goes through the normal commit path: row marked data-changed, listed as changed, one Undo step restores every byte, nothing is sent to the keyboard.
// TEST-ONLY ENV: none beyond what launch() sets (KRONOS_E2E=1 and the OPEN/SAVE/BACKUP paths); the sim keyboard comes from the connect-sim button.
import assert from "node:assert/strict";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("WAVES"), { check, finish } = g, C = await core(g), { T, P, L, Q } = C;
let M; try { M = await load("src/core/pcg/multisamples.ts"); } catch (e) { g.fails.push(`cannot load multisamples.ts: ${e.message}`); await finish(); }

// Independent reading of the factory file straight from the generated row tables.
const f = C.parsed(), hex = (b) => Buffer.from(b).toString("hex");
const rowOf = (osc, z, n) => T.programHd1.find((r) => r.group === `OSC${osc} Trigger` && r.name === `Zone${z} MS ${n}`);
const hd1 = L.listBanks(f).filter((b) => b.kind === "program" && b.type === "hd1");
const scan = []; // {key,index,osc,zone,ref} of every Type 1 zone
for (const b of hd1) for (let i = 0; i < b.count; i++) { const e = L.getEntry(f, b.key, i); for (const osc of [1, 2]) for (let z = 1; z <= 8; z++) { const tr = rowOf(osc, z, "Type"); if (Q.readParam(e, tr) === 1) scan.push({ key: b.key, index: i, osc, zone: z, ref: { bank: hex(e.subarray(tr.ofs + 1, tr.ofs + 18)), number: Q.readParam(e, rowOf(osc, z, "Number")) } }); } }
const cmp = (a, b) => (a.bank < b.bank ? -1 : a.bank > b.bank ? 1 : a.number - b.number);
const distinct = [...new Map(scan.map((s) => [`${s.ref.bank}:${s.ref.number}`, s.ref])).values()].sort(cmp);
const KORG0 = "4b4f524700000000000000004d53000000", KORG1 = "4b4f524700000000000000004d53000100", KORG4 = "4b4f524700000000000000004d53000400";
const ents = (key, i) => L.getEntry(f, key, i);

await check("the factory file has the multisample data this gate expects", () => { assert.equal(scan.length, 3656); assert.equal(distinct.length, 1167); assert.equal(new Set(distinct.map((r) => r.bank)).size, 58); });
await check("readZones reads all 16 zones of a real program", () => {
  const z = M.readZones(ents("program:INT-B", 0)); assert.equal(M.MS_ZONES, 8); assert.equal(z.length, 16);
  assert.deepEqual(z[0], { osc: 1, zone: 1, type: 1, ref: { bank: KORG1, number: 2 } }); assert.deepEqual(z[8], { osc: 2, zone: 1, type: 1, ref: { bank: "4b4f524700000000000000004d53000500", number: 3 } });
  assert.deepEqual(z.map((x) => [x.osc, x.zone]), [1, 2].flatMap((o) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [o, n])));
  const all = []; for (const b of hd1) for (let i = 0; i < b.count; i++) for (const x of M.readZones(L.getEntry(f, b.key, i))) if (x.type === 1) all.push(x.ref);
  assert.equal(all.length, 3656); assert.deepEqual(all.slice(0, 50), scan.slice(0, 50).map((s) => s.ref)); assert.ok(z.some((x) => x.type === 0));
});
await check("listMultisamples gives each real multisample once, sorted, without wave sequences", () => { const l = M.listMultisamples(f); assert.equal(l.length, 1167); assert.deepEqual(l, distinct); assert.equal(l.some((r) => r.number > 16382 || r.number < 0), false); });
await check("bank and multisample labels", () => {
  assert.equal(M.bankLabel(KORG4), "KORG MS 4"); assert.equal(M.bankLabel(KORG0), "KORG MS 0"); assert.equal(M.bankLabel("4b4f524700000000000000004d5300c000"), "KORG MS 192");
  assert.equal(M.bankLabel("f0418e3405bd48a38e93f828113742d200"), "Bank f0418e34-42d200"); assert.equal(M.msLabel({ bank: KORG4, number: 8 }), "KORG MS 4 #8");
  const banks = [...new Set(distinct.map((r) => r.bank))]; assert.equal(new Set(banks.map(M.bankLabel)).size, banks.length, "two banks share a label");
});
await check("grouping by bank keeps everything and the order", () => {
  const G = M.groupMultisamples(distinct); assert.equal(G.length, 58); assert.equal(G.reduce((a, x) => a + x.items.length, 0), 1167);
  for (const x of G) { assert.equal(x.label, M.bankLabel(x.bank)); assert.ok(x.items.length > 0 && x.items.every((r) => r.bank === x.bank)); }
  assert.deepEqual(G.flatMap((x) => x.items), distinct); assert.deepEqual(M.groupMultisamples([]), []);
  const mixed = [{ bank: KORG4, number: 1 }, { bank: KORG0, number: 5 }, { bank: KORG4, number: 2 }]; assert.deepEqual(M.groupMultisamples(mixed).map((x) => x.items.map((r) => r.number)), [[1, 2], [5]]);
});
await check("searching by label words and number", () => {
  assert.deepEqual(M.searchMultisamples(distinct, "ms 4 #8"), [{ bank: KORG4, number: 8 }]); assert.deepEqual(M.searchMultisamples(distinct, "  KORG   MS 4 #8 "), [{ bank: KORG4, number: 8 }]);
  assert.deepEqual(M.searchMultisamples(distinct, ""), distinct); assert.deepEqual(M.searchMultisamples(distinct, "zzz"), []);
  const ms4 = M.searchMultisamples(distinct, "korg ms 4 #"); assert.ok(ms4.length > 1 && ms4.every((r) => r.bank === KORG4)); assert.equal(ms4.length, distinct.filter((r) => r.bank === KORG4).length);
});
await check("whoUses lists the Programs in the file, with zones", () => {
  const rare = { bank: KORG4, number: 8 }, w = M.whoUses(f, rare); assert.equal(w.length, 1); assert.equal(w[0].key, "program:INT-B"); assert.equal(w[0].index, 3); assert.equal(w[0].name, "Bright Mono Piano"); assert.equal(w[0].name, L.getName(f, "program:INT-B", 3));
  const exp = scan.filter((s) => s.ref.bank === rare.bank && s.ref.number === 8); assert.deepEqual(w[0].zones, exp.map((s) => ({ osc: s.osc, zone: s.zone })));
  const big = M.whoUses(f, { bank: KORG0, number: 0 }), eb = scan.filter((s) => s.ref.bank === KORG0 && s.ref.number === 0); assert.equal(big.length, 173); assert.equal(big.reduce((a, x) => a + x.zones.length, 0), 342); assert.equal(eb.length, 342);
  assert.deepEqual(big.slice(0, 3).map((x) => `${x.key}#${x.index}`), ["program:INT-B#3", "program:INT-B#4", "program:INT-B#9"]);
  assert.deepEqual(M.whoUses(f, { bank: KORG0, number: 16382 }), []); assert.deepEqual(M.whoUses(f, { bank: "00".repeat(17), number: 1 }), []);
});
await check("applyMultisample changes only the zone's own bytes and refuses bad input", () => {
  const e = ents("program:INT-B", 0), copy = Uint8Array.from(e), ref = { bank: KORG4, number: 8 }, o = rowOf(1, 2, "Type").ofs;
  const out = M.applyMultisample(e, 1, 2, ref); assert.deepEqual(e, copy, "input was modified"); assert.notEqual(out, e); assert.equal(out.length, e.length);
  const diff = []; for (let i = 0; i < e.length; i++) if (out[i] !== e[i]) diff.push(i); assert.ok(diff.length > 0 && diff.every((i) => i >= o && i <= o + 19), `changed bytes ${diff}`); assert.equal(out[o] & 0xfc, e[o] & 0xfc); assert.equal(out[o] & 3, 1);
  assert.deepEqual(M.readZones(out)[1], { osc: 1, zone: 2, type: 1, ref }); assert.deepEqual(M.readZones(out).filter((_, i) => i !== 1), M.readZones(e).filter((_, i) => i !== 1));
  const o2 = M.applyMultisample(e, 2, 8, { bank: KORG0, number: 16382 }); assert.deepEqual(M.readZones(o2)[15], { osc: 2, zone: 8, type: 1, ref: { bank: KORG0, number: 16382 } });
  assert.deepEqual(M.applyMultisample(out, 1, 2, M.readZones(e)[1].ref).slice(o + 1, o + 20), e.slice(o + 1, o + 20));
  for (const a of [[3, 1, ref], [0, 1, ref], [1, 0, ref], [1, 9, ref], [1, 1, { bank: "zz".repeat(17), number: 1 }], [1, 1, { bank: "ab", number: 1 }], [1, 1, { bank: KORG4, number: 16383 }], [1, 1, { bank: KORG4, number: -1 }], [1, 1, { bank: KORG4, number: 1.5 }]]) assert.throws(() => M.applyMultisample(e, ...a), JSON.stringify(a));
});
await testsAndTypes(g, ["core/pcg/multisamples.test.ts"]);
if (g.fails.length) await finish();

// ---- UI: the real app, with a simulated keyboard connected so we can prove nothing is written to it ----
const KEY = "program:INT-B", SLOT = 0, K = "2792.0", LEVEL = "2794.0", NAME = L.getName(f, KEY, SLOT), orig = Uint8Array.from(ents(KEY, SLOT));
const ui = await launch(g, C), { X, seen, text, until, win } = ui;
const midi = () => win.evaluate(() => window.__kronosE2E.midiLog().length);
const entryOf = async () => L.getEntry(P.parsePcg(await ui.saved()), KEY, SLOT);
const search = async (q) => { await X("waves-q").fill(q); await until(async () => (await text("waves-count")) === String(M.searchMultisamples(distinct, q).length), `count for "${q}"`); };
let midi0 = 0;
await ui.openFile(); await ui.connectSim(); midi0 = await midi();
await ui.editSlot(KEY, SLOT);
await check("the multisample row has a picker button and its neighbours don't", async () => {
  await X("group-OSC1 Trigger").click(); await seen(`param-${K}`); await seen(`param-${LEVEL}`);
  assert.equal(await X(`waves-open-${K}`).isVisible(), true); assert.equal(await X(`waves-open-${LEVEL}`).count(), 0); assert.equal(await X("waves-picker").count(), 0);
});
await check("the picker shows every multisample in the file, grouped by bank", async () => {
  const G = M.groupMultisamples(distinct); await X(`waves-open-${K}`).click(); await seen("waves-picker"); await seen("waves-q");
  await until(async () => (await text("waves-count")) === "1167", "all multisamples counted"); assert.equal(await text("waves-ngroups"), "58");
  assert.ok((await text("waves-group-0")).includes(G[0].label), await text("waves-group-0")); const o0 = X("waves-opt-0");
  assert.equal(await o0.getAttribute("data-bank"), G[0].items[0].bank); assert.equal(await o0.getAttribute("data-number"), String(G[0].items[0].number)); assert.ok((await o0.textContent()).includes(M.msLabel(G[0].items[0])));
});
await check("searching narrows the list; nothing found says so; Escape changes nothing", async () => {
  await search("ms 4 #8"); assert.equal(await text("waves-ngroups"), "1"); assert.equal(await X("waves-opt-0").getAttribute("data-bank"), KORG4); assert.equal(await X("waves-opt-0").getAttribute("data-number"), "8"); assert.ok((await text("waves-opt-0")).includes("KORG MS 4 #8"));
  await search("korg ms 4 #"); assert.equal(await text("waves-ngroups"), "1");
  await X("waves-q").fill("zzz-no-such"); await until(async () => (await text("waves-count")) === "0", "no matches"); await seen("waves-empty"); assert.equal(await X("waves-opt-0").count(), 0);
  await X("waves-q").press("Escape"); await X("waves-picker").waitFor({ state: "hidden", timeout: 10000 });
  assert.equal(await X(`param-${K}`).getAttribute("data-changed"), "false"); assert.equal(await X("undo").isDisabled(), true); assert.equal(await midi(), midi0);
});
await check("picking commits one change to the zone, with only its bytes touched", async () => {
  await X(`waves-open-${K}`).click(); await seen("waves-q"); await search("ms 4 #8"); await X("waves-opt-0").click(); await X("waves-picker").waitFor({ state: "hidden", timeout: 10000 });
  await until(async () => (await X(`param-${K}`).getAttribute("data-changed")) === "true", "marked changed"); await seen(`change-${KEY}-${SLOT}`);
  const e = await entryOf(); assert.deepEqual(M.readZones(e)[0], { osc: 1, zone: 1, type: 1, ref: { bank: KORG4, number: 8 } });
  const diff = []; for (let i = 0; i < e.length; i++) if (e[i] !== orig[i]) diff.push(i); assert.ok(diff.length >= 2 && diff.every((i) => i >= 2775 && i <= 2793), `changed bytes ${diff}`); assert.ok(diff.includes(2792));
  assert.equal(await midi(), midi0, "the pick was sent to the keyboard");
});
await check("Who uses this reads the open file, unsaved edit included", async () => {
  await X(`waves-who-${K}`).click(); await seen("waves-who-list"); await until(async () => (await text("waves-who-count")) === "2", "two Programs");
  assert.ok((await text("waves-who-row-0")).includes(NAME), await text("waves-who-row-0")); assert.ok((await text("waves-who-row-1")).includes("Bright Mono Piano"), await text("waves-who-row-1")); assert.equal(await X("waves-who-row-2").count(), 0);
  await X("waves-who-list").press("Escape"); await X("waves-who-list").waitFor({ state: "hidden", timeout: 10000 });
});
await check("one Undo restores every byte and the list follows", async () => {
  await X("undo").click(); await until(() => X("undo").isDisabled(), "undone"); assert.deepEqual(await entryOf(), orig); /* data-changed is vs the last save, and entryOf saves, so it is not checked here */
  await X(`waves-who-${K}`).click(); await seen("waves-who-list"); const w = M.whoUses(f, M.readZones(orig)[0].ref); await until(async () => (await text("waves-who-count")) === String(w.length), "count of the original multisample");
  for (let i = 0; i < 3; i++) assert.ok((await text(`waves-who-row-${i}`)).includes(w[i].name), `row ${i}`);
  await X("waves-who-list").press("Escape"); assert.equal(await midi(), midi0);
});
await ui.noErrors();
await finish();
