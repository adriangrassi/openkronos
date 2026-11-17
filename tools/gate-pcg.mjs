// Acceptance gate for the .PCG layer, run against KORG's real factory files. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const DIR = path.join(root, "research/korg-factory/pcg");
const FULL = "PRELOAD_KRONOSX.PCG";
const FILES = [FULL, "PRELOAD.PCG", "KRS-06.PCG", "EXs2 Concert Grand.PCG"];
const fails = [];
const check = async (name, fn) => {
  try { await fn(); console.log("ok  ", name); }
  catch (e) { fails.push(`${name}: ${e.message.split("\n").slice(0, 6).join(" ")}`); console.log("FAIL", name); }
};
const finish = () => { console.log(fails.length ? `\nPCG FAIL (${fails.length})\n- ${fails.join("\n- ")}` : "\nPCG PASS"); process.exit(fails.length ? 1 : 0); };
const load = (p) => import(pathToFileURL(path.join(root, p)).href);

let P, L;
try { P = await load("src/core/pcg/pcg.ts"); L = await load("src/core/pcg/library.ts"); }
catch (e) { fails.push(`cannot load pcg modules: ${e.message}`); finish(); }

const read = (n) => new Uint8Array(readFileSync(path.join(DIR, n)));
const sha = (a) => createHash("sha256").update(a).digest("hex");
const orig = read(FULL);
const fresh = () => P.parsePcg(orig);
const diffRanges = (a, b) => { assert.equal(a.length, b.length, "file length changed"); const r = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) r.push(i); return r; };
const bankOf = (f, key) => { const b = L.listBanks(f).find((x) => x.key === key); assert.ok(b, `no bank ${key}; have ${L.listBanks(f).map((x) => x.key).join(", ")}`); return b; };
const isPcgErr = (e) => e.name === "PcgError";

// Locate a bank's first entry by a known file offset, independent of the builder's code.
const MBK1_AT = 9347764;   // first MBK1 block in PRELOAD_KRONOSX.PCG, so the check does not depend on the code under test
const nameAt = (name) => { const i = MBK1_AT + 24; assert.equal(Buffer.from(orig.subarray(i, i + name.length)).toString("latin1"), name); return i; };

for (const n of FILES) await check(`${n}: unmodified save is byte-identical`, () => assert.equal(sha(P.serializePcg(P.parsePcg(read(n)))), sha(read(n))));
for (const n of FILES) await check(`${n}: all checksums verify`, () => assert.deepEqual(P.verifyChecksums(P.parsePcg(read(n))), []));

await check("full file: bank inventory", () => {
  const b = L.listBanks(fresh()), count = (k) => b.filter((x) => x.kind === k).length;
  assert.equal(count("program"), 17); assert.equal(count("combi"), 6); assert.equal(count("drumkit"), 4); assert.equal(count("waveseq"), 3); assert.equal(count("setlist"), 1);
  assert.equal(b.length, 31, "SDB1 must not be listed as its own bank");
});
await check("bank sizes", () => {
  const f = fresh(); for (const [k, c, s] of [["program:INT-A", 128, 4960], ["combi:INT-A", 128, 7810], ["drumkit:INT", 40, 38424], ["waveseq:INT", 150, 2216], ["setlist:SET", 128, 69416]]) { const b = bankOf(f, k); assert.equal(b.count, c, k); assert.equal(b.entrySize, s, k); }
});
await check("bank labels, numbering and program type", () => {
  const f = fresh();
  for (const [k, id, sys, type] of [["program:INT-A", 0, 0, "exi"], ["program:INT-B", 1, 1, "hd1"], ["program:INT-F", 0x8000, 5, "hd1"], ["program:U-A", 0x20000, 0x40, "hd1"], ["program:U-B", 0x20001, 0x41, "exi"], ["program:U-AA", 0x20007, 0x47, "exi"], ["program:U-EE", 0x2000b, 0x4b, "hd1"]]) {
    const b = bankOf(f, k); assert.equal(b.id, id, `${k} id`); assert.equal(b.sysexBank, sys, `${k} sysexBank`); assert.equal(b.type, type, `${k} type`);
  }
  assert.equal(bankOf(f, "combi:INT-F").id, 5); assert.equal(bankOf(f, "combi:INT-A").type, null);
});
await check("names read correctly, including NUL-padded ones", () => {
  const f = fresh();
  for (const [k, i, n] of [["program:INT-A", 0, "KRONOS German Grand"], ["program:U-B", 0, "Dynamic FM Keys"], ["program:U-C", 0, "Perc Organ 1 SW1 V2"], ["combi:INT-A", 0, "The Era of Kronos"], ["combi:INT-F", 0, "Analog Surface"], ["drumkit:INT", 0, "Trance kit"], ["waveseq:INT", 0, "19 Orch/Band HITS"], ["setlist:SET", 0, "Preload Set List K3"]]) assert.equal(L.getName(f, k, i), n, `${k} ${i}`);
});
await check("a file holding only part of a keyboard lists just that part", () => { const b = L.listBanks(P.parsePcg(read("KRS-06.PCG"))); assert.equal(b.length, 1); assert.equal(b[0].key, "program:U-G"); assert.equal(b[0].sysexBank, 0x46); });
await check("an unknown chunk survives untouched", () => {
  const extra = Buffer.concat([Buffer.from("ZZZ9"), Buffer.from([0, 0, 0, 3]), Buffer.from([1, 2, 3, 4]), Buffer.from([9, 8, 7])]);
  const small = Buffer.from(read("EXs2 Concert Grand.PCG")); const out = Buffer.concat([small, extra]); out.writeUInt32BE(small.readUInt32BE(20) + extra.length, 20);
  assert.equal(sha(P.serializePcg(P.parsePcg(new Uint8Array(out)))), sha(out));
});

