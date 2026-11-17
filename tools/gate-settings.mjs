// Acceptance gate for the Settings dialog. Owned by the architect: builders must not edit it.
//
// PURE EXPORTS of src/core/settings.ts (exact names):
//   type Settings = { accent: "amber"|"ice"|"green"|"red"; scale: number; density: "compact"|"comfortable"; channelMode: string }
//     channelMode is "auto" | "keyboard" | "file" | "1".."16" (the values of the MIDI panel's channel select)
//   DEFAULT_SETTINGS: Settings = { accent: "amber", scale: 100, density: "comfortable", channelMode: "keyboard" }
//   ACCENTS: Record<accentId, "#rrggbb">, key order amber, ice, green, red; amber is "#e8a33d" (today's --accent); all four distinct
//   validateSettings(raw: unknown): Settings    // anything -> a full valid Settings. Per field: wrong type or unknown value -> that field's default;
//                                               // scale: a finite number, rounded to an integer, clamped to 90..125 (strings, NaN, Infinity -> 100); unknown keys dropped
//   mergeSettings(current: Settings, patch: unknown): Settings   // like validate, but an invalid or missing field in patch keeps CURRENT's value; never mutates; non-object patch -> current
//   parseSettingsFile(text: string): Settings   // JSON text -> validateSettings; corrupt, empty, null, array -> DEFAULT_SETTINGS
//
// IPC on window.kronos: settingsGet(): Promise<Settings>; settingsSet(patch: unknown): Promise<Settings> (merged result, persisted, applied to the window;
//   bad fields are ignored or clamped per mergeSettings; a non-object patch rejects). The file is settings.json somewhere under userData (APPDATA/openkronos).
// Applied on screen: CSS var --accent on :root = ACCENTS[accent]; document.documentElement.dataset.density = density; zoom through webFrame/window zoom
//   (window.innerWidth shrinks by scale/100); the MIDI panel's channel select starts at channelMode.
//
// data-testid table:
//   settings-open            top-bar button that opens the dialog
//   settings-dialog          the dialog element (visible only while open)
//   settings-close           closes the dialog
//   settings-accent-amber | -ice | -green | -red   one button per accent colour
//   settings-scale           input (range or number) with min=90 max=125; fill() + change sets the UI scale in percent
//   settings-scale-value     text of the current scale, "100%" style
//   settings-density-compact | settings-density-comfortable   one button per density
//   settings-channel         select whose option values are the channelMode values
//   settings-reset           resets all four to defaults (no confirm dialog: it never writes to the keyboard)
// Bulk-write confirmations are not configurable: Settings has exactly the four keys above, checked below.
// Test-only env: none beyond what gate-kit's launch() sets (KRONOS_E2E=1, APPDATA under a temp folder; the gate overrides APPDATA to reuse one across restarts).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("SETTINGS"), { check, finish } = g, C = await core(g);
let S; try { S = await load("src/core/settings.ts"); } catch (e) { g.fails.push(`cannot load settings.ts: ${e.message}`); await finish(); }
const D = { theme: "a", accent: "theme", scale: 100, density: "comfortable", channelMode: "keyboard", globalChannel: "file", liveParams: false, verifyLive: false, aiProvider: "cloud", aiClaudeModel: "sonnet", aiBaseUrl: "http://127.0.0.1:4503/v1", aiModel: "spark/auto:code:medium:proxy", aiLength: "normal", speechProvider: "auto", speechSystemVoiceEn: "", speechSystemVoicePt: "", speechUrl: "http://localhost:8081", speechModel: "mlx-community/Kokoro-82M-bf16", speechCustomVoice: "", elevenModel: "eleven_multilingual_v2", elevenVoice: "", speechLang: "en", speechVoice: "af_heart", speechAuto: false, speechSpeed: 1 };
const KEYS = Object.keys(D).sort();

