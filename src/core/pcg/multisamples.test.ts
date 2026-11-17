import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMultisample, bankLabel, readZones, searchMultisamples } from "./multisamples.ts";

test("labels, search and apply on a blank entry", () => {
  const korg4 = "4b4f524700000000000000004d53000400";
  assert.equal(bankLabel(korg4), "KORG MS 4");
  assert.deepEqual(searchMultisamples([{ bank: korg4, number: 8 }], " ms 4 #8"), [{ bank: korg4, number: 8 }]);
  const out = applyMultisample(new Uint8Array(4000), 2, 8, { bank: korg4, number: 300 });
  assert.deepEqual(readZones(out)[15], { osc: 2, zone: 8, type: 1, ref: { bank: korg4, number: 300 } });
  assert.throws(() => applyMultisample(out, 1, 9, { bank: korg4, number: 1 }));
});
