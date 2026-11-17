// Acceptance gate for "add X over this sound": a Refine that adds instruments is promoted to a build (a Combination with the open sound untouched as timbre 1), with Keep, Discard and Undo; a small Refine ("add a delay") stays small. The model is scripted (no AI call, nothing sent to a device).
// With BUILD_SHOTS=<dir> it also writes screenshots of the review.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, sha } from "./gate-kit.mjs";

const g = gate("BUILD"), { check, finish } = g, C = await core(g), { T, P, L, Q, parsed } = C;
const U = await load("src/core/ai/session.ts");
const f0 = parsed(), PIANO = { key: "program:INT-A", index: 0 }, COMBI = { key: "combi:INT-F", index: 100 };
const REQ = "add a pad and a synth over the piano", REQ_KARMA = "add a pad and a synth over the piano with an arpeggio on the synth, split at C3", REQ_TWEAK = "add a delay with 4 long repetition";
const s0 = new U.SoundSession(T, f0);
const first = (text) => { const r = U.runTool(s0, "search_sounds", { text, kind: "program", limit: 5 }).results.find((x) => !/init/i.test(x.name) && `${x.key}${x.index}` !== `${PIANO.key}${PIANO.index}`); assert.ok(r, `no program for ${text}`); return { key: r.key, index: r.index, name: r.name }; };
const PAD = first("pad"), SYNTH = first("synth"), GE = U.runTool(s0, "search_ge", { query: "arp" }).results[0].number;
const call = (id, name, args) => ({ id, name, arguments: args });
const part = (p, o) => ({ key: p.key, index: p.index, ...o });

const SCRIPT_BUILD = [
  { content: "", toolCalls: [call("s1", "search_sounds", { text: "pad", kind: "program", limit: 3 }), call("s2", "search_sounds", { text: "synth", kind: "program", limit: 3 })] },
  { content: "", toolCalls: [call("b1", "build_combi", { name: "Piano Pad Synth", parts: [part(PIANO, { keyBottom: 0, keyTop: 127, volume: 100 }), part(PAD, { keyBottom: 0, keyTop: 127, volume: 70 }), part(SYNTH, { keyBottom: 0, keyTop: 127, volume: 60 })] })] },
  { content: "The piano stays as it was in timbre 1; a pad and a synth play under your hands in the Combination Piano Pad Synth.", toolCalls: [] },
];
const SCRIPT_KARMA = [
  { content: "", toolCalls: [call("g1", "search_ge", { query: "arp", limit: 3 })] },
  { content: "", toolCalls: [call("b1", "build_combi", { name: "Piano Pad Arp", parts: [part(PIANO, { keyBottom: 48, keyTop: 127, volume: 100 }), part(PAD, { keyBottom: 48, keyTop: 127, volume: 70 }), part(SYNTH, { keyBottom: 0, keyTop: 47, volume: 90, channel: 2 })] })] },
  { content: "", toolCalls: [call("c1", "configure_combi", { key: COMBI.key, index: COMBI.index, tempo: 100, karma: { modules: [{ module: "A", ge: GE, plays: 3, inputChannel: 16, keyBottom: 0, keyTop: 47 }] } })] },
  { content: "Piano and pad play from C3 up; the synth is under C3 and is played by KARMA module A.", toolCalls: [] },
];
const SCRIPT_TWEAK = [
  { content: "", toolCalls: [call("d1", "describe_sound", PIANO), call("x1", "build_combi", { name: "No", parts: [part(PIANO, { keyBottom: 0, keyTop: 127 })] })] },
  { content: "Nothing was changed: the piano has no free effect to raise; I only read it.", toolCalls: [] },
];

const SHOTS = process.env.BUILD_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const rowOf = (e, group, name) => Q.paramsFor(T, "combi", e).find((r) => r.group === group && r.name === name);
const cell = (e, n, name) => Q.readParam(e, rowOf(e, `Timbre${n}`, name));
const mod = (e, m, name) => Q.readParam(e, rowOf(e, `KARMA Module ${m}`, name));
const LOGGED = "This needs a Combination: building it for you";

