// Acceptance gate for moving banks between a Kronos and the library, using the simulator seeded from KORG's real file.
// Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fails = [];
const check = async (name, fn) => {
  try { await fn(); console.log("ok  ", name); }
  catch (e) { fails.push(`${name}: ${String(e.message).split("\n").slice(0, 6).join(" ")}`); console.log("FAIL", name); }
};
const finish = () => { console.log(fails.length ? `\nSYNC FAIL (${fails.length})\n- ${fails.join("\n- ")}` : "\nSYNC PASS"); process.exit(fails.length ? 1 : 0); };
const load = (p) => import(pathToFileURL(path.join(root, p)).href);

let P, L, C, S, Y, H;
try {
  P = await load("src/core/pcg/pcg.ts"); L = await load("src/core/pcg/library.ts"); C = await load("src/core/device/client.ts");
  S = await load("src/core/device/simulator.ts"); Y = await load("src/core/device/sync.ts"); H = await load("src/core/sysex/sha1.ts");
} catch (e) { fails.push(`cannot load modules: ${e.message}`); finish(); }

const orig = new Uint8Array(readFileSync(path.join(root, "research/korg-factory/pcg/PRELOAD_KRONOSX.PCG")));
const sha = (a) => createHash("sha256").update(a).digest("hex");
const fresh = () => P.parsePcg(orig);
const rig = () => { const file = fresh(), sim = new S.SimulatedKronos({ latencyMs: 0 }); Y.seedSimulator(sim, file); return { file, sim, client: new C.KronosClient(sim, { timeoutMs: 2000 }) }; };
const bank = (f, key) => L.listBanks(f).find((b) => b.key === key);
const OBJ = { program: 0, combi: 1, drumkit: 4, waveseq: 5 };

