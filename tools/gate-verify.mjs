// Gate for "Check keyboard": reads the simulator's edit buffer back and compares it with the open sound. Simulator only, nothing real is touched.
// With VERIFY_SHOTS=<dir> it also writes a screenshot of each state.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, testsAndTypes } from "./gate-kit.mjs";

const SHOTS = process.env.VERIFY_SHOTS;
const g = gate("VERIFY"), { check, finish } = g, C = await core(g), { T, L, Q, parsed } = C;
await testsAndTypes(g, ["core/device/verify.test.ts"]);
if (g.fails.length) await finish();

const KEY = "program:INT-B", IDX = 5;
const f0 = parsed(), entry = L.getEntry(f0, KEY, IDX), info = L.listBanks(f0).find((b) => b.key === KEY);
const rows = Q.paramsFor(T, info.type === "exi" ? "exi" : "hd1", entry), ROW = rows.find((r) => r.group === "Master Effect1" && r.name === "Effect Type");
assert.ok(ROW, "no Master Effect1 / Effect Type row");

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ui = await launch(g, C);
const { win, X, seen, text, until } = ui;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
const setKnob = (v) => win.evaluate((v) => {
  const el = document.querySelector('[data-testid="macro-Attack"]'), i = el.matches("input") ? el : el.querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, String(v));
  i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); i.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
}, v);
const dumps = async () => (await log()).filter((m) => m[0] === 0xf0 && m.length > 200).length;

try {
  await ui.openFile();
  await check("not connected: Check keyboard is off, with the reason shown", async () => {
    await ui.editSlot(KEY, IDX);
    assert.equal(await X("check-keyboard").isDisabled(), true);
    assert.equal(await text("check-why"), "Connect the Kronos first");
    await shot("1-not-connected");
  });
  await ui.connectSim();
  await check("Live on, one edit, Check keyboard: matches", async () => {
    await X("view-simple").click(); await seen("macro-Attack");
    assert.equal(await X("live-edit").isChecked(), true);
    const n = await dumps();
    await setKnob(30);
    await until(async () => (await dumps()) > n, "dump after the edit", 5000);
    await until(async () => !(await X("check-keyboard").isDisabled()), "button enabled");
    await X("check-keyboard").click();
    await seen("verify-strip"); assert.equal(await text("verify-strip").then((t) => t.startsWith("Keyboard matches this sound")), true);
    assert.equal(await X("verify-strip").getAttribute("data-ok"), "1");
    await shot("2-matches");
    await X("verify-strip-close").click(); assert.equal(await X("verify-strip").count(), 0);
  });
  await check("the keyboard holds a different value: the strip names the setting", async () => {
    // Live calls the sound up again whenever the link settles and re-sends the whole sound twice within about 1.1 s (see LiveEdit SETTLE_MS/RESEND_MS), which would overwrite the tampered byte: wait until no dump has gone out for 1.6 s.
    for (let n = await dumps(), t = Date.now(); Date.now() - t < 1600; await wait(100)) { const d = await dumps(); if (d !== n) { n = d; t = Date.now(); } }
    await win.evaluate(([o, x]) => window.__kronosE2E.tamperEditBuffer(0, o, x), [ROW.ofs, 1 << (ROW.bitLo ?? 0)]);
    await X("check-keyboard").click(); await seen("verify-strip");
    const t = await text("verify-strip");
    assert.match(t, /Keyboard differs in 1 setting:/); assert.ok(t.includes("Master Effect1 / Effect Type: sent"), t); assert.ok(t.includes("keyboard"), t);
    assert.equal(await X("verify-strip").getAttribute("data-ok"), "0");
    await shot("3-differs");
  });
  await check("the keyboard holds a different program: the strip says so", async () => {
    await win.evaluate(() => window.__kronosE2E.tamperEditBuffer(0, 0, 1));
    await X("check-keyboard").click(); await until(async () => /different program loaded/.test(await text("verify-strip")), "different program text");
    await shot("4-other-program");
    await win.evaluate(() => window.__kronosE2E.tamperEditBuffer(0, 0, 1));
  });
  await check("Settings: 'Verify after each Live send' is off by default; on, a send that matches shows no strip", async () => {
    await X("settings-open").click(); await seen("settings-dialog");
    assert.equal(await X("settings-verifylive").isChecked(), false);
    await X("settings-verifylive").click(); await until(() => X("settings-verifylive").isChecked(), "verify setting saved"); await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden", timeout: 10000 });
    if (await X("verify-strip").count()) await X("verify-strip-close").click();
    const reqs = async () => (await log()).filter((m) => m[4] === 0x74).length, r0 = await reqs();
    await setKnob(60); await until(async () => (await reqs()) > r0, "the read-back request after the send", 15000); await wait(500);
    assert.equal(await X("verify-strip").count(), 0, "a matching send showed a strip");
  });
  await ui.noErrors();
} catch (e) { g.fails.push(`gate crashed: ${e.message}`); if (SHOTS) await win.screenshot({ path: path.join(SHOTS, "crash.png") }).catch(() => {}); }
await finish();
