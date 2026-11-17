// Wires speech and the secrets store to the window. The speech target is built here from the saved settings and the secrets store, so the window never names an address or a key.
import { app, ipcMain, safeStorage } from "electron";
import path from "node:path";
import type { Settings } from "../../core/settings.ts";
import { createSecrets } from "./secrets.ts";
import { cancelSpeech, elevenBase, listVoices, speechTarget, synthesize } from "./speech.ts";

export function registerSpeech(getSettings: () => Settings): void {
  const secrets = createSecrets(path.join(app.getPath("userData"), "secrets.bin"), safeStorage);
  ipcMain.handle("kronos:speech-synthesize", (_e, req: unknown) => synthesize(req, speechTarget(getSettings(), secrets)));
  ipcMain.handle("kronos:speech-cancel", (): void => cancelSpeech());
  ipcMain.handle("kronos:speech-voices", () => listVoices(elevenBase(), secrets.get("elevenlabs")));
  ipcMain.handle("kronos:secrets-set", (_e, name: unknown, value: unknown) => secrets.set(name, value));
  ipcMain.handle("kronos:secrets-clear", (_e, name: unknown) => secrets.clear(name));
  ipcMain.handle("kronos:secrets-has", (_e, name: unknown) => secrets.has(name));
}
