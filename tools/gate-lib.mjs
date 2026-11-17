// Acceptance gate for value names and for slot references (who uses which Program or Combi). Owned by the architect: builders must not edit it.
// The reference checks decode KORG's real factory file independently of the code under test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  console.log(fails.length ? `\nLIB FAIL (${fails.length})\n- ${fails.join("\n- ")}` : "\nLIB PASS");
  process.exit(fails.length ? 1 : 0);
};
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const FACTORY = path.join(root, "research/korg-factory/pcg/PRELOAD_KRONOSX.PCG");
const gen = spawnSync(process.execPath, ["scripts/gen-params.ts"], { cwd: root, encoding: "utf8" });
if (gen.status !== 0) { fails.push(`gen-params failed: ${(gen.stdout + gen.stderr).slice(-800)}`); await finish(); }
const T = JSON.parse(readFileSync(path.join(root, "src/generated/params.json"), "utf8"));
const P = await load("src/core/pcg/pcg.ts"), L = await load("src/core/pcg/library.ts"), Q = await load("src/core/params/params.ts");
let R; try { R = await load("src/core/pcg/refs.ts"); } catch (e) { fails.push(`cannot load refs.ts: ${e.message}`); }
const raw = new Uint8Array(readFileSync(FACTORY)), parsed = () => P.parsePcg(raw), sha = (a) => createHash("sha256").update(a).digest("hex");

const row = (t, f) => { const r = t.find(f); assert.ok(r, "row not found"); return r; };
const textRow = (text, min, max, t = [...T.programHd1, ...T.combi, ...T.global]) => row(t, (r) => !r.continuation && r.valueText === text && r.rawMin === min && r.rawMax === max);
await check("notes are named", () => { const n = textRow("C-1~G9", 0, 127); assert.equal(Q.formatValue(n, 0), "C-1"); assert.equal(Q.formatValue(n, 60), "C4"); assert.equal(Q.formatValue(n, 61), "C#4"); assert.equal(Q.formatValue(n, 127), "G9"); });
await check("notes with Off or Remove", () => { const o = textRow("Off~G9", -1, 127); assert.equal(Q.formatValue(o, -1), "Off"); assert.equal(Q.formatValue(o, 60), "C4"); const m = row([...T.programHd1, ...T.combi, ...T.global], (r) => !r.continuation && r.valueText === "C-1~G9, Remove" && r.rawMax === 255); assert.equal(Q.formatValue(m, 255), "Remove"); assert.equal(Q.formatValue(m, 60), "C4"); });
await check("MIDI channels", () => { const c = textRow("1~Gch", 0, 16); assert.equal(Q.formatValue(c, 0), "1"); assert.equal(Q.formatValue(c, 15), "16"); assert.equal(Q.formatValue(c, 16), "Gch"); });
await check("controller numbers", () => { const c = textRow("Off~CC#119", -1, 119); assert.equal(Q.formatValue(c, -1), "Off"); assert.equal(Q.formatValue(c, 7), "CC#7"); assert.equal(Q.formatValue(c, 119), "CC#119"); const w = textRow("Off~CC#119", 0, 255); assert.equal(Q.formatValue(w, 255), "Off"); assert.equal(Q.formatValue(w, 7), "CC#7"); assert.equal(Q.formatValue(w, 200), "200"); });
await check("Off then plain numbers, and numbered names", () => { const c = textRow("Off~127", -1, 127); assert.equal(Q.formatValue(c, -1), "Off"); assert.equal(Q.formatValue(c, 5), "5"); const s = textRow("Scene1~Scene8", 0, 7); assert.equal(Q.formatValue(s, 2), "Scene3"); });
await check("anything not provable stays a number", () => { const d = textRow("Off~Dyn.MIDI8", -1, 31); assert.equal(Q.formatValue(d, 5), "5"); assert.equal(Q.formatValue(d, -1), "Off"); assert.equal(Q.formatValue(d, 31), "Dyn.MIDI8"); });
await check("KORG's modulation source lists are parsed", () => { const l = T.valueLists?.["HD-1 AMS Sources"]; assert.ok(l, "no HD-1 AMS Sources"); assert.equal(l.length, 78); assert.equal(l[0], "Off"); assert.equal(l[21], "JS+Y (CC#1)"); assert.ok(T.valueLists["SGX-1 AMS Sources"], "no SGX-1 list"); });
const listed = (rows) => rows.filter((r) => r.list);
await check("a list is attached only when both end names match, with the right engine's list", () => {
  const hd = T.programHd1.filter((r) => !r.continuation && r.valueText === "Off~Tempo" && r.rawMax === 48); assert.ok(hd.length >= 99, `only ${hd.length} HD-1 rows`); for (const r of hd) assert.equal(r.list, "HD-1 AMS Sources");
  for (const [n, f] of [["AL-1", "AL-1"], ["MOD-7", "MOD-7"], ["STR-1", "STR-1"], ["PolysixEX", "PolysixEX"], ["EP-1", "EP-1"], ["CX-3", "CX-3"], ["SGX-2", "SGX-1"]]) for (const r of listed(T.engines[n])) assert.equal(r.list, `${f} AMS Sources`, `${n} ${r.name}`);
  assert.ok(listed(T.engines["AL-1"]).length > 50, "AL-1 rows have no list");
  for (const t of [T.programHd1, T.programExiCommon, T.combi, ...Object.values(T.engines)]) for (const r of listed(t)) { const l = T.valueLists[r.list], [a, b] = r.valueText.split("~"); assert.equal(l[r.rawMin], a.trim(), r.name); assert.equal(l[r.rawMax], b.trim(), r.name); }
  for (const r of T.programHd1.filter((x) => !x.continuation && x.valueText === "Off~Tempo" && x.rawMax === 37)) assert.equal(r.list, undefined, "the effect-source rows have no matching list");
});
await check("list names need the tables, and two arguments still work", () => { const r = row(T.programHd1, (x) => x.list === "HD-1 AMS Sources"); assert.equal(Q.formatValue(r, 21, T), "JS+Y (CC#1)"); assert.equal(Q.formatValue(r, 21), "21"); assert.equal(Q.formatValue(r, 0, T), "Off"); });

