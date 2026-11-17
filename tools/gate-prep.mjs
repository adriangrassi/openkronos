// Gate for "Put on keyboard": the AI's free slots come only from banks the keyboard matches, a Combination shows what it needs on the keyboard, Put on keyboard
// asks first (current names, Cancel by default) and writes nothing when cancelled, and the editor keys play the open Combi on its channels. Simulator only; the model is scripted.
// With PREP_SHOTS=<dir> it also writes screenshots of the review line, the dependency line and the dialog.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { gate, core, launch, load, sha } from "./gate-kit.mjs";

const g = gate("PREP"), { check, finish } = g, C = await core(g), { T, P, L, Q, parsed } = C;
const U = await load("src/core/ai/session.ts"), Rf = await load("src/core/pcg/refs.ts");
const SHOTS = process.env.PREP_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (id, name, args) => ({ id, name, arguments: args });
const PIANO = { key: "program:INT-A", index: 0 };
const BUILD = [{ content: "", toolCalls: [call("b1", "build_combi", { name: "Prep Test", parts: [{ ...PIANO, keyBottom: 0, keyTop: 127 }] })] }, { content: "Built.", toolCalls: [] }];
const f0 = parsed(), used = Rf.referencedSlots(f0);
const pick = (kind, type) => { for (const b of L.listBanks(f0).filter((x) => x.kind === kind && x.type === type).reverse()) for (let i = b.count - 1; i >= 0; i--) if (!used.has(`${b.key}/${i}`)) return { key: b.key, index: i }; throw new Error(`no unreferenced ${kind}`); };
const PRG = pick("program", "exi"), CMB = pick("combi", null);
const info = (k) => L.listBanks(f0).find((b) => b.key === k);
const label = (s) => `${info(s.key).label} ${String(s.index).padStart(3, "0")}`;
assert.ok(U.bankNumberOf(PRG.key) !== null, `${PRG.key} has no reference bank number`);

// V1: an Init Program and an Init Combi, for the AI. V2: the Combi "Berlin Grand + Soft Pad" (timbre 1 INT-A 000 on the global channel, timbre 2 the Program on channel 4).
const withNames = (fn) => { const f = parsed(); fn(f); return P.serializePcg(f); };
const V1 = withNames((f) => { L.setName(f, PRG.key, PRG.index, "Init Program"); L.setName(f, CMB.key, CMB.index, "Init Combi"); });
const V2 = withNames((f) => {
  const e = Uint8Array.from(L.getEntry(f, CMB.key, CMB.index));
  const row = (t, n) => Q.paramsFor(T, "combi", e).find((r) => r.group === `Timbre${t}` && r.name === n);
  const put = (t, n, v) => Q.writeParam(e, row(t, n), v);
  for (let t = 1; t <= 16; t++) put(t, "Status", 0);
  put(1, "Status", 1); put(1, "MIDI Channel", 16); put(1, "Bank Number", 0); put(1, "Program Number", 0);
  put(2, "Status", 1); put(2, "MIDI Channel", 3); put(2, "Bank Number", U.bankNumberOf(PRG.key)); put(2, "Program Number", PRG.index);
  L.setEntry(f, CMB.key, CMB.index, e);
  L.setName(f, CMB.key, CMB.index, "Berlin Grand + Soft Pad"); L.setName(f, PRG.key, PRG.index, "Berlin Soft Pad");
});

