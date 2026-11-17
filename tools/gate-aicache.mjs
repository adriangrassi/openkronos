// Gate for saved AI answers and the parameter-guide lookup tool. FULLY OFFLINE: one fake local model router on 127.0.0.1 records every chat request, and the app is pointed at it through its own settings.
// KRONOS_GATE_THEME=normal|studio|a picks the theme. Shift-click explain is the way in; the cache lives in userData/ai-answers.json, which this gate reads and corrupts directly.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { gate, core, launch, testsAndTypes } from "./gate-kit.mjs";

const g = gate("AICACHE"), { check, finish } = g, C = await core(g);
await testsAndTypes(g, ["core/ai/answerCache.test.ts", "core/ai/paramDocs.test.ts"]);
if (g.fails.length) await finish();

const chats = [], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mode = "ok", n = 0;
const fake = http.createServer((q, r) => {
  const c = []; q.on("data", (d) => c.push(d));
  q.on("end", () => {
    const body = JSON.parse(Buffer.concat(c).toString("utf8")); chats.push(body);
    const pt = /Brazilian Portuguese/.test(body.messages[0].content);
    n++;
    const text = mode === "hedge" ? "I'm unsure how this control responds on this engine, so I would not guess." : pt ? `Resposta ${n}: este controle muda o som de forma clara e vale a pena experimentar.` : `Answer ${n}: this control shapes the sound in a clear way and is worth trying by ear.`;
    r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${fake.address().port}`;
const SHIFT = { modifiers: ["Shift"] };
const kill = async () => { try { spawnSync("taskkill", ["/PID", String(g.state.app.process().pid), "/T", "/F"]); } catch {} await sleep(1200); };

const ui1 = await launch(g, C, { AUTOROUTER_KEY: "gate-key" });
const APPDATA = path.join(ui1.tmp, "appdata"), CACHE = path.join(APPDATA, "openkronos", "ai-answers.json");
const saved = () => (existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")).entries : []);

// Opens a Program's panel view, points the AI window at the fake router, and returns what a test needs to Shift-click one dial.
async function prep(ui) {
  const { win, X, seen, openFile, connectSim, openBank, until } = ui;
  await win.evaluate((u) => window.kronos.settingsSet({ aiBaseUrl: u }), `${BASE}/v1`);
  await openFile(); await connectSim(); await openBank("program:INT-A"); await X("row-5").click(); await X("edit-params").click(); await seen("editor-title");
  if (!(await win.locator(".kc-dial").count()) && (await win.locator('[data-testid="view-kronos"]').count())) await X("view-kronos").click();
  if (!(await win.locator(".kc-dial").count()) && (await win.locator('[data-testid="view-panel"]').count())) await X("view-panel").click();
  await win.locator(".kc-dial").first().waitFor({ timeout: 15000 });
  await X("ai-open").click(); await seen("ai-prompt"); await X("ai-provider").selectOption("local"); await X("ai-close").click();
  const dials = win.locator(".kc-dial");
  const note = async () => (await win.locator('[data-testid="ai-note"]').first().textContent().catch(() => "")) ?? "";
  const idle = async () => (await win.locator('[data-testid="ai-banner"]').count()) === 0;
  // Shift+click dial number `i`; resolves once the answer is on screen.
  const explain = async (i = 0) => {
    if (await win.locator('[data-testid="ai-close"]').count()) await X("ai-close").click();
    await X("ai-prompt").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await dials.nth(i).locator("svg").first().click({ ...SHIFT });
    await seen("ai-prompt");
    await until(async () => (await note()).length > 20 && (await idle()), "the answer", 20000);
    return note();
  };
  return { note, explain, label: (await dials.first().getAttribute("data-param-label")) ?? "", dials };
}
const reopen = async (env = {}) => { await kill(); return launch(g, C, { AUTOROUTER_KEY: "gate-key", APPDATA, ...env }); };

let ui = ui1, p = await prep(ui);
const { win, X, seen, until } = ui;
let first;

await check("first Shift-click calls the model once; the request offers lookup_param_help and holds neither the sound name nor the value", async () => {
  assert.equal(chats.length, 0);
  first = await p.explain(0);
  assert.equal(chats.length, 1, "one model request");
  assert.match(first, /Answer 1:/);
  assert.equal(await win.locator('[data-testid="ai-cached"]').count(), 0, "a fresh answer is not labelled saved");
  const names = (chats[0].tools ?? []).map((t) => t.function?.name);
  assert.ok(names.includes("lookup_param_help"), `tools offered: ${names}`);
  assert.ok(!names.includes("set_params"), "Ask stays read-only");
  const user = chats[0].messages.find((m) => m.role === "user").content;
  assert.doesNotMatch(user, /Current value/);
  assert.match(user, /Explain the control/);
  await until(async () => saved().length === 1, "the answer is saved to disk");
  assert.match(saved()[0].t, /Answer 1:/);
});

await check("second Shift-click on the same control shows the saved answer at once, with From saved answers, Speak available, and no model request", async () => {
  const again = await p.explain(0);
  assert.equal(chats.length, 1, "the fake got no new request");
  assert.match(again, /Answer 1:/);
  assert.equal((await X("ai-cached").textContent()).trim(), "From saved answers");
  assert.equal(await X("ai-reask").isVisible(), true);
  assert.equal(await X("ai-speak").isDisabled(), false, "Speak works on a saved answer");
});

await check("a different language or answer length misses, and each is then saved on its own", async () => {
  await X("ai-speech-lang").selectOption("pt"); await until(async () => (await win.evaluate(() => window.kronos.settingsGet())).speechLang === "pt", "pt stored");
  const pt = await p.explain(0);
  assert.equal(chats.length, 2); assert.match(pt, /Resposta 2:/); assert.equal(await win.locator('[data-testid="ai-cached"]').count(), 0);
  await X("ai-speech-lang").selectOption("en"); await until(async () => (await win.evaluate(() => window.kronos.settingsGet())).speechLang === "en", "en stored");
  await X("ai-length").selectOption("brief"); await until(async () => (await win.evaluate(() => window.kronos.settingsGet())).aiLength === "brief", "brief stored");
  await p.explain(0);
  assert.equal(chats.length, 3, "another length is another question");
  await X("ai-length").selectOption("normal"); await until(async () => (await win.evaluate(() => window.kronos.settingsGet())).aiLength === "normal", "normal stored");
  assert.match(await p.explain(0), /Answer 1:/); assert.equal(chats.length, 3, "back to the first language and length: a hit");
  await until(async () => saved().length === 3, "three separate answers on disk");
});

await check("a different control of the same sound misses", async () => {
  if ((await p.dials.count()) < 2) return "only one dial on this page";
  const other = await p.explain(1);
  assert.equal(chats.length, 4); assert.doesNotMatch(other, /Answer 1:/);
});

await check("Re-ask bypasses the saved answer and replaces it", async () => {
  await p.explain(0);
  const before = chats.length;
  await X("ai-reask").click();
  await until(async () => chats.length === before + 1 && (await p.note()).includes(`Answer ${n}:`) && (await p.note()).length > 20, "the fresh answer", 20000);
  await until(async () => saved().some((e) => e.t.includes(`Answer ${n}:`)), "the new answer replaced the saved one");
  assert.equal(await win.locator('[data-testid="ai-cached"]').count(), 0, "the fresh answer is not labelled saved");
  const again = await p.explain(0);
  assert.equal(chats.length, before + 1); assert.match(again, new RegExp(`Answer ${n}:`));
});

await check("a hedged answer is shown but not saved, and asking again calls the model again", async () => {
  mode = "hedge";
  const count = saved().length, calls = chats.length, i = (await p.dials.count()) > 2 ? 2 : (await p.dials.count()) > 1 ? 1 : 0;
  if (i === 0 || i === 1) await X("ai-length").selectOption("detailed");
  const a = await p.explain(i);
  assert.match(a, /unsure/); assert.equal(chats.length, calls + 1);
  await sleep(500); assert.equal(saved().length, count, "nothing new saved");
  await p.explain(i); assert.equal(chats.length, calls + 2, "not served from the cache");
  mode = "ok";
  if (i < 2) await X("ai-length").selectOption("normal");
});

await check("Settings shows Saved answers: N, and Clear saved answers empties the file and the count", async () => {
  await X("ai-close").click().catch(() => {});
  await X("settings-open").click(); await seen("settings-dialog");
  const count = saved().length;
  assert.ok(count >= 3);
  await until(async () => Number(await X("settings-answers-count").textContent()) === count, "the count shows");
  await X("settings-clear-answers").click();
  await until(async () => (await X("settings-answers-count").textContent()).trim() === "0", "the count is 0");
  assert.equal(saved().length, 0);
  await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden" });
  const calls = chats.length;
  await p.explain(0); assert.equal(chats.length, calls + 1, "after Clear the same question asks the model again");
  await until(async () => saved().length === 1, "and is saved again");
});

await check("a saved answer survives an app restart (same user data), with no model request", async () => {
  const text = saved()[0].t, calls = chats.length;
  await ui.noErrors();
  ui = await reopen(); p = await prep(ui);
  const shown = await p.explain(0);
  assert.equal(chats.length, calls, "no request after the restart");
  assert.ok(shown.includes(text.trim()), `${shown} vs ${text}`);
  assert.equal((await ui.X("ai-cached").textContent()).trim(), "From saved answers");
});

await check("a corrupt cache file does not break the app: the question is asked, answered and saved again", async () => {
  await ui.noErrors();
  await kill(); writeFileSync(CACHE, "{ this is not json \u0000\u0001");
  ui = await launch(g, C, { AUTOROUTER_KEY: "gate-key", APPDATA }); p = await prep(ui);
  const calls = chats.length;
  const shown = await p.explain(0);
  assert.equal(chats.length, calls + 1); assert.match(shown, /Answer \d+:|Resposta \d+:/);
  await until(async () => saved().length === 1, "the file is valid again");
  assert.equal(await ui.win.locator('[data-testid="ai-cached"]').count(), 0);
});

await ui.noErrors();
fake.close();
try { rmSync(ui1.tmp, { recursive: true, force: true }); } catch {}
await finish();
