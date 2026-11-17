// Acceptance gate for "add strings over this sound": Ask plans a layer, the walkthrough shows the numbered steps, Build it for me makes the Combination. The model is scripted (no AI call, nothing sent to a device).
// With LAYER_SHOTS=<dir> it also writes a screenshot of the steps and of the Build result.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, sha } from "./gate-kit.mjs";

const g = gate("LAYER"), { check, finish } = g, C = await core(g), { T, P, L, Q, parsed } = C;
const U = await load("src/core/ai/session.ts");
const f0 = parsed(), BASE = { key: "program:INT-A", index: 0 }, OPEN = { key: "program:U-B", index: 5 }, COMBI = { key: "combi:INT-F", index: 100 };
const rowOf = (type, entry, group, name) => Q.paramsFor(T, type, entry).find((r) => r.group === group && r.name === name);
const withFreeCombi = () => { const f = parsed(); L.setName(f, COMBI.key, COMBI.index, "Init Combi"); return f; }; // the factory file has no free Combi slot
const askSession = (f = withFreeCombi()) => new U.SoundSession(T, f, { ask: true });
const plan = (s, base, add, method) => U.runTool(s, "propose_layer", { base, add, method });

// Real library, no app: the engine is named, osc2 needs HD-1, and the plan's ids are real rows.
await check("read_sound names the engine: SGX-2 piano, an HD-1 Program, a Combi", () => {
  const s = askSession(), eng = (k, i) => U.runTool(s, "describe_sound", { key: k, index: i }).sound.engine;
  assert.equal(eng(BASE.key, 0), "SGX-2"); assert.equal(eng("program:INT-B", 5), "HD-1"); assert.equal(eng("combi:INT-A", 0), "Combi");
});
await check("an osc2 plan on the SGX-2 piano is refused with a clear error; the combi plan is offered", () => {
  const s = askSession(), r = plan(s, BASE, { role: "strings" }, "osc2");
  assert.equal(r.ok, false); assert.match(String(r.error), /HD-1/); assert.match(String(r.error), /combi/);
  const c = plan(s, BASE, { role: "strings" }, "combi");
  assert.equal(c.ok, true, String(c.error)); assert.ok(!/piano|guitar|grand/i.test(c.add.chosen.name), `chose ${c.add.chosen.name}`);
  console.log("  strings candidates:", c.add.candidates.map((x) => `${x.name} (${x.engine})`).join("; "));
});
await check("an osc2 plan on an HD-1 Program points at real rows: Oscillator Mode, OSC2 multisample, level, attack", () => {
  const e = L.getEntry(f0, "program:INT-B", 5), r = plan(askSession(), { key: "program:INT-B", index: 5 }, { role: "strings" }, "osc2");
  assert.equal(r.ok, true, String(r.error));
  const ids = new Map(Q.paramsFor(T, "hd1", e).map((x) => [`${x.ofs}.${x.bitLo ?? 0}`, x]));
  const params = r.steps.filter((x) => x.kind === "param");
  assert.deepEqual(params.map((x) => ids.get(x.id)?.name), ["Oscillator Mode", "Zone1 MS Number", "Level", "Attack Time"]);
  assert.equal(params[0].suggest, 1);
});

// The app: a scripted Ask on a file whose open sound is an Init Program.
const idOf = (r) => `${r.ofs}.${r.bitLo ?? 0}`;
const call = (id, name, args) => ({ id, name, arguments: args });
const SCRIPT = [
  { content: "", toolCalls: [call("d1", "describe_sound", BASE)] },
  { content: "", toolCalls: [call("p1", "propose_layer", { base: BASE, add: { role: "strings" }, method: "osc2" })] },
  { content: "", toolCalls: [call("p2", "propose_layer", { base: BASE, add: { role: "strings" }, method: "combi", notes: "The piano is a single-engine SGX-2 Program, so the strings go in a Combination." })] },
  { content: "A Combination plays the grand piano and a strings Program together, because the SGX-2 piano has no second oscillator. The numbered steps are shown.", toolCalls: [] },
];
const SHOTS = process.env.LAYER_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(SCRIPT), KRONOS_E2E_AI_DELAY_MS: "300" });
const { win, X, seen, text, until, openBank, saved } = ui;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
const hl = () => win.evaluate(() => [...document.querySelectorAll('[data-pointed="true"]')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }).filter((r) => r.w > 0 && r.h > 0));
const stepNo = async () => Number(/Step (\d+) of/.exec(await text("guide-step"))?.[1] ?? 0);
const gone = async () => (await X("guide-callout").count()) === 0 && (await hl()).length === 0;
const rename = async (k, i, name) => { await openBank(k); await X(`row-${i}`).dblclick(); await X("rename-input").fill(name); await X("rename-input").press("Enter"); await until(async () => (await text(`row-name-${i}`)) === name, `renamed ${name}`); };
const entryOf = async (key, index) => L.getEntry(P.parsePcg(await saved()), key, index);
const cell = (e, n, name) => Q.readParam(e, rowOf("combi", e, `Timbre${n}`, name));
const ranked = () => [...(function* walk(d) { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) yield* walk(p); else if (n === "ai-runs.jsonl") yield p; } })(ui.tmp)];
const next = async (n) => { await X("guide-next").click(); await until(async () => (await stepNo()) === n, `step ${n}`); await nap(350); };

