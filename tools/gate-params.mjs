// Acceptance gate for the parameter tables. Row counts are computed here, independently of the builder's parser,
// and the parser is proven against KORG's real factory sounds. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(root, "research/korg-sysex/midiimp/MIDI implementation");
const fails = [];
const check = async (name, fn) => {
  try { const note = await fn(); console.log("ok  ", name, note ? `(${note})` : ""); }
  catch (e) { fails.push(`${name}: ${String(e.message).split("\n").slice(0, 6).join(" ")}`); console.log("FAIL", name); }
};
const finish = () => { console.log(fails.length ? `\nPARAMS FAIL (${fails.length})\n- ${fails.join("\n- ")}` : "\nPARAMS PASS"); process.exit(fails.length ? 1 : 0); };
const load = (p) => import(pathToFileURL(path.join(root, p)).href);

const gen = spawnSync(process.execPath, ["scripts/gen-params.ts"], { cwd: root, encoding: "utf8" });
if (gen.status !== 0) { fails.push(`scripts/gen-params.ts failed: ${(gen.stdout + gen.stderr).slice(-800)}`); finish(); }
const JSON_PATH = path.join(root, "src/generated/params.json");
if (!existsSync(JSON_PATH)) { fails.push("src/generated/params.json was not generated"); finish(); }
const T = JSON.parse(readFileSync(JSON_PATH, "utf8"));
let P, L, Q;
try { P = await load("src/core/pcg/pcg.ts"); L = await load("src/core/pcg/library.ts"); Q = await load("src/core/params/params.ts"); }
catch (e) { fails.push(`cannot load modules: ${e.message}`); finish(); }
const file = P.parsePcg(new Uint8Array(readFileSync(path.join(root, "research/korg-factory/pcg/PRELOAD_KRONOSX.PCG"))));
const banks = L.listBanks(file);
const entries = (kind, type) => banks.filter((b) => b.kind === kind && (type === undefined || b.type === type)).flatMap((b) => Array.from({ length: b.count }, (_, i) => L.getEntry(file, b.key, i)));

// A data row has a number or blank in OFS, and isn't the header or an undocumented "*" row.
const isRow = (l) => { if (!/^\|\s*\d*\s*\|/.test(l) || /^\|\s*\|\s*\|\s*\|/.test(l)) return false; const c = l.split("|").map((x) => x.trim()); return c[2] !== "*" && c[3] !== "*"; };
const rowsOf = (text) => text.split(/\r?\n/).filter(isRow).length;
const doc = (n) => readFileSync(path.join(DOCS, n), "latin1");
const sections = (() => { const out = {}; let cur = null; for (const l of doc("Prog_EXi.txt").split(/\r?\n/)) { const m = /^\d+:([A-Za-z0-9-]+)/.exec(l); if (m) { cur = m[1]; out[cur] = 0; } else if (cur && isRow(l)) out[cur]++; } return out; })();

for (const [key, f] of [["programHd1", "Prog_HD-1.txt"], ["programExiCommon", "Prog_EXi_Common.txt"], ["combi", "CombiAndSongTimbreSet.txt"], ["global", "Global.txt"], ["drumkit", "DrumKit.txt"], ["waveseq", "WaveSequence.txt"]])
  await check(`${key}: every documented row was parsed`, () => { const want = rowsOf(doc(f)); assert.equal(T[key]?.length, want, `${key} has ${T[key]?.length} rows; the document has ${want}`); return `${want} rows`; });
await check("every EXi engine section was parsed", () => { const names = Object.keys(sections).filter((n) => sections[n] > 0); assert.deepEqual(names.sort(), ["AL-1", "CX-3", "EP-1", "MOD-7", "MS-20EX", "PolysixEX", "SGX-2", "STR-1"]); for (const n of names) assert.equal(T.engines?.[n]?.length, sections[n], n); });

