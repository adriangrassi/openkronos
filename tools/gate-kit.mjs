// Shared helpers for acceptance gates. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, writeFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const root = path.resolve(import.meta.dirname, "..");
export const PCG_DIR = path.join(root, "research/korg-factory/pcg");
export const FACTORY = path.join(PCG_DIR, "PRELOAD_KRONOSX.PCG");
export const sha = (a) => createHash("sha256").update(a).digest("hex");
export const load = (p) => import(pathToFileURL(path.join(root, p)).href);

export function gate(name) {
  const fails = [], state = { app: null, tmp: null };
  const check = async (title, fn) => {
    try { const note = await fn(); console.log("ok  ", title, note ? `(${note})` : ""); }
    catch (e) { fails.push(`${title}: ${String(e.message).split("\n").slice(0, 14).join(" ")}`); console.log("FAIL", title); }
  };
  const finish = async () => {
    try { if (state.app) spawnSync("taskkill", ["/PID", String(state.app.process().pid), "/T", "/F"]); } catch {}
    try { if (state.tmp) { await new Promise((r) => setTimeout(r, 800)); rmSync(state.tmp, { recursive: true, force: true }); } } catch {}
    console.log(fails.length ? `\n${name} FAIL (${fails.length})\n- ${fails.join("\n- ")}` : `\n${name} PASS`);
    process.exit(fails.length ? 1 : 0);
  };
  return { fails, state, check, finish };
}

export async function core(g) {
  const gen = spawnSync(process.execPath, ["scripts/gen-params.ts"], { cwd: root, encoding: "utf8" });
  if (gen.status !== 0) { g.fails.push(`gen-params failed: ${(gen.stdout + gen.stderr).slice(-800)}`); await g.finish(); }
  const fx = spawnSync(process.execPath, ["scripts/gen-effects.ts"], { cwd: root, encoding: "utf8" });
  if (fx.status !== 0) { g.fails.push(`gen-effects failed: ${(fx.stdout + fx.stderr).slice(-800)}`); await g.finish(); }
  const T = JSON.parse(readFileSync(path.join(root, "src/generated/params.json"), "utf8"));
  const [P, L, Q] = await Promise.all([load("src/core/pcg/pcg.ts"), load("src/core/pcg/library.ts"), load("src/core/params/params.ts")]);
  const raw = new Uint8Array(readFileSync(FACTORY));
  return { T, P, L, Q, raw, parsed: () => P.parsePcg(raw) };
}

export const testsAndTypes = (g, required = []) => g.check("unit tests and type check pass", () => {
  const tests = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("src", f));
  for (const t of required) assert.ok(tests.some((f) => f.replace(/\\/g, "/").endsWith(t)), `${t} is missing`);
  let r = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1000));
  r = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", root], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 1000));
});

export const onlyBits = (after, before, parts) => {
  const mask = new Map(); for (const [o, h, l] of parts) mask.set(o, (mask.get(o) ?? 0) | (((1 << (h - l + 1)) - 1) << l));
  let changed = 0; for (let i = 0; i < before.length; i++) { const d = after[i] ^ before[i]; if (d) { changed++; assert.equal(d & ~(mask.get(i) ?? 0), 0, `byte ${i} changed outside the expected bits`); } }
  assert.ok(changed > 0, "nothing changed");
};

// KRONOS_GATE_THEME=normal|studio|a runs the gate under that theme (the default is the app default). `appdata` is the APPDATA folder the app is launched with.
export function themeSettings(appdata) {
  if (!process.env.KRONOS_GATE_THEME) return;
  mkdirSync(path.join(appdata, "openkronos"), { recursive: true });
  writeFileSync(path.join(appdata, "openkronos", "settings.json"), JSON.stringify({ theme: process.env.KRONOS_GATE_THEME }));
}

// Studio keeps these seven buttons in its Tools sheet (display none until it is open). Under studio a click on one opens the sheet first, and the tool's own click closes it again, so what a gate checks is unchanged.
const STUDIO_TOOLS = ["save-as", "exchange-open", "shell-recent-button", "shell-history-button", "overview-open", "shell-help-button", "settings-open"];
export const byTestId = (win) => (id) => {
  const loc = win.getByTestId(id);
  if (process.env.KRONOS_GATE_THEME !== "studio" || !STUDIO_TOOLS.includes(id)) return loc;
  return new Proxy(loc, {
    get: (t, k) => k === "click"
      ? async (...a) => { const tools = win.getByTestId("studio-tools"); if ((await tools.count()) && (await tools.getAttribute("aria-expanded")) !== "true") await tools.click(); return t.click(...a); }
      : typeof t[k] === "function" ? t[k].bind(t) : t[k],
  });
};

