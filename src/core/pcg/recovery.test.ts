import { test } from "node:test";
import assert from "node:assert/strict";
import { RECOVERY_KEEP, isValidRecovery, parseRecoveryFileName, planRotation, recoveryFileName } from "./recovery.ts";

test("names round-trip and bad ones are rejected", () => {
  assert.equal(RECOVERY_KEEP, 3);
  assert.deepEqual(parseRecoveryFileName(recoveryFileName("abc123", 7)), { docId: "abc123", seq: 7 });
  assert.equal(parseRecoveryFileName("abc123.1.5.recovery"), null);
  assert.equal(parseRecoveryFileName("../abc123.7.recovery"), null);
  assert.throws(() => recoveryFileName("../x", 1));
});

test("rotation keeps 3 per document", () => {
  const f = recoveryFileName;
  assert.deepEqual(planRotation([f("docaaa1", 0), f("docaaa1", 1), f("docaaa1", 2), f("docbbb2", 9)], "docaaa1"), { write: f("docaaa1", 3), remove: [f("docaaa1", 0)] });
});

test("garbage is not a recovery copy", () => {
  assert.equal(isValidRecovery(new Uint8Array(0)), false);
  assert.equal(isValidRecovery(new TextEncoder().encode("<html>not a pcg</html>")), false);
});
