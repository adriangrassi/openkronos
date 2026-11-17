// settings.json in userData: read at startup (corrupt means defaults), written atomically after every set.
import { app, ipcMain, type BrowserWindow } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, mergeSettings, parseSettingsFile, type Settings } from "../../core/settings.ts";
import { ensureDir } from "./ensure-dir.ts";

let current: Settings = { ...DEFAULT_SETTINGS };
export const currentSettings = (): Settings => current;
const file = (): string => path.join(app.getPath("userData"), "settings.json");

// shortcut: the write is synchronous (a few dozen bytes), upgrade if settings ever grow.
function persist(): void {
  ensureDir(app.getPath("userData"));
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(current));
  renameSync(tmp, file());
}

const apply = (w: BrowserWindow | null): void => {
  if (w && !w.isDestroyed()) w.webContents.setZoomFactor(current.scale / 100);
};

export function registerSettings(getWin: () => BrowserWindow | null): { applyToWindow: (w: BrowserWindow) => void } {
  try {
    current = existsSync(file()) ? parseSettingsFile(readFileSync(file(), "utf8")) : { ...DEFAULT_SETTINGS };
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  ipcMain.handle("kronos:settings-get", (): Settings => current);
  ipcMain.handle("kronos:settings-set", (_e, patch: unknown): Settings => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("settings patch must be an object");
    current = mergeSettings(current, patch);
    persist();
    apply(getWin());
    return current;
  });
  return { applyToWindow: apply };
}
