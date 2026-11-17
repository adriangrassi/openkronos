import assert from "node:assert/strict";
import { test } from "node:test";
import { isBackupFolderName, parseManifest, verifyFiles } from "./manifest.ts";

test("backup folder names", () => {
  assert.equal(isBackupFolderName("Kronos Backup 2026-01-01-10-00-00"), true);
  assert.equal(isBackupFolderName("Kronos Backup ../x"), false);
});
test("a bad manifest throws", () => {
  assert.throws(() => parseManifest("[]"));
  assert.equal(verifyFiles(parseManifest(JSON.stringify({ created: "c", os: "o", pcg: { file: "a.PCG", sha256: "x" }, banks: [], objects: [], failed: [] })), () => null).problems[0]?.kind, "missing");
});