const row = (t, ofs, name) => { const r = t.find((x) => x.ofs === ofs && x.name === name); assert.ok(r, `no row at ${ofs} named ${name}`); return r; };
await check("sampled rows match the document exactly", () => {
  let r = row(T.programHd1, 88, "Effect Type"); assert.equal(r.group, "Insert Effect1"); assert.equal(r.rawMin, 0); assert.equal(r.rawMax, 0xb9); assert.equal(r.bitHi, null); assert.equal(r.typ, 7); assert.equal(r.soc, 0);
  r = row(T.programHd1, 89, "Channel"); assert.equal(r.bitHi, 5); assert.equal(r.bitLo, 0); assert.equal(r.fixed, true); assert.equal(r.rawMin, 0x10); assert.equal(r.rawMax, 0x10);
  r = row(T.programHd1, 89, "Switch"); assert.equal(r.bitHi, 6); assert.equal(r.bitLo, 6); assert.equal(r.rawMax, 1); assert.equal(r.pid, 0);
  r = row(T.programHd1, 92, "Panpot"); assert.equal(r.rawMax, 0x7f); assert.equal(r.valueText, "L000~R127");
  assert.equal(row(T.combi, 88, "Effect Type").typ, 24);
  assert.equal(row(T.combi, 89, "Channel").rawMax, 0x11);
  assert.equal(row(T.programHd1, 0, "Name").rawMax, 0xff);
});

const SIZE = { programHd1: 3706, programExiCommon: 4960, combi: 7810, global: 24708, drumkit: 38424, waveseq: 2216 };
await check("every parameter sits inside its object", () => { for (const [k, s] of Object.entries(SIZE)) for (const r of T[k]) { assert.ok(r.ofs >= 0 && r.ofs < s, `${k} ${r.name} at ${r.ofs}`); if (r.bitHi !== null) assert.ok(r.bitHi <= 7 && r.bitLo >= 0 && r.bitLo <= r.bitHi, `${k} ${r.name} bits`); assert.ok(r.rawMin <= r.rawMax, `${k} ${r.name} range`); } });

// A misplaced field reads values outside its documented range, so real data proves the parser.
const inRange = (table, objs, min, label) => { let good = 0, all = 0; const worst = new Map(); for (const o of objs) for (const r of table) { all++; const v = Q.readParam(o, r); if (v >= r.rawMin && v <= r.rawMax) good++; else worst.set(`${r.ofs}:${r.name}`, (worst.get(`${r.ofs}:${r.name}`) ?? 0) + 1); } const pct = (100 * good) / all; assert.ok(pct >= min, `${label}: only ${pct.toFixed(2)}% of values in range; worst ${[...worst].sort((a, b) => b[1] - a[1]).slice(0, 6)}`); return `${pct.toFixed(2)}% of ${all}`; };
await check("HD-1 programs read inside documented ranges", () => inRange(T.programHd1, entries("program", "hd1").map((e) => e.subarray(0, 3706)), 98, "hd1"));
await check("EXi common fields read inside documented ranges", () => inRange(T.programExiCommon, entries("program", "exi"), 98, "exi"));
await check("combis read inside documented ranges", () => inRange(T.combi, entries("combi"), 98, "combi"));
await check("drum kits read inside documented ranges", () => inRange(T.drumkit, entries("drumkit"), 98, "drumkit"));
await check("wave sequences read inside documented ranges", () => inRange(T.waveseq, entries("waveseq"), 98, "waveseq"));

await check("the two EXi engines are identified from the program data", () => {
  assert.deepEqual(Q.exiEngines(T, L.getEntry(file, "program:INT-A", 0))[0], "SGX-2"); assert.deepEqual(Q.exiEngines(T, L.getEntry(file, "program:U-C", 0))[0], "CX-3");
  const seen = new Set(), ok = new Set(["Off", "AL-1", "CX-3", "STR-1", "MS-20EX", "PolysixEX", "MOD-7", "SGX-2", "EP-1"]);
  for (const e of entries("program", "exi")) { const pair = Q.exiEngines(T, e); assert.equal(pair.length, 2); for (const n of pair) { assert.ok(ok.has(n), `unknown engine ${n}`); seen.add(n); } }
  for (const n of ok) if (n !== "Off") assert.ok(seen.has(n), `no factory program uses ${n}`);
  return [...seen].join(",");
});
await check("paramsFor gives each EXi program its own engines' fields, inside its 4960 bytes", () => {
  const e = L.getEntry(file, "program:U-C", 0), rows = Q.paramsFor(T, "exi", e); assert.ok(rows.length > T.programExiCommon.length, "engine rows are missing");
  for (const r of rows) assert.ok(r.ofs >= 0 && r.ofs < 4960, `${r.name} at ${r.ofs}`); assert.ok(rows.some((r) => /CX-3|EXi ?1/.test(r.group)), "no row is labelled with its engine");
  assert.equal(Q.paramsFor(T, "hd1", L.getEntry(file, "program:INT-B", 0)).length, T.programHd1.length);
});
await check("engine fields read inside documented ranges", () => { let good = 0, all = 0; for (const e of entries("program", "exi").filter((_, i) => i % 8 === 0)) for (const r of Q.paramsFor(T, "exi", e)) { all++; const v = Q.readParam(e, r); if (v >= r.rawMin && v <= r.rawMax) good++; } const pct = (100 * good) / all; assert.ok(pct >= 97, `only ${pct.toFixed(2)}%`); return `${pct.toFixed(2)}% of ${all}`; });

