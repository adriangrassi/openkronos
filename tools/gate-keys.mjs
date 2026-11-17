// Acceptance gate for the keyboard-style screens. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, onlyBits, root, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("KEYS"), { check, finish } = g, C = await core(g), { T, P, L, Q, raw, parsed } = C;
let V; try { V = await load("src/core/pages/view.ts"); } catch (e) { g.fails.push(`cannot load view.ts: ${e.message}`); await finish(); }
const M = JSON.parse(readFileSync(path.join(root, "src/core/pages/pages.json"), "utf8")), f = parsed();
const JK = "program:U-AA", JI = 78, HK = "program:INT-B", HI = 5, CK = "combi:INT-A", jump = L.getEntry(f, JK, JI), hd = L.getEntry(f, HK, HI).subarray(0, 3706), combi = L.getEntry(f, CK, 0);
const K = (r) => `${r.ofs}.${r.bitLo ?? 0}`, rowsIn = (s) => s.flatMap((p) => p.tabs.flatMap((t) => t.rows));
const covers = (screens, rows, label) => { const have = new Set(rowsIn(screens).map(K)), lost = rows.filter((r) => Q.isEditable(r) && !have.has(K(r))); assert.deepEqual(lost.slice(0, 4).map((r) => `${r.group}/${r.name}`), [], `${label}: ${lost.length} settings have no screen`); };

