// Acceptance gate for parameter editing, proven by inspecting the bytes the real app saves. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { byTestId, themeSettings } from "./gate-kit.mjs";

const root = path.resolve(import.meta.dirname, "..");
const fails = [];
const check = async (name, fn) => {
  try { const note = await fn(); console.log("ok  ", name, note ? `(${note})` : ""); }
  catch (e) { fails.push(`${name}: ${String(e.message).split("\n").slice(0, 5).join(" ")}`); console.log("FAIL", name); }
};
let app;
const finish = async () => {
  try { if (app) spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"]); } catch {}
  console.log(fails.length ? `\nEDIT FAIL (${fails.length})\n- ${fails.join("\n- ")}` : "\nEDIT PASS");
  process.exit(fails.length ? 1 : 0);
};
const load = (p) => import(pathToFileURL(path.join(root, p)).href);

const FACTORY = path.join(root, "research/korg-factory/pcg/PRELOAD_KRONOSX.PCG");
const gen = spawnSync(process.execPath, ["scripts/gen-params.ts"], { cwd: root, encoding: "utf8" });
if (gen.status !== 0) { fails.push(`gen-params failed: ${(gen.stdout + gen.stderr).slice(-800)}`); await finish(); }
const T = JSON.parse(readFileSync(path.join(root, "src/generated/params.json"), "utf8"));
const P = await load("src/core/pcg/pcg.ts"), L = await load("src/core/pcg/library.ts"), Q = await load("src/core/params/params.ts");
const raw = new Uint8Array(readFileSync(FACTORY)), file = P.parsePcg(raw);
const parseFile = (p) => P.parsePcg(new Uint8Array(readFileSync(p)));
const banks = L.listBanks(file);
const all = (kind) => banks.filter((b) => b.kind === kind).flatMap((b) => Array.from({ length: b.count }, (_, i) => L.getEntry(file, b.key, i)));
const key = (r) => `${r.ofs}.${r.bitLo ?? 0}`;
const GLB_DATA = 29995096 + 12, GLB_SUM = 29995096 + 11, GLB_SIZE = 24708;

const noSharedBits = (rows, label) => { const own = new Map(); for (const r of rows) { if (r.continuation || r.fixed || r.name === "Name") continue; const me = `${r.group} / ${r.name} @${r.ofs}`; for (const [o, h, l] of r.parts) for (let b = l; b <= h; b++) { const at = `${o}.${b}`, was = own.get(at); assert.ok(!was || was === me, `${label}: bit ${at} is owned by ${was} and ${me}`); own.set(at, me); } } };
const allInRange = (kindRows, entries, label) => { let reads = 0, out = 0; for (const e of entries) for (const r of kindRows(e)) { if (!Q.isEditable(r)) continue; reads++; const v = Q.readParam(e, r); if (v < r.rawMin || v > r.rawMax) out++; } assert.equal(out, 0, `${label}: ${out} of ${reads} out of range`); return `${reads} values`; };

await check("drum kits: all 128 notes and 8 zones are covered", () => {
  const e = L.getEntry(file, "drumkit:INT", 0), rows = Q.paramsFor(T, "drumkit", e), ed = rows.filter((r) => Q.isEditable(r)); assert.equal(ed.length, 20352);
  for (const [n, z] of [[1, 1], [1, 8], [2, 3], [77, 5], [128, 8]]) { const r = ed.find((x) => x.ofs === 24 + 300 * (n - 1) + 34 * (z - 1) + 32 && x.name === "Low Boost"); assert.ok(r, `no Low Boost for note ${n} zone ${z}`); assert.ok(r.group.includes(`Note${n} `) && r.group.includes(`Zone${z}`), r.group); }
  assert.ok(ed.find((x) => x.ofs === 38419 && x.name === "Send 1 Level"), "no Note128 Send 1 Level");
  for (const r of ed) { assert.match(r.group, /^Note\d+ /, r.name); for (const [o] of r.parts) assert.ok(o < 38424, `${r.name} at ${o}`); } noSharedBits(rows, "drumkit");
});
await check("drum kits read in range on every note", () => allInRange((e) => Q.paramsFor(T, "drumkit", e), all("drumkit"), "drumkit"));
await check("wave sequences: all 64 steps are covered", () => {
  const e = L.getEntry(file, "waveseq:INT", 0), rows = Q.paramsFor(T, "waveseq", e), ed = rows.filter((r) => Q.isEditable(r)); assert.equal(ed.length, 976);
  const r = ed.find((x) => x.ofs === 1297 && x.name === "Fade-Out Shape"); assert.ok(r, "no Step37 Fade-Out Shape"); assert.equal(r.group, "Step37"); noSharedBits(rows, "waveseq");
});
await check("wave sequences read in range on every step", () => allInRange((e) => Q.paramsFor(T, "waveseq", e), all("waveseq"), "waveseq"));
await check("Global: read and write through the library", () => {
  const f = P.parsePcg(raw), g = L.getGlobal(f); assert.equal(g.length, GLB_SIZE); assert.deepEqual(Buffer.from(g), Buffer.from(raw.subarray(GLB_DATA, GLB_DATA + GLB_SIZE)));
  assert.equal(L.getGlobal(P.parsePcg(new Uint8Array(readFileSync(path.join(root, "research/korg-factory/pcg/KRS-06.PCG"))))), null);
  assert.throws(() => L.setGlobal(f, new Uint8Array(10)), (e) => e.name === "PcgError");
  g[5] ^= 1; L.setGlobal(f, g); const out = P.serializePcg(f), d = []; for (let i = 0; i < out.length; i++) if (out[i] !== raw[i]) d.push(i);
  assert.ok(d.includes(GLB_DATA + 5) && d.every((i) => i === GLB_DATA + 5 || i === GLB_SUM), `changed ${d.slice(0, 6)}`); assert.deepEqual(P.verifyChecksums(P.parsePcg(out)), []);
  assert.equal(Q.paramsFor(T, "global", g).length, T.global.length);
});
await check("Global reads in range with no shared bits", () => { const g = L.getGlobal(file); noSharedBits(T.global, "global"); return allInRange(() => T.global, [g], "global"); });
await check("effect names come from KORG's list", () => { assert.equal(T.effectTypes.length, 198); assert.equal(T.effectTypes[0], "No Effect"); assert.equal(T.effectTypes[1], "Stereo Dyna Compressor"); assert.equal(typeof T.effectTypes[197], "string"); });
await check("settings that change how the rest of the sound is read can't be edited yet", () => {
  for (const rows of [T.programHd1, T.programExiCommon, T.combi]) { const names = rows.filter((r) => /^(Effect Type|Algorithm Type)$/.test(r.name)); assert.ok(names.length > 0); for (const r of names) assert.equal(Q.isEditable(r), false, `${r.group} ${r.name}`); }
});
await check("unit tests and type check pass", () => {
  const tests = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("src", f));
  let r = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1000));
  r = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", root], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 1000));
});
if (fails.length) await finish();

