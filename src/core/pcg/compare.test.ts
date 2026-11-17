import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { changedTargets, compareBanks, compareSlots, copyBlocker, copyFromCompare, diffSounds, type CopyItem } from "./compare.ts";
import { getEntry, getName, setName, commitBank, viewEntry } from "./library.ts";
import { parsePcg, verifyChecksums } from "./pcg.ts";
import { paramsFor, readParam, writeParam } from "../params/params.ts";

// The factory file is the test data: a real file, so banks, names and the Panpot row are the real ones.
const FACTORY = path.join(import.meta.dirname, "../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG");
const load = () => parsePcg(new Uint8Array(readFileSync(FACTORY)));
const BI = "program:INT-B";
const it = (fk: string, fi: number, tk: string, ti: number): CopyItem => ({ from: { key: fk, index: fi }, to: { key: tk, index: ti } });

test("compare finds the one changed slot and the copy moves it", () => {
  const a = load();
  const b = load();
  setName(b, BI, 5, "Cmp Five");
  assert.equal(compareBanks(a, b).find((d) => d.key === BI)?.differing, 1);
  assert.deepEqual(compareSlots(a, b, BI, true).map((s) => s.index), [5]);
  assert.equal(copyBlocker(a, b, it(BI, 5, BI, 5)), null);
  copyFromCompare(a, b, [it(BI, 5, BI, 5)]);
  assert.equal(getName(a, BI, 5), "Cmp Five");
  assert.deepEqual(verifyChecksums(a), []);
});

test("copies refuse an incompatible engine type and leave the file alone", () => {
  const a = load();
  const b = load();
  const before = a.bytes.slice();
  assert.match(copyBlocker(a, b, it("program:INT-A", 0, BI, 0)) ?? "", /cannot copy/);
  assert.throws(() => copyFromCompare(a, b, [it(BI, 0, BI, 1), it("program:INT-A", 0, BI, 2)]));
  assert.deepEqual(a.bytes, before);
});

test("changed targets are found against the saved file", () => {
  const saved = load();
  const cur = load();
  setName(cur, BI, 9, "Edited");
  const items = [it(BI, 5, BI, 5), it(BI, 9, BI, 9)];
  assert.deepEqual(changedTargets(cur, saved, items), [items[1]]);
});

test("a parameter diff lists only the changed setting", () => {
  const a = load();
  const b = load();
  const tables = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../generated/params.json"), "utf8"));
  const pan = paramsFor(tables, "hd1", getEntry(a, BI, 5)).find((r) => r.name === "Panpot" && r.ofs === 92)!;
  writeParam(viewEntry(b, BI, 5), pan, readParam(getEntry(a, BI, 5), pan) === 64 ? 63 : 64);
  commitBank(b, BI);
  const d = diffSounds(tables, { type: "hd1", entry: getEntry(a, BI, 5) }, { type: "hd1", entry: getEntry(b, BI, 5) });
  assert.deepEqual(d.map((x) => x.name), ["Panpot"]);
  assert.deepEqual(diffSounds(tables, { type: "hd1", entry: getEntry(a, BI, 5) }, { type: "hd1", entry: getEntry(a, BI, 5) }), []);
});
