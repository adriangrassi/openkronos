// Acceptance gate: the app stays usable while an AI run is in progress. The model is scripted with heavy tool calls and a per-turn delay.
// Every 300 ms a real navigation action (bank, sound, Kronos-view page) must take effect, and the renderer and main process must not block.
import assert from "node:assert/strict";
import { gate, core, launch } from "./gate-kit.mjs";

const MAX_LONGTASK_MS = 250, MAX_BLOCKED_MS = 1500, MAX_MAIN_LAG_MS = 250, MIN_ACTIONS = 8, NAV_TIMEOUT = 2000;
const g = gate("AIRESPONSIVE"), { check, finish } = g, C = await core(g), { T, L, Q, parsed } = C;
const f0 = parsed(), JK = "program:U-AA", JI = 78, rows = Q.paramsFor(T, "exi", L.getEntry(f0, JK, JI));
const attack = rows.find((r) => r.group === "EXi1 AL-1: Amplifier EG" && r.name === "Attack Time"), groups = [...new Set(rows.map((r) => r.group))].slice(0, 8);
const call = (name, args) => ({ id: `c${Math.random()}`, name, arguments: args });
const heavy = (n) => ({ content: `step ${n}`, toolCalls: [
  call("search_sounds", { text: "a", limit: 100 }), call("search_sounds", { engine: "AL-1", limit: 100 }), call("search_sounds", { used: true, limit: 100 }),
  call("free_slots", { kind: "program" }), call("describe_sound", { key: JK, index: JI, groups }), call("search_ge", { query: "arp" }),
  call("set_params", { key: JK, index: JI, changes: [{ id: `${attack.ofs}.${attack.bitLo ?? 0}`, value: 10 + n }] }),
] });
const TURNS = 16;
const SCRIPT = [
  { content: "Building.", toolCalls: [call("build_combi", { name: "AI Split", parts: [{ key: "program:U-A", index: 3, keyBottom: 0, keyTop: 59 }, { key: "program:INT-B", index: 5, keyBottom: 60, keyTop: 127 }] })] },
  ...Array.from({ length: TURNS }, (_, n) => heavy(n)), { content: "All set.", toolCalls: [] },
];

const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(SCRIPT), KRONOS_E2E_AI_DELAY_MS: "150" }), { win, X, seen, text, until, openBank } = ui;
await ui.openFile();
await openBank("combi:INT-F"); await X("row-100").dblclick(); await X("rename-input").fill("Init Combi"); await X("rename-input").press("Enter");
await until(async () => (await text("row-name-100")) === "Init Combi", "renamed");
await openBank("program:INT-A");

// Page probes: long tasks and a requestAnimationFrame heartbeat, both stamped so the run window can be cut out afterwards.
await win.evaluate(() => {
  const w = window; w.__lt = []; w.__raf = []; let last = performance.now();
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ["longtask"] });
  const beat = (t) => { w.__raf.push([t, t - last]); last = t; requestAnimationFrame(beat); };
  requestAnimationFrame(beat);
});
// Main-process event-loop lag: a 20 ms timer records how late it fires.
await g.state.app.evaluate(() => {
  const s = (globalThis.__lag = { max: 0, sum: 0, t0: 0, on: false }); let last = Date.now();
  setInterval(() => { const now = Date.now(), d = Math.max(0, now - last - 20); last = now; if (s.on) { s.max = Math.max(s.max, d); s.sum += d; } }, 20);
});

const actions = [];
const act = async (name, fn) => { const t0 = Date.now(); let ok = false, why = ""; try { ok = (await fn()) !== false; } catch (e) { why = String(e.message).replace(/\s+/g, " ").slice(-380); } actions.push({ name, ok, ms: Date.now() - t0, why }); };
const bankOn = async (k) => (await X(`bank-${k}`).getAttribute("aria-current")) === "true";
const cycle = [
  () => act("bank INT-B", async () => { await X("bank-program:INT-B").click({ timeout: NAV_TIMEOUT }); await until(() => bankOn("program:INT-B"), "bank", NAV_TIMEOUT); }),
  () => act("bank INT-A", async () => { await X("bank-program:INT-A").click({ timeout: NAV_TIMEOUT }); await until(() => bankOn("program:INT-A"), "bank", NAV_TIMEOUT); }),
  () => act("open sound", async () => { await X("row-5").click({ position: { x: 12, y: 8 }, timeout: NAV_TIMEOUT }); await X("edit-params").click({ timeout: NAV_TIMEOUT }); await seen("editor-title", NAV_TIMEOUT); await X("view-kronos").click({ timeout: NAV_TIMEOUT }); await seen("kronos-view", NAV_TIMEOUT); }),
  () => act("page tab", async () => { const tabs = win.locator('[data-testid^="kv-page-"]'), n = await tabs.count(); if (n < 1) throw new Error("no Kronos-view page tabs"); const t = tabs.nth(i % n); await t.click({ timeout: NAV_TIMEOUT }); await until(async () => (await t.getAttribute("aria-pressed")) === "true", "page", NAV_TIMEOUT); }),
  () => act("close editor", async () => { await X("close-editor").click({ timeout: NAV_TIMEOUT }); await seen("row-name-0", NAV_TIMEOUT); }),
];

