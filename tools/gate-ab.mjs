// Gate for A/B compare: the before/after bar in the AI review, the walkthrough callout and the editor header. Simulator only, scripted model, nothing real is touched.
// With AB_SHOTS=<dir> it also writes a screenshot of each state.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const SHOTS = process.env.AB_SHOTS;
const g = gate("AB"), { finish } = g, C = await core(g), { T, L, Q, parsed } = C;
const check = (t, fn) => g.check(t, async () => { try { return await fn(); } catch (e) { console.log("  why:", String(e.message).slice(0, 400)); if (SHOTS && typeof win !== "undefined") await win.screenshot({ path: path.join(SHOTS, `fail-${t.slice(0, 20).replace(/\W+/g, "-")}.png`) }).catch(() => {}); throw e; } });
const H = await load("src/core/midi/phrases.ts"), AB = await load("src/core/midi/ab.ts"), Cat = await load("src/core/pcg/catalog.ts"), E = await import("../src/core/params/effects.ts");
await testsAndTypes(g, ["core/midi/ab.test.ts", "core/midi/phrases.test.ts"]);
if (g.fails.length) await finish();

const JK = "program:U-AA", JI = 78, GK = "program:INT-A", GI = 1;
const f0 = parsed(), jump = L.getEntry(f0, JK, JI), rows = Q.paramsFor(T, "exi", jump), AMP = rows.find((r) => r.group === "EXi1 AL-1: Amplifier EG" && r.name === "Attack Time");
const id = (r) => `${r.ofs}.${r.bitLo ?? 0}`, orig = Q.readParam(jump, AMP), NEW = orig === 40 ? 41 : 40;
const afterJump = Uint8Array.from(jump); Q.writeParam(afterJump, AMP, NEW);
const gEntry = L.getEntry(f0, GK, GI), gRows = Q.paramsFor(T, "exi", gEntry), wet = E.effectRowsAt(gRows.find((r) => r.group === "Master Effect2" && r.name === "Effect Type").ofs, gEntry[gRows.find((r) => r.group === "Master Effect2" && r.name === "Effect Type").ofs], "Master Effect2").find((r) => r.name === "Wet/Dry");
const wantKind = (key, idx, type) => { const e = L.getEntry(f0, key, idx), kind = "program"; return AB.abPlan({ name: L.getName(f0, key, idx), category: Cat.categoryLabel(Cat.categoryNames(f0, T, kind), Q.readParam(e, Cat.categoryRow(T, kind, type))), engine: type }); };
const SCRIPT = [
  { content: "", toolCalls: [{ id: "a1", name: "set_params", arguments: { key: JK, index: JI, changes: [{ id: id(AMP), value: NEW }] } }] }, { content: "Attack changed.", toolCalls: [] },
];
const SCRIPT_LOCAL = [
  { content: "", toolCalls: [{ id: "d1", name: "describe_sound", arguments: { key: GK, index: GI } }] },
  { content: "", toolCalls: [{ id: "s1", name: "show_param", arguments: { key: GK, index: GI, ids: [{ id: id(wet), note: "Raise slightly", suggest: 30 }] } }] }, { content: "One setting.", toolCalls: [] },
];

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(SCRIPT), KRONOS_E2E_AI_SCRIPT_LOCAL: JSON.stringify(SCRIPT_LOCAL), KRONOS_E2E_AI_DELAY_MS: "300" });
var { win, X, seen, text, until, openBank, connectSim } = ui;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const buf = (obj = 0) => win.evaluate((o) => window.__kronosE2E.editBuffer(o), obj);
const isDump = (m) => m[0] === 0xf0 && m.length > 200, isOn = (m) => (m[0] & 0xf0) === 0x90 && m[2] > 0, allOff = (m) => (m[0] & 0xf0) === 0xb0 && m[1] === 123;
const diff = (data, entry) => (data ? `len ${data.length}/${entry.length}, first diff at ${data.findIndex((b, i) => b !== entry[i])}` : "no edit buffer");
const same = (data, entry) => data && data.length > 0 && data.every((b, i) => b === entry[i]);
const noteSet = (l) => new Set(l.filter(isOn).map((m) => m[1]));
const kindAttr = async () => ({ kind: await X("ab-kind").getAttribute("data-kind"), variant: Number(await X("ab-kind").getAttribute("data-variant")) });
const expected = (k, v) => new Set(H.phrase(k, 0, v).filter((e) => (e.data[0] & 0xf0) === 0x90).map((e) => e.data[1]));
const gone = async () => (await X("ab-bar").count()) === 0;
const now = async () => text("ab-now");

