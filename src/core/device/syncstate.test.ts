import assert from "node:assert/strict";
import { test } from "node:test";
import { bankKnown, changedSinceSync, emptySyncState, parseSyncState, recordBank, recordSlots, slotHash } from "./syncstate.ts";

const b = (...xs: number[]) => Uint8Array.from(xs);
const entries = (rows: Uint8Array[]) => (i: number) => rows[i];

test("slotHash is stable, changes with one byte, and with length", () => {
  assert.equal(slotHash(b(1, 2, 3)), slotHash(b(1, 2, 3)));
  assert.notEqual(slotHash(b(1, 2, 3)), slotHash(b(1, 2, 4)));
  assert.notEqual(slotHash(b(1, 2)), slotHash(b(1, 2, 0)));
  assert.notEqual(slotHash(b()), slotHash(b(0)));
  assert.match(slotHash(b(1)), /^[0-9a-f]{16,}$/);
});

test("parseSyncState keeps valid state and empties anything malformed", () => {
  const ok = { version: 1, banks: { "program:INT-A": { "0": "abcd", "1": "beef" } } };
  assert.deepEqual(parseSyncState(ok), ok);
  assert.deepEqual(parseSyncState({ version: 2, banks: {} }), emptySyncState());
  assert.deepEqual(parseSyncState(null), emptySyncState());
  assert.deepEqual(parseSyncState("garbage"), emptySyncState());
  assert.deepEqual(parseSyncState({ version: 1, banks: [] }), emptySyncState());
  assert.deepEqual(parseSyncState({ version: 1, banks: { "program:INT-A": { "0": 7 } } }), emptySyncState());
  assert.deepEqual(parseSyncState({ version: 1, banks: { "program:INT-A": "x" } }), emptySyncState());
});

test("bankKnown reports whether a bank has a record", () => {
  const s = recordBank(emptySyncState(), "program:INT-A", 1, entries([b(1)]));
  assert.equal(bankKnown(s, "program:INT-A"), true);
  assert.equal(bankKnown(s, "program:U-A"), false);
});

test("changedSinceSync returns missing and differing slots", () => {
  const rows = [b(1), b(2), b(3)];
  const s = recordBank(emptySyncState(), "program:INT-A", 3, entries(rows));
  assert.deepEqual(changedSinceSync(s, "program:INT-A", 3, entries(rows)), []);
  assert.deepEqual(changedSinceSync(s, "program:INT-A", 3, entries([b(1), b(9), b(3)])), [1]);
  assert.deepEqual(changedSinceSync(emptySyncState(), "program:INT-A", 3, entries(rows)), [0, 1, 2]);
});

test("recordSlots updates only the given slots and records are immutable", () => {
  const before = recordBank(emptySyncState(), "program:INT-A", 2, entries([b(1), b(2)]));
  const snapshot = JSON.stringify(before);
  const after = recordSlots(before, "program:INT-A", [1], entries([b(1), b(7)]));
  assert.equal(JSON.stringify(before), snapshot);
  assert.notEqual(after, before);
  assert.deepEqual(changedSinceSync(after, "program:INT-A", 2, entries([b(1), b(7)])), []);
});