await X("ai-open").click(); await seen("ai-prompt");
// The window now opens large and may cover the editor: shrink it to its minimum into the bottom-right corner, so the navigation under test stays reachable.
{ const b = await X("ai-resize-nw").boundingBox(), p = await win.locator(".ai-panel").boundingBox(); await win.mouse.move(b.x + 6, b.y + 6); await win.mouse.down(); await win.mouse.move(b.x + 6 + p.width - 320, b.y + 6 + p.height - 300, { steps: 6 }); await win.mouse.up(); }
await X("ai-prompt").fill("bass left, brass right");
await g.state.app.evaluate(() => { globalThis.__lag.on = true; });
const t0 = await win.evaluate(() => performance.now());
await X("ai-go").click();
let i = 0, finished = false;
const deadline = Date.now() + 90000;
while (!finished && Date.now() < deadline) {
  const tick = Date.now();
  await cycle[i++ % cycle.length]();
  finished = /All set/.test(await text("ai-log"));
  await new Promise((r) => setTimeout(r, Math.max(0, 300 - (Date.now() - tick))));
}
const t1 = await win.evaluate(() => performance.now());
const lag = await g.state.app.evaluate(() => { globalThis.__lag.on = false; return { max: globalThis.__lag.max, sum: globalThis.__lag.sum }; });
const m = await win.evaluate(([a, b]) => ({ lt: window.__lt.filter(([s]) => s >= a && s <= b), raf: window.__raf.filter(([t]) => t >= a && t <= b) }), [t0, t1]);
const maxLong = Math.max(0, ...m.lt.map((x) => x[1])), blocked = m.lt.reduce((s, x) => s + x[1], 0), maxGap = Math.max(0, ...m.raf.map((x) => x[1]));
const worked = actions.filter((a) => a.ok).length;
console.log(JSON.stringify({ runMs: Math.round(t1 - t0), maxLongTaskMs: Math.round(maxLong), longTasks: m.lt.length, blockedMs: Math.round(blocked), maxRafGapMs: Math.round(maxGap), mainLagMaxMs: lag.max, mainLagSumMs: lag.sum, actions: actions.length, worked }));
for (const a of actions) console.log(a.ok ? "  ok  " : "  FAIL", a.name.padEnd(13), `${a.ms} ms`, a.why);

await check("the scripted run finished", () => assert.ok(finished, "the run did not finish in time"));
await check("the AI window follows the newest line", async () => { const r = await win.evaluate(() => { const el = document.querySelector(".ai-body"); return { max: el.scrollHeight - el.clientHeight, top: el.scrollTop }; }); assert.ok(r.max > 40, "log did not overflow, test is empty: " + r.max); assert.ok(r.max - r.top <= 3, "not at the bottom: top " + r.top + " of " + r.max); });
await check(`at least ${MIN_ACTIONS} navigation actions were tried during the run`, () => assert.ok(actions.length >= MIN_ACTIONS, `${actions.length} actions`));
await check("every navigation action took effect while the AI was working", () => assert.deepEqual(actions.filter((a) => !a.ok).map((a) => `${a.name}: ${a.why}`), []));
await check(`no renderer long task over ${MAX_LONGTASK_MS} ms`, () => assert.ok(maxLong <= MAX_LONGTASK_MS, `${Math.round(maxLong)} ms`));
await check(`renderer blocked under ${MAX_BLOCKED_MS} ms in total`, () => assert.ok(blocked <= MAX_BLOCKED_MS, `${Math.round(blocked)} ms`));
await check(`main-process event loop never late by over ${MAX_MAIN_LAG_MS} ms`, () => assert.ok(lag.max <= MAX_MAIN_LAG_MS, `${lag.max} ms`));
await check("the review still waits for Keep or Discard after navigating", async () => { await seen("ai-approve", 20000); await X("ai-discard").click(); await X("ai-approve").waitFor({ state: "hidden", timeout: 8000 }); });
await ui.noErrors();
await finish();