async function session(script, file, body) {
  const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(script), KRONOS_E2E_AI_DELAY_MS: "150" });
  const pid = g.state.app.process().pid;
  try { writeFileSync(ui.OPEN, file); await ui.openFile(); await body(ui); await ui.noErrors(); }
  catch (e) { g.fails.push(`gate stopped: ${String(e.message).slice(0, 400)}`); if (SHOTS) await ui.win.screenshot({ path: path.join(SHOTS, "crash.png") }).catch(() => {}); }
  finally { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]); await nap(800); }
}
const shot = async (ui, n) => { if (SHOTS) await ui.win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
const runAi = async (ui) => { await ui.X("ai-open").click(); await ui.seen("ai-prompt"); await ui.X("ai-prompt").fill("build me a combi"); await ui.X("ai-go").click(); };
const logText = async (ui) => (await ui.X("ai-log").textContent()) ?? "";
const rename = (ui, obj, k, i, name) => ui.win.evaluate(([o, b, x, n]) => window.__kronosE2E.keyboardRename(o, b, x, n), [obj, info(k).sysexBank, i, name]);

// 1. The keyboard holds something else in the Combi bank: the AI gets no slot there, and nothing is written.
await session(BUILD, V1, async (ui) => {
  const { X, until, saved } = ui;
  await ui.connectSim();
  await rename(ui, 1, CMB.key, CMB.index, "Owner Piano");
  const before = sha(await saved());
  await runAi(ui);
  await check("mismatch bank: the AI is refused a slot there, and the log says to pull it", async () => {
    await until(async () => /pull it first/.test(await logText(ui)), "refusal in the log", 30000);
    const t = await logText(ui);
    assert.ok(t.includes(`${info(CMB.key).label} differs from the keyboard: pull it first`), t);
    assert.ok(t.includes("Pull this bank"), t);
    await nap(800); assert.equal(await X("ai-approve").count(), 0, "a review was offered");
    assert.equal(sha(await saved()), before, "the library changed");
  });
});

// 2. The keyboard matches: the run builds, and the review shows what the new Combination needs and offers Put on keyboard.
await session(BUILD, V1, async (ui) => {
  const { X, seen, until, text } = ui;
  await ui.connectSim();
  await runAi(ui);
  await seen("ai-approve", 40000);
  await check("matching banks: the review shows the dependency lines and Put on keyboard", async () => {
    await until(async () => (await X("need-combi").count()) > 0, "combi line", 15000);
    assert.equal(await X("need-line").first().getAttribute("data-state"), "ready"); // INT-A 000 is on the keyboard
    assert.equal(await X("need-combi").getAttribute("data-state"), "missing"); // the new Combination is not
    assert.match(await text("need-line"), /INT-A 000 ".*" on the keyboard: ready$/);
    assert.equal(await X("prepare-keyboard").isEnabled(), true);
    assert.equal(await X("ai-file-only").count(), 0);
    await shot(ui, "1-review-needs");
  });
});

// 3. No keyboard: free slots come from the file, and the review warns.
await session(BUILD, V1, async (ui) => {
  await runAi(ui); await ui.seen("ai-approve", 40000);
  await check("not connected: the review warns that free slots came from the file only", async () => {
    assert.match(await ui.text("ai-file-only"), /free slots chosen from the file only/);
  });
});

// 4. The editor: dependency line, editor keys, and Put on keyboard.
await session([], V2, async (ui) => {
  const { X, seen, until, text, win, openBank, BACKUPS } = ui;
  const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
  const names = (k, i) => win.evaluate(([kk, ii]) => [window.__kronosE2E.ramName(kk, ii), window.__kronosE2E.storedName(kk, ii)], [k, i]);
  await ui.connectSim();
  await rename(ui, 0, PRG.key, PRG.index, "Drums"); await rename(ui, 1, CMB.key, CMB.index, "Owner Piano");
  await openBank(CMB.key); await X(`row-${CMB.index}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
  await check("the Combination says what it needs, and that the keyboard does not have it yet", async () => {
    await until(async () => (await X("need-line").count()) === 2 && (await X("need-line").nth(1).getAttribute("data-state")) === "missing", "needs read", 20000);
    assert.equal(await X("need-line").first().textContent(), `This Combination needs INT-A 000 "${L.getName(f0, PIANO.key, 0)}" on the keyboard: ready`);
    assert.equal(await X("need-line").nth(1).textContent(), `This Combination needs ${label(PRG)} "Berlin Soft Pad" on the keyboard: not there yet`);
    await shot(ui, "2-editor-needs");
  });
  await check("the editor keyboard plays the open Combi in Combi mode, on the global channel and the timbre's own channel", async () => {
    await X("live-edit").waitFor(); assert.equal(await X("live-edit").isChecked(), true);
    if (!(await X("dock-key-60").count())) await X("dock-toggle").click();
    await seen("dock-key-60");
    assert.match(await text("dock-playing"), new RegExp(`^Playing: Combi ${info(CMB.key).label} \\d{3} "Berlin Grand \\+ Soft Pad" \\(needs ${label(PRG)} on keyboard: not there\\)$`));
    const n0 = (await log()).length;
    const b = await X("dock-key-60").boundingBox(); await win.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.8); await win.mouse.down(); await nap(80); await win.mouse.up(); await nap(150);
    const all = await log(), mode = all.findIndex((m) => m[0] === 0xf0 && m[4] === 0x4e && m[5] === 0), on = all.filter((m, i) => i >= n0 && (m[0] & 0xf0) === 0x90 && m[1] === 60);
    assert.ok(mode >= 0 && mode < n0, "no Combi mode change before the key");
    assert.deepEqual(on.map((m) => m[0] & 0x0f).sort((a, b2) => a - b2), [0, 3], "note-on channels");
  });
  await check("Put on keyboard: the dialog names what the keyboard holds, defaults to Cancel, and cancelling writes nothing", async () => {
    await X("prepare-keyboard").click(); await seen("confirm-lines");
    const lines = await win.locator('[data-testid="confirm-lines"] li').allTextContents();
    assert.deepEqual(lines, [`Store ${label(PRG)} "Berlin Soft Pad" (keyboard now holds "Drums"): this will REPLACE it`, `Store ${label(CMB)} "Berlin Grand + Soft Pad" (keyboard now holds "Owner Piano"): this will REPLACE it`]);
    assert.match(await text("confirm-message"), /PERMANENT/);
    assert.equal(await win.evaluate(() => document.activeElement?.getAttribute("data-testid")), "confirm-cancel");
    assert.equal(await X("confirm-ok").isDisabled(), true, "OK is on before the REPLACE box is ticked");
    await shot(ui, "3-dialog");
    await X("confirm-cancel").click(); await X("confirm-ok").waitFor({ state: "hidden" }); await nap(300);
    assert.deepEqual(await names(PRG.key, PRG.index), ["Drums", "Drums"]); assert.deepEqual(await names(CMB.key, CMB.index), ["Owner Piano", "Owner Piano"]);
    assert.equal(readdirSync(BACKUPS).length, 0, "a backup was written for a cancelled run");
  });
  await check("Put on keyboard: backup, store, read back; the line turns ready and Live sends the Combi", async () => {
    await X("prepare-keyboard").click(); await seen("confirm-ack"); await X("confirm-ack").check(); assert.equal(await X("confirm-ok").isEnabled(), true);
    const n0 = (await log()).length;
    await X("confirm-ok").click();
    await until(async () => (await X("need-line").nth(1).getAttribute("data-state")) === "ready" && (await X("need-combi").getAttribute("data-state")) === "ready", "ready", 40000);
    assert.deepEqual(await names(PRG.key, PRG.index), ["Berlin Soft Pad", "Berlin Soft Pad"]); assert.deepEqual(await names(CMB.key, CMB.index), ["Berlin Grand + Soft Pad", "Berlin Grand + Soft Pad"]);
    const files = readdirSync(BACKUPS); assert.equal(files.length, 2, files.join(", "));
    assert.ok(files.some((f) => f.startsWith(PRG.key.replace(":", "-"))) && files.some((f) => f.startsWith(CMB.key.replace(":", "-"))), files.join(", "));
    await until(async () => (await log()).slice(n0).some((m) => m[0] === 0xf0 && m.length > 200 && m[4] === 0x75), "Live sent the Combi", 10000);
    assert.equal(await X("prepare-keyboard").count(), 0);
    assert.match(await text("dock-playing"), /on keyboard: ready\)$/);
    await shot(ui, "4-ready");
  });
});

await finish();