await check("HD-1 screens come in the keyboard's order", () => assert.deepEqual(V.screensFor(M, T, "hd1", hd).map((p) => `${p.page} ${p.title}`), ["P0 Play", "P1 Basic/Vector", "P2 OSC/Pitch", "P3 Filter", "P4 Amp/EQ", "P5 LFO", "P6 AMS Mixer/Common Key Track", "P7 KARMA", "P8 Insert Effect", "P9 Master/Total Effect"]));
await check("every HD-1 setting is on a screen", () => covers(V.screensFor(M, T, "hd1", hd), Q.paramsFor(T, "hd1", hd), "hd1"));
await check("an EXi program shows common pages and its engine's pages", () => { const s = V.screensFor(M, T, "exi", jump); covers(s, Q.paramsFor(T, "exi", jump), "exi"); const al = s.filter((p) => p.engine === "AL-1"); assert.ok(al.length >= 3); assert.ok(al.every((p) => p.slot === 1)); assert.ok(s.every((p) => p.engine !== "Off")); assert.ok(s.some((p) => !p.engine)); const a = rowsIn(al).find((r) => r.group === "EXi1 AL-1: Amplifier EG" && r.name === "Attack Time"), want = Q.paramsFor(T, "exi", jump).find((r) => r.group === "EXi1 AL-1: Amplifier EG" && r.name === "Attack Time"); assert.ok(a); assert.deepEqual(a.parts, want.parts); });
await check("every setting on every factory EXi engine has a screen", () => { for (const b of L.listBanks(f).filter((x) => x.kind === "program" && x.type === "exi")) for (let i = 0; i < b.count; i += 11) { const e = L.getEntry(f, b.key, i); covers(V.screensFor(M, T, "exi", e), Q.paramsFor(T, "exi", e), `${b.key}/${i}`); } });
await check("every Combi setting is on a screen", () => covers(V.screensFor(M, T, "combi", combi), T.combi, "combi"));
await check("screens never show padding rows and tabs have no repeats", () => { for (const s of [V.screensFor(M, T, "hd1", hd), V.screensFor(M, T, "exi", jump), V.screensFor(M, T, "combi", combi)]) for (const p of s) for (const t of p.tabs) { assert.ok(t.rows.every((r) => !r.continuation), t.id); const ks = t.rows.map(K); assert.equal(new Set(ks).size, ks.length, `${p.page} ${t.id} repeats a setting`); } });
await check("drum kits and wave sequences have no keyboard screens yet", () => { assert.equal(V.screensFor(M, T, "drumkit", L.getEntry(f, "drumkit:INT", 0)), null); assert.equal(V.screensFor(M, T, "waveseq", L.getEntry(f, "waveseq:INT", 0)), null); });
await check("no KORG artwork in the project", () => { const imgs = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((x) => /\.(png|bmp|jpe?g|gif|ico)$/i.test(x)); assert.deepEqual(imgs, []); });
await testsAndTypes(g, ["core/pages/view.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { win, X, seen, text, until, editSlot, closeEditor, saved } = ui;
const tabOf = (pages, group) => { for (const p of pages) for (const t of p.tabs) if ((t.groups ?? []).includes(group)) return [p.page, t.id]; throw new Error(`no tab for ${group}`); };
await ui.openFile();
const [AP, AT] = tabOf(M.program.hd1, "OSC1 Amplifier EG"), start = T.programHd1.find((r) => r.group === "OSC1 Amplifier EG" && r.name === "Attack Level"), k = K(start), orig = Q.readParam(hd, start), to = orig === 50 ? 49 : 50;
await check("the editor opens in List and switches to Keyboard", async () => { await editSlot(HK, HI); assert.equal(await X("view-list").getAttribute("data-active"), "true"); assert.equal(await X("view-keyboard").getAttribute("data-active"), "false"); await X("view-keyboard").click(); await seen("kb-page-0-P0"); assert.equal(await win.locator('[data-testid^="kb-page-"]').count(), 10); assert.match(await text("kb-page-0-P4"), /Amp\/EQ/); });
await check("a Keyboard tab shows its settings and envelope graph", async () => { await X(`kb-page-0-${AP}`).click(); await X(`kb-tab-${AT}`).click(); await seen("eg-graph"); await seen(`input-${k}`); });
await check("an edit in Keyboard view appears in List view, and saves only that setting", async () => { await X(`input-${k}`).fill(String(to)); await X(`input-${k}`).press("Enter"); await until(async () => (await X(`param-${k}`).getAttribute("data-changed")) === "true", "marked"); await X("view-list").click(); await X("group-OSC1 Amplifier EG").click(); await seen(`input-${k}`); assert.equal(await X(`input-${k}`).inputValue(), String(to)); const after = L.getEntry(P.parsePcg(await saved()), HK, HI).subarray(0, 3706); assert.equal(Q.readParam(after, start), to); onlyBits(after, hd, start.parts); await X("undo").click(); await until(async () => (await X(`input-${k}`).inputValue()) === String(orig), "undone"); });
await check("Keyboard view is remembered for the next sound", async () => { await X("view-keyboard").click(); await seen("kb-page-0-P0"); await closeEditor(); await editSlot(JK, JI); assert.equal(await X("view-keyboard").getAttribute("data-active"), "true"); await seen("kb-page-0-P0"); });
await check("an EXi program lists its engine's pages, and they work", async () => { const eng = V.screensFor(M, T, "exi", jump).find((p) => p.engine === "AL-1" && p.tabs.some((t) => t.rows.some((r) => r.group === "EXi1 AL-1: Amplifier EG"))), tab = eng.tabs.find((t) => t.rows.some((r) => r.group === "EXi1 AL-1: Amplifier EG")); await X(`kb-page-1-${eng.page}`).click(); await X(`kb-tab-${tab.id}`).click(); await seen("eg-graph"); assert.match(await text(`kb-page-1-${eng.page}`), /AL-1|EXi ?1/); await closeEditor(); });
await check("a Combi has Keyboard screens too", async () => { await editSlot(CK, 0); await seen("kb-page-0-P0"); await closeEditor(); });
await check("a drum kit stays in List view", async () => { await editSlot("drumkit:INT", 0); assert.equal(await X("view-keyboard").isDisabled(), true); await seen("param-search"); await closeEditor(); });
await check("the file is untouched after all that", async () => { const b = await saved(); assert.equal(sha(b), sha(raw)); });
await ui.noErrors();
await finish();
