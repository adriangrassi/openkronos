// Snapshot files: <home>/OpenKronos/Snapshots/<snapshotFile>. The renderer sends a sound name and engine, never a path.
import { app, ipcMain } from "electron";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseSnapshots, serializeSnapshots, snapshotFile, validSnapshots, type Snapshot } from "../../core/pcg/snapshots.ts";
import type { ParamType } from "../../core/params/params.ts";
import { ensureDir } from "./ensure-dir.ts";

const folder = (): string => (process.env.KRONOS_E2E === "1" && process.env.KRONOS_E2E_SNAPSHOTS_DIR) || path.join(app.getPath("home"), "OpenKronos", "Snapshots");

function target(name: unknown, engine: unknown): string {
  if (typeof name !== "string" || (engine !== "hd1" && engine !== "exi" && engine !== "combi")) throw new Error("bad snapshot request");
  return path.join(folder(), snapshotFile(name, engine as ParamType));
}

export function registerSnapshots(): void {
  ipcMain.handle("kronos:snapshots-load", (_e, name: unknown, engine: unknown): Snapshot[] => {
    const file = target(name, engine);
    if (!existsSync(file)) return [];
    const list = parseSnapshots(readFileSync(file, "utf8"));
    if (list) return list;
    // shortcut: a second corrupt file overwrites the first .bad, upgrade to time-stamped names if that loses data
    renameSync(file, `${file}.bad`);
    return [];
  });

  ipcMain.handle("kronos:snapshots-save", (_e, name: unknown, engine: unknown, list: unknown): void => {
    const file = target(name, engine);
    if (!validSnapshots(list)) throw new Error("bad snapshot list");
    ensureDir(folder());
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, serializeSnapshots(list));
      renameSync(tmp, file);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {
        // nothing to clean up
      }
      throw e;
    }
  });
}
