import { test } from "node:test";
import assert from "node:assert/strict";
import { getEntry, copyEntry, getGlobal, getName, listBanks, setEntry, setGlobal, setName, swapEntries } from "./library.ts";
import { PcgError, parsePcg, serializePcg, verifyChecksums } from "./pcg.ts";
import { bank, container, entry, file, leaf, raw } from "./synthetic.ts";

// Synthetic set: one set list (SDB1 + SBK1 in an SLS1), two EXi programs, one HD-1 user program, one odd id, one combi, one drum kit.
const sample = () =>
  file(
    container(
      "PCG1",
      raw("DIV1", new Uint8Array(44), 0x10000),
      container(
        "SLS1",
        container("SLD1", bank("SDB1", 40, 0, [entry("Set A", 40), entry("Set B", 40)])),
        container("STL1", bank("SBK1", 48, 0, [entry("Set A", 48), entry("Set B", 48)])),
      ),
      container(
        "PRG1",
        bank("MBK1", 40, 0, [entry("Exi A", 40), entry("Exi B", 40)]),
        bank("PBK1", 40, 0x20000, [entry("Hd U", 40), entry("Hd U2", 40)]),
        bank("MBK1", 40, 0x123456, [entry("Odd", 40)]),
      ),
      container("CMB1", bank("CBK1", 40, 0, [entry("Combi A", 40), entry("Combi B", 40)])),
      container("DKT1", bank("DBK1", 40, 0x20007, [entry("Kit", 40)])),
    ),
  );

const load = () => parsePcg(sample());
const count = (b: Uint8Array, s: string) => Buffer.from(b).toString("latin1").split(s).length - 1;

test("listBanks lists banks in file order and never lists SDB1", () => {
  assert.deepEqual(
    listBanks(load()).map((b) => b.key),
    ["setlist:SET", "program:INT-A", "program:U-A", "program:ID-00123456", "combi:INT-A", "drumkit:U-AA"],
  );
});

test("labels, sysex banks, types and sizes", () => {
  const b = Object.fromEntries(listBanks(load()).map((x) => [x.key, x]));
  assert.deepEqual([b["program:INT-A"].type, b["program:INT-A"].sysexBank, b["program:INT-A"].count, b["program:INT-A"].entrySize], ["exi", 0, 2, 40]);
  assert.deepEqual([b["program:U-A"].type, b["program:U-A"].sysexBank, b["program:U-A"].id], ["hd1", 0x40, 0x20000]);
  assert.deepEqual([b["program:ID-00123456"].label, b["program:ID-00123456"].sysexBank, b["program:ID-00123456"].type], ["ID-00123456", null, "exi"]);
  assert.deepEqual([b["drumkit:U-AA"].sysexBank, b["drumkit:U-AA"].type, b["combi:INT-A"].type], [0x47, null, null]);
  assert.deepEqual([b["setlist:SET"].type, b["setlist:SET"].sysexBank, b["setlist:SET"].count, b["setlist:SET"].entrySize], [null, null, 2, 48]);
});

test("getName strips NUL and space padding", () => {
  const f = load();
  assert.equal(getName(f, "program:INT-A", 1), "Exi B");
  assert.equal(getName(f, "program:U-A", 0), "Hd U");
});

test("setName writes a NUL-padded name and keeps checksums valid", () => {
  const f = load();
  setName(f, "program:INT-A", 0, "Brass");
  assert.equal(getName(f, "program:INT-A", 0), "Brass");
  assert.deepEqual(verifyChecksums(f), []);
  const out = serializePcg(f);
  assert.equal(count(out, "Brass\0"), 1);
  assert.equal(count(out, "Exi B"), 1, "other entries untouched");
});

test("setName refuses bad names and leaves the file unchanged", () => {
  const f = load();
  const before = serializePcg(f);
  for (const n of ["", "ABCDEFGHIJKLMNOPQRSTUVWXY", "Café", "tab\tname", "trailing "]) {
    assert.throws(() => setName(f, "program:INT-A", 0, n), PcgError, JSON.stringify(n));
  }
  assert.deepEqual(serializePcg(f), before);
});

test("a set list rename changes SBK1 and SDB1 alike", () => {
  const f = load();
  setName(f, "setlist:SET", 0, "Gig Set");
  assert.equal(getName(f, "setlist:SET", 0), "Gig Set");
  const out = serializePcg(f);
  assert.equal(count(out, "Gig Set"), 2);
  assert.equal(count(out, "Set A"), 0);
  assert.deepEqual(verifyChecksums(f), []);
});