await check("writing back a value changes no byte, on every field", () => { for (const [t, o] of [[T.programHd1, entries("program", "hd1")[30].subarray(0, 3706)], [T.combi, entries("combi")[30]], [T.drumkit, entries("drumkit")[3]], [T.waveseq, entries("waveseq")[3]]]) { const c = Uint8Array.from(o); for (const r of t) Q.writeParam(c, r, Q.readParam(c, r)); assert.deepEqual(Buffer.from(c), Buffer.from(o)); } });
await check("writing a field changes only that field's bits", () => {
  const o = Uint8Array.from(entries("program", "hd1")[0].subarray(0, 3706)), sw = row(T.programHd1, 89, "Switch"), ch = row(T.programHd1, 89, "Channel"); const a = Q.readParam(o, ch), s = Q.readParam(o, sw);
  Q.writeParam(o, sw, s ? 0 : 1); assert.equal(Q.readParam(o, sw), s ? 0 : 1); assert.equal(Q.readParam(o, ch), a, "neighbouring bits changed");
  const before = Uint8Array.from(o); const pan = row(T.programHd1, 92, "Panpot"); Q.writeParam(o, pan, 64); assert.equal(o[92], 64); assert.deepEqual(Buffer.from(o.subarray(0, 92)), Buffer.from(before.subarray(0, 92))); assert.deepEqual(Buffer.from(o.subarray(93)), Buffer.from(before.subarray(93)));
});
await check("writing out of range is refused", () => { const o = new Uint8Array(3706), r = row(T.programHd1, 89, "Switch"); assert.throws(() => Q.writeParam(o, r, 2), RangeError); assert.throws(() => Q.writeParam(o, r, -1), RangeError); assert.throws(() => Q.writeParam(o, r, 0.5), RangeError); assert.deepEqual(Buffer.from(o), Buffer.alloc(3706)); });
await check("fixed fields can't be edited", () => { const o = new Uint8Array(3706); o[89] = 0x10; const r = row(T.programHd1, 89, "Channel"); assert.equal(Q.isEditable(r), false); assert.equal(Q.isEditable(row(T.programHd1, 92, "Panpot")), true); });
await check("values are shown the way KORG writes them", () => {
  const pan = row(T.programHd1, 92, "Panpot"), sw = row(T.programHd1, 89, "Switch");
  assert.equal(Q.formatValue(pan, 0), "L000"); assert.equal(Q.formatValue(pan, 0x7f), "R127"); assert.equal(Q.formatValue(sw, 0), "Off"); assert.equal(Q.formatValue(sw, 1), "On");
  const n = T.programHd1.find((r) => /^-?\d+~-?\d+$/.test(r.valueText) && r.rawMax > r.rawMin + 1); const [a, b] = n.valueText.split("~").map(Number); assert.equal(Q.formatValue(n, n.rawMin), String(a)); assert.equal(Q.formatValue(n, n.rawMax), String(b));
});
// KORG packs values across bytes. parts are [ofs, bitHi, bitLo], least significant first.
const EXI = entries("program", "exi"), HD1 = entries("program", "hd1").map((e) => e.subarray(0, 3706)), COMBI = entries("combi");
const ENGINES = ["AL-1", "CX-3", "STR-1", "MS-20EX", "PolysixEX", "MOD-7", "SGX-2", "EP-1"];
const fieldWidth = (r) => r.parts.reduce((a, [, h, l]) => a + h - l + 1, 0);
const inExi1 = (n) => { const e = EXI.find((x) => Q.exiEngines(T, x)[0] === n); assert.ok(e, `no program has ${n} as EXi1`); return e; };
const anyWith = (n) => { const e = EXI.find((x) => Q.exiEngines(T, x).includes(n)); assert.ok(e, `no program uses ${n}`); return e; };
const find = (rows, group, name) => { const r = rows.find((x) => x.group.includes(group) && x.name === name); assert.ok(r, `no row ${group} / ${name}`); return r; };
const tablesToAudit = () => [["HD-1", T.programHd1], ["combi", T.combi], ["drumkit", T.drumkit], ["waveseq", T.waveseq], ...ENGINES.map((n) => [n, Q.paramsFor(T, "exi", anyWith(n))])];

