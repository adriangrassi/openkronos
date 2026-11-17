import { test } from "node:test";
import assert from "node:assert/strict";
import { getEntry, getName, getSetList, setEntry } from "./library.ts";
import { PcgError, parsePcg, serializePcg, verifyChecksums, type PcgFile } from "./pcg.ts";
import { refsTo, refsToCached, slotsTouchedBySwap, swapWithRefs, type Ref, type Slot } from "./refs.ts";
import { bank, container, entry, file, raw } from "./synthetic.ts";

// Synthetic sizes: a Program is 2700 bytes (the Drum Track sits at 2688), a Combi 7810, a Set List 69416 with a 3612-byte companion.
const PROG = 2700;
const COMBI = 7810;
const SET = 69416;
const SDB = 3612;

const program = (name: string, drum?: [number, number]): Uint8Array => {
  const e = entry(name, PROG);
  if (drum) [e[2688], e[2689]] = drum;
  return e;
};

// timbres: timbre number -> [program index, program bank column]
const combi = (name: string, timbres: Record<number, [number, number]>): Uint8Array => {
  const e = entry(name, COMBI);
  for (const [t, [num, col]] of Object.entries(timbres)) {
    e[4802 + 188 * Number(t)] = num;
    e[4803 + 188 * Number(t)] = col;
  }
  return e;
};

// slots: slot -> [type, bank byte, number]; the bank byte keeps its top bits as KORG stores them
const setList = (name: string, slots: Record<number, [number, number, number]>): Uint8Array => {
  const e = entry(name, SET);
  for (let s = 0; s < 128; s++) e[24 + 542 * s + 24] = 2; // every slot starts as an untracked type; zero would read as Combi INT-A 0
  for (const [s, [type, col, num]] of Object.entries(slots)) {
    const o = 24 + 542 * Number(s);
    e[o + 24] = type;
    e[o + 25] = col;
    e[o + 26] = num;
  }
  return e;
};

const sample = (): Uint8Array =>
  file(
    container(
      "PCG1",
      raw("DIV1", new Uint8Array(44), 0x10000),
      container(
        "SLS1",
        container("SLD1", bank("SDB1", SDB, 0, [entry("Set A", SDB), entry("Set B", SDB)])),
        container(
          "STL1",
          bank("SBK1", SET, 0, [
            // slot 5: Program U-A 2 with top bits set in the bank byte; slot 6: Combi INT-A 0; slot 7: GM bank 6 (not tracked); slot 8: a type not tracked
            setList("Set A", { 5: [1, 0xe0 | 17, 2], 6: [0, 0, 0], 7: [0, 6, 0], 8: [2, 17, 2] }),
            setList("Set B", {}),
          ]),
        ),
      ),
      container(
        "PRG1",
        bank("MBK1", PROG, 0, [program("I0", [2, 17]), program("I1")]),
        bank("PBK1", PROG, 0x20000, [program("U0"), program("U1"), program("U2")]),
      ),
      // timbre 0 -> U-A 2, timbre 1 -> INT-A 1, timbre 2 -> U-AA 0 (no such bank here), timbre 3 -> GM bank 6
      container("CMB1", bank("CBK1", COMBI, 0, [combi("C0", { 0: [2, 17], 1: [1, 0], 2: [0, 24], 3: [0, 6] }), entry("C1", COMBI)])),
    ),
  );

const load = (): PcgFile => parsePcg(sample());
const names = (refs: Ref[]): string[] => refs.map((r) => `${r.kind} ${r.fromKey} ${r.fromIndex} ${r.part}`).sort();
const slots = (list: Slot[]): string[] => list.map((s) => `${s.key}/${s.index}`).sort();

test("finds the Combi timbres, Drum Tracks and Set List slots that point at a slot", () => {
  const f = load();
  assert.deepEqual(names(refsTo(f, "program:U-A", 2)), ["drum-track program:INT-A 0 0", "setlist setlist:SET 0 5", "timbre combi:INT-A 0 0"]);
  assert.deepEqual(names(refsTo(f, "program:U-A", 0)), []);
  assert.deepEqual(names(refsTo(f, "program:INT-A", 1)), ["timbre combi:INT-A 0 1"]);
  assert.deepEqual(names(refsTo(f, "combi:INT-A", 0)), ["setlist setlist:SET 0 6"]);
});