await check("defaults and the accent table", () => {
  assert.deepEqual(S.DEFAULT_SETTINGS, D); assert.deepEqual(Object.keys(S.ACCENTS), ["amber", "ice", "green", "red"]);
  assert.equal(S.ACCENTS.amber, "#e8a33d"); const v = Object.values(S.ACCENTS); assert.equal(new Set(v).size, 4); for (const c of v) assert.match(c, /^#[0-9a-f]{6}$/i);
});
await check("garbage input gives the defaults", () => { for (const x of [undefined, null, "x", 5, [], [1, 2], true, {}, { accent: 7, scale: "big" }]) assert.deepEqual(S.validateSettings(x), D, JSON.stringify(x)); });
await check("each field is checked on its own", () => {
  assert.deepEqual(S.validateSettings({ accent: "ice", scale: 110, density: "compact", channelMode: "keyboard" }), { ...D, accent: "ice", scale: 110, density: "compact" });
  assert.equal(S.validateSettings({ accent: "pink" }).accent, "theme"); assert.equal(S.validateSettings({ accent: "Ice" }).accent, "theme");
  for (const [i, o] of [[500, 125], [10, 90], [89, 90], [126, 125], [107.6, 108], [-1, 90]]) assert.equal(S.validateSettings({ scale: i }).scale, o, `scale ${i}`);
  for (const i of ["110", NaN, Infinity, null, {}]) assert.equal(S.validateSettings({ scale: i }).scale, 100, `scale ${String(i)}`);
  assert.equal(S.validateSettings({ density: "huge" }).density, "comfortable");
  for (const ok of ["auto", "keyboard", "file", "1", "7", "16"]) assert.equal(S.validateSettings({ channelMode: ok }).channelMode, ok);
  for (const bad of ["0", "17", "x", 3, "", "01"]) assert.equal(S.validateSettings({ channelMode: bad }).channelMode, "keyboard", String(bad));
  const r = S.validateSettings({ accent: "red", confirmBulk: false, extra: 1 }); assert.deepEqual(Object.keys(r).sort(), KEYS);
});
await check("merge keeps current values for bad or missing fields and never mutates", () => {
  const cur = { ...D, accent: "green", scale: 120, density: "compact", channelMode: "9" }, frozen = Object.freeze({ ...cur });
  assert.deepEqual(S.mergeSettings(frozen, { scale: 95 }), { ...cur, scale: 95 });
  assert.deepEqual(S.mergeSettings(frozen, { accent: "pink", density: 4, channelMode: "99", scale: "x" }), cur);
  assert.deepEqual(S.mergeSettings(frozen, { scale: 9999, extra: 1 }), { ...cur, scale: 125 });
  for (const p of [null, "x", 3, []]) assert.deepEqual(S.mergeSettings(frozen, p), cur);
  assert.deepEqual(frozen, cur);
});
await check("a corrupt settings file means defaults, a partial one keeps its good fields", () => {
  for (const t of ["", "{not json", "null", "[]", "42", '"x"', "\u0000\u0001", '{"accent":']) assert.deepEqual(S.parseSettingsFile(t), D, JSON.stringify(t));
  assert.deepEqual(S.parseSettingsFile('{"accent":"red","scale":9000,"density":"nope"}'), { ...D, accent: "red", scale: 125 });
});
await testsAndTypes(g, ["core/settings.test.ts"]);
if (g.fails.length) await finish();

// ---- UI ----
const kill = async (app) => { try { spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"]); } catch {} await new Promise((r) => setTimeout(r, 1500)); };
const css = (win, v) => win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), v);
const find = (dir) => { if (!existsSync(dir)) return null; for (const f of readdirSync(dir, { recursive: true })) if (path.basename(String(f)) === "settings.json") return path.join(dir, String(f)); return null; };
const ui = await launch(g, C), { X, seen, text, until, win } = ui, APPDATA = path.join(ui.tmp, "appdata"), tmp1 = ui.tmp;
const get = () => win.evaluate(() => window.kronos.settingsGet()), width = () => win.evaluate(() => window.innerWidth);
await ui.openFile();
const base = await width();

await check("the dialog opens and each accent changes the real colour", async () => {
  await X("settings-open").click(); await seen("settings-dialog"); assert.equal((await get()).accent, "theme");
  for (const a of ["ice", "green", "red", "amber"]) { await X(`settings-accent-${a}`).click(); await until(async () => (await css(win, "--accent")) === S.ACCENTS[a], `accent ${a}`); assert.equal((await get()).accent, a); }
  await X("settings-accent-red").click(); await until(async () => (await get()).accent === "red", "red stored");
});
await check("UI scale zooms the window within 90 to 125 percent", async () => {
  assert.equal(await X("settings-scale").getAttribute("min"), "90"); assert.equal(await X("settings-scale").getAttribute("max"), "125");
  await X("settings-scale").fill("125"); await until(async () => Math.abs((await width()) - base / 1.25) <= 3, "zoomed to 125");
  await until(async () => parseInt(await text("settings-scale-value")) === 125, "scale label shows 125"); assert.equal((await get()).scale, 125);
  await X("settings-scale").fill("90"); await until(async () => Math.abs((await width()) - base / 0.9) <= 3, "zoomed to 90");
  await X("settings-scale").fill("300").catch(() => {}); await new Promise((r) => setTimeout(r, 400)); const s = (await get()).scale; assert.ok(s >= 90 && s <= 125, `scale ${s}`); assert.ok((await width()) >= base / 1.25 - 3, "not zoomed past 125");
  await X("settings-scale").fill("110"); await until(async () => (await get()).scale === 110, "110 stored");
});
await check("list density switches on the page", async () => {
  await X("settings-density-compact").click(); await until(async () => (await win.evaluate(() => document.documentElement.dataset.density)) === "compact", "compact"); assert.equal((await get()).density, "compact");
  await X("settings-density-comfortable").click(); await until(async () => (await win.evaluate(() => document.documentElement.dataset.density)) === "comfortable", "comfortable");
  await X("settings-density-compact").click(); await until(async () => (await get()).density === "compact", "compact stored");
});
await check("the default MIDI channel mode is chosen in the dialog", async () => { await X("settings-channel").selectOption("16"); await until(async () => (await get()).channelMode === "16", "16 stored"); });
await check("the IPC validates what the renderer sends", async () => {
  const set = (p) => win.evaluate((x) => window.kronos.settingsSet(x).then((r) => ({ ok: r }), (e) => ({ err: String(e) })), p);
  const a = await set({ scale: 9999 }); assert.equal(a.ok.scale, 125); const b = await set({ accent: "pink", density: "x" }); assert.equal(b.ok.accent, "red"); assert.equal(b.ok.density, "compact");
  for (const bad of ["../x", 5, null]) assert.ok((await set(bad)).err, `rejects ${JSON.stringify(bad)}`);
  assert.deepEqual(Object.keys((await set({ confirmBulk: false })).ok).sort(), KEYS);
  await set({ scale: 110 });
});
await check("settings.json in userData holds exactly the current settings", async () => {
  let file; await until(async () => { file = find(APPDATA); if (!file) return false; try { return JSON.parse(readFileSync(file, "utf8")).scale === 110; } catch { return false; } }, "settings.json written");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { ...D, theme: process.env.KRONOS_GATE_THEME || D.theme, accent: "red", scale: 110, density: "compact", channelMode: "16" });
  assert.ok(!file.toLowerCase().includes("documents"), file);
});
await check("Reset to defaults restores everything", async () => {
  await X("settings-reset").click(); await until(async () => (await get()).accent === "theme", "accent reset");
  await until(async () => Math.abs((await width()) - base) <= 3, "zoom reset"); assert.deepEqual(await get(), D);
  await until(async () => (await win.evaluate(() => document.documentElement.dataset.density)) === "comfortable" && (await X("settings-channel").inputValue()) === "keyboard" && parseInt(await text("settings-scale-value")) === 100, "the page shows the defaults");
  await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden", timeout: 10000 });
});
await ui.noErrors();

