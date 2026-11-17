// Acceptance gate for complete backups. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, load, PCG_DIR, sha, testsAndTypes } from "./gate-kit.mjs";

const g = gate("BACKUP"), { check, finish } = g, C = await core(g), { P, L, raw, parsed } = C;
const [Y, K, S] = await Promise.all([load("src/core/device/sync.ts"), load("src/core/device/client.ts"), load("src/core/device/simulator.ts")]);
const read = (n) => new Uint8Array(readFileSync(path.join(PCG_DIR, n)));
const rig = () => { const file = parsed(), sim = new S.SimulatedKronos({ latencyMs: 0 }); Y.seedSimulator(sim, file); return { file, sim, client: new K.KronosClient(sim, { timeoutMs: 2000 }) }; };
const blob = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);
const EXTRA = [[6, 0, 0, 1, blob(90, 1)], [6, 0, 1, 1, blob(90, 2)], [7, 1, 0, 2, blob(40, 3)], [0x0e, 0, 0, 1, blob(64, 4)], [0x18, 0, 0, 3, blob(200, 5)]];
const topTags = (b) => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = []; for (let o = 28; o + 12 <= b.length; o += 12 + v.getUint32(o + 4)) out.push(String.fromCharCode(...b.subarray(o, o + 4))); return out; };

await check("the bank map block is rebuilt exactly as KORG writes it", () => { for (const n of ["PRELOAD_KRONOSX.PCG", "PRELOAD.PCG", "EXs2 Concert Grand.PCG"]) { const b = read(n); assert.equal(Buffer.from(Y.buildDiv1(L.listBanks(P.parsePcg(b)))).toString("hex"), Buffer.from(b.subarray(40, 84)).toString("hex"), n); } });
await check("the Set List companion is rebuilt exactly as KORG writes it", () => { const f = parsed(); for (let i = 0; i < 128; i++) { const s = L.getSetList(f, i); assert.equal(sha(Y.buildSetListCompanion(s.entry)), sha(s.companion), `set ${i}`); } });
let full;
await check("a complete pull brings back every bank, Set List and Global", async () => {
  const { file, sim, client } = rig(), prog = []; for (const e of EXTRA) sim.seedObject(...e); full = await Y.pullFull(client, { onProgress: (d, t) => prog.push([d, t]) });
  const lib = full.pcg; assert.deepEqual(P.verifyChecksums(lib), []); assert.deepEqual(L.listBanks(lib).map((b) => b.key).sort(), L.listBanks(file).map((b) => b.key).sort());
  for (const b of L.listBanks(file)) for (let i = 0; i < b.count; i += b.kind === "setlist" ? 1 : 17) assert.equal(sha(L.getEntry(lib, b.key, i).subarray(0, b.objectSize)), sha(L.getEntry(file, b.key, i).subarray(0, b.objectSize)), `${b.key}/${i}`);
  assert.equal(sha(L.getGlobal(lib)), sha(L.getGlobal(file))); assert.deepEqual(prog.at(-1)[0], prog.at(-1)[1]); assert.ok(prog.length > 1000);
});
await check("the file has KORG's structure, bank map and companion", () => { const out = P.serializePcg(full.pcg); assert.deepEqual(topTags(out), ["DIV1", "SLS1", "PRG1", "CMB1", "DKT1", "WSQ1", "GLB1"]); assert.equal(sha(out.subarray(40, 84)), sha(raw.subarray(40, 84)), "bank map differs"); assert.equal(sha(out.subarray(132, 132 + 128 * 3612)), sha(raw.subarray(132, 132 + 128 * 3612)), "Set List companion differs"); assert.deepEqual(L.listBanks(P.parsePcg(out)).length, 31); });
await check("KARMA, patterns and songs come back exactly", () => { for (const [obj, bank, index, version, data] of EXTRA) { const o = full.objects.find((x) => x.obj === obj && x.bank === bank && x.index === index); assert.ok(o, `missing ${obj}/${bank}/${index}`); assert.equal(o.version, version); assert.equal(sha(o.data), sha(data)); } assert.ok(!full.objects.some((x) => [0, 1, 3, 4, 5, 0x0d].includes(x.obj)), "objects already in the .PCG were duplicated"); });
await check("the report says what isn't included", () => { assert.ok(full.report.notIncluded.some((s) => /sample/i.test(s))); assert.deepEqual(full.report.failed, []); });
await check("only reads are sent", async () => { const { sim, client } = rig(), sent = new Set(), real = sim.send.bind(sim); sim.send = (m) => { sent.add(m[4]); real(m); }; await Y.pullFull(client); assert.deepEqual([...sent], [0x72]); });
await check("an optional object failing is reported, not fatal", async () => { const { client } = rig(), real = client.requestObject.bind(client); client.requestObject = (o, b, i) => (o === 6 ? Promise.reject(new K.KronosError(2)) : real(o, b, i)); const r = await Y.pullFull(client); assert.equal(L.listBanks(r.pcg).length, 31); assert.ok(r.report.failed.some((x) => /karma/i.test(x)), JSON.stringify(r.report.failed)); });
await check("a required object failing stops the backup", async () => { const { client } = rig(), real = client.requestObject.bind(client); client.requestObject = (o, b, i) => (o === 3 ? Promise.reject(new K.KronosError(2)) : real(o, b, i)); await assert.rejects(Y.pullFull(client), (e) => e.name === "KronosError"); });
await check("it can be cancelled", async () => { const { client } = rig(), ac = new AbortController(); await assert.rejects(Y.pullFull(client, { signal: ac.signal, onProgress: (d) => { if (d === 20) ac.abort(); } }), (e) => e.name === "AbortError"); });
await testsAndTypes(g, ["core/device/backup.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C), { X, seen, text, until, BACKUPS } = ui;
await ui.openFile();
await check("Full Backup writes a complete folder and leaves the library alone", async () => {
  await ui.connectSim(); const name = await text("file-name"); await X("full-backup").click(); await until(async () => /done|saved|complete/i.test(await text("backup-status")), "backup finished", 400000);
  const dir = readdirSync(BACKUPS).find((d) => /^Kronos Backup /.test(d)); assert.ok(dir, `no backup folder in ${readdirSync(BACKUPS)}`); const root = path.join(BACKUPS, dir), man = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")), pcg = new Uint8Array(readFileSync(path.join(root, man.pcg.file)));
  assert.equal(sha(pcg), man.pcg.sha256); assert.equal(pcg.length, man.pcg.size); const f = P.parsePcg(pcg); assert.deepEqual(P.verifyChecksums(f), []); assert.equal(L.listBanks(f).length, 31); assert.equal(man.banks.length, 31); assert.match(man.os, /3\.1\.2/); assert.ok(man.notIncluded.some((s) => /sample/i.test(s))); assert.ok(Array.isArray(man.objects)); for (const o of man.objects) { const p = path.join(root, o.file); assert.ok(existsSync(p), o.file); assert.equal(sha(readFileSync(p)), o.sha256); }
  assert.equal(await text("file-name"), name, "the open library changed"); assert.equal(await text("changes-count"), "0");
});
await check("Full Backup needs a connection", async () => { await X("disconnect").click(); await until(async () => X("full-backup").isDisabled(), "disabled"); });
await ui.noErrors();
await finish();