test("a bad key, a bad index or a bank that is not a Program or Combi is refused", () => {
  const f = load();
  assert.throws(() => refsTo(f, "program:NOPE", 0), (e) => e instanceof PcgError);
  assert.throws(() => refsTo(f, "program:U-A", 3), (e) => e instanceof PcgError);
  assert.throws(() => refsTo(f, "setlist:SET", 0), (e) => e instanceof PcgError);
});

test("a swap moves both slots, rewrites every pointer, keeps the bank byte's top bits, and undoes byte for byte", () => {
  const f = load();
  const before = serializePcg(f);
  const companion = getSetList(f, 0).companion;
  const touched = swapWithRefs(f, "program:U-A", 0, "program:U-A", 2);
  assert.deepEqual(verifyChecksums(f), []);
  assert.equal(getName(f, "program:U-A", 0), "U2");
  assert.equal(getName(f, "program:U-A", 2), "U0");
  assert.deepEqual(names(refsTo(f, "program:U-A", 0)), ["drum-track program:INT-A 0 0", "setlist setlist:SET 0 5", "timbre combi:INT-A 0 0"]);
  assert.deepEqual(names(refsTo(f, "program:U-A", 2)), []);
  const after = getSetList(f, 0);
  assert.equal(after.entry[24 + 542 * 5 + 25], 0xe0 | 17, "the top bits of the bank byte were lost");
  assert.deepEqual(after.companion, companion, "the companion block changed");
  assert.deepEqual(slots(touched), ["program:INT-A/0", "program:U-A/0", "program:U-A/2", "combi:INT-A/0", "setlist:SET/0"].sort());
  swapWithRefs(f, "program:U-A", 0, "program:U-A", 2);
  assert.deepEqual(serializePcg(f), before);
});

test("slotsTouchedBySwap names exactly the slots a swap changes", () => {
  const f = load();
  const predicted = slots(slotsTouchedBySwap(f, "program:U-A", 0, "program:U-A", 2));
  assert.deepEqual(slots(swapWithRefs(f, "program:U-A", 0, "program:U-A", 2)), predicted);
});

test("a Combi swap moves Set List pointers to the other slot and leaves untracked banks alone", () => {
  const f = load();
  const slot7 = getSetList(f, 0).entry[24 + 542 * 7 + 25];
  swapWithRefs(f, "combi:INT-A", 0, "combi:INT-A", 1);
  assert.deepEqual(names(refsTo(f, "combi:INT-A", 1)), ["setlist setlist:SET 0 6"]);
  assert.equal(getSetList(f, 0).entry[24 + 542 * 7 + 25], slot7);
  assert.deepEqual(verifyChecksums(f), []);
});

test("a mismatched pair is refused and changes nothing", () => {
  const f = load();
  const before = serializePcg(f);
  assert.throws(() => swapWithRefs(f, "program:INT-A", 0, "program:U-A", 0), (e) => e instanceof PcgError);
  assert.deepEqual(serializePcg(f), before);
  assert.equal(getEntry(f, "program:INT-A", 0)[0], "I".charCodeAt(0));
});

test("refsToCached equals refsTo for every target, and a dropped bank entry is rebuilt after a pointer edit", () => {
  const f = load();
  const cache = new Map();
  const targets: [string, number][] = [["program:INT-A", 0], ["program:INT-A", 1], ["program:U-A", 0], ["program:U-A", 2], ["combi:INT-A", 0], ["combi:INT-A", 1]];
  for (const [k, i] of targets) assert.deepEqual(refsToCached(f, k, i, cache), refsTo(f, k, i), `${k}/${i}`);
  const e = getEntry(f, "combi:INT-A", 1);
  e[4802] = 2; e[4803] = 17; // timbre 0 of C1 now points at U-A 2
  setEntry(f, "combi:INT-A", 1, e);
  cache.delete("combi:INT-A");
  for (const [k, i] of targets) assert.deepEqual(refsToCached(f, k, i, cache), refsTo(f, k, i), `${k}/${i} after the edit`);
  assert.throws(() => refsToCached(f, "program:U-A", 3, cache), (x) => x instanceof PcgError);
});