const progLabel = (b) => (b <= 5 ? `INT-${"ABCDEF"[b]}` : b >= 17 && b <= 23 ? `U-${"ABCDEFG"[b - 17]}` : b >= 24 && b <= 30 ? `U-${"ABCDEFG"[b - 24].repeat(2)}` : null);
const decodeUsers = (f) => {
  const banks = L.listBanks(f), have = new Set(banks.map((b) => b.key)), m = new Map();
  const add = (to, holder) => { if (!m.has(to)) m.set(to, new Set()); m.get(to).add(holder); };
  const prog = (bank, idx, holder) => { const l = progLabel(bank); if (l && have.has(`program:${l}`)) add(`program:${l}/${idx}`, holder); };
  for (const b of banks) for (let i = 0; i < b.count; i++) {
    if (b.kind === "combi") { const e = L.getEntry(f, b.key, i); for (let t = 0; t < 16; t++) prog(e[4803 + 188 * t], e[4802 + 188 * t], `timbre|${b.key}|${i}|${t}`); }
    if (b.kind === "program") { const e = L.getEntry(f, b.key, i); prog(e[2689], e[2688], `drum-track|${b.key}|${i}|0`); }
    if (b.kind === "setlist") { const e = L.getEntry(f, b.key, i); for (let s = 0; s < 128; s++) { const o = 24 + 542 * s, ty = e[o + 24] & 3, bk = e[o + 25] & 31, idx = e[o + 26], holder = `setlist|${b.key}|${i}|${s}`; if (ty === 1) prog(bk, idx, holder); else if (ty === 0 && bk <= 5 && have.has(`combi:INT-${"ABCDEF"[bk]}`)) add(`combi:INT-${"ABCDEF"[bk]}/${idx}`, holder); } }
  }
  return m;
};
const asHolder = (r) => `${r.kind}|${r.fromKey}|${r.fromIndex}|${r.part}`;
const usedSet = (f, to) => { const [k, i] = to.split("/"); return new Set(R.refsTo(f, k, +i).map(asHolder)); };
const users0 = decodeUsers(parsed());
const ranked = [...users0].sort((a, b) => b[1].size - a[1].size);
const typeOf = (f, k) => L.listBanks(f).find((b) => b.key === k).type;
const pickPair = (sameBank) => { const f = parsed(); const progs = ranked.map(([to]) => to).filter((to) => to.startsWith("program:")); for (const a of progs) for (const b of progs) { if (a === b) continue; const [ka] = a.split("/"), [kb] = b.split("/"); if (typeOf(f, ka) !== typeOf(f, kb) || (ka === kb) !== sameBank) continue; return [a, b]; } throw new Error("no pair"); };
const relabel = (s, ka, ia, kb, ib) => { const [kind, k, i, part] = s.split("|"); if (k === ka && +i === ia) return `${kind}|${kb}|${ib}|${part}`; if (k === kb && +i === ib) return `${kind}|${ka}|${ia}|${part}`; return s; };
const expectAfter = (m, a, b) => { const [ka, ia] = a.split("/"), [kb, ib] = b.split("/"), out = new Map(); for (const [to, set] of m) { const nt = to === a ? b : to === b ? a : to; out.set(nt, new Set([...set].map((h) => relabel(h, ka, +ia, kb, +ib)))); } return out; };
const sameMap = (x, y, label) => { const keys = new Set([...x.keys(), ...y.keys()]); for (const k of keys) { const p = [...(x.get(k) ?? [])].sort().join(","), q = [...(y.get(k) ?? [])].sort().join(","); assert.equal(p, q, `${label}: ${k}`); } };
const SDB_START = 132, SDB_END = 132 + 128 * 3612;

