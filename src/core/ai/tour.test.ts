import { test } from "node:test";
import assert from "node:assert/strict";
import { stepsOf, tourPoint, tourReduce, tourStart, type TourState } from "./tour.ts";
import type { PointAt } from "./point.ts";

const steps = [{ id: "1.0", note: "Raise slightly", suggest: 10 }, { id: "2.0", note: "Lower" }, { id: "3.1", note: "Raise", suggest: 4 }];
const at = (s: TourState, ...acts: Parameters<typeof tourReduce>[1][]): TourState => acts.reduce(tourReduce, s);

test("a tour starts on step 1 and Next walks forward, Back walks back and stops at the first step", () => {
  const s = tourStart(steps);
  assert.deepEqual([s.index, s.active], [0, true]);
  assert.equal(at(s, { type: "next" }).index, 1);
  assert.equal(at(s, { type: "next" }, { type: "next" }).index, 2);
  assert.equal(at(s, { type: "back" }).index, 0);
  assert.equal(at(s, { type: "next" }, { type: "back" }).index, 0);
});

test("Next on the last step is Done: the tour ends", () => {
  const last = at(tourStart(steps), { type: "next" }, { type: "next" });
  assert.equal(last.active, true);
  assert.equal(at(last, { type: "next" }).active, false);
  assert.equal(at(tourStart(steps), { type: "finished" }).active, false);
});

test("Cancel and a new AI question end the tour", () => {
  assert.equal(at(tourStart(steps), { type: "cancel" }).active, false);
  assert.equal(at(tourStart(steps), { type: "next" }, { type: "newQuestion" }).active, false);
});

test("a move the user makes ends the tour, but the tour's own navigation does not", () => {
  const s = at(tourStart(steps), { type: "settled" });
  assert.equal(tourStart(steps).navigating, true, "opening step 1 is the tour's own navigation too");
  assert.equal(at(s, { type: "userNavigated" }).active, false);
  const moving = at(s, { type: "next" });
  assert.equal(moving.navigating, true);
  assert.equal(at(moving, { type: "userNavigated" }).active, true, "the page change Next caused is not the user's");
  assert.equal(at(moving, { type: "settled" }, { type: "userNavigated" }).active, false, "after it settled, a move is the user's");
  assert.equal(at(s, { type: "next" }, { type: "back" }).navigating, true);
});

test("events on an ended tour change nothing", () => {
  const ended = at(tourStart(steps), { type: "cancel" });
  for (const type of ["next", "back", "settled", "userNavigated", "cancel"] as const) assert.deepEqual(tourReduce(ended, { type }), ended, type);
});

test("an empty list of steps never starts a tour", () => {
  assert.equal(tourStart([]).active, false);
});

test("stepsOf keeps old pointers (ids and notes only) working", () => {
  const old: PointAt = { key: "program:INT-A", index: 1, ids: ["1.0", "2.0"], notes: ["Raise: A (now 1)", "Lower: B (now 2)"], names: ["A", "B"] };
  assert.deepEqual(stepsOf(old), [{ id: "1.0", note: "Raise: A (now 1)" }, { id: "2.0", note: "Lower: B (now 2)" }]);
  const withSteps: PointAt = { ...old, steps };
  assert.equal(stepsOf(withSteps), steps);
});

test("tourPoint is a one-setting pointer for the current step, and null when the tour is not active", () => {
  const base: PointAt = { key: "program:INT-A", index: 1, ids: ["1.0", "2.0", "3.1"], notes: ["n1", "n2", "n3"], names: ["A", "B", "C"], steps };
  const s = at(tourStart(steps), { type: "next" });
  const p = tourPoint(base, s)!;
  assert.deepEqual([p.key, p.index, p.ids, p.names, p.notes, p.steps], ["program:INT-A", 1, ["2.0"], ["B"], ["n2"], [steps[1]]]);
  assert.equal(tourPoint(base, at(s, { type: "cancel" })), null);
});

test("a note step and a Combi timbre step walk like any other step and keep their kind in the pointer", () => {
  const mixed = [{ id: "note-1", note: "Pick an empty slot", kind: "note" as const }, { id: "4990.0", note: "Set Timbre 2", suggest: 2, kind: "combi-timbre" as const, timbre: 2, field: "program" as const, bank: 3 }, { id: "4995.0", note: "Lower", suggest: 80, kind: "combi-timbre" as const, timbre: 2, field: "level" as const }];
  const base: PointAt = { key: "combi:INT-F", index: 100, ids: mixed.map((x) => x.id), notes: mixed.map((x) => x.note), names: ["Plan", "Timbre 2 program", "Timbre 2 level"], steps: mixed };
  let s = tourStart(mixed);
  assert.deepEqual([tourPoint(base, s)!.ids, tourPoint(base, s)!.steps![0].kind], [["note-1"], "note"]);
  s = at(s, { type: "next" });
  const p = tourPoint(base, s)!;
  assert.deepEqual([p.key, p.index, p.ids, p.names, p.steps![0].field, p.steps![0].bank], ["combi:INT-F", 100, ["4990.0"], ["Timbre 2 program"], "program", 3]);
  assert.equal(at(s, { type: "next" }, { type: "next" }).active, false);
});
