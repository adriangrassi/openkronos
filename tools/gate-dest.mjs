// Acceptance gate for "Keep as": a run that changed an existing sound asks where the result goes (Current program, New program, New program + combi); runs that only create sounds do not ask. The model is scripted (no AI call, nothing sent to a device).
// With DEST_SHOTS=<dir> it also writes a screenshot of the review with the group.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { gate, core, launch, load, sha } from "./gate-kit.mjs";

const g = gate("DEST"), { check, finish } = g, C = await core(g), { T, P, L, Q, parsed } = C;
const U = await load("src/core/ai/session.ts"), Rf = await load("src/core/pcg/refs.ts");
const f0 = parsed(), PIANO = { key: "program:INT-A", index: 0 };
const SHOTS = process.env.DEST_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (id, name, args) => ({ id, name, arguments: args });
const row = (e, type, ofs, bit) => Q.paramsFor(T, type, e).find((r) => r.ofs === ofs && (r.bitLo ?? 0) === bit);
// The scripted change: Chord Mode (2558.3) of the open piano, to value v.
const setChord = (v) => [{ content: "", toolCalls: [call("p1", "set_params", { ...PIANO, changes: [{ id: "2558.3", value: v }] })] }, { content: "Chord mode changed.", toolCalls: [] }];
const withChord = (v) => { const e = Uint8Array.from(L.getEntry(f0, PIANO.key, PIANO.index)); Q.writeParam(e, row(e, "exi", 2558, 3), v); return e; };
const BUILD = [{ content: "", toolCalls: [call("b1", "build_combi", { name: "Dest Test", parts: [{ ...PIANO, keyBottom: 0, keyTop: 127 }] })] }, { content: "Built.", toolCalls: [] }];

// The factory file has no free slots: one unreferenced EXi Program and one unreferenced Combi are renamed to Init so a copy has a place to go.
function variant() {
  const f = parsed(), used = Rf.referencedSlots(f), out = {};
  const pick = (kind, type) => { for (const b of L.listBanks(f).filter((x) => x.kind === kind && x.type === type).reverse()) for (let i = b.count - 1; i >= 0; i--) if (!used.has(`${b.key}/${i}`)) return { key: b.key, index: i }; throw new Error(`no unreferenced ${kind}`); };
  out.program = pick("program", "exi"); out.combi = pick("combi", null);
  L.setName(f, out.program.key, out.program.index, "Init Program"); L.setName(f, out.combi.key, out.combi.index, "Init Combi");
  return { bytes: P.serializePcg(f), ...out };
}
const V = variant();
const label = (s) => `${s.key.split(":")[1]} ${String(s.index).padStart(3, "0")}`;