try {
  await ui.openFile();
  await check("not connected: the editor header's Compare A/B is off, with the reason", async () => {
    await openBank("program:INT-B"); await X("row-3").dblclick(); await X("rename-input").fill("Renamed A"); await X("rename-input").press("Enter"); await until(async () => (await text("row-name-3")) === "Renamed A", "renamed");
    await X("row-3").click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
    assert.equal(await X("ab-open-editor").isDisabled(), true); assert.equal(await X("ab-open-editor").getAttribute("title"), "Connect the Kronos first"); await shot("1-not-connected");
    await ui.closeEditor();
  });
  await connectSim();
  await check("the AI review offers Compare A/B once a run has changed a sound", async () => {
    await X("ai-open").click(); await seen("ai-prompt"); await X("ai-prompt").fill("slower attack"); await X("ai-go").click(); await seen("ai-approve", 20000);
    assert.equal(await X("ab-open-ai").isDisabled(), false); await shot("1b-review");
  });
  const dumps0 = async () => (await log()).filter(isDump).length;
  await check("review: Compare A/B opens a bar that says nothing is stored and sends nothing yet", async () => {
    const n = await dumps0();
    await X("ab-open-ai").click(); await seen("ab-bar");
    assert.equal(await text("ab-note"), "Audition only: nothing is stored on the keyboard"); assert.match(await now(), /nothing sent yet/); assert.match(await text("ab-source"), /before the AI's changes/);
    assert.equal(await dumps0(), n, "opening the bar sent a dump"); await shot("2-ai-bar-open");
  });
  let plan;
  await check("A sends the before state, then Play loops the phrase picked for the sound", async () => {
    await X("ab-a").click(); await until(async () => /A before/.test(await now()), "A loaded");
    { const d = (await buf()); assert.ok(same(d, jump), `A is not the before bytes: ${diff(d, jump)}`); } assert.equal(await X("ab-a").getAttribute("aria-pressed"), "true");
    const from = (await log()).length; await X("ab-play").click(); await seen("ab-kind"); plan = await kindAttr();
    const want = wantKind(JK, JI, "EXi"); assert.equal(plan.kind, want.kind, "auto kind"); assert.equal(plan.variant, want.variant);
    await until(async () => noteSet((await log()).slice(from)).size > 1, "notes sounding", 8000);
    const got = noteSet((await log()).slice(from)); for (const n of got) assert.ok(expected(plan.kind, plan.variant).has(n), `note ${n} is not in the ${plan.kind} phrase`);
    await shot("3-playing-A");
  });
  await check("B mid-loop: all notes off first, then the after bytes, then the same phrase goes on", async () => {
    const from = (await log()).length; await X("ab-b").click(); await until(async () => /B after/.test(await now()), "B loaded");
    const l = (await log()).slice(from), iOff = l.findIndex(allOff), iDump = l.findIndex(isDump);
    assert.ok(iOff >= 0 && iDump >= 0 && iOff < iDump, `all-notes-off at ${iOff}, dump at ${iDump}`); assert.ok(same((await buf()), afterJump), "B is not the after bytes");
    assert.deepEqual(await kindAttr(), plan, "the phrase changed between A and B");
    const mark = (await log()).length; await until(async () => noteSet((await log()).slice(mark)).size > 0, "phrase continues after the switch", 8000);
    for (const n of noteSet((await log()).slice(mark))) assert.ok(expected(plan.kind, plan.variant).has(n), `note ${n} after the switch`);
    await shot("4-playing-B");
  });
  await check("Stop sends all-notes-off and keeps B loaded", async () => {
    const from = (await log()).length; await X("ab-stop").click(); await until(async () => (await log()).slice(from).some(allOff), "all notes off");
    assert.equal(await X("ab-stop").isDisabled(), true); assert.match(await now(), /B after/); await nap(900);
    const after = (await log()).length; await nap(700); assert.equal((await log()).slice(after).filter(isOn).length, 0, "notes after Stop");
  });
  await check("the phrase drop-down overrides Auto, and a repeated press rotates the variant", async () => {
    await X("ab-phrase").selectOption("bass"); const from = (await log()).length; await X("ab-play").click();
    await until(async () => (await kindAttr()).kind === "bass", "bass picked"); const v1 = (await kindAttr()).variant;
    await until(async () => noteSet((await log()).slice(from)).size > 0, "bass notes", 8000); for (const n of noteSet((await log()).slice(from))) assert.ok(n < 55, `bass note ${n}`);
    await X("ab-stop").click(); await X("ab-play").click(); await until(async () => (await kindAttr()).variant !== v1, "variant rotated"); await shot("5-bass-override");
    await X("ab-stop").click(); await X("ab-phrase").selectOption("auto");
  });
  await check("a keyboard that stops answering shows the normal error and leaves the bar usable", async () => {
    await win.evaluate(() => window.__kronosE2E.setLatency(6500)); await X("ab-a").click();
    await until(async () => (await X("ab-bar").locator('[role="alert"]').count()) > 0, "error shown", 12000);
    assert.match(await X("ab-bar").locator('[role="alert"]').first().innerText(), /stopped answering/); assert.match(await now(), /B after/, "state changed on failure");
    await shot("6-error"); await win.evaluate(() => window.__kronosE2E.setLatency(0)); await nap(1800);
    assert.equal(await X("ab-a").isDisabled(), false); await X("ab-a").click(); await until(async () => /A before/.test(await now()), "usable again", 10000);
  });
  await check("Keep ends the hold: the bar closes and the keyboard is put back to B", async () => {
    await X("ai-approve").click(); await until(gone, "bar closed"); await until(async () => same((await buf()), afterJump), "keyboard back to B", 8000);
  });
  await X("ai-open").click(); await X("ask-text").waitFor({ state: "hidden", timeout: 5000 }); // the AI window would cover the editor header
  await check("header: Compare A/B for an edited sound; Close restores B", async () => {
    await openBank(JK); await X(`row-${JI}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
    assert.equal(await X("ab-open-editor").isDisabled(), false); await shot("7-editor-header");
    await X("ab-open-editor").click(); await seen("ab-bar"); assert.match(await text("ab-source"), /last saved or opened/);
    await X("ab-a").click(); await until(async () => /A before/.test(await now()), "A"); assert.ok(same((await buf()), jump));
    await X("ab-close").click(); await until(gone, "closed"); await until(async () => same((await buf()), afterJump), "restored to B", 8000);
  });
  await check("header: a sound that was never edited has the button off, with the reason; a rename counts as an edit", async () => {
    await ui.closeEditor(); await openBank("program:INT-B"); await X("row-4").click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
    assert.equal(await X("ab-open-editor").isDisabled(), true); assert.equal(await X("ab-open-editor").getAttribute("title"), "Nothing differs from the saved sound");
    await ui.closeEditor(); await X("row-3").click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title"); assert.equal(await X("ab-open-editor").isDisabled(), false);
    await X("ab-open-editor").click(); await seen("ab-bar"); await X("ab-a").click(); await until(async () => /A before/.test(await now()), "A");
    assert.ok(same((await buf()), L.getEntry(f0, "program:INT-B", 3)), "A is the original name");
  });
  await check("leaving the sound closes the bar and puts the keyboard back", async () => {
    const from = (await log()).length; await X("close-editor").click(); await until(gone, "bar closed"); await until(async () => (await log()).slice(from).some(isDump), "restore dump", 8000);
    assert.ok(!same((await buf()), L.getEntry(f0, "program:INT-B", 3)), "still the old name on the keyboard");
  });
  await check("walkthrough: the A/B button is off until something changed, then compares the start state", async () => {
    await openBank(GK); await X(`row-${GI}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title"); await X("view-kronos").click(); await seen("kronos-view");
    await X("ai-open").click(); await seen("ask-text"); await X("ai-provider").selectOption("local"); await X("ask-text").fill("more expansive"); await X("ask-go").click(); await seen("guide-callout", 30000);
    assert.equal(await X("ab-open-guide").isDisabled(), true); assert.equal(await X("ab-open-guide").getAttribute("title"), "Nothing has changed since the walkthrough started");
    await X("guide-apply").click(); await seen("guide-done"); assert.equal(await X("ab-open-guide").isDisabled(), false); await shot("8-guide-callout");
    await X("ab-open-guide").click(); await seen("ab-bar"); assert.match(await text("ab-source"), /walkthrough started/);
    await X("ab-a").click(); await until(async () => /A before/.test(await now()), "A"); assert.ok(same((await buf()), gEntry), "A is not the start state");
    await X("ab-b").click(); await until(async () => /B after/.test(await now()), "B"); assert.ok(!same((await buf()), gEntry), "B equals the start state");
    await shot("9-guide-bar"); await X("ab-close").click(); await until(gone, "closed");
  });
  await ui.noErrors();
} catch (e) { g.fails.push(`gate aborted: ${e.stack ?? e.message}`.slice(0, 600)); } finally { await finish(); }
