import { shell, ipcMain } from "electron";
import { appendFileSync, existsSync, renameSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expectedFiles, isBackupFolderName, parseManifest, summarizeManifest, unsafe, verifyFiles, type BackupSummary } from "../../core/backup/manifest.ts";

// Backup Manager IPC. The renderer sends plain folder names; every handler checks the name before touching disk.
const E2E = process.env.KRONOS_E2E === "1";

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await folderBytes(p);
    else if (e.isFile()) total += (await stat(p)).size;
  }
  return total;
}

export function registerBackups(backupDir: () => string): void {
  const folder = (name: unknown): string => {
    if (typeof name !== "string" || !isBackupFolderName(name)) throw new Error("bad backup folder name");
    const dir = path.join(backupDir(), name);
    if (!existsSync(dir)) throw new Error("no such backup");
    return dir;
  };
  const manifestOf = async (dir: string): Promise<unknown> => parseManifest(await readFile(path.join(dir, "manifest.json"), "utf8"));

  ipcMain.handle("kronos:backup-list", async () => {
    const root = backupDir();
    if (!existsSync(root)) return [];
    const rows: { name: string; bytes: number; summary: BackupSummary | null }[] = [];
    for (const e of await readdir(root, { withFileTypes: true })) {
      if (!e.isDirectory() || !isBackupFolderName(e.name)) continue;
      const dir = path.join(root, e.name);
      let summary: BackupSummary | null = null;
      try {
        summary = summarizeManifest(await manifestOf(dir));
      } catch {
        summary = null;
      }
      rows.push({ name: e.name, bytes: await folderBytes(dir), summary });
    }
    // Newest first; damaged last.
    rows.sort((a, b) => (a.summary && b.summary ? b.summary.created.localeCompare(a.summary.created) : a.summary ? -1 : b.summary ? 1 : a.name.localeCompare(b.name)));
    return rows;
  });

  ipcMain.handle("kronos:backup-verify", async (_e, name: unknown) => {
    const dir = folder(name);
    const m = await manifestOf(dir);
    // shortcut: reads every file into memory at once, so a keyboard with a huge object set uses that much RAM briefly; stream the hashes if it ever hurts.
    const files = new Map<string, Uint8Array>();
    
    for (const f of expectedFiles(m)) {
      if (unsafe(f.file)) continue;
      try {
        files.set(f.file, await readFile(path.join(dir, ...f.file.split("/"))));
      } catch {
        // missing: verifyFiles reports it
      }
    }
    return verifyFiles(m, (f) => files.get(f) ?? null);
  });

  ipcMain.handle("kronos:backup-open", async (_e, name: unknown) => {
    const dir = folder(name);
    const m = (await manifestOf(dir)) as { pcg: { file: string } };
    if (unsafe(m.pcg.file)) throw new Error("backup PCG name is unsafe");
    const target = path.join(dir, ...m.pcg.file.split("/"));
    if (!existsSync(target)) return null;
    return { name, bytes: new Uint8Array(await readFile(target)) };
  });

  ipcMain.handle("kronos:backup-reveal", (_e, name: unknown): void => {
    const dir = folder(name);
    if (E2E && process.env.KRONOS_E2E_REVEAL_LOG) appendFileSync(process.env.KRONOS_E2E_REVEAL_LOG, `${dir}\n`);
    else shell.showItemInFolder(dir);
  });

  ipcMain.handle("kronos:backup-delete", async (_e, name: unknown): Promise<void> => {
    const dir = folder(name);
    if (E2E && process.env.KRONOS_E2E_TRASH_DIR) renameSync(dir, path.join(process.env.KRONOS_E2E_TRASH_DIR, path.basename(dir)));
    else await shell.trashItem(dir);
  });
}
