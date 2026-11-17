import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearCache, readCache, writeCache } from "./last-cache.ts";

const bytes = new Uint8Array([75, 79, 82, 71, 1, 2, 3, 4]);
const tmp = (): string => path.join(mkdtempSync(path.join(tmpdir(), "kcache-")), "Cache");

test("round trip keeps the bytes and leaves no temp files", () => {
  const d = tmp();
  writeCache(d, "C:/x/a.PCG", { size: 8, mtimeMs: 42 }, bytes);
  const c = readCache(d)!;
  assert.deepEqual([...c.bytes], [...bytes]);
  assert.equal(c.meta.originalPath, "C:/x/a.PCG");
  assert.equal(c.meta.name, "a.PCG");
  assert.equal(c.meta.mtimeMs, 42);
  assert.deepEqual(readdirSync(d).sort(), ["last.json", "last.pcg"]);
});
test("a second write replaces the first (one copy only)", () => {
  const d = tmp();
  writeCache(d, "C:/x/a.PCG", { size: 8, mtimeMs: 1 }, bytes);
  writeCache(d, "C:/x/b.PCG", { size: 8, mtimeMs: 2 }, new Uint8Array([75, 79, 82, 71, 9, 9, 9, 9]));
  assert.equal(readCache(d)!.meta.name, "b.PCG");
  assert.equal(readdirSync(d).length, 2);
});
test("corrupt bytes are discarded", () => {
  const d = tmp();
  writeCache(d, "C:/x/a.PCG", { size: 8, mtimeMs: 1 }, bytes);
  writeFileSync(path.join(d, "last.pcg"), new Uint8Array([75, 79, 82, 71, 1, 2, 3, 5]));
  assert.equal(readCache(d), null);
  assert.equal(existsSync(path.join(d, "last.pcg")), false);
});
test("missing, garbled metadata and clear all read as no cache", () => {
  const d = tmp();
  assert.equal(readCache(d), null);
  writeCache(d, "C:/x/a.PCG", { size: 8, mtimeMs: 1 }, bytes);
  writeFileSync(path.join(d, "last.json"), "{nope");
  assert.equal(readCache(d), null);
  writeCache(d, "C:/x/a.PCG", { size: 8, mtimeMs: 1 }, bytes);
  clearCache(d);
  assert.equal(readCache(d), null);
});

test("clearing also removes the saved whole-keyboard pull", () => {
  const d = tmp();
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "keyboard.PCG"), bytes);
  clearCache(d);
  assert.equal(existsSync(path.join(d, "keyboard.PCG")), false);
});
