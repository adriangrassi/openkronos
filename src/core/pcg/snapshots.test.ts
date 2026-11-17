import assert from "node:assert/strict";
import { test } from "node:test";
import { addSnapshot, makeSnapshot, parseSnapshots, serializeSnapshots, snapshotEntry, snapshotFile } from "./snapshots.ts";

test("snapshot bytes and text round-trip", () => {
  const e = Uint8Array.from([0, 1, 254, 255, 7]);
  const s = makeSnapshot(" a ", "hd1", e, 5);
  assert.deepEqual(snapshotEntry(s), e);
  assert.deepEqual(parseSnapshots(serializeSnapshots([s])), [s]);
  assert.equal(parseSnapshots("{"), null);
});

test("limit and file names", () => {
  let l = [] as ReturnType<typeof addSnapshot>;
  for (let i = 0; i < 205; i++) l = addSnapshot(l, makeSnapshot(String(i), "exi", new Uint8Array(1), i));
  assert.equal(l.length, 200);
  assert.equal(l[0].label, "5");
  assert.notEqual(snapshotFile("a", "hd1"), snapshotFile("a", "exi"));
  assert.ok(!snapshotFile("../x", "hd1").includes(".."));
});