await check("every field lists its bit parts", () => {
  for (const [k, rows] of tablesToAudit()) for (const r of rows) {
    assert.equal(typeof r.continuation, "boolean", `${k} ${r.name}: continuation`);
    if (r.continuation) { assert.equal((r.name ?? "").trim(), "", `${k}: continuation row has a name`); assert.equal(Q.isEditable(r), false, `${k}: continuation row is editable`); continue; }
    assert.ok(Array.isArray(r.parts) && r.parts.length >= 1, `${k} ${r.name}: no parts`);
    for (const [o, h, l] of r.parts) assert.ok(Number.isInteger(o) && o >= 0 && h <= 7 && l >= 0 && l <= h, `${k} ${r.name}: bad part`);
  }
});
await check("values split across bytes have the right parts", () => {
  const poly = Q.paramsFor(T, "exi", inExi1("PolysixEX")), ms = Q.paramsFor(T, "exi", inExi1("MS-20EX")), str = Q.paramsFor(T, "exi", inExi1("STR-1"));
  assert.deepEqual(find(poly, "PolysixEX: Filter", "Cutoff").parts, [[3170, 7, 0], [3171, 1, 0]]);
  assert.deepEqual(find(ms, "MS-20EX: HPF", "EG2/EXT").parts, [[3217, 7, 0], [3218, 1, 0]]);
  const lpf = find(ms, "MS-20EX: LPF", "Cutoff"); assert.deepEqual(lpf.parts[0], [3218, 7, 2]); assert.equal(fieldWidth(lpf), 10);
  assert.deepEqual(find(str, "STR-1: Feedback", "Feedback Distance").parts, [[2948, 7, 7], [2949, 7, 0], [2950, 0, 0]]);
  assert.deepEqual(find(str, "STR-1: PCM", "Mid Low MS Number").parts, [[3517, 7, 0], [3518, 5, 0]]);
  const seed = find(T.programHd1, "KARMA Module", "Start Seed"); assert.equal(seed.rawMin, -2147483648); assert.equal(seed.rawMax, 2147483647); assert.equal(seed.signed, true); assert.equal(fieldWidth(seed), 32);
  const swing = T.combi.find((r) => r.name === "Swing" && !r.fixed); assert.ok(swing, "no editable combi Swing"); assert.equal(swing.signed, true); assert.equal(fieldWidth(swing), 10);
  const padded = T.programHd1.find((r) => r.signed && r.rawMin === -99 && r.rawMax === 99 && r.bitHi === null); assert.equal(fieldWidth(padded), 8, "blank padding rows must not widen a field that already fits");
});
await check("a split value reads and writes without touching its neighbour", () => {
  const r = find(Q.paramsFor(T, "exi", inExi1("PolysixEX")), "PolysixEX: Filter", "Cutoff"), e = new Uint8Array(4960); e[3170] = 0x9c; e[3171] = 0x6c;
  assert.equal(Q.readParam(e, r), 156); Q.writeParam(e, r, 1000); assert.equal(e[3170], 0xe8); assert.equal(e[3171], 0x6f, "the next setting's bits changed");
  assert.throws(() => Q.writeParam(e, r, 1001), RangeError); assert.equal(e[3171], 0x6f);
});
await check("no two settings own the same bit", () => {
  for (const [k, rows] of tablesToAudit()) { const own = new Map(); for (const r of rows) { if (r.continuation || r.fixed || r.name === "Name") continue; const me = `${r.group} / ${r.name}`; for (const [o, h, l] of r.parts) for (let b = l; b <= h; b++) { const at = `${o}.${b}`, was = own.get(at); assert.ok(!was || was === me, `${k}: bit ${at} is owned by ${was} and ${me}`); own.set(at, me); } } }
});
const strict = (label, pairs) => {
  const seen = new Map(), bad = new Map(); let reads = 0, out = 0;
  for (const [rows, e] of pairs) for (const r of rows) { if (!Q.isEditable(r)) continue; const k = `${r.group} / ${r.name}`; reads++; seen.set(k, (seen.get(k) ?? 0) + 1); const v = Q.readParam(e, r); if (v < r.rawMin || v > r.rawMax) { out++; bad.set(k, (bad.get(k) ?? 0) + 1); } }
  const worst = [...bad].map(([k, n]) => [k, n / seen.get(k)]).sort((a, b) => b[1] - a[1]), show = worst.slice(0, 6).map(([k, s]) => `${k} ${(100 * s).toFixed(1)}%`).join("; ");
  assert.ok(out / reads <= 0.0001, `${label}: ${out} of ${reads} out of range; ${show}`); assert.ok(!worst.length || worst[0][1] <= 0.01, `${label}: a field is out of range too often; ${show}`);
  return `${out} of ${reads}`;
};
await check("HD-1: strict range on every setting, per field", () => strict("hd1", HD1.map((e) => [T.programHd1, e])));
await check("EXi and engines: strict range on every setting, per field", () => strict("exi", EXI.map((e) => [Q.paramsFor(T, "exi", e), e])));
await check("combis: strict range on every setting, per field", () => strict("combi", COMBI.map((e) => [T.combi, e])));
await check("drum kits: strict range on every setting, per field", () => strict("drumkit", entries("drumkit").map((e) => [T.drumkit, e])));
await check("wave sequences: strict range on every setting, per field", () => strict("waveseq", entries("waveseq").map((e) => [T.waveseq, e])));
const SAMPLE = () => [...HD1.filter((_, i) => i % 288 === 7).map((e) => [T.programHd1, e]), ...EXI.filter((_, i) => i % 128 === 7).map((e) => [Q.paramsFor(T, "exi", e), e]), ...COMBI.filter((_, i) => i % 384 === 7).map((e) => [T.combi, e])];
await check("changing any setting changes only that setting's bits", () => {
  let n = 0;
  for (const [rows, e] of SAMPLE()) for (const r of rows) {
    if (!Q.isEditable(r) || r.rawMin === r.rawMax) continue; const cur = Q.readParam(e, r); if (cur < r.rawMin || cur > r.rawMax) continue;
    const next = cur === r.rawMin ? r.rawMax : r.rawMin, c = Uint8Array.from(e); Q.writeParam(c, r, next); assert.equal(Q.readParam(c, r), next, `${r.group} / ${r.name} did not read back`); n++;
    const mask = new Map(); for (const [o, h, l] of r.parts) mask.set(o, (mask.get(o) ?? 0) | (((1 << (h - l + 1)) - 1) << l));
    for (let i = 0; i < c.length; i++) { const d = c[i] ^ e[i]; if (d && (d & ~(mask.get(i) ?? 0))) assert.fail(`${r.group} / ${r.name} changed byte ${i} outside its own bits`); }
  }
  return `${n} edits`;
});
await check("writing back any in-range value changes no byte, including EXi", () => {
  for (const [rows, e] of SAMPLE()) { const c = Uint8Array.from(e); for (const r of rows) { if (!Q.isEditable(r)) continue; const v = Q.readParam(c, r); if (v >= r.rawMin && v <= r.rawMax) Q.writeParam(c, r, v); } assert.deepEqual(Buffer.from(c), Buffer.from(e)); }
});
await check("sample-bank IDs can't be edited as numbers", () => { for (const [k, rows] of tablesToAudit()) for (const r of rows) if (/UUID/.test(r.name ?? "")) assert.equal(Q.isEditable(r), false, `${k} ${r.name}`); });
await check("unknown values show as numbers, never a wrong name", () => {
  const fx = row(T.programHd1, 88, "Effect Type");
  assert.equal(Q.formatValue(fx, 0), "No Effect"); assert.equal(Q.formatValue(fx, 185), "Multitap"); assert.equal(Q.formatValue(fx, 50), "50"); assert.equal(Q.formatValue(fx, 191), "191");
});

await check("generated tables stay out of git; tests, types and earlier gates pass", () => {
  const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).stdout; assert.ok(!tracked.includes("src/generated/"), "src/generated is tracked in git"); assert.ok(tracked.includes("scripts/gen-params.ts"), "scripts/gen-params.ts is not committed");
  const test = spawnSync(process.execPath, ["--test", "src/core/params/params.test.ts"], { cwd: root, encoding: "utf8" }); assert.equal(test.status, 0, (test.stdout + test.stderr).slice(-1000));
  const t = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", root], { cwd: root, encoding: "utf8" }); assert.equal(t.status, 0, (t.stdout + t.stderr).slice(0, 1000));
  for (const g of ["tools/gate-core.mjs", "tools/gate-pcg.mjs"]) { const r = spawnSync(process.execPath, [g], { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, g + r.stdout.slice(-500)); }
});
finish();