// Restart: keep the same user-data folder.
await win.evaluate(() => window.kronos.settingsSet({ accent: "ice", scale: 110, density: "compact", channelMode: "16" }));
const file = await (async () => { for (let i = 0; i < 100; i++) { const f = find(APPDATA); if (f) { try { if (JSON.parse(readFileSync(f, "utf8")).accent === "ice") return f; } catch {} } await new Promise((r) => setTimeout(r, 100)); } return null; })();
await kill(g.state.app);
await check("settings written before were saved to disk for the restart", () => assert.ok(file, "settings.json with the new values never appeared"));
if (!file) await finish();

const ui2 = await launch(g, C, { APPDATA }), w2 = ui2.win;
await check("after a restart the settings are back, and the MIDI panel starts on the chosen channel", async () => {
  await until(async () => (await css(w2, "--accent")) === S.ACCENTS.ice, "accent restored"); await until(async () => Math.abs((await w2.evaluate(() => window.innerWidth)) - base / 1.1) <= 4, "zoom restored");
  assert.equal(await w2.evaluate(() => document.documentElement.dataset.density), "compact");
  await ui2.openFile(); await ui2.connectSim(); assert.equal(await ui2.X("midi-channel").inputValue(), "16");
  // Style A hosts the transport in the dock's MIDI player tab, so the gate opens that tab first.
  if (!(await ui2.X("midi-test").isVisible())) await ui2.X("dock-tab-player").click();
  await ui2.X("midi-test").click(); await until(async () => (await w2.evaluate(() => window.__kronosE2E.midiLog())).some((m) => m[0] === 0x9f && m[2] > 0), "test pattern on channel 16", 10000);
});
await kill(g.state.app);
writeFileSync(file, "{ this is not json \u0000");
const ui3 = await launch(g, C, { APPDATA }), w3 = ui3.win;
await check("a corrupt settings.json starts the app on the defaults", async () => {
  await ui3.openFile(); assert.notEqual(await css(w3, "--accent"), S.ACCENTS.ice); assert.deepEqual(await w3.evaluate(() => window.kronos.settingsGet()), D);
  assert.ok(Math.abs((await w3.evaluate(() => window.innerWidth)) - base) <= 4); await ui3.X("settings-open").click(); await ui3.seen("settings-dialog"); assert.equal(await ui3.X("settings-channel").inputValue(), "keyboard");
});
await ui3.noErrors();
try { rmSync(tmp1, { recursive: true, force: true }); } catch {}
await finish();
