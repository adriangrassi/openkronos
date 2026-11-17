import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MAX_PACK_BYTES, parsePack } from "./exchange.ts";

const pack = (mut: (s: Record<string, unknown>) => void = () => {}): string => {
  const bytes = Uint8Array.from({ length: 4960 }, (_, i) => (i * 7) & 255);
  const s: Record<string, unknown> = { type: "program", engine: "exi", name: "Test", data: Buffer.from(bytes).toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex") };
  mut(s);
  return JSON.stringify({ format: "kronos-sounds", version: 1, name: "t", sounds: [s], programs: [] });
};

test("a valid pack parses (so the built-in sha256 agrees with node)", () => {
  assert.equal(parsePack(pack()).sounds[0].name, "Test");
});

test("refuses oversize, bad hash, bad size, bad engine, polluting keys", () => {
  assert.throws(() => parsePack(" ".repeat(MAX_PACK_BYTES + 1)), /too large/);
  assert.throws(() => parsePack(pack((s) => { s.sha256 = "0".repeat(64); })), /sha256/);
  assert.throws(() => parsePack(pack((s) => { s.data = "AAAA"; })), /size/);
  assert.throws(() => parsePack(pack((s) => { s.engine = "hd9"; })), /engine/);
  const p = parsePack(pack().replace(/^\{/, '{"__proto__":{"polluted":1},'));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.hasOwn(p, "__proto__"), false);
});
