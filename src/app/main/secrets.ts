// The secrets store: userData/secrets.bin holds {name: base64 of the safeStorage ciphertext}. Only this process can decrypt; the window can set, clear and ask has, never read.
// No plaintext fallback: when the operating system cannot protect a secret, nothing is stored.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSecretName, isSecretValue, type SecretName } from "../../core/secrets.ts";
import { ensureDir } from "./ensure-dir.ts";

export type SafeStorageLike = { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string; getSelectedStorageBackend?(): string };
export type SetResult = { ok: true } | { ok: false; error: string };
export type Secrets = { set(name: unknown, value: unknown): SetResult; clear(name: unknown): boolean; has(name: unknown): boolean; get(name: SecretName): string | undefined };

export function createSecrets(file: string, ss: SafeStorageLike, env: NodeJS.ProcessEnv = process.env): Secrets {
  const read = (): Record<string, string> => {
    try {
      const j: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
      return typeof j === "object" && j !== null && !Array.isArray(j) ? (j as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const write = (m: Record<string, string>): void => {
    ensureDir(path.dirname(file));
    writeFileSync(`${file}.tmp`, JSON.stringify(m));
    renameSync(`${file}.tmp`, file);
  };
  // basic_text is Linux's "no keyring" backend: it only obscures the value, which is the plaintext fallback this store refuses.
  const usable = (): boolean => ss.isEncryptionAvailable() && ss.getSelectedStorageBackend?.() !== "basic_text";
  // The one environment key is read only in a gate launch (KRONOS_E2E=1).
  const fromEnv = (name: SecretName): string | undefined => (env.KRONOS_E2E === "1" && name === "elevenlabs" && isSecretValue(env.KRONOS_ELEVENLABS_KEY) ? env.KRONOS_ELEVENLABS_KEY : undefined);
  const get = (name: SecretName): string | undefined => {
    const c = read()[name];
    if (typeof c === "string" && usable()) {
      try {
        return ss.decryptString(Buffer.from(c, "base64"));
      } catch {
        // an unreadable entry (another user or machine) counts as absent
      }
    }
    return fromEnv(name);
  };
  return {
    set(name, value) {
      if (!isSecretName(name)) return { ok: false, error: "unknown secret" };
      if (!isSecretValue(value)) return { ok: false, error: "That does not look like a key: it must be 8 or more characters with no spaces." };
      if (!usable()) return { ok: false, error: "This computer cannot protect a saved key (no secure storage is available), so the key was not saved." };
      write({ ...read(), [name]: ss.encryptString(value).toString("base64") });
      return { ok: true };
    },
    clear(name) {
      if (!isSecretName(name)) return false;
      const { [name]: _gone, ...rest } = read();
      write(rest);
      return true;
    },
    has: (name) => isSecretName(name) && get(name) !== undefined,
    get,
  };
}
