// End-to-end acceptance gate: builds the real Electron app and drives it like a user. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { byTestId, themeSettings } from "./gate-kit.mjs";

const root = path.resolve(import.meta.dirname, "..");
const fails = [];
const check = async (name, fn) => {
  try { await fn(); console.log("ok  ", name); }
  catch (e) { fails.push(`${name}: ${String(e.message).split("\n").slice(0, 5).join(" ")}`); console.log("FAIL", name); }
};
let app;
const finish = async () => {
  try { if (app) spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"]); } catch {}
  console.log(fails.length ? `\nAPP FAIL (${fails.length})\n- ${fails.join("\n- ")}` : "\nAPP PASS");
  process.exit(fails.length ? 1 : 0);
};

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: true });
const FACTORY = path.join(root, "research/korg-factory/pcg/PRELOAD_KRONOSX.PCG");
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const P = await load("src/core/pcg/pcg.ts"), L = await load("src/core/pcg/library.ts");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const parse = (p) => P.parsePcg(new Uint8Array(readFileSync(p)));

await check("unit tests, type check and earlier gates pass", () => {
  const all = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("src", f));
  assert.ok(all.some((f) => /webmidi\.test\.ts$/.test(f)), "src/app/renderer/webmidi.test.ts is missing");
  let r = spawnSync(process.execPath, ["--test", ...all], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1000));
  r = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", root], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 1000));
  r = spawnSync(process.execPath, ["tools/gate-sync.mjs"], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, r.stdout.slice(-800));
});

// Real-MIDI port selection, with fake Web MIDI objects.
await check("USB: finds the Kronos by asking each port, not by its name", async () => {
  const W = await load("src/app/renderer/webmidi.ts");
  const REPLY = [0xf0, 0x7e, 0, 6, 2, 0x42, 0x68, 0, 0x17, 0, 3, 1, 2, 0, 0xf7];
  const mkIn = (name) => { const p = { name, id: name, onmidimessage: null, addEventListener(t, f) { this.l = f; }, removeEventListener() { this.l = null; }, open: async () => {}, close: async () => {}, fire(d) { const e = { data: Uint8Array.from(d) }; this.onmidimessage?.(e); this.l?.(e); } }; return p; };
  const mkAccess = (answerOn) => {
    const inputs = [mkIn("Other Gear"), mkIn("KRONOS")];
    const mkOut = (name, i) => ({ name, id: name, open: async () => {}, close: async () => {}, send(d) { const b = Array.from(d); if (b[1] === 0x7e && b[4] === 1 && name === answerOn) setTimeout(() => inputs[i].fire(REPLY), 1); } });
    const outputs = [mkOut("Microsoft GS Wavetable Synth", 0), mkOut("KRONOS", 1)];
    return { inputs: new Map(inputs.map((p) => [p.id, p])), outputs: new Map(outputs.map((p) => [p.id, p])) };
  };
  const c = await W.connectKronos(mkAccess("KRONOS"), { timeoutMs: 100 });
  assert.equal(c.identity.family, 0x68); assert.equal(c.outputName, "KRONOS"); assert.equal(c.inputName, "KRONOS"); assert.ok(c.client && c.transport);
  await assert.rejects(W.connectKronos(mkAccess("nobody"), { timeoutMs: 40 }), /no kronos/i);
});

const r = run("npm", ["run", "build"]);
if (r.status !== 0) { fails.push(`npm run build failed: ${(r.stdout + r.stderr).slice(-1200)}`); await finish(); }

const require = createRequire(path.join(root, "package.json"));
let electron;
try { electron = require("playwright-core")._electron; } catch (e) { fails.push("playwright-core is not installed"); await finish(); }

const tmp = mkdtempSync(path.join(os.tmpdir(), "kronos-gate-"));
const OPEN = path.join(tmp, "work.PCG"), SAVE = path.join(tmp, "saved.PCG"), BACKUPS = path.join(tmp, "backups");
copyFileSync(FACTORY, OPEN); mkdirSync(BACKUPS);
const APPDATA = path.join(tmp, "appdata"); mkdirSync(APPDATA); themeSettings(APPDATA);
const launch = (extra = {}) => electron.launch({ args: [root], cwd: root, timeout: 60000, env: { ...process.env, APPDATA, ELECTRON_RUN_AS_NODE: undefined, ...extra } });
const E2E = { KRONOS_E2E: "1", KRONOS_E2E_OPEN: OPEN, KRONOS_E2E_SAVE: SAVE, KRONOS_E2E_BACKUP_DIR: BACKUPS };