await check("rename: only the name bytes and that bank's checksum change", () => {
  const f = fresh(); L.setName(f, "program:INT-A", 0, "Test Name"); assert.equal(L.getName(f, "program:INT-A", 0), "Test Name");
  const out = P.serializePcg(f), at = nameAt("KRONOS German Grand"), d = diffRanges(orig, out);
  assert.ok(d.every((i) => (i >= at && i < at + 24) || i === at - 12 - 12 + 8 + 3), `changed outside the name and checksum: ${d.filter((i) => !(i >= at && i < at + 24)).slice(0, 8)}`);
  assert.equal(out[at + 9], 0, "the Kronos pads names with NUL"); assert.equal(out[at + 23], 0);
  assert.deepEqual(P.verifyChecksums(P.parsePcg(out)), []);
  const ours = L.getName(P.parsePcg(out), "program:INT-A", 0); assert.equal(ours, "Test Name");
});
await check("rename a 24-character name exactly", () => { const f = fresh(); L.setName(f, "combi:INT-A", 1, "ABCDEFGHIJKLMNOPQRSTUVWX"); assert.equal(L.getName(f, "combi:INT-A", 1), "ABCDEFGHIJKLMNOPQRSTUVWX"); });
await check("rename refuses bad names", () => {
  const f = fresh(); for (const n of ["", "ABCDEFGHIJKLMNOPQRSTUVWXY", "Café", "bad\tname"]) assert.throws(() => L.setName(f, "program:INT-A", 0, n), isPcgErr, JSON.stringify(n));
  assert.equal(sha(P.serializePcg(f)), sha(orig), "a refused rename changed the file");
});
await check("rename a set list keeps both copies of its name in step", () => {
  const f = fresh(); L.setName(f, "setlist:SET", 0, "Gig Set"); const out = P.serializePcg(f);
  assert.equal(L.getName(P.parsePcg(out), "setlist:SET", 0), "Gig Set"); assert.deepEqual(P.verifyChecksums(P.parsePcg(out)), []);
  const firstSeen = Buffer.from(out).indexOf(Buffer.from("Gig Set", "latin1")), second = Buffer.from(out).indexOf(Buffer.from("Gig Set", "latin1"), firstSeen + 1);
  assert.ok(firstSeen > 0 && second > firstSeen, "expected the name in both the SDB1 and SBK1 blocks");
  assert.equal(Buffer.from(out).indexOf(Buffer.from("Preload Set List K3", "latin1")), -1, "old name left behind");
});
await check("swap twice restores the file exactly", () => { const f = fresh(); L.swapEntries(f, "program:U-A", 3, "program:U-A", 9); const once = P.serializePcg(f); assert.notEqual(sha(once), sha(orig)); assert.deepEqual(P.verifyChecksums(P.parsePcg(once)), []); L.swapEntries(f, "program:U-A", 3, "program:U-A", 9); assert.equal(sha(P.serializePcg(f)), sha(orig)); });
await check("swap across two banks", () => { const f = fresh(); const a = L.getName(f, "combi:INT-A", 0), b = L.getName(f, "combi:INT-B", 5); L.swapEntries(f, "combi:INT-A", 0, "combi:INT-B", 5); assert.equal(L.getName(f, "combi:INT-A", 0), b); assert.equal(L.getName(f, "combi:INT-B", 5), a); assert.deepEqual(P.verifyChecksums(f), []); });
await check("copy duplicates the whole entry and leaves the source", () => {
  const f = fresh(); const src = Uint8Array.from(L.getEntry(f, "combi:INT-A", 2)); L.copyEntry(f, "combi:INT-A", 2, "combi:INT-C", 7);
  assert.equal(sha(L.getEntry(f, "combi:INT-C", 7)), sha(src)); assert.equal(sha(L.getEntry(f, "combi:INT-A", 2)), sha(src)); assert.deepEqual(P.verifyChecksums(f), []);
});
await check("getEntry returns a copy, not a window into the file", () => { const f = fresh(); const e = L.getEntry(f, "combi:INT-A", 0); e[0] = 0x7a; assert.equal(L.getName(f, "combi:INT-A", 0), "The Era of Kronos"); });
await check("setEntry validates length and updates the checksum", () => {
  const f = fresh(); assert.throws(() => L.setEntry(f, "combi:INT-A", 0, new Uint8Array(10)), isPcgErr);
  L.setEntry(f, "combi:INT-A", 0, L.getEntry(f, "combi:INT-A", 9)); assert.equal(L.getName(f, "combi:INT-A", 0), L.getName(f, "combi:INT-A", 9)); assert.deepEqual(P.verifyChecksums(f), []);
});
await check("copy refuses mismatched kinds and engine types", () => {
  const f = fresh();
  assert.throws(() => L.copyEntry(f, "combi:INT-A", 0, "program:INT-A", 0), isPcgErr, "combi into program");
  assert.throws(() => L.copyEntry(f, "program:INT-A", 0, "program:INT-B", 0), isPcgErr, "EXi into HD-1 bank");
  assert.throws(() => L.swapEntries(f, "program:INT-A", 0, "program:INT-B", 0), isPcgErr, "swap EXi with HD-1");
});
await check("bad bank key or index is refused", () => { const f = fresh(); for (const fn of [() => L.getName(f, "program:NOPE", 0), () => L.getName(f, "program:INT-A", 128), () => L.getName(f, "program:INT-A", -1), () => L.setName(f, "combi:INT-A", 1.5, "x")]) assert.throws(fn, isPcgErr); });