if (R) {
  await check("who uses a slot matches an independent reading of the file", () => { const f = parsed(); for (const [to, set] of ranked.slice(0, 40)) assert.deepEqual([...usedSet(f, to)].sort(), [...set].sort(), to); assert.ok(ranked.some(([, s]) => [...s].some((h) => h.startsWith("drum-track"))), "no drum tracks in sample"); assert.ok(ranked.some(([, s]) => [...s].some((h) => h.startsWith("setlist")))); return `${ranked.reduce((a, [, s]) => a + s.size, 0)} references`; });
  await check("a slot nothing uses reports none, and bad input is refused", () => { const f = parsed(); const free = (() => { for (const b of L.listBanks(f)) if (b.kind === "program") for (let i = 0; i < b.count; i++) if (!users0.has(`${b.key}/${i}`)) return [b.key, i]; })(); assert.deepEqual(R.refsTo(f, free[0], free[1]), []); assert.throws(() => R.refsTo(f, "program:NOPE", 0), (e) => e.name === "PcgError"); assert.throws(() => R.refsTo(f, "program:INT-A", 128), (e) => e.name === "PcgError"); });
  for (const [label, same] of [["inside a bank", true], ["across banks", false]]) await check(`swap ${label} moves the slots and every reference to them`, () => {
    const [a, b] = pickPair(same), [ka, ia] = a.split("/"), [kb, ib] = b.split("/"), f = parsed();
    const before = Uint8Array.from(P.serializePcg(f)); const changed = R.swapWithRefs(f, ka, +ia, kb, +ib); assert.ok(Array.isArray(changed) && changed.length >= 2);
    assert.deepEqual(P.verifyChecksums(f), []); assert.equal(L.getName(f, ka, +ia), L.getName(parsed(), kb, +ib)); sameMap(decodeUsers(f), expectAfter(users0, a, b), "users");
    const out = P.serializePcg(f); assert.equal(sha(out.subarray(SDB_START, SDB_END)), sha(before.subarray(SDB_START, SDB_END)), "the Set List companion block changed");
    const g = parsed(); const inChanged = new Set(changed.map((c) => `${c.key}/${c.index}`));
    for (const bk of L.listBanks(f)) for (let i = 0; i < bk.count; i++) { const x = L.getEntry(f, bk.key, i), y = L.getEntry(g, bk.key, i); const differs = sha(x) !== sha(y); assert.equal(differs, inChanged.has(`${bk.key}/${i}`) && differs, `${bk.key}/${i} changed but was not reported`); if (!differs || `${bk.key}/${i}` === a || `${bk.key}/${i}` === b) continue;
      const ok = new Map(); const allow = (o, m) => ok.set(o, (ok.get(o) ?? 0) | m); if (bk.kind === "combi") for (let t = 0; t < 16; t++) { allow(4802 + 188 * t, 255); allow(4803 + 188 * t, 255); } if (bk.kind === "program") { allow(2688, 255); allow(2689, 255); } if (bk.kind === "setlist") for (let s = 0; s < 128; s++) { allow(24 + 542 * s + 25, 31); allow(24 + 542 * s + 26, 255); }
      for (let o = 0; o < x.length; o++) { const d = x[o] ^ y[o]; if (d) assert.equal(d & ~(ok.get(o) ?? 0), 0, `${bk.key}/${i} changed outside a reference at ${o}`); } }
    R.swapWithRefs(f, ka, +ia, kb, +ib); assert.equal(sha(P.serializePcg(f)), sha(raw), "swapping back did not restore the file");
    return `${changed.length} slots`;
  });
  await check("slotsTouchedBySwap names exactly what a swap changes", () => { const [a, b] = pickPair(false), [ka, ia] = a.split("/"), [kb, ib] = b.split("/"), f = parsed(); const predicted = new Set(R.slotsTouchedBySwap(f, ka, +ia, kb, +ib).map((c) => `${c.key}/${c.index}`)); const changed = R.swapWithRefs(f, ka, +ia, kb, +ib); for (const c of changed) assert.ok(predicted.has(`${c.key}/${c.index}`), `${c.key}/${c.index} not predicted`); });
  await check("a Combi's references from Set Lists are found and moved", () => { const c = ranked.find(([to]) => to.startsWith("combi:")); assert.ok(c, "no combi used by a set list"); const f = parsed(), [k, i] = c[0].split("/"), other = i === "1" ? 2 : 1; R.swapWithRefs(f, k, +i, k, other); sameMap(decodeUsers(f), expectAfter(users0, c[0], `${k}/${other}`), "users"); });
  await check("swapping a mismatched pair is refused and changes nothing", () => { const f = parsed(); assert.throws(() => R.swapWithRefs(f, "program:INT-A", 0, "program:INT-B", 0), (e) => e.name === "PcgError"); assert.equal(sha(P.serializePcg(f)), sha(raw)); });
}
await check("a Set List snapshot round-trips both blocks", () => { const f = parsed(), a = L.getSetList(f, 2); assert.equal(a.entry.length, 69416); assert.equal(a.companion.length, 3612); L.copyEntry(f, "setlist:SET", 2, "setlist:SET", 9); assert.equal(L.getName(f, "setlist:SET", 9), L.getName(f, "setlist:SET", 2)); const was = L.getSetList(parsed(), 9); L.setSetList(f, 9, was); assert.equal(sha(P.serializePcg(f)), sha(raw)); assert.throws(() => L.setSetList(f, 9, { entry: new Uint8Array(4), companion: was.companion }), (e) => e.name === "PcgError"); });
const Y = await load("src/core/device/sync.ts"), C = await load("src/core/device/client.ts"), S = await load("src/core/device/simulator.ts");
const rig = () => { const file = parsed(), sim = new S.SimulatedKronos({ latencyMs: 0 }); Y.seedSimulator(sim, file); return { file, sim, client: new C.KronosClient(sim, { timeoutMs: 2000 }) }; };
const keysOf = (f) => L.listBanks(f).map((b) => b.key).sort();
await check("the keyboard's bank list is complete", () => {
  const k = Y.keyboardBanks(), of = (x) => k.filter((b) => b.key.startsWith(x + ":")); assert.equal(of("program").length, 20); assert.equal(of("combi").length, 14); assert.equal(of("drumkit").length, 15); assert.equal(of("waveseq").length, 15);
  for (const [key, bank, count] of [["program:INT-F", 5, 128], ["program:U-AA", 0x47, 128], ["program:U-GG", 0x4d, 128], ["combi:INT-G", 6, 128], ["combi:U-A", 0x40, 128], ["drumkit:INT", 0, 40], ["drumkit:U-GG", 0x4d, 16], ["waveseq:INT", 0, 150], ["waveseq:U-A", 0x40, 32]]) { const b = k.find((x) => x.key === key); assert.ok(b, key); assert.equal(b.sysexBank, bank, key); assert.equal(b.count, count, key); assert.ok(b.label, key); }
});
await check("one bank is pulled with no file, and only reads", async () => {
  const { file, sim, client } = rig(), sent = [], prog = [], real = sim.send.bind(sim); sim.send = (m) => { sent.push(m[4]); real(m); };
  const lib = await Y.pullBanks(client, ["program:U-A"], { onProgress: (d, t) => prog.push([d, t]) }); assert.deepEqual(keysOf(lib), ["program:U-A"]); assert.equal(L.listBanks(lib)[0].type, "hd1"); assert.deepEqual(P.verifyChecksums(lib), []);
  for (const i of [0, 5, 127]) { assert.equal(L.getName(lib, "program:U-A", i), L.getName(file, "program:U-A", i)); assert.equal(sha(L.getEntry(lib, "program:U-A", i).subarray(0, 3706)), sha(L.getEntry(file, "program:U-A", i).subarray(0, 3706))); }
  assert.equal(sent.length, 128, "extra requests"); assert.ok(sent.every((b) => b === 0x72), "something other than a read was sent"); assert.deepEqual(prog.at(-1), [128, 128]); assert.deepEqual(keysOf(P.parsePcg(P.serializePcg(lib))), ["program:U-A"]);
});
await check("pulling into a library keeps its other banks and replaces that one", async () => {
  const { file, client } = rig(), lib = await Y.pullBanks(client, ["program:U-A"]); L.setName(lib, "program:U-A", 1, "Local");
  const two = await Y.pullBanks(client, ["combi:INT-B"], {}, lib); assert.deepEqual(keysOf(two), ["combi:INT-B", "program:U-A"]); assert.equal(L.getName(two, "program:U-A", 1), "Local"); assert.deepEqual(keysOf(lib), ["program:U-A"], "the old library was changed");
  const again = await Y.pullBanks(client, ["program:U-A"], {}, two); assert.deepEqual(keysOf(again), ["combi:INT-B", "program:U-A"]); assert.equal(L.getName(again, "program:U-A", 1), L.getName(file, "program:U-A", 1)); assert.equal(L.getName(again, "combi:INT-B", 3), L.getName(file, "combi:INT-B", 3)); assert.deepEqual(P.verifyChecksums(again), []);
  assert.deepEqual(L.listBanks(two).map((b) => b.kind), ["program", "combi"], "banks out of order");
});
await check("a missing bank, a cancel or a bad name leaves the library alone", async () => {
  const { client } = rig(), lib = await Y.pullBanks(client, ["program:U-A"]), before = sha(P.serializePcg(lib));
  await assert.rejects(Y.pullBanks(client, ["program:U-G"], {}, lib), (e) => e.name === "KronosError" && e.code === 4); const ac = new AbortController();
  await assert.rejects(Y.pullBanks(client, ["combi:INT-A"], { signal: ac.signal, onProgress: (d) => { if (d === 10) ac.abort(); } }, lib), (e) => e.name === "AbortError"); await assert.rejects(Y.pullBanks(client, ["program:NOPE"], {}, lib), (e) => e.name === "PcgError"); assert.equal(sha(P.serializePcg(lib)), before);
});
await check("unit tests and type check pass", () => {
  const tests = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("src", f)); assert.ok(tests.some((f) => /refs\.test\.ts$/.test(f)), "src/core/pcg/refs.test.ts is missing");
  let r = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1000));
  r = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", root], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 1000));
});
if (fails.length) await finish();

