import { test } from "node:test";
import assert from "node:assert/strict";
import { decideReopen } from "./reopen.ts";

const orig = { exists: true, size: 100, mtimeMs: 5000 };
const good = { size: 100, mtimeMs: 5000, sha256Ok: true };

test("setting off opens nothing", () => {
  assert.deepEqual(decideReopen({ reopenLast: false, original: orig, cache: good }), { use: "none", refreshCache: false });
});
test("original unchanged loads the cache", () => {
  assert.deepEqual(decideReopen({ reopenLast: true, original: orig, cache: good }), { use: "cache", refreshCache: false });
});
test("original changed size or time loads the original and refreshes", () => {
  const want = { use: "original", refreshCache: true };
  assert.deepEqual(decideReopen({ reopenLast: true, original: { ...orig, size: 101 }, cache: good }), want);
  assert.deepEqual(decideReopen({ reopenLast: true, original: { ...orig, mtimeMs: 5001 }, cache: good }), want);
});
test("original present with a bad or missing cache loads the original and refreshes", () => {
  const want = { use: "original", refreshCache: true };
  assert.deepEqual(decideReopen({ reopenLast: true, original: orig, cache: { ...good, sha256Ok: false } }), want);
  assert.deepEqual(decideReopen({ reopenLast: true, original: orig, cache: null }), want);
});
test("original missing: good cache is used, bad or no cache is none", () => {
  const gone = { exists: false, size: 0, mtimeMs: 0 };
  assert.deepEqual(decideReopen({ reopenLast: true, original: gone, cache: good }), { use: "cache", refreshCache: false });
  assert.deepEqual(decideReopen({ reopenLast: true, original: null, cache: good }), { use: "cache", refreshCache: false });
  assert.deepEqual(decideReopen({ reopenLast: true, original: gone, cache: { ...good, sha256Ok: false } }), { use: "none", refreshCache: false });
  assert.deepEqual(decideReopen({ reopenLast: true, original: null, cache: null }), { use: "none", refreshCache: false });
});