await check("verifyChecksums catches a corrupted byte", () => { const c = Uint8Array.from(orig); c[nameAt("KRONOS German Grand") + 2000] ^= 1; const bad = P.verifyChecksums(P.parsePcg(c)); assert.equal(bad.length, 1); assert.match(String(bad[0]), /MBK1/); });
await check("garbage and damaged files fail with PcgError, never a crash", () => {
  const small = read("EXs2 Concert Grand.PCG");
  const cases = { empty: new Uint8Array(0), short: small.subarray(0, 10), "wrong magic": Uint8Array.from(small).fill(0x41, 0, 4), truncated: small.subarray(0, small.length - 100), "cut mid-header": small.subarray(0, 22) };
  const huge = Buffer.from(small); huge.writeUInt32BE(0xfffffff0, 20); cases["size past end"] = new Uint8Array(huge);
  const inner = Buffer.from(small); inner.writeUInt32BE(0x7fffffff, 32); cases["inner size past end"] = new Uint8Array(inner);
  for (const [k, v] of Object.entries(cases)) assert.throws(() => P.parsePcg(v), isPcgErr, k);
});
await check("parsing does not mutate or alias the caller's buffer", () => { const c = Uint8Array.from(orig), h = sha(c); const f = P.parsePcg(c); L.setName(f, "program:INT-A", 0, "Changed"); assert.equal(sha(c), h); });

await check("builder's unit tests exist, pass, and ship no KORG data", () => {
  const found = readdirSync(path.join(root, "src/core/pcg")).filter((f) => f.endsWith(".test.ts"));
  assert.ok(found.length >= 2, `expected at least 2 test files in src/core/pcg, found ${found.length}`);
  const all = readdirSync(path.join(root, "src"), { recursive: true }).map(String).filter((f) => f.endsWith(".test.ts")).map((f) => path.join("src", f));
  const r = spawnSync(process.execPath, ["--test", ...all], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-1200));
  const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout; assert.ok(!/\.pcg$/im.test(tracked), "a .PCG file is tracked in git");
});
await check("TypeScript strict type check is clean", () => {
  const tsc = path.join(root, "node_modules/typescript/bin/tsc"); assert.ok(existsSync(tsc), "typescript not installed");
  const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", root], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, (r.stdout + r.stderr).slice(0, 1200));
});
await check("the core gate still passes", () => { const r = spawnSync(process.execPath, ["tools/gate-core.mjs"], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, r.stdout.slice(-800)); });
finish();