const b = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", shell: true }); if (b.status !== 0) { fails.push(`build failed: ${(b.stdout + b.stderr).slice(-1000)}`); await finish(); }
const { _electron: electron } = createRequire(path.join(root, "package.json"))("playwright-core");
const tmp = mkdtempSync(path.join(os.tmpdir(), "kronos-lib-")), OPEN = path.join(tmp, "work.PCG"), SAVE = path.join(tmp, "saved.PCG"); copyFileSync(FACTORY, OPEN); mkdirSync(path.join(tmp, "b"));
const APPDATA = path.join(tmp, "appdata"); mkdirSync(APPDATA); themeSettings(APPDATA);
try { app = await electron.launch({ args: [root], cwd: root, timeout: 60000, env: { ...process.env, APPDATA, ELECTRON_RUN_AS_NODE: undefined, KRONOS_E2E: "1", KRONOS_E2E_BARE_SIM: "1", KRONOS_E2E_OPEN: OPEN, KRONOS_E2E_SAVE: SAVE, KRONOS_E2E_BACKUP_DIR: path.join(tmp, "b") } }); } catch (e) { fails.push(`app did not launch: ${e.message}`); await finish(); }
const win = await app.firstWindow(), errors = []; win.on("pageerror", (e) => errors.push(e.message)); win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const X = byTestId(win), seen = (id, timeout = 20000) => X(id).waitFor({ state: "visible", timeout }), text = async (id) => ((await X(id).textContent()) ?? "").trim();
const until = async (fn, what, timeout = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await fn()) return; await new Promise((r) => setTimeout(r, 60)); } throw new Error(`timed out: ${what}`); };
const openBank = async (k) => { await X(`bank-${k}`).click(); await seen("row-name-0"); };
const ok = async () => { await seen("confirm-ok"); await X("confirm-ok").click(); await X("confirm-ok").waitFor({ state: "hidden", timeout: 20000 }); };
let n = 0; const saved = async () => { n++; const prev = (() => { try { return sha(readFileSync(SAVE)); } catch { return ""; } })(); await X("save-as").click(); await until(async () => { try { const b = readFileSync(SAVE); return sha(b) !== prev && P.verifyChecksums(P.parsePcg(new Uint8Array(b))).length === 0; } catch { return false; } }, `save ${n}`, 40000); return new Uint8Array(readFileSync(SAVE)); };
const undoAndCheckClean = async () => { await X("undo").click(); await new Promise((r) => setTimeout(r, 300)); const prev = n; await X("save-as").click(); n = prev; await until(async () => { try { return sha(readFileSync(SAVE)) === sha(raw); } catch { return false; } }, "file back to the original after undo", 40000); };