const b = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", shell: true });
if (b.status !== 0) { fails.push(`npm run build failed: ${(b.stdout + b.stderr).slice(-1200)}`); await finish(); }
const { _electron: electron } = createRequire(path.join(root, "package.json"))("playwright-core");
const tmp = mkdtempSync(path.join(os.tmpdir(), "kronos-edit-"));
const OPEN = path.join(tmp, "work.PCG"), SAVE = path.join(tmp, "saved.PCG"); copyFileSync(FACTORY, OPEN); mkdirSync(path.join(tmp, "b"));
const APPDATA = path.join(tmp, "appdata"); mkdirSync(APPDATA); themeSettings(APPDATA);
try { app = await electron.launch({ args: [root], cwd: root, timeout: 60000, env: { ...process.env, APPDATA, ELECTRON_RUN_AS_NODE: undefined, KRONOS_E2E: "1", KRONOS_E2E_OPEN: OPEN, KRONOS_E2E_SAVE: SAVE, KRONOS_E2E_BACKUP_DIR: path.join(tmp, "b") } }); }
catch (e) { fails.push(`app did not launch: ${e.message}`); await finish(); }
const win = await app.firstWindow();
const errors = []; win.on("pageerror", (e) => errors.push(e.message)); win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const T_ = byTestId(win);
const seen = (id, timeout = 20000) => T_(id).waitFor({ state: "visible", timeout });
const until = async (fn, what, timeout = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn()) return; await new Promise((r) => setTimeout(r, 60)); } throw new Error(`timed out: ${what}`); };
const openBank = async (k) => { await T_(`bank-${k}`).click(); if (k.startsWith("setlist:")) await T_("setlists-list-view").click(); await seen("row-name-0"); }; // the SET bank opens on the pad grid; these checks use the plain list
const editSlot = async (k, i) => { await openBank(k); await T_(`row-${i}`).click(); await T_("edit-params").click(); await seen("editor-title"); await seen("view-list"); if (await T_("view-panel").count()) await T_("view-list").click(); };
const close = async () => { await T_("close-editor").click(); await seen("row-name-0"); };
const setValue = async (k, v) => { await T_(`input-${k}`).fill(String(v)); await T_(`input-${k}`).press("Enter"); };
let saves = 0;
const saveAndParse = async () => { const before = existsSync(SAVE) ? readFileSync(SAVE).length + ":" + saves : ""; saves++; await T_("save-as").click(); await new Promise((r) => setTimeout(r, 400)); let f; await until(async () => { try { f = parseFile(SAVE); return P.verifyChecksums(f).length === 0; } catch { return false; } }, `saved file ${before}`, 30000); return f; };
const onlyTheseBits = (after, before, parts) => { const mask = new Map(); for (const [o, h, l] of parts) mask.set(o, (mask.get(o) ?? 0) | (((1 << (h - l + 1)) - 1) << l)); let changed = 0; for (let i = 0; i < before.length; i++) { const d = after[i] ^ before[i]; if (d) { changed++; assert.equal(d & ~(mask.get(i) ?? 0), 0, `byte ${i} changed outside the field`); } } assert.ok(changed > 0, "nothing changed"); };

