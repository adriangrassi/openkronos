// The last whole-keyboard pull, kept on this PC so it does not have to be pulled again.
import { app, ipcMain } from "electron";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./ensure-dir.ts";

const MAX_BYTES = 512 * 1024 * 1024;

// Tests only touch a cache when they name one, never the owner's.
const cacheDir = (): string | null => process.env.KRONOS_E2E_CACHE_DIR ?? (process.env.KRONOS_E2E === "1" ? null : path.join(app.getPath("home"), "OpenKronos", "Cache"));

export function registerPullCache(): void {
  ipcMain.handle("kronos:pull-cache-save", async (_e, bytes: unknown): Promise<void> => {
    if (!(bytes instanceof Uint8Array) || bytes.length < 1024 || bytes.length > MAX_BYTES) throw new Error("bad keyboard pull");
    const dir = cacheDir();
    if (!dir) return;
    ensureDir(dir);
    const file = path.join(dir, "keyboard.PCG");
    await writeFile(`${file}.tmp`, bytes);
    await rename(`${file}.tmp`, file); // a crash mid-write leaves the previous pull intact
  });
  ipcMain.handle("kronos:pull-cache-load", async (): Promise<{ bytes: Uint8Array; savedAt: number } | null> => {
    const dir = cacheDir();
    if (!dir) return null;
    const file = path.join(dir, "keyboard.PCG");
    try {
      const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
      return { bytes: new Uint8Array(bytes), savedAt: info.mtimeMs };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  });
}