await X("open-file").waitFor({ timeout: 20000 });
const bankCount = () => win.locator('[data-testid^="bank-"]').count(), factory = parsed();
await check("with no file open, one bank comes straight from the keyboard", async () => {
  await X("connect-sim").click(); await until(async () => /simulated/i.test(await text("device-status")), "simulator"); assert.equal(await X("pull-bank").isDisabled(), true);
  await X("pull-target").selectOption("program:U-A"); await X("pull-target-go").click(); await until(async () => /pulled/i.test(await text("file-name")), "pulled", 60000); await seen("bank-program:U-A"); assert.equal(await bankCount(), 1); assert.equal(await text("row-name-0"), L.getName(factory, "program:U-A", 0));
});
await check("a second bank joins it, and the library saves", async () => {
  await X("pull-target").selectOption("combi:INT-B"); await X("pull-target-go").click(); await seen("bank-combi:INT-B", 60000); assert.equal(await bankCount(), 2); await X("save-file").click(); await until(async () => { try { const f = P.parsePcg(new Uint8Array(readFileSync(SAVE))); return L.listBanks(f).length === 2 && P.verifyChecksums(f).length === 0; } catch { return false; } }, "saved two banks", 30000);
  await X("pull-target").selectOption("drumkit:INT"); await X("pull-target-go").click(); await seen("bank-drumkit:INT", 60000); assert.equal(await bankCount(), 3, "a saved pulled library must still accept more banks");
});
await check("a bank the keyboard doesn't have shows an error and keeps the library", async () => { await X("pull-target").selectOption("program:U-G"); await X("pull-target-go").click(); await seen("error-message", 30000); assert.equal(await bankCount(), 3); });
await check("edits to a freshly pulled bank still warn before being discarded", async () => {
  await openBank("drumkit:INT"); await X("row-0").dblclick(); await X("rename-input").fill("Edited Kit"); await X("rename-input").press("Enter"); await until(async () => (await text("changes-count")) === "1", "change listed");
  await X("open-file").click(); await seen("confirm-message"); assert.match(await text("confirm-message"), /discard/i); await X("confirm-cancel").click(); await X("confirm-cancel").waitFor({ state: "hidden", timeout: 10000 });
  await X("undo").click(); await until(async () => (await text("changes-count")) === "0", "undone");
});
await X("open-file").click(); await seen("bank-program:INT-A", 30000); await until(async () => (await bankCount()) === 31, "factory file open");
const [top, topUsers] = ranked.find(([to]) => to.startsWith("program:")), [topK, topI] = top.split("/"), holders = [...topUsers].sort();
await check("Used By lists every user of the selected slot", async () => { await openBank(topK); await X(`row-${topI}`).click(); await seen("used-by-count"); assert.equal(await text("used-by-count"), String(topUsers.size)); await seen("used-by-item-0"); });
await check("clicking a user goes to it", async () => { const t = (await text("used-by-item-0")); assert.ok(t.length > 0); const before = await X("used-by-item-0").getAttribute("data-target"); assert.ok(before, "no data-target"); const [k, i] = before.split("/"); await X("used-by-item-0").click(); await until(async () => (await X(`row-${i}`).getAttribute("aria-selected")) === "true", "target selected"); assert.ok(holders.some((h) => h.split("|")[1] === k && h.split("|")[2] === i)); });
const [pa, pb] = pickPair(true), [ka, ia] = pa.split("/"), [, ib] = pb.split("/");
const selectPair = async () => { await openBank(ka); await X(`row-${ia}`).click(); await X(`row-${ib}`).click({ modifiers: ["Control"] }); await X("swap").click(); await seen("confirm-message"); };
await check("swap updates users by default, and the saved file proves it", async () => { await selectPair(); assert.equal(await X("swap-update-refs").isChecked(), true); await ok(); const f = P.parsePcg(await saved()); sameMap(decodeUsers(f), expectAfter(users0, pa, pb), "users"); });
await check("undo puts every touched slot back, byte for byte", async () => { await undoAndCheckClean(); });
await check("swap can leave users alone", async () => { await selectPair(); await X("swap-update-refs").uncheck(); await ok(); const f = P.parsePcg(await saved()); const stay = new Map(); for (const [to, set] of users0) stay.set(to, new Set([...set].map((h) => relabel(h, ka, +ia, ka, +ib)))); sameMap(decodeUsers(f), stay, "users"); await undoAndCheckClean(); });
await check("set lists can be copied and undone", async () => {
  await openBank("setlist:SET"); const name2 = await text("row-name-2"); await X("row-2").click(); await X("copy").click(); await X("row-9").click(); await X("paste").click(); await ok(); await until(async () => (await text("row-name-9")) === name2, "pasted");
  const bytes = await saved(), f = P.parsePcg(bytes); assert.equal(sha(L.getEntry(f, "setlist:SET", 9)), sha(L.getEntry(f, "setlist:SET", 2))); assert.equal(sha(bytes.subarray(132 + 9 * 3612, 132 + 10 * 3612)), sha(bytes.subarray(132 + 2 * 3612, 132 + 3 * 3612)), "the companion block is out of step"); await undoAndCheckClean();
});
await check("set lists can be swapped and undone", async () => { await openBank("setlist:SET"); const a = await text("row-name-3"), c = await text("row-name-4"); await X("row-3").click(); await X("row-4").click({ modifiers: ["Control"] }); await X("swap").click(); await ok(); await until(async () => (await text("row-name-3")) === c && (await text("row-name-4")) === a, "swapped"); await undoAndCheckClean(); });
await check("the editor shows modulation sources by name", async () => {
  const f = parsed(), e = L.getEntry(f, "program:INT-B", 5), r = T.programHd1.find((x) => x.list === "HD-1 AMS Sources" && Q.isEditable(x) && Q.readParam(e, x) >= x.rawMin && Q.readParam(e, x) <= x.rawMax), k = `${r.ofs}.${r.bitLo ?? 0}`;
  await openBank("program:INT-B"); await X("row-5").click(); await X("edit-params").click(); await seen("editor-title"); await X(`group-${r.group}`).click(); await seen(`value-${k}`); assert.equal(await text(`value-${k}`), T.valueLists["HD-1 AMS Sources"][Q.readParam(e, r)]); await X("close-editor").click();
});
await check("a real file refuses a bank it doesn't contain", async () => { await X("connect-sim").click(); await until(async () => /simulated/i.test(await text("device-status")), "simulator"); await X("pull-target").selectOption("program:U-G"); await X("pull-target-go").click(); await seen("error-message", 20000); assert.match(await text("error-message"), /U-G/); assert.equal(await bankCount(), 31); assert.equal((await text("file-name")).toLowerCase().includes("pulled"), false); });
await check("no errors in the console", async () => { assert.deepEqual(errors.filter((e) => !/Electron Security Warning|Autofill|DevTools/i.test(e)), []); });
try { spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"]); app = null; await new Promise((r) => setTimeout(r, 1000)); rmSync(tmp, { recursive: true, force: true }); } catch {}
await finish();
