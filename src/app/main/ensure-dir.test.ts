import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureDir } from "./ensure-dir.ts";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "ensure-dir-"));

test("makes every missing level and is safe to repeat", () => {
  const dir = path.join(tmp(), "a", "b", "c");
  ensureDir(dir);
  ensureDir(dir);
  assert.ok(existsSync(dir));
});

test("a folder that can't be made is an error", () => {
  const file = path.join(tmp(), "file");
  writeFileSync(file, "x");
  assert.throws(() => ensureDir(path.join(file, "sub")));
});
