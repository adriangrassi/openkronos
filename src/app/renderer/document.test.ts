import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getEntry, setEntry, setName } from "../../core/pcg/library.ts";
import { refsTo } from "../../core/pcg/refs.ts";
import { Workspace } from "./document.ts";

const bytes = () => new Uint8Array(readFileSync(new URL("../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG", import.meta.url)));
const edit = (w: Workspace, key: string, i: number) =>
  w.apply([{ key, index: i }], () => { const e = getEntry(w.file, key, i); e[40] ^= 1; setEntry(w.file, key, i, e); });

test("changes() after edits, undo and redo equals a cold scan", async () => {
  const w = new Workspace(bytes());
  assert.equal(w.changes().length, 0);
  await edit(w, "program:INT-A", 3);
  await edit(w, "combi:INT-A", 1);
  await edit(w, "program:INT-A", 3);
  const cold = () => { const f = new Workspace(bytes()); f.file = w.file; return f.changes(); };
  assert.deepEqual(w.changes(), cold());
  w.undo(); assert.deepEqual(w.changes(), cold());
  w.undo(); w.undo(); assert.equal(w.changes().length, 0);
  w.redo(); assert.deepEqual(w.changes(), cold());
});

test("an edit rescans only the bank it touched", async () => {
  const w = new Workspace(bytes());
  w.changes();
  const before = (w as unknown as { bankCache: Map<string, unknown> }).bankCache;
  const other = before.get("combi:INT-A");
  await edit(w, "program:INT-A", 3);
  w.changes();
  assert.equal(before.get("combi:INT-A"), other);
  assert.equal(before.get("program:INT-A") !== undefined, true);
});

test("several edits in one bank, a revert, undo and redo keep the per-slot patched list equal to a cold scan, in slot order", async () => {
  const w = new Workspace(bytes());
  w.changes();
  const cold = () => { const f = new Workspace(bytes()); f.file = w.file; return f.changes(); };
  await edit(w, "program:INT-A", 9);
  await edit(w, "program:INT-A", 2);
  await edit(w, "program:INT-A", 5);
  assert.deepEqual(w.changes().filter((c) => c.key === "program:INT-A").map((c) => c.index), [2, 5, 9]);
  assert.deepEqual(w.changes(), cold());
  await edit(w, "program:INT-A", 5); // flips the same bit back: slot 5 is no longer a change
  assert.deepEqual(w.changes().filter((c) => c.key === "program:INT-A").map((c) => c.index), [2, 9]);
  assert.deepEqual(w.changes(), cold());
  w.undo(); assert.deepEqual(w.changes(), cold());
  w.undo(); w.undo(); assert.deepEqual(w.changes(), cold());
  w.redo(); w.redo(); assert.deepEqual(w.changes(), cold());
});

test("nameRev moves only when a name changed", async () => {
  const w = new Workspace(bytes());
  const n0 = w.nameRev;
  await edit(w, "program:INT-A", 3);
  assert.equal(w.nameRev, n0, "a parameter edit left the names alone");
  await w.apply([{ key: "program:INT-A", index: 3 }], () => setName(w.file, "program:INT-A", 3, "Renamed"));
  assert.equal(w.nameRev, n0 + 1);
  w.undo();
  assert.equal(w.nameRev, n0 + 2, "undoing a rename changes a name too");
  w.refresh();
  assert.equal(w.nameRev, n0 + 3);
});

test("usedBy after edits and undo equals refsTo on the file", async () => {
  const w = new Workspace(bytes());
  const all = () => w.banks().filter((b) => b.kind === "program" || b.kind === "combi").flatMap((b) => Array.from({ length: Math.min(b.count, 12) }, (_, i) => [b.key, i] as const));
  const agree = () => { for (const [k, i] of all()) assert.deepEqual(w.usedBy(k, i), refsTo(w.file, k, i), `${k}/${i}`); };
  agree();
  // Points timbre 1 of the first Combi at program INT-A 4: bytes 4802 + 188 * 1 (number) and 4803 + 188 * 1 (bank).
  await w.apply([{ key: "combi:INT-A", index: 0 }], () => { const e = getEntry(w.file, "combi:INT-A", 0); e[4802 + 188] = 4; e[4803 + 188] = 0; setEntry(w.file, "combi:INT-A", 0, e); });
  assert.ok(w.usedBy("program:INT-A", 4).some((r) => r.kind === "timbre" && r.fromKey === "combi:INT-A" && r.fromIndex === 0 && r.part === 1));
  agree();
  w.undo();
  agree();
  w.redo();
  agree();
});