async function session(script, body, { variantFile = true, env = {} } = {}) {
  const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(script), KRONOS_E2E_AI_DELAY_MS: "150", ...env });
  const pid = g.state.app.process().pid;
  try {
    if (variantFile) writeFileSync(ui.OPEN, V.bytes);
    await ui.openFile();
    await body(ui);
    await ui.noErrors();
  } catch (e) { g.fails.push(`gate stopped: ${String(e.message).slice(0, 300)}`); } finally { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]); await nap(800); }
}
// The piano open in the editor and the AI panel ready: returns the library hash before any run.
async function prep(ui) {
  const { X, seen, openBank, saved } = ui;
  await openBank(PIANO.key); await X(`row-${PIANO.index}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
  const before = sha(await saved());
  await ui.win.evaluate(() => { window.__resync = 0; window.addEventListener("kronos-live-resync", () => { window.__resync++; }); });
  await X("ai-open").click(); await seen("ask-text");
  return before;
}
const refine = async (ui, text = "make it wider") => { await ui.X("refine-text").fill(text); await ui.X("refine-go").click(); await ui.seen("ai-approve", 30000); await ui.seen("ai-dest"); };
const resyncs = (ui) => ui.win.evaluate(() => window.__resync);
const decisions = (ui) => { const found = []; (function walk(d) { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n === "ai-runs.jsonl") found.push(p); } })(ui.tmp); return found.flatMap((p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))).filter((r) => r.type === "decision"); };
const lines = async (ui, id = "ai-dest") => ((await ui.X(`${id}-lines`).textContent()) ?? "").trim();

await session(setChord(1), async (ui) => {
  const { X, text, until, saved } = ui, shot = async (n) => { if (SHOTS) await ui.win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
  const before = await prep(ui);
  const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
  const slotBytes = (f, s) => L.getEntry(f, s.key, s.index);
  const undoOnce = async (why) => { await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before, why); assert.equal(await X("undo").isDisabled(), true, "that was the only undo step"); };

  await check("a run that changed an existing sound shows 'Keep as', Current selected, and says what Keep overwrites", async () => {
    await refine(ui);
    assert.equal(await X("ai-dest-current").isChecked(), true); assert.equal(await X("ai-dest-new-program").isChecked(), false);
    assert.match(await text("ai-dest"), /Keep as:/); assert.match(await text("ai-dest"), /New program \+ combi/);
    assert.equal(await lines(ui), "-> INT-A 000 overwritten");
    await X("ai-dest-new-program").check();
    assert.equal(await lines(ui), `-> ${label(V.program)} "KRONOS German AI" (original INT-A 000 stays)`);
    await shot("1-review-new-program");
    await X("ai-dest-new-combi").check();
    assert.match(await lines(ui), new RegExp(`^-> ${label(V.program)} "KRONOS German AI", ${label(V.combi)} "KRONOS Ger Combi" \\(original INT-A 000 stays\\)$`));
    await shot("2-review-new-combi");
    await X("ai-dest-current").check();
  });
  await check("Keep with Current is today's Keep: the sound is overwritten, nothing else moves, one Undo", async () => {
    const r0 = await resyncs(ui);
    await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    const f = P.parsePcg(await saved());
    assert.ok(same(slotBytes(f, PIANO), withChord(1)), "INT-A 000 holds the changed bytes");
    for (const b of L.listBanks(f).filter((x) => x.kind === "program" || x.kind === "combi")) for (let i = 0; i < b.count; i++) if (!(b.key === PIANO.key && i === PIANO.index)) assert.ok(same(L.getEntry(f, b.key, i), L.getEntry(P.parsePcg(V.bytes), b.key, i)), `${b.key} ${i} moved`);
    assert.match(await text("ai-log"), /Kept 1 slot\(s\)\./);
    const d = decisions(ui).at(-1); assert.deepEqual([d.decision, d.destination], ["keep", "current"]);
    assert.equal(await resyncs(ui), r0, "no resend needed when nothing moved");
    await undoOnce("one Undo puts the library back");
  });
  await check("New program: the original equals the baseline, the first free slot holds the changed bytes under the new name, ONE Undo reverses it all", async () => {
    await refine(ui); await X("ai-dest-new-program").check();
    const r0 = await resyncs(ui);
    await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    const f = P.parsePcg(await saved());
    assert.ok(same(slotBytes(f, PIANO), L.getEntry(f0, PIANO.key, PIANO.index)), "original equals the baseline");
    assert.equal(L.getName(f, V.program.key, V.program.index), "KRONOS German AI");
    assert.ok(same(slotBytes(f, V.program).subarray(24), withChord(1).subarray(24)), "the copy holds the changed bytes");
    assert.match(await text("ai-log"), new RegExp(`Kept as new program ${label(V.program)} "KRONOS German AI": original INT-A 000 unchanged\\.`));
    const d = decisions(ui).at(-1); assert.deepEqual([d.decision, d.destination], ["keep", "new-program"]); assert.match(d.destinationNote, /original INT-A 000 unchanged/);
    assert.ok((await resyncs(ui)) > r0, "the keyboard is resent for the sound that is open");
    await undoOnce("one Undo reverses the copy and the restore");
  });
  await check("New program + combi: a Combi in the free slot plays the new program as timbre 1, original untouched, ONE Undo", async () => {
    await refine(ui); await X("ai-dest-new-combi").check();
    await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    const f = P.parsePcg(await saved()), c = L.getEntry(f, V.combi.key, V.combi.index);
    assert.equal(L.getName(f, V.combi.key, V.combi.index), "KRONOS Ger Combi");
    const cell = (t, n) => Q.readParam(c, Q.paramsFor(T, "combi", c).find((r) => r.group === `Timbre${t}` && r.name === n));
    assert.deepEqual([cell(1, "Program Number"), cell(1, "Bank Number"), cell(1, "Status")], [V.program.index, U.bankNumberOf(V.program.key), 1]);
    assert.equal(cell(2, "Status"), 0);
    assert.ok(same(slotBytes(f, PIANO), L.getEntry(f0, PIANO.key, PIANO.index)), "original untouched");
    assert.ok(same(slotBytes(f, V.program).subarray(24), withChord(1).subarray(24)));
    assert.match(await text("ai-log"), /Kept as new program .* and Combi .*: original INT-A 000 unchanged\./);
    assert.equal(decisions(ui).at(-1).destination, "new-combi");
    await undoOnce("one Undo reverses the program, the Combi and the restore");
  });
  await check("Discard still restores everything, whichever destination was picked", async () => {
    const r0 = await resyncs(ui);
    await refine(ui); await X("ai-dest-new-combi").check();
    await X("ai-discard").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    assert.equal(sha(await saved()), before); assert.ok((await resyncs(ui)) > r0);
    assert.equal(await X("undo").isDisabled(), true, "Discard leaves no undo step");
  });
});

await session(BUILD, async (ui) => {
  const { X, seen, text, saved } = ui;
  const before = await prep(ui);
  await check("a Go run that only creates a Combination shows NO 'Keep as'", async () => {
    await X("ai-prompt").fill("build a combi with the piano"); await X("ai-go").click(); await seen("ai-approve", 30000);
    assert.equal(await X("ai-dest").count(), 0); assert.match(await text("ai-result"), /Combi /);
    await X("ai-discard").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    assert.equal(sha(await saved()), before);
  });
  await check("a promoted build-layer run that leaves the piano untouched shows NO 'Keep as' and keeps as before", async () => {
    await X("refine-text").fill("add a pad and a synth over the piano"); await X("refine-go").click(); await seen("ai-approve", 30000);
    assert.equal(await X("ai-dest").count(), 0);
    await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    assert.equal(decisions(ui).at(-1).destination, undefined, "no destination was asked, so none is logged");
    const f = P.parsePcg(await saved()); assert.equal(L.getName(f, V.combi.key, V.combi.index), "Dest Test");
    await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before);
  });
});

await session(setChord(1), async (ui) => {
  const { X, text, saved } = ui;
  const before = await prep(ui);
  await check("no free program slot: the group says so, Keep falls back to Current with a plain message", async () => {
    await refine(ui); await X("ai-dest-new-program").check();
    assert.match(await text("ai-dest-error"), /free program slot/i);
    await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    assert.match(await text("ai-log"), /Kept as the current sound instead/);
    const f = P.parsePcg(await saved());
    assert.ok(Buffer.from(L.getEntry(f, PIANO.key, PIANO.index)).equals(Buffer.from(withChord(1))), "kept as the current sound");
    assert.equal(decisions(ui).at(-1).destination, "current");
    await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before);
  });
}, { variantFile: false });

await session(setChord(1), async (ui) => {
  const { X, seen, text, saved } = ui;
  const before = await prep(ui);
  await check("model comparison: the chosen candidate can be kept as a new program, one Undo", async () => {
    await X("ai-prompt").fill("wider piano"); await X("ai-compare").click(); await seen("ai-cmp-review", 40000);
    assert.equal(await X("ai-dest-A-current").isChecked(), true);
    assert.equal(await lines(ui, "ai-dest-A"), "-> INT-A 000 overwritten");
    await X("ai-dest-A-new-program").check();
    assert.equal(await lines(ui, "ai-dest-A"), `-> ${label(V.program)} "KRONOS German AI" (original INT-A 000 stays)`);
    if (SHOTS) await ui.win.screenshot({ path: path.join(SHOTS, "3-compare.png") });
    await X("ai-keep-A").click(); await X("ai-cmp-review").waitFor({ state: "hidden", timeout: 8000 });
    const f = P.parsePcg(await saved());
    assert.ok(Buffer.from(L.getEntry(f, PIANO.key, PIANO.index)).equals(Buffer.from(L.getEntry(f0, PIANO.key, PIANO.index))));
    assert.ok(Buffer.from(L.getEntry(f, V.program.key, V.program.index)).subarray(24).equals(Buffer.from(withChord(1)).subarray(24)));
    assert.equal(decisions(ui).filter((d) => d.decision === "keep").at(-1).destination, "new-program");
    await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before);
  });
}, { env: { KRONOS_E2E_AI_SCRIPT_LOCAL: JSON.stringify(setChord(2)) } });

await finish();