try { app = await launch(E2E); } catch (e) { fails.push(`app did not launch: ${e.message}`); await finish(); }
const win = await app.firstWindow();
const errors = []; win.on("pageerror", (e) => errors.push(e.message)); win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await win.waitForLoadState("domcontentloaded");
const T = byTestId(win);
const seen = (id, timeout = 15000) => T(id).waitFor({ state: "visible", timeout });
const until = async (fn, what, timeout = 15000) => { const t0 = Date.now(); let last; while (Date.now() - t0 < timeout) { last = await fn(); if (last === true) return; await new Promise((r) => setTimeout(r, 60)); } throw new Error(`timed out: ${what}`); };
const text = async (id) => (await T(id).textContent() ?? "").trim();
const name = (i) => text(`row-name-${i}`);
const waitName = (i, v) => until(async () => (await name(i)) === v, `row ${i} to read "${v}"`);
const openBank = async (key) => { await T(`bank-${key}`).click(); if (key.startsWith("setlist:")) await T("setlists-list-view").click(); await seen("row-name-0"); }; // the SET bank opens on the pad grid; these checks use the plain list
const rename = async (i, v) => { await T(`row-${i}`).dblclick(); await T("rename-input").fill(v); await T("rename-input").press("Enter"); };
const ok = async () => { await seen("confirm-ok"); await T("confirm-ok").click(); await T("confirm-ok").waitFor({ state: "hidden", timeout: 15000 }); };
const count = (id, v) => until(async () => (await text(id)) === String(v), `${id} to be ${v}`);
const sim = (fn, ...a) => win.evaluate(([f, x]) => window.__kronosE2E[f](...x), [fn, a]);

await check("window opens with the product name", async () => { await seen("open-file"); assert.match(await win.title(), /OpenKronos/); });
await check("security: isolated renderer, no Node access", async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.sandbox, true);
  assert.equal(await win.evaluate(() => typeof require), "undefined");
});
await check("USB access is granted without a prompt", async () => { assert.equal(await win.evaluate(async () => { const a = await navigator.requestMIDIAccess({ sysex: true }); return a.sysexEnabled; }), true); });
await check("simulator needs a file first", async () => { assert.equal(await T("connect-sim").isDisabled(), true); });

await check("open a real file: all 31 banks listed", async () => { await T("open-file").click(); await seen("bank-program:INT-A", 30000); assert.match(await text("file-name"), /work\.PCG/); assert.equal(await win.locator('[data-testid^="bank-"]').count(), 31); });
await check("a bank shows its 128 slots and names", async () => { await openBank("program:INT-A"); await waitName(0, "KRONOS German Grand"); assert.equal(await win.locator('[data-testid^="row-name-"]').count(), 128); });
await check("rename a program and see it in the change list", async () => { await rename(0, "Test Name"); await waitName(0, "Test Name"); await count("changes-count", 1); const c = await text("change-program:INT-A-0"); assert.ok(c.includes("KRONOS German Grand") && c.includes("Test Name"), c); });
await check("a bad name is refused with a message and changes nothing", async () => { await T("row-1").dblclick(); await T("rename-input").fill("Café"); await T("rename-input").press("Enter"); await seen("rename-error"); await T("rename-input").press("Escape"); await T("rename-input").waitFor({ state: "hidden" }); await count("changes-count", 1); });
await check("undo and redo", async () => { await T("undo").click(); await waitName(0, "KRONOS German Grand"); await count("changes-count", 0); await T("redo").click(); await waitName(0, "Test Name"); await count("changes-count", 1); });
await check("Save As writes a valid file and leaves the original alone", async () => {
  const before = sha(OPEN); await T("save-as").click(); await until(async () => existsSync(SAVE), "saved file");
  await until(async () => { try { return L.getName(parse(SAVE), "program:INT-A", 0) === "Test Name"; } catch { return false; } }, "saved name");
  assert.deepEqual(P.verifyChecksums(parse(SAVE)), []); assert.equal(sha(OPEN), before);
});
await check("Save over an existing file keeps a backup of the old one", async () => {
  const before = sha(SAVE); await rename(1, "Second Edit"); await waitName(1, "Second Edit"); await T("save-file").click();
  await until(async () => { try { return L.getName(parse(SAVE), "program:INT-A", 1) === "Second Edit"; } catch { return false; } }, "second save");
  const baks = readdirSync(tmp).filter((f) => f.startsWith("saved.PCG.bak")); assert.ok(baks.length >= 1, `no backup; have ${readdirSync(tmp)}`); assert.equal(sha(path.join(tmp, baks[0])), before);
});
await check("search finds names across every bank", async () => { await T("search").fill("Trance kit"); await seen("hit-drumkit:INT-0"); await T("hit-drumkit:INT-0").click(); await T("search").fill(""); await waitName(0, "Trance kit"); });
await check("swap warns about Combis and Set Lists, then swaps", async () => {
  await openBank("program:U-A"); const a = await name(3), b = await name(9); await T("row-3").click(); await T("row-9").click({ modifiers: ["Control"] }); await T("swap").click(); await seen("confirm-message");
  assert.match(await text("confirm-message"), /combi/i); await ok(); await waitName(3, b); await waitName(9, a);
});
await check("copy and paste with confirmation", async () => { const a = await name(2); await T("row-2").click(); await T("copy").click(); await T("row-20").click(); await T("paste").click(); await ok(); await waitName(20, a); });
await check("pasting between engine types is refused", async () => { await openBank("program:INT-A"); await T("row-5").click(); await T("copy").click(); await openBank("program:INT-B"); const before = await name(5); await T("row-5").click(); await T("paste").click(); await seen("error-message"); assert.equal(await name(5), before); });

