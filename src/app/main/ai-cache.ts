// The saved-answer file: userData/ai-answers.json, read once on first use, written atomically after each change. A corrupt or old file reads as empty.
// The renderer sends a key and text only; it never names a path. What may be saved is decided again here, so a bad caller cannot fill the file with junk.
import { app, ipcMain } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emptyStore, getAnswer, isHedged, KEY_PATTERN, MAX_ANSWER, parseStore, putAnswer, serialize, stats, type Store } from "../../core/ai/answerCache.ts";
import { ensureDir } from "./ensure-dir.ts";

let store: Store | null = null;
const file = (): string => path.join(app.getPath("userData"), "ai-answers.json");

function load(): Store {
  if (store) return store;
  try {
    store = existsSync(file()) ? parseStore(readFileSync(file(), { encoding: "utf8" })) : emptyStore();
  } catch {
    store = emptyStore();
  }
  return store;
}

// shortcut: a synchronous write of at most 2 MB on each save; upgrade if answers ever grow past that.
function persist(s: Store): void {
  ensureDir(app.getPath("userData"));
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, serialize(s), { encoding: "utf8" });
  renameSync(tmp, file());
}

const checkKey = (k: unknown): string => {
  if (typeof k !== "string" || !KEY_PATTERN.test(k)) throw new Error("bad answer key");
  return k;
};

export function registerAiCache(): void {
  ipcMain.handle("kronos:ai-cache-get", (_e, key: unknown): string | null => getAnswer(load(), checkKey(key)));
  // A save that fails (disk full, folder locked) must not stop the answer from showing: it returns false instead of throwing.
  ipcMain.handle("kronos:ai-cache-put", (_e, key: unknown, text: unknown): boolean => {
    checkKey(key);
    if (typeof text !== "string" || text.trim() === "" || text.length > MAX_ANSWER || isHedged(text)) return false;
    try {
      const s = load();
      putAnswer(s, key as string, text);
      persist(s);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("kronos:ai-cache-clear", (): boolean => {
    store = emptyStore();
    try {
      persist(store);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle("kronos:ai-cache-stats", (): { count: number; bytes: number } => stats(load()));
}