try {
  await ui.openFile();
  await rename(OPEN.key, OPEN.index, "Init EXi Program"); await rename(COMBI.key, COMBI.index, "Init Combi");
  await openBank(OPEN.key); await X(`row-${OPEN.index}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
  const before = sha(await saved());
  await X("ai-open").click(); await seen("ask-text");

  await check("Ask 'add strings over INT-A 000': the model reads INT-A 000, not the open Init sound, and the run is told which sound is open", async () => {
    await X("ask-text").fill("add strings over INT-A 000"); await X("ask-go").click();
    await seen("guide-callout", 30000);
    const log = await text("ai-log");
    assert.match(log, /Read "KRONOS German Grand" INT-A 000/); assert.doesNotMatch(log, /Read "Init EXi Program"/);
    assert.match(log, /propose_layer refused: .*HD-1/, "osc2 on the SGX-2 piano was refused and shown");
    const run = ranked().flatMap((p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x))).find((r) => r.type === "run" && r.kind === "ask");
    assert.ok(run, "the run was logged");
    const user = run.transcript.find((m) => m.role === "user").content, eng = Q.exiEngines(T, L.getEntry(f0, OPEN.key, OPEN.index))[0];
    assert.match(user, /"Init EXi Program"/); assert.match(user, /program:U-B 5/); assert.ok(user.includes(`engine ${eng}`), user); assert.match(user, /blank Init sound/);
    assert.match(await text("ai-log"), /A Combination plays the grand piano/);
    assert.doesNotMatch(await text("ai-log"), /\b(I changed|I have changed|has been changed)\b/);
  });
  await check("the walkthrough shows the numbered steps: a note, the two programs, a level with a suggested number", async () => {
    assert.match(await text("editor-title"), /INT-F 100 Init Combi/, "the walkthrough opened the Combination"); assert.equal(await text("guide-step"), "Step 1 of 5"); assert.equal(await text("guide-name"), "Plan");
    assert.equal(await X("guide-callout").getAttribute("data-docked"), "true"); assert.match(await text("guide-note"), /Open Combinations and pick the empty slot INT-F 100/); assert.match(await text("guide-note"), /Name it "[ -~]+"/);
    assert.equal(await X("guide-now").count(), 0); assert.equal(await X("guide-apply").count(), 0); await shot("1-note-step");
    const steps = (await X("ai-layer-steps").locator("li").allTextContents()); assert.equal(steps.length, 5); assert.match(steps[1], /^Set Timbre 1 to INT-A 000 KRONOS German Grand/); assert.match(steps[2], /^Set Timbre 2 to \S+ \d{3} /); assert.match(steps[3], /Set Timbre 2 Volume to \d+/);
    await next(2); assert.equal(await text("guide-name"), "Timbre 1 program"); await until(async () => (await hl()).length > 0, "target of step 2"); assert.match(await text("guide-suggest"), /^0+$/); await shot("2-timbre1-program");
    await next(3); assert.equal(await text("guide-name"), "Timbre 2 program"); await until(async () => (await hl()).length > 0, "target of step 3"); await shot("3-timbre2-program");
    await next(4); assert.equal(await text("guide-name"), "Timbre 2 level"); await until(async () => (await hl()).length > 0, "target of step 4");
    assert.match(await text("guide-suggest"), /^\d+$/); await shot("4-timbre2-level");
  });
  await check("Do it for me on the level step writes the number as one undo step; Next, then Cancel", async () => {
    const want = await text("guide-suggest"); await X("guide-apply").click(); await until(async () => (await text("guide-now")) === want, "value written"); await seen("guide-done"); await shot("5-level-applied");
    assert.equal(cell(await entryOf(COMBI.key, COMBI.index), 2, "Volume"), Number(want));
    await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before, "one Undo puts the library back");
    await next(5); assert.equal(await text("guide-name"), "Plan"); assert.equal(await X("guide-callout").getAttribute("data-docked"), "true"); await shot("6-last-note");
    await X("guide-cancel").click(); await until(gone, "tour gone");
  });
  await check("Build it for me: the Combination is in the free slot with Keep and Discard; Discard leaves the library untouched", async () => {
    assert.equal(await X("ai-build-layer").isVisible(), true);
    await X("ai-build-layer").click(); await seen("ai-approve", 20000); await seen("ai-discard");
    assert.match(await text("ai-result"), /Combi INT-F 100 .*\(was "Init Combi"\)/); await shot("7-build-review");
    await X("ai-discard").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    assert.equal(sha(await saved()), before, "Discard changed nothing");
  });
  await check("Build it for me again, Keep: timbre 1 = the piano, timbre 2 = the strings, levels from the plan; one Undo reverses it", async () => {
    const steps = await X("ai-layer-steps").locator("li").allTextContents(), name = /Name it "([ -~]+)"/.exec(steps[0])[1], t2 = /^Set Timbre 2 to (\S+) (\d{3}) /.exec(steps[2]), t2Key = `program:${t2[1]}`;
    await X("ai-build-layer").click(); await seen("ai-approve", 20000); await X("ai-approve").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 });
    const f = P.parsePcg(await saved()), e = L.getEntry(f, COMBI.key, COMBI.index);
    assert.equal(L.getName(f, COMBI.key, COMBI.index), name);
    assert.deepEqual([cell(e, 1, "Program Number"), cell(e, 1, "Bank Number"), cell(e, 1, "Volume")], [BASE.index, U.bankNumberOf(BASE.key), 100]);
    assert.deepEqual([cell(e, 2, "Program Number"), cell(e, 2, "Bank Number")], [Number(t2[2]), U.bankNumberOf(t2Key)]); assert.ok(cell(e, 2, "Volume") < 100);
    assert.equal(cell(e, 3, "Status"), 0, "no third timbre");
    await shot("8-build-kept");
    await X("undo").click(); await nap(400); assert.equal(sha(await saved()), before, "one Undo puts the library back");
  });
  await ui.noErrors();
} catch (e) {
  g.fails.push(`gate stopped: ${String(e.message).slice(0, 300)}`);
} finally {
  await finish();
}