await check("connect to the simulated Kronos", async () => { await T("connect-sim").click(); await until(async () => /simulated/i.test(await text("device-status")) && /3\.1\.2/.test(await text("device-status")), "simulator status"); });
await check("Send backs up the keyboard first, and stays temporary", async () => {
  await openBank("combi:INT-A"); const original = await name(0); await rename(0, "Sim Edit"); await waitName(0, "Sim Edit"); await T("push-bank").click(); await ok(); await seen("temp-badge", 30000);
  assert.equal(await sim("ramName", "combi:INT-A", 0), "Sim Edit"); assert.equal(await sim("storedName", "combi:INT-A", 0), original, "stored memory changed by Send");
  const combi = readdirSync(BACKUPS).filter((f) => f.startsWith("combi-INT-A-before-send-")).sort().at(-1); assert.ok(combi, "no combi backup written"); assert.equal(L.getName(parse(path.join(BACKUPS, combi)), "combi:INT-A", 0), original, "backup holds the edited version, not what was on the keyboard");
});
await check("Store is confirmed and makes it permanent", async () => { await T("store-bank").click(); await seen("confirm-message"); await ok(); await until(async () => (await sim("storedName", "combi:INT-A", 0)) === "Sim Edit", "stored name"); });
await check("Pull replaces local edits after confirming", async () => { const k = await sim("ramName", "combi:INT-A", 1); await rename(1, "Local Only"); await waitName(1, "Local Only"); await T("pull-bank").click(); await ok(); await waitName(1, k); });
await check("a transfer can be cancelled", async () => {
  await sim("setLatency", 25); await openBank("combi:INT-B"); await rename(0, "Keep Local"); await waitName(0, "Keep Local"); await T("pull-bank").click(); await ok(); await seen("progress"); await T("cancel-transfer").click(); await T("progress").waitFor({ state: "hidden", timeout: 15000 }); await sim("setLatency", 0);
  assert.equal(await name(0), "Keep Local", "a cancelled pull changed the library"); assert.match(await text("device-status"), /simulated/i);
});
await check("set lists stay file-only for now", async () => { await openBank("setlist:SET"); assert.equal(await T("push-bank").isDisabled(), false); assert.equal(await T("pull-bank").isDisabled(), true); });
// KRONOS_GATE_SKIP_USB: a real keyboard may be in use, and MIDI ports can be exclusive
if (!process.env.KRONOS_GATE_SKIP_USB) await check("USB connect fails cleanly when no Kronos answers, or identifies one", async () => { await T("disconnect").click(); await T("connect-usb").click(); await until(async () => /no kronos|kronos 88|3\.1/i.test(await text("device-status")), "usb status", 25000); });
await check("a damaged file shows an error and keeps your work", async () => { writeFileSync(OPEN, Buffer.from("not a pcg file")); await T("open-file").click(); await seen("error-message"); await seen("bank-program:INT-A"); });
await check("closing with unsaved edits asks first", async () => {
  await count("changes-count", await text("changes-count")); await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); }); await seen("confirm-message");
  await T("confirm-cancel").click(); await T("confirm-cancel").waitFor({ state: "hidden" }); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
});
await check("Pull Whole Keyboard builds a library with no file, and can't overwrite the old one", async () => {
  if (!(await T("disconnect").isDisabled())) await T("disconnect").click();
  await T("connect-sim").click(); await until(async () => /simulated/i.test(await text("device-status")), "simulator");
  const before = sha(OPEN); await T("pull-keyboard").click(); await ok();
  await until(async () => /pulled/i.test(await text("file-name")), "pulled library", 300000);
  assert.equal(await win.locator('[data-testid^="bank-"]').count(), 31); assert.equal(await T("bank-setlist:SET").count(), 1);
  const stamp = sha(SAVE); await T("save-file").click(); await until(async () => { try { return sha(SAVE) !== stamp && L.listBanks(parse(SAVE)).length === 31; } catch { return false; } }, "saved pulled library", 30000);
  assert.deepEqual(P.verifyChecksums(parse(SAVE)), []); assert.equal(sha(OPEN), before, "the previously opened file changed");
});
await check("no errors in the console", async () => { const real = errors.filter((e) => !/Electron Security Warning|Autofill|DevTools/i.test(e)); assert.deepEqual(real, []); });
// the unsaved-edits prompt would block a normal close
try { spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"]); await new Promise((r) => setTimeout(r, 1500)); } catch {}
await check("test hooks do not exist in a normal launch", async () => {
  app = await launch(); const w = await app.firstWindow(); await w.getByTestId("open-file").waitFor({ timeout: 20000 }); assert.equal(await w.evaluate(() => typeof window.__kronosE2E), "undefined");
});
try { rmSync(tmp, { recursive: true, force: true }); } catch {}
await finish();