await T_("open-file").waitFor({ timeout: 20000 });
await check("open the file; Edit needs exactly one slot and no set list", async () => {
  await T_("open-file").click(); await seen("bank-program:INT-A", 30000); await openBank("program:INT-B"); assert.equal(await T_("edit-params").isDisabled(), true);
  await T_("row-5").click(); assert.equal(await T_("edit-params").isDisabled(), false); await T_("row-6").click({ modifiers: ["Control"] }); assert.equal(await T_("edit-params").isDisabled(), true);
  await openBank("setlist:SET"); await T_("row-0").click(); assert.equal(await T_("edit-params").isDisabled(), true);
});
const HD = "program:INT-B", HI = 5, hdOrig = L.getEntry(file, HD, HI).subarray(0, 4960), pan = T.programHd1.find((r) => r.ofs === 92 && r.name === "Panpot"), panKey = key(pan), panTo = Q.readParam(hdOrig, pan) === 64 ? 63 : 64;
await check("open a program in the editor", async () => { await editSlot(HD, HI); assert.ok((await T_("editor-title").textContent()).includes(L.getName(file, HD, HI))); await T_("group-Insert Effect1").click(); await seen(`param-${panKey}`); });
await check("a value outside the range is refused with a message", async () => { await setValue(panKey, 128); await seen("param-error"); await setValue(panKey, panTo); await T_("param-error").waitFor({ state: "hidden", timeout: 10000 }); });
await check("the edited setting is marked and listed as changed", async () => { await until(async () => (await T_(`param-${panKey}`).getAttribute("data-changed")) === "true", "changed marker"); await seen(`change-${HD}-${HI}`); assert.match(await T_(`change-${HD}-${HI}`).textContent(), /setting/i); assert.match(await T_(`value-${panKey}`).textContent(), /[LR]0\d\d|C/); });
await check("undo and redo a setting", async () => { await T_("undo").click(); await until(async () => (await T_(`param-${panKey}`).getAttribute("data-changed")) !== "true", "undone"); await T_(`change-${HD}-${HI}`).waitFor({ state: "hidden", timeout: 10000 }); await T_("redo").click(); await until(async () => (await T_(`param-${panKey}`).getAttribute("data-changed")) === "true", "redone"); });
await check("effect types show their name and can't be edited", async () => { const fx = T.programHd1.find((r) => r.ofs === 88 && r.name === "Effect Type"), k = key(fx); await seen(`value-${k}`); assert.equal((await T_(`value-${k}`).textContent()).trim(), T.effectTypes[Q.readParam(hdOrig, fx)]); assert.equal(await T_(`input-${k}`).count(), 0); });
await check("saving changes exactly that one byte in the program", async () => { const f = await saveAndParse(), after = L.getEntry(f, HD, HI); assert.equal(Q.readParam(after, pan), panTo); onlyTheseBits(after, hdOrig, pan.parts); await close(); });

