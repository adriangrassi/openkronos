import { app, ipcMain } from "electron";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidRecovery, parseRecoveryFileName, planRotation } from "../../core/pcg/recovery.ts";
import { ensureDir } from "./ensure-dir.ts";

const E2E = process.env.KRONOS_E2E === "1";
// Test runs never share the owner's folder: they would offer, or leave behind, recovery copies that are not real.
const dir = (): string => (E2E ? process.env.KRONOS_E2E_RECOVERY_DIR || path.join(app.getPath("userData"), "Recovery") : path.join(app.getPath("home"), "OpenKronos", "Recovery"));
// Documents this session wrote copies for, so a clean close removes them and leaves older crashes' copies for the offer.
const mine = new Set<string>();
// One operation at a time, so two writes never plan the same rotation.
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(f: () => Promise<T>): Promise<T> => {
  const r = chain.then(f, f);
  chain = r.catch(() => undefined);
  return r;
};

const list = async (): Promise<string[]> => {
  try {
    return (await readdir(dir())).filter((n) => parseRecoveryFileName(n));
  } catch {
    return [];
  }
};

const removeFiles = async (names: string[]): Promise<void> => {
  for (const n of names) await unlink(path.join(dir(), n)).catch(() => undefined);
};

const validId = (v: unknown): v is string => typeof v === "string" && parseRecoveryFileName(`${v}.0.recovery`) !== null;

export function clearSessionRecovery(): Promise<void> {
  return queue(async () => {
    const names = await list();
    await removeFiles(names.filter((n) => mine.has(parseRecoveryFileName(n)!.docId)));
  });
}

export function registerRecovery(): void {
  ipcMain.handle("kronos:recovery-write", (_e, docId: unknown, bytes: unknown): Promise<void> => {
    if (!validId(docId)) return Promise.reject(new Error("bad recovery document id"));
    const id = docId;
    if (!(bytes instanceof Uint8Array) || !isValidRecovery(bytes)) return Promise.reject(new Error("not a .PCG file"));
    return queue(async () => {
      ensureDir(dir());
      const plan = planRotation(await list(), id);
      const target = path.join(dir(), plan.write);
      const tmp = `${target}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, target);
      mine.add(id);
      await removeFiles(plan.remove);
    });
  });

  ipcMain.handle("kronos:recovery-clear", (_e, docId: unknown): Promise<void> => {
    if (!validId(docId)) return Promise.reject(new Error("bad recovery document id"));
    const id = docId;
    return queue(async () => removeFiles((await list()).filter((n) => parseRecoveryFileName(n)!.docId === id)));
  });

  // The newest valid copy, as bytes. The renderer never sees a path.
  ipcMain.handle("kronos:recovery-peek", (): Promise<Uint8Array | null> =>
    queue(async () => {
      const found: { n: string; t: number }[] = [];
      for (const n of await list()) found.push({ n, t: (await stat(path.join(dir(), n)).catch(() => null))?.mtimeMs ?? 0 });
      found.sort((a, b) => b.t - a.t || parseRecoveryFileName(b.n)!.seq - parseRecoveryFileName(a.n)!.seq);
      for (const { n } of found) {
        const bytes = new Uint8Array(await readFile(path.join(dir(), n)).catch(() => Buffer.alloc(0)));
        if (isValidRecovery(bytes)) return bytes;
      }
      return null;
    }),
  );

  ipcMain.handle("kronos:recovery-interval", (): number => {
    const ms = Number(process.env.KRONOS_E2E_AUTOSAVE_MS);
    return E2E && Number.isFinite(ms) && ms >= 50 ? ms : 60000;
  });

  ipcMain.handle("kronos:recovery-discard", (): Promise<void> => queue(async () => removeFiles(await list())));
}