test("copyEntry duplicates a whole entry and leaves the source alone", () => {
  const f = load();
  const src = getEntry(f, "combi:INT-A", 0);
  copyEntry(f, "combi:INT-A", 0, "combi:INT-A", 1);
  assert.deepEqual(getEntry(f, "combi:INT-A", 1), src);
  assert.deepEqual(getEntry(f, "combi:INT-A", 0), src);
  assert.deepEqual(verifyChecksums(f), []);
});

test("copy in a set list moves SBK1 and SDB1 entries together", () => {
  const f = load();
  copyEntry(f, "setlist:SET", 0, "setlist:SET", 1);
  assert.equal(getName(f, "setlist:SET", 1), "Set A");
  assert.equal(count(serializePcg(f), "Set A"), 4);
  assert.deepEqual(verifyChecksums(f), []);
});

test("swap across banks exchanges entries, and swapping twice restores the file", () => {
  const f = load();
  const before = serializePcg(f);
  swapEntries(f, "program:INT-A", 0, "program:INT-A", 1);
  assert.equal(getName(f, "program:INT-A", 0), "Exi B");
  assert.deepEqual(verifyChecksums(f), []);
  swapEntries(f, "program:INT-A", 0, "program:INT-A", 1);
  assert.deepEqual(serializePcg(f), before);
});

test("copy and swap refuse mismatched kind, engine type and entry size", () => {
  const f = load();
  assert.throws(() => copyEntry(f, "combi:INT-A", 0, "program:INT-A", 0), PcgError, "combi into program");
  assert.throws(() => copyEntry(f, "program:INT-A", 0, "program:U-A", 0), PcgError, "EXi into HD-1");
  assert.throws(() => swapEntries(f, "program:INT-A", 0, "combi:INT-A", 0), PcgError, "swap program with combi");
  assert.throws(() => swapEntries(f, "drumkit:U-AA", 0, "combi:INT-A", 0), PcgError, "swap drum kit with combi");
});

test("unknown keys and bad indexes throw PcgError", () => {
  const f = load();
  const bad: Array<() => unknown> = [
    () => getName(f, "program:NOPE", 0),
    () => getName(f, "program:INT-A", 2),
    () => getName(f, "program:INT-A", -1),
    () => getName(f, "program:INT-A", 0.5),
    () => setName(f, "combi:INT-A", 1.5, "x"),
    () => getEntry(f, "combi:INT-A", NaN),
    () => swapEntries(f, "combi:INT-A", 0, "combi:INT-A", 2),
  ];
  for (const fn of bad) assert.throws(fn, PcgError);
});

test("setEntry checks length, updates the checksum, and refuses set lists", () => {
  const f = load();
  assert.throws(() => setEntry(f, "combi:INT-A", 0, new Uint8Array(10)), PcgError);
  setEntry(f, "combi:INT-A", 0, getEntry(f, "combi:INT-A", 1));
  assert.equal(getName(f, "combi:INT-A", 0), "Combi B");
  assert.deepEqual(verifyChecksums(f), []);
  assert.throws(() => setEntry(f, "setlist:SET", 0, new Uint8Array(48)), PcgError);
});

test("Global is a copy of its GLB1 data; writing it updates the checksum; files without one return null", () => {
  const data = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const f = parsePcg(file(container("PCG1", raw("DIV1", new Uint8Array(4), 0x10000), leaf("GLB1", data))));
  const g = getGlobal(f)!;
  assert.deepEqual(Array.from(g), Array.from(data));
  g[0] = 99;
  assert.equal(getGlobal(f)![0], 1, "getGlobal returns a copy");
  setGlobal(f, data.map((x) => x ^ 0xff));
  assert.deepEqual(Array.from(getGlobal(f)!), Array.from(data, (x) => x ^ 0xff));
  assert.deepEqual(verifyChecksums(f), []);
  assert.throws(() => setGlobal(f, new Uint8Array(3)), PcgError);
  const bare = parsePcg(file(container("PCG1", raw("DIV1", new Uint8Array(4), 0x10000))));
  assert.equal(getGlobal(bare), null);
  assert.throws(() => setGlobal(bare, new Uint8Array(16)), PcgError);
});
