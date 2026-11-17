import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSecrets, type SafeStorageLike } from "./secrets.ts";

// A stand-in for safeStorage: a reversible scramble, so the test can tell the file holds ciphertext and not the key.
const fake = (available = true, backend?: string): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).reverse().toString("latin1")}`, "latin1"),
  decryptString: (b) => Buffer.from(b.toString("latin1").slice(4), "latin1").reverse().toString(),
  ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
});
const tmp = (): { dir: string; file: string } => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kronos-secrets-"));
  return { dir, file: path.join(dir, "sub", "secrets.bin") };
};
const KEY = "sk_test_0123456789abcdef";

test("set, has, get and clear round-trip, and the file holds no plaintext", () => {
  const { dir, file } = tmp();
  const s = createSecrets(file, fake(), {});
  assert.equal(s.has("elevenlabs"), false);
  assert.deepEqual(s.set("elevenlabs", KEY), { ok: true });
  assert.equal(s.has("elevenlabs"), true);
  assert.equal(s.has("speech-server"), false);
  assert.equal(s.get("elevenlabs"), KEY);
  const raw = readFileSync(file, "utf8");
  assert.ok(!raw.includes(KEY) && !raw.includes(Buffer.from(KEY).toString("base64")));
  assert.deepEqual(Object.keys(JSON.parse(raw)), ["elevenlabs"]);
  assert.equal(createSecrets(file, fake(), {}).get("elevenlabs"), KEY, "a new store reads the same file");
  assert.equal(s.clear("elevenlabs"), true);
  assert.equal(s.has("elevenlabs"), false);
  assert.equal(readdirSync(path.dirname(file)).length, 1, "no temp file is left behind");
  rmSync(dir, { recursive: true });
});

test("when encryption is unavailable nothing is stored, with no plaintext fallback", () => {
  for (const ss of [fake(false), fake(true, "basic_text")]) {
    const { dir, file } = tmp();
    const s = createSecrets(file, ss, {});
    const r = s.set("elevenlabs", KEY);
    assert.ok(!r.ok && /cannot protect/.test(r.error) && !r.error.includes(KEY));
    assert.equal(existsSync(file), false);
    assert.equal(s.has("elevenlabs"), false);
    rmSync(dir, { recursive: true });
  }
  const { dir, file } = tmp();
  assert.ok(createSecrets(file, fake(true, "gnome_libsecret"), {}).set("elevenlabs", KEY).ok);
  rmSync(dir, { recursive: true });
});

test("only the two allowed names and header-safe values are accepted", () => {
  const { dir, file } = tmp();
  const s = createSecrets(file, fake(), {});
  for (const name of ["", "other", "__proto__", "constructor", "ELEVENLABS", null, 5, "../x"]) {
    assert.equal(s.set(name, KEY).ok, false, String(name));
    assert.equal(s.has(name), false);
    assert.equal(s.clear(name), false);
  }
  for (const v of ["", "short", "has space 12345", "line\nbreak12345", "tab\t12345678", "x".repeat(401), "ünïcode-key-12345", 5, null]) assert.equal(s.set("elevenlabs", v).ok, false, String(v));
  assert.equal(s.set("speech-server", "Bearer-token_12345").ok, true);
  assert.equal(existsSync(file), true);
  rmSync(dir, { recursive: true });
});

test("a corrupt or foreign file reads as empty, and an undecryptable entry counts as absent", () => {
  const { dir, file } = tmp();
  const s = createSecrets(file, fake(), {});
  s.set("elevenlabs", KEY);
  const broken: SafeStorageLike = { ...fake(), decryptString: () => { throw new Error("other user"); } };
  assert.equal(createSecrets(file, broken, {}).has("elevenlabs"), false);
  assert.ok(s.set("elevenlabs", KEY).ok, "a bad entry can be replaced");
  rmSync(dir, { recursive: true });
});

test("KRONOS_ELEVENLABS_KEY counts only in a KRONOS_E2E=1 launch, and only for elevenlabs", () => {
  const { dir, file } = tmp();
  const key = "env_key_0123456789";
  assert.equal(createSecrets(file, fake(), { KRONOS_ELEVENLABS_KEY: key }).get("elevenlabs"), undefined);
  assert.equal(createSecrets(file, fake(), { KRONOS_E2E: "1", KRONOS_ELEVENLABS_KEY: key }).get("elevenlabs"), key);
  assert.equal(createSecrets(file, fake(), { KRONOS_E2E: "1", KRONOS_ELEVENLABS_KEY: key }).get("speech-server"), undefined);
  assert.equal(createSecrets(file, fake(), { KRONOS_E2E: "1", KRONOS_ELEVENLABS_KEY: "bad key" }).get("elevenlabs"), undefined);
  rmSync(dir, { recursive: true });
});