await check("sha1 matches a reference implementation", () => {
  assert.equal(Buffer.from(H.sha1(new TextEncoder().encode("abc"))).toString("hex"), "a9993e364706816aba3e25717850c26c9cd0d89d");
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 1000]) { const d = randomBytes(n); assert.equal(Buffer.from(H.sha1(new Uint8Array(d))).toString("hex"), createHash("sha1").update(d).digest("hex"), `n=${n}`); }
});
await check("src/core no longer imports any node: module outside tests", () => {
  const offenders = readdirSync(path.join(root, "src/core"), { recursive: true }).map(String).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).filter((f) => !/backup[\\/]manifest\.ts$/.test(f)).filter((f) => /from\s+["']node:/.test(readFileSync(path.join(root, "src/core", f), "utf8")));
  assert.deepEqual(offenders, []);
});
await check("BankInfo reports object version and over-the-wire size", () => {
  const f = fresh();
  for (const [k, v, s] of [["program:INT-A", 5, 4960], ["program:INT-B", 5, 3706], ["combi:INT-A", 3, 7810], ["drumkit:INT", 3, 38424], ["waveseq:INT", 1, 2216], ["setlist:SET", 0, 69416]]) { const b = bank(f, k); assert.equal(b.version, v, `${k} version`); assert.equal(b.objectSize, s, `${k} objectSize`); }
});
await check("seedSimulator loads every object with the right address, version and size", () => {
  const { file, sim } = rig();
  for (const [k, i] of [["program:INT-A", 0], ["program:INT-B", 5], ["program:U-A", 127], ["combi:INT-C", 3], ["drumkit:INT", 39], ["waveseq:INT", 149]]) {
    const b = bank(file, k); const got = sim.storedObject(OBJ[b.kind], b.sysexBank, i); assert.ok(got, `${k} ${i} missing`);
    assert.equal(got.version, b.version, k); assert.equal(got.data.length, b.objectSize, k); assert.equal(sha(got.data), sha(L.getEntry(file, k, i).subarray(0, b.objectSize)), k);
  }
});
await check("pullBank restores a bank from the keyboard", async () => {
  const { file, client } = rig(); L.setName(file, "program:U-A", 7, "Local Edit"); const want = L.getName(fresh(), "program:U-A", 7);
  await Y.pullBank(client, file, "program:U-A"); assert.equal(L.getName(file, "program:U-A", 7), want); assert.deepEqual(P.verifyChecksums(file), []);
});
await check("pullBank leaves undocumented bytes past the object size alone", async () => {
  const { file, client } = rig(); const b = bank(file, "program:U-A"), e = L.getEntry(file, b.key, 2); e.fill(0x5a, 3706); L.setEntry(file, b.key, 2, e);
  await Y.pullBank(client, file, b.key); const after = L.getEntry(file, b.key, 2); assert.ok(after.subarray(3706).every((x) => x === 0x5a), "bytes past 3706 were changed");
});
await check("progress reports reach the total", async () => {
  const { file, client } = rig(); const seen = []; await Y.pullBank(client, file, "combi:INT-A", { onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(seen.at(-1), [128, 128]); assert.ok(seen.length >= 2);
});
await check("a failed pull changes nothing and reports the keyboard's error", async () => {
  const file = fresh(), sim = new S.SimulatedKronos({ latencyMs: 0 }), client = new C.KronosClient(sim, { timeoutMs: 2000 });
  const b = bank(file, "combi:INT-B"); for (let i = 0; i < 60; i++) sim.seedObject(OBJ.combi, b.sysexBank, i, 3, L.getEntry(file, b.key, 127));
  const before = sha(P.serializePcg(file)); await assert.rejects(Y.pullBank(client, file, b.key), (e) => e.name === "KronosError" && e.code === 4); assert.equal(sha(P.serializePcg(file)), before);
});
await check("cancelling a pull stops it and changes nothing", async () => {
  const { file, client } = rig(); L.setName(file, "combi:INT-C", 0, "Keep Me"); const before = sha(P.serializePcg(file)); const ac = new AbortController();
  await assert.rejects(Y.pullBank(client, file, "combi:INT-C", { signal: ac.signal, onProgress: (d) => { if (d === 10) ac.abort(); } }), (e) => e.name === "AbortError"); assert.equal(sha(P.serializePcg(file)), before);
});
await check("pushEntries sends only the chosen slots, and only to temporary memory", async () => {
  const { file, sim, client } = rig(); const sent = []; const real = sim.send.bind(sim); sim.send = (m) => { sent.push(m[4]); real(m); };
  L.setName(file, "program:U-A", 1, "Pushed One"); L.setName(file, "program:U-A", 2, "Pushed Two"); L.setName(file, "program:U-A", 3, "Not Sent");
  const b = bank(file, "program:U-A"); const stored = sha(sim.storedObject(0, b.sysexBank, 1).data);
  await Y.pushEntries(client, file, b.key, [1, 2]);
  assert.deepEqual(sent, [0x73, 0x73], "expected exactly two Object Dumps and no Store");
  assert.equal(sha(sim.storedObject(0, b.sysexBank, 1).data), stored, "stored memory changed without Store");
  const got = await client.requestObject(0, b.sysexBank, 1); assert.equal(got.data.length, b.objectSize); assert.equal(Buffer.from(got.data.subarray(0, 10)).toString("latin1"), "Pushed One");
  assert.equal(Buffer.from((await client.requestObject(0, b.sysexBank, 3)).data.subarray(0, 8)).toString("latin1") === "Not Sent", false, "slot 3 was sent");
});
await check("storeBank makes pushes permanent", async () => {
  const { file, sim, client } = rig(); L.setName(file, "combi:INT-D", 4, "Stored Combi"); await Y.pushEntries(client, file, "combi:INT-D", [4]); await Y.storeBank(client, file, "combi:INT-D"); sim.powerCycle();
  assert.equal(Buffer.from((await client.requestObject(1, bank(file, "combi:INT-D").sysexBank, 4)).data.subarray(0, 12)).toString("latin1"), "Stored Combi");
});
await check("set lists are refused over USB for now", async () => {
  const { file, client } = rig(); for (const p of [Y.pullBank(client, file, "setlist:SET"), Y.pushEntries(client, file, "setlist:SET", [0]), Y.storeBank(client, file, "setlist:SET")]) await assert.rejects(p, (e) => e.name === "PcgError");
});
await check("pullKeyboard builds a whole library from the keyboard alone", async () => {
  const { file, client } = rig(); const seen = []; const pulled = await Y.pullKeyboard(client, { onProgress: (d, t) => seen.push([d, t]) });
  const wantKeys = L.listBanks(file).filter((b) => b.kind !== "setlist").map((b) => b.key).sort(), gotKeys = L.listBanks(pulled).map((b) => b.key).sort(); assert.deepEqual(gotKeys, wantKeys);
  assert.deepEqual(P.verifyChecksums(pulled), []);
  for (const [k, i] of [["program:INT-A", 0], ["program:INT-F", 77], ["program:U-AA", 12], ["combi:INT-F", 0], ["drumkit:U-B", 3], ["waveseq:U-F", 9]]) { const a = bank(file, k), b = bank(pulled, k); assert.equal(b.type, a.type, `${k} type`); assert.equal(b.count, a.count, `${k} count`); assert.equal(L.getName(pulled, k, i), L.getName(file, k, i), `${k} ${i}`); assert.equal(sha(L.getEntry(pulled, k, i).subarray(0, a.objectSize)), sha(L.getEntry(file, k, i).subarray(0, a.objectSize)), `${k} ${i}`); }
  assert.equal(seen.at(-1)[0], seen.at(-1)[1], "final progress should equal the total");
  const again = P.parsePcg(P.serializePcg(pulled)); assert.equal(L.listBanks(again).length, gotKeys.length, "the pulled library must survive a save and reload");
});
await check("builder's tests pass, type check is clean, earlier gates still pass", () => {
  const all = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("src", f));
  assert.ok(all.some((f) => /sync\.test\.ts$/.test(f)), "src/core/device/sync.test.ts is missing");
  let r = spawnSync(process.execPath, ["--test", ...all], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1000));
  r = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", root], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 1000));
  r = spawnSync(process.execPath, ["tools/gate-pcg.mjs"], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, r.stdout.slice(-800));
});
finish();