// Launches the real app with its own user-data folder, so it can't disturb a copy the owner has open. It never touches USB.
export async function launch(g, { P }, env = {}) {
  const b = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", shell: true });
  if (b.status !== 0) { g.fails.push(`build failed: ${(b.stdout + b.stderr).slice(-1000)}`); await g.finish(); }
  const { _electron: electron } = createRequire(path.join(root, "package.json"))("playwright-core");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "kronos-gate-")); g.state.tmp = tmp;
  const OPEN = path.join(tmp, "work.PCG"), SAVE = path.join(tmp, "saved.PCG"), BACKUPS = path.join(tmp, "backups"), APPDATA = path.join(tmp, "appdata");
  copyFileSync(FACTORY, OPEN); mkdirSync(BACKUPS); mkdirSync(APPDATA);
  themeSettings(APPDATA);
  try { g.state.app = await electron.launch({ args: [root], cwd: root, timeout: 60000, env: { ...process.env, APPDATA, ELECTRON_RUN_AS_NODE: undefined, KRONOS_E2E: "1", KRONOS_E2E_OPEN: OPEN, KRONOS_E2E_SAVE: SAVE, KRONOS_E2E_BACKUP_DIR: BACKUPS, ...env } }); }
  catch (e) { g.fails.push(`app did not launch: ${e.message}`); await g.finish(); }
  const win = await g.state.app.firstWindow(), errors = [];
  // The OS may open the window on a small or portrait display (remote sessions), which changes the layout under test: always run on the largest display at 1400x900 content size. KRONOS_GATE_KEEP_SIZE=1 keeps the OS size.
  if (!process.env.KRONOS_GATE_KEEP_SIZE) {
    await g.state.app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0], d = screen.getAllDisplays().sort((x, y) => y.workArea.width * y.workArea.height - x.workArea.width * x.workArea.height)[0];
      w.setBounds({ x: d.workArea.x + 20, y: d.workArea.y + 20, width: 800, height: 600 }); w.setContentSize(...(process.env.KRONOS_GATE_SIZE ?? "1400x900").split("x").map(Number));
    });
    await win.waitForFunction(() => innerWidth >= 1300, null, { timeout: 10000 }).catch(() => {});
  }
  win.on("pageerror", (e) => errors.push(e.message)); win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const X = byTestId(win), seen = (id, timeout = 20000) => X(id).waitFor({ state: "visible", timeout }), text = async (id) => ((await X(id).textContent()) ?? "").trim();
  const until = async (fn, what, timeout = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn()) return; await new Promise((r) => setTimeout(r, 60)); } throw new Error(`timed out: ${what}`); };
  const openBank = async (k) => { await X(`bank-${k}`).click(); await seen("row-name-0"); };
  // Style A opens a Program in the panel view; the gates read the parameter list, so they take the visible List view switch first.
  const listView = async () => { await seen("view-list"); if (await X("view-panel").count()) await X("view-list").click(); };
  const editSlot = async (k, i) => { await openBank(k); await X(`row-${i}`).click(); await X("edit-params").click(); await seen("editor-title"); await listView(); };
  const closeEditor = async () => { await X("close-editor").click(); await seen("row-name-0"); };
  const ok = async () => { await seen("confirm-ok"); await X("confirm-ok").click(); await X("confirm-ok").waitFor({ state: "hidden", timeout: 20000 }); };
  const openFile = async () => { await X("open-file").waitFor({ timeout: 20000 }); await X("open-file").click(); await seen("bank-program:INT-A", 30000); };
  const connectSim = async () => { await X("connect-sim").click(); await until(async () => /simulated/i.test(await text("device-status")), "simulator"); };
  const mtime = () => { try { return statSync(SAVE).mtimeMs; } catch { return 0; } };
  const saved = async () => { const before = mtime(); await new Promise((r) => setTimeout(r, 30)); await X("save-as").click(); let bytes; await until(async () => { if (mtime() === before) return false; try { bytes = new Uint8Array(readFileSync(SAVE)); return P.verifyChecksums(P.parsePcg(bytes)).length === 0; } catch { return false; } }, "file saved", 40000); return bytes; };
  const drag = async (id, dx, dy) => { const b = await X(id).boundingBox(); assert.ok(b, `${id} has no box`); const x = b.x + b.width / 2, y = b.y + b.height / 2; await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x + dx, y + dy, { steps: 8 }); await win.mouse.up(); await new Promise((r) => setTimeout(r, 150)); };
  const noErrors = () => g.check("no errors in the console", async () => { assert.deepEqual(errors.filter((e) => !/Electron Security Warning|Autofill|DevTools/i.test(e)), []); });
  return { win, X, seen, text, until, openBank, editSlot, listView, closeEditor, ok, openFile, connectSim, saved, drag, noErrors, tmp, OPEN, SAVE, BACKUPS };
}
