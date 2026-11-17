import { test } from "node:test";
import assert from "node:assert/strict";
import { getEntry, setEntry } from "../pcg/library.ts";
import { parsePcg, serializePcg } from "../pcg/pcg.ts";
import { bank, container, entry, file, raw } from "../pcg/synthetic.ts";
import { HOLD_MESSAGE, Workspace } from "../../app/renderer/document.ts";
import { parkSlots, showCandidate, unionSlots, type Candidate } from "./compare.ts";

const EXI = 4960;
const build = () => parsePcg(file(container("PCG1", raw("DIV1", new Uint8Array(44), 0x10000), container("PRG1", bank("MBK1", EXI, 0, [entry("Init Program", EXI), entry("Init Keys", EXI), entry("Lead", EXI)])))));
const KEY = "program:INT-A";
const cand = (id: "A" | "B", w: Workspace, writes: [number, number][]): Candidate => {
  const slots = writes.map(([index]) => ({ key: KEY, index }));
  for (const [index, v] of writes) { const e = getEntry(w.file, KEY, index); e[100] = v; setEntry(w.file, KEY, index, e); }
  return { id, provider: "cloud", model: "m", seconds: 1, steps: 1, status: "done", slots, bytes: parkSlots(w.file, slots), items: [], tracks: [], runId: id };
};

test("two runs park their bytes, the library goes back to base, and each candidate can be shown alone", () => {
  const w = new Workspace(serializePcg(build()));
  const base = w.clone();
  w.holdAll();
  const a = cand("A", w, [[0, 11]]);
  showCandidate(w.file, base, unionSlots([a]), null);
  const b = cand("B", w, [[0, 22], [1, 33]]);
  const all = unionSlots([a, b]);
  showCandidate(w.file, base, all, null);
  assert.deepEqual(all.map((s) => s.index), [0, 1]);
  assert.equal(Buffer.from(serializePcg(w.file)).equals(Buffer.from(serializePcg(base))), true);
  showCandidate(w.file, base, all, a);
  assert.deepEqual([0, 1, 2].map((i) => getEntry(w.file, KEY, i)[100]), [11, 0, 0]);
  showCandidate(w.file, base, all, b);
  assert.deepEqual([0, 1, 2].map((i) => getEntry(w.file, KEY, i)[100]), [22, 33, 0]);
});

test("Keep records only the chosen candidate as one Undo step, and the hold stays until released", async () => {
  const w = new Workspace(serializePcg(build()));
  const base = w.clone();
  w.holdAll();
  const a = cand("A", w, [[0, 11]]);
  showCandidate(w.file, base, a.slots, null);
  const b = cand("B", w, [[0, 22], [1, 33]]);
  const all = unionSlots([a, b]);
  w.holdSlots(all);
  showCandidate(w.file, base, all, b);
  await assert.rejects(() => w.apply([{ key: KEY, index: 0 }], () => {}), new RegExp(HOLD_MESSAGE.slice(0, 20)));
  w.release();
  w.recordSince(base, b.slots);
  assert.equal(getEntry(w.file, KEY, 1)[100], 33);
  assert.equal(w.undoLabels().length, 1);
  assert.equal(w.undo(), true);
  assert.deepEqual([0, 1].map((i) => getEntry(w.file, KEY, i)[100]), [0, 0]);
});