let polyAt; for (const bk of banks.filter((x) => x.kind === "program" && x.type === "exi")) { for (let i = 0; i < bk.count && !polyAt; i++) if (Q.exiEngines(T, L.getEntry(file, bk.key, i))[0] === "PolysixEX") polyAt = [bk.key, i]; if (polyAt) break; }
await check("a value split across bytes leaves the next setting alone", async () => {
  const [k, i] = polyAt, orig = L.getEntry(file, k, i), r = Q.paramsFor(T, "exi", orig).find((x) => x.ofs === 3170 && x.name === "Cutoff"), to = Q.readParam(orig, r) === 1000 ? 500 : 1000;
  await editSlot(k, i); await T_("param-search").fill("Filter"); await seen(`param-${key(r)}`); await setValue(key(r), to); await until(async () => (await T_(`param-${key(r)}`).getAttribute("data-changed")) === "true", "changed");
  const f = await saveAndParse(), after = L.getEntry(f, k, i); assert.equal(Q.readParam(after, r), to); onlyTheseBits(after, orig, r.parts); await T_("param-search").fill(""); await close();
});
await check("a combi opens in the editor", async () => { await editSlot("combi:INT-A", 0); await seen("group-Insert Effect1"); await close(); });
await check("drum kit: a zone on the last note can be found and edited", async () => {
  const orig = L.getEntry(file, "drumkit:INT", 0), r = Q.paramsFor(T, "drumkit", orig).find((x) => x.ofs === 38394), to = Q.readParam(orig, r) === r.rawMin ? r.rawMax : r.rawMin;
  await editSlot("drumkit:INT", 0); await T_("param-search").fill("Note128 Zone8"); await seen(`param-${key(r)}`); await setValue(key(r), to); await until(async () => (await T_(`param-${key(r)}`).getAttribute("data-changed")) === "true", "changed");
  const f = await saveAndParse(), after = L.getEntry(f, "drumkit:INT", 0); assert.equal(Q.readParam(after, r), to); onlyTheseBits(after, orig, r.parts); await T_("param-search").fill(""); await close();
});
await check("wave sequence: a middle step can be found", async () => { await editSlot("waveseq:INT", 0); await T_("param-search").fill("Step37"); await seen("param-1297.0"); await T_("param-search").fill(""); await close(); });
const gl = L.getGlobal(file), glR = T.global.find((r) => r.group === "Basic" && Q.isEditable(r) && r.rawMax - r.rawMin >= 2), glTo = Q.readParam(gl, glR) === glR.rawMin ? glR.rawMax : glR.rawMin;
await check("Global can be edited and saved, and stays file-only", async () => {
  await T_("global-item").click(); await seen("editor-title"); await T_("group-Basic").click(); await seen(`param-${key(glR)}`); assert.equal(await T_("push-bank").isDisabled(), true); assert.equal(await T_("pull-bank").isDisabled(), true);
  await setValue(key(glR), glTo); await seen("change-global"); assert.match(await T_("change-global").textContent(), /setting/i);
  const f = await saveAndParse(), after = L.getGlobal(f); assert.equal(Q.readParam(after, glR), glTo); onlyTheseBits(after, gl, glR.parts);
});
await check("very long lists stay fast: only visible rows are drawn", async () => {
  await T_("group-MIDI").click(); const rows = win.locator('[data-testid^="param-"]:not([data-testid="param-search"]):not([data-testid="param-error"]):not([data-testid="param-list"])'); await rows.first().waitFor({ timeout: 20000 }); const n = await rows.count(); assert.ok(n > 5 && n <= 300, `${n} rows in the page`);
  const last = T.global.filter((r) => r.group === "MIDI" && Q.isEditable(r)).at(-1); await T_("param-list").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await seen(`param-${key(last)}`);
});
await check("no errors in the console", async () => { const real = errors.filter((e) => !/Electron Security Warning|Autofill|DevTools/i.test(e)); assert.deepEqual(real, []); });
try { spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"]); app = null; await new Promise((r) => setTimeout(r, 1000)); rmSync(tmp, { recursive: true, force: true }); } catch {}
await finish();
