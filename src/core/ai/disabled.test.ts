import { test } from "node:test";
import assert from "node:assert/strict";
import { askDisabledReason, awayFrom, SUPPORTED_HINT } from "./disabled.ts";

const ok = { selected: true, busy: false, locked: false, routeBlocked: false, text: "x" };
test("askDisabledReason names the first thing that blocks Ask and Refine", () => {
  assert.equal(askDisabledReason(ok), null);
  assert.match(askDisabledReason({ ...ok, selected: false })!, /No sound is open: select one row or open it/i);
  assert.match(askDisabledReason({ ...ok, text: "  " })!, /type/i);
  assert.match(askDisabledReason({ ...ok, busy: true })!, /in progress/i);
  assert.match(askDisabledReason({ ...ok, locked: true })!, /locked/i);
  assert.match(askDisabledReason({ ...ok, routeBlocked: true })!, /local model/i);
  assert.match(askDisabledReason({ ...ok, selected: false, text: "" })!, /No sound is open: select one row or open it/i);
});

test("awayFrom is true when the open sound is not the run's target", () => {
  const t = { key: "program:INT-A", index: 5 };
  assert.equal(awayFrom(t, t), false);
  assert.equal(awayFrom({ ...t }, t), false);
  assert.equal(awayFrom({ ...t, index: 6 }, t), true);
  assert.equal(awayFrom({ key: "program:INT-B", index: 5 }, t), true);
  assert.equal(awayFrom(null, t), true);
});

test("the hint under the fields names what is supported and what is not editable yet", () => {
  for (const kind of [/Program/, /Combination/, /Drum Kit/, /Wave Sequence/]) assert.match(SUPPORTED_HINT, kind);
  assert.match(SUPPORTED_HINT, /Sequences, songs and patterns are not editable yet/);
});
