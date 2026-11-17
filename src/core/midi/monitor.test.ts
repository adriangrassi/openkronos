import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMessage, filterEntries, formatEntries, MonitorLog, noteName } from "./monitor.ts";

test("notes and channel messages decode", () => {
  assert.equal(noteName(0), "C-1");
  assert.equal(noteName(21), "A0");
  assert.deepEqual(decodeMessage([0x90, 60, 0]), { type: "Note Off", channel: 1, values: "C4 60 vel 0" });
  assert.deepEqual(decodeMessage([0xe0, 0, 64]), { type: "Pitch Bend", channel: 1, values: "bend 0" });
  assert.equal(decodeMessage([0x90, 60]).type, "Unknown");
});

test("the ring keeps the newest entries and copies bytes", () => {
  const log = new MonitorLog(3);
  for (let i = 0; i < 5; i++) log.add("in", [0x90, 60 + i, 90], i);
  assert.deepEqual(log.entries().map((e) => e.seq), [2, 3, 4]);
  assert.equal(log.size, 3);
});

test("filter hides Active Sensing and matches text; copy format is tab separated", () => {
  const log = new MonitorLog();
  log.add("out", [0x90, 60, 100], 1);
  log.add("in", [0xfe], 2);
  assert.deepEqual(filterEntries(log.entries(), "", false).map((e) => e.type), ["Note On"]);
  assert.deepEqual(filterEntries(log.entries(), " OUT ", true).map((e) => e.type), ["Note On"]);
  assert.equal(formatEntries(filterEntries(log.entries(), "", false)), "00:00.001\tOUT\t1\tNote On\tC4 60 vel 100");
});