async function session(script, body) {
  const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(script), KRONOS_E2E_AI_DELAY_MS: "200" });
  const pid = g.state.app.process().pid;
  try { await body(ui); await ui.noErrors(); } catch (e) { g.fails.push(`gate stopped: ${String(e.message).slice(0, 300)}`); } finally { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]); await nap(800); }
}
// The piano open in the editor, a free Combination slot, and the AI panel ready: returns the library hash before any run.
async function prep(ui) {
  const { X, seen, text, until, openBank, saved } = ui;
  await ui.openFile();
  await openBank(COMBI.key); await X(`row-${COMBI.index}`).dblclick(); await X("rename-input").fill("Init Combi"); await X("rename-input").press("Enter"); await until(async () => (await text(`row-name-${COMBI.index}`)) === "Init Combi", "renamed");
  await openBank(PIANO.key); await X(`row-${PIANO.index}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
  const before = sha(await saved());
  await X("ai-open").click(); await seen("ask-text");
  return before;
}
const refine = async (ui, text) => { await ui.X("refine-text").fill(text); await ui.X("refine-go").click(); };
const programsUntouched = (f) => { for (const b of L.listBanks(f)) if (b.kind === "program") for (let i = 0; i < b.count; i++) assert.equal(sha(L.getEntry(f, b.key, i)), sha(L.getEntry(f0, b.key, i)), `${b.key} ${i} changed`); };

await session(SCRIPT_BUILD, async (ui) => {
  const { X, seen, text, until, saved } = ui, shot = async (n) => { if (SHOTS) await ui.win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
  const before = await prep(ui);
  await check(`Refine '${REQ}' on the SGX-2 piano is promoted: the log says so, the run builds a Combination in the free slot`, async () => {
    await refine(ui, REQ); await seen("ai-approve", 30000); await seen("ai-discard");
    assert.ok((await text("ai-log")).includes(LOGGED));
    const log = await text("ai-built");
    assert.match(log, /Built the Combination "Piano Pad Synth" in slot INT-F 100/); assert.match(log, /Timbre 1: INT-A 000 /); assert.match(log, /Timbre 3: /); assert.match(log, /select the Combination on the keyboard/); assert.match(log, /Store/);
    assert.doesNotMatch(log, /KARMA ON\/OFF/, "no KARMA was built, so no KARMA reminder");
    assert.match(await text("ai-result"), /Combi INT-F 100 .*\(was "Init Combi"\)/);
    await shot("1-review-keep-discard");
  });
  await check("Discard leaves the library untouched", async () => {
    await X("ai-discard").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    assert.equal(sha(await saved()), before, "Discard changed nothing");
  });
  await check("Keep keeps it: timbre 1 = the piano unchanged, timbres 2 and 3 are the new sounds, nothing else; one Undo reverses it", async () => {
    await refine(ui, REQ); await seen("ai-approve", 30000); await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    const f = P.parsePcg(await saved()), e = L.getEntry(f, COMBI.key, COMBI.index);
    assert.equal(L.getName(f, COMBI.key, COMBI.index), "Piano Pad Synth");
    assert.deepEqual([1, 2, 3].map((t) => [cell(e, t, "Program Number"), cell(e, t, "Bank Number")]), [PIANO, PAD, SYNTH].map((p) => [p.index, U.bankNumberOf(p.key)]));
    assert.equal(cell(e, 4, "Status"), 0, "no fourth timbre");
    programsUntouched(f);
    await shot("2-kept");
    await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before, "one Undo puts the library back");
  });
});

await session(SCRIPT_TWEAK, async (ui) => {
  const { X, seen, text, saved } = ui;
  const before = await prep(ui);
  await check(`Refine '${REQ_TWEAK}' stays a normal small refine: not promoted, still the small toolset, nothing changed`, async () => {
    await refine(ui, REQ_TWEAK); await seen("ai-log"); await ui.until(async () => /Nothing was changed/.test(await text("ai-log")), "final text", 30000);
    const log = await text("ai-log");
    assert.ok(!log.includes(LOGGED), log); assert.match(log, /build_combi refused: Refine may not use build_combi/);
    assert.equal(sha(await saved()), before);
  });
});

await session(SCRIPT_KARMA, async (ui) => {
  const { X, seen, text, saved } = ui, shot = async (n) => { if (SHOTS) await ui.win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
  const before = await prep(ui);
  await check(`Refine '${REQ_KARMA}': piano and pad above C3 (48..127), the synth below (0..47) played by KARMA module A only, reported honestly`, async () => {
    await refine(ui, REQ_KARMA); await seen("ai-approve", 30000);
    assert.ok((await text("ai-log")).includes(LOGGED));
    const log = await text("ai-built");
    assert.match(log, /Timbre 1: INT-A 000 .*keys C3\.\.G9/); assert.match(log, /Timbre 3: .*keys C-1\.\.B2.*played by KARMA module A \(silent with KARMA off\)/);
    assert.match(log, /KARMA module A: \d+ .*keys C-1\.\.B2/); assert.match(log, /KARMA tempo 100 BPM/); assert.match(log, /press KARMA ON\/OFF/);
    await shot("3-karma-review");
    await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    const f = P.parsePcg(await saved()), e = L.getEntry(f, COMBI.key, COMBI.index);
    assert.deepEqual([1, 2, 3].map((t) => [cell(e, t, "Key Window Bottom"), cell(e, t, "Key Window Top")]), [[48, 127], [48, 127], [0, 47]]);
    assert.deepEqual([cell(e, 1, "MIDI Channel"), cell(e, 3, "MIDI Channel")], [16, 2]);
    assert.deepEqual(["GE Number", "Output MIDI Channel", "Input MIDI Channel", "Key Zone Bottom", "Key Zone Top"].map((n) => mod(e, "A", n)), [GE, 2, 16, 0, 47]);
    programsUntouched(f);
    await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before, "one Undo puts the library back");
  });
});

await finish();
