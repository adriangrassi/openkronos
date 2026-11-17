import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } from "electron";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BackupFile, OpenedFile, RecentState } from "../shared/api.ts";
import { MAX_PACK_BYTES } from "../../core/pcg/exchange.ts";
import { chatVia, providerStatus, testProvider } from "./ai-connect.ts";
import { cancelCli } from "./ai-cli.ts";
import { cancelLocal, localReady } from "./ai-local.ts";
import { PROVIDER_IDS, type ProviderId } from "../../core/ai/connect.ts";
import { isAllowedLink } from "../../core/links.ts";
import { registerAiCache } from "./ai-cache.ts";
import { runLine } from "../../core/ai/runlog.ts";
import { ensureDir } from "./ensure-dir.ts";
import { registerBackups } from "./backups.ts";
import { clearCache, readCache, writeCache } from "./last-cache.ts";
import { decideReopen } from "./reopen.ts";
import { registerMidi } from "./midiweb.ts";
import { clearSessionRecovery, registerRecovery } from "./recovery.ts";
import { registerPullCache } from "./pull-cache.ts";
import { currentSettings, registerSettings } from "./settings.ts";
import { registerSpeech } from "./speech-ipc.ts";
import { registerSnapshots } from "./snapshots-store.ts";
import { findRecent, forgetRecent, recentItems, reopenLastOn, rememberFile, rememberWindow, setReopenLast, windowBounds, type WindowBounds } from "./shell-store.ts";
import { registerSoundLibrary } from "./sound-library.ts";
import { parseSyncState, type SyncState } from "../../core/device/syncstate.ts";

// Test overrides for files and folders are read only in a KRONOS_E2E=1 launch.
const E2E = process.env.KRONOS_E2E === "1";
// A gate launch keeps its recent list and window state in its temp APPDATA, not the owner's profile (Electron ignores the APPDATA variable on Windows).
if (E2E && process.env.APPDATA) app.setPath("userData", path.join(process.env.APPDATA, "OpenKronos E2E"));
// A pre-release install kept its data under the old product name: move it once, so backups and settings are not orphaned.
if (!E2E) for (const [from, to] of [[path.join(app.getPath("home"), "Kronos Studio"), path.join(app.getPath("home"), "OpenKronos")], [path.join(app.getPath("appData"), "kronos-studio"), path.join(app.getPath("appData"), "openkronos")]]) {
  try { if (existsSync(from) && !existsSync(to)) renameSync(from, to); } catch { /* in use by another copy: the old folder stays and the app starts empty */ }
}
const MAX_BYTES = 64 * 1024 * 1024;
const RENDERER = fileURLToPath(new URL("../renderer/index.html", import.meta.url));
const APP_PAGE = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(RENDERER).href;
const ALLOWED_PERMISSIONS = new Set(["midi", "midiSysex"]);
const PCG_FILTER = [{ name: "KORG PCG", extensions: ["PCG", "pcg"] }];
const MIDI_FILTER = [{ name: "MIDI file", extensions: ["mid", "midi", "MID", "MIDI"] }];
const MAX_MIDI_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_CHARS = 4 * 1024 * 1024;

// Electron ignores the APPDATA variable on Windows; an e2e launch uses it so tests get their own userData.
if (E2E && process.env.APPDATA) app.setPath("userData", path.join(process.env.APPDATA, "openkronos"));

let win: BrowserWindow | null = null;
let currentPath: string | null = null;
let pendingPath: string | null = null;
// The disk copy waiting for the renderer to confirm it parsed; only then does it become the cached last file.
let pendingCache: { st: { size: number; mtimeMs: number }; bytes: Uint8Array } | null = null;
let allowClose = false;
let applySettings: (w: BrowserWindow) => void = () => {};

const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

function uniquePath(p: string): string {
  if (!existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, `${name} (${n})${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
}

function pcgBytes(v: unknown): Uint8Array {
  if (!(v instanceof Uint8Array)) throw new Error("expected file contents");
  if (v.length < 28 || v.length > MAX_BYTES) throw new Error(`file is ${v.length} bytes, not a .PCG size`);
  if (Buffer.from(v.subarray(0, 4)).toString("latin1") !== "KORG") throw new Error("not a KORG .PCG file");
  return v;
}

// A file that already exists is copied aside first, so a save never destroys what was there.
function writeKeepingBackup(target: string, data: Uint8Array): void {
  if (existsSync(target)) copyFileSync(target, uniquePath(`${target}.bak-${stamp()}`));
  writeFileSync(target, data);
}

function plainName(v: unknown): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 200) throw new Error("bad backup name");
  if (/[\\/\0]/.test(v) || v.includes("..")) throw new Error("backup name must be a plain file name");
  const safe = v.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[. ]+/, "").slice(0, 120);
  if (safe.length === 0) throw new Error("bad backup name");
  return /\.pcg$/i.test(safe) ? safe : `${safe}.PCG`;
}

const backupDir = (): string =>
  (E2E && process.env.KRONOS_E2E_BACKUP_DIR) || path.join(app.getPath("home"), "OpenKronos", "Backups");

// Backup folders and files are plain relative names: one or two segments, no separators beyond "/", no "..", no absolute paths.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,120}$/;
function backupFolderName(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("Kronos Backup ") || !SEGMENT.test(v)) throw new Error("bad backup folder name");
  return v;
}

function backupFileName(v: unknown): string {
  if (typeof v !== "string" || v.length > 200) throw new Error("bad backup file name");
  const parts = v.split("/");
  if (parts.length > 2 || !parts.every((p) => SEGMENT.test(p))) throw new Error(`bad backup file name ${JSON.stringify(v)}`);
  return parts.join("/");
}

// Each file goes to a path inside the folder, so a name can never climb out of it.
function backupTarget(folder: string, name: string): string {
  const target = path.join(folder, ...name.split("/"));
  if (!path.resolve(target).startsWith(path.resolve(folder) + path.sep)) throw new Error("backup file would leave its folder");
  return target;
}

// An e2e launch never touches the owner's real cache: it uses the override or its own userData.
const cacheDir = (): string => (E2E ? process.env.KRONOS_E2E_CACHE_DIR || path.join(app.getPath("userData"), "Cache") : path.join(app.getPath("home"), "OpenKronos", "Cache"));

function readFromDisk(p: string): Uint8Array {
  const st = statSync(p);
  const bytes = new Uint8Array(readFileSync(p));
  if (bytes.length > MAX_BYTES) throw new Error("file is too large to be a .PCG");
  pendingPath = p;
  pendingCache = { st: { size: st.size, mtimeMs: st.mtimeMs }, bytes };
  return bytes;
}

// Opens a Recent Files entry by id. A file that has gone is reported and removed from the list.
function openRecent(id: string): OpenedFile {
  const entry = findRecent(id);
  if (!entry) throw new Error("That file is not in Recent Files.");
  if (!existsSync(entry.path)) {
    forgetRecent(id);
    throw new Error(`${entry.name} is no longer there. It was removed from Recent Files.`);
  }
  return { name: entry.name, bytes: readFromDisk(entry.path) };
}

function registerIpc(): void {
  registerMidi(() => win);
  registerBackups(backupDir);
  registerSoundLibrary();
  registerRecovery();
  registerPullCache();
  applySettings = registerSettings(() => win).applyToWindow;
  registerSnapshots();
  registerAiCache();

  ipcMain.handle("kronos:open", async (): Promise<OpenedFile | null> => {
    let p: string | undefined;
    if (E2E) {
      p = process.env.KRONOS_E2E_OPEN;
    } else {
      const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: PCG_FILTER });
      p = r.canceled ? undefined : r.filePaths[0];
    }
    if (!p) return null;
    // The renderer confirms the open once it has parsed the file, so a damaged file never becomes the save target.
    return { name: path.basename(p), bytes: readFromDisk(p) };
  });

  // The file is read here, so the renderer never names a path. The renderer parses it and keeps the old file if it is bad.
  ipcMain.handle("kronos:midi-open", async (): Promise<OpenedFile | null> => {
    let p: string | undefined;
    if (E2E) {
      p = process.env.KRONOS_E2E_MIDI;
    } else {
      const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: MIDI_FILTER });
      p = r.canceled ? undefined : r.filePaths[0];
    }
    if (!p) return null;
    if (statSync(p).size > MAX_MIDI_BYTES) throw new Error("MIDI file is over 8 MB");
    return { name: path.basename(p), bytes: new Uint8Array(readFileSync(p)) };
  });

  // Read-only compare file: the main process returns its bytes and never keeps a handle to it.
  ipcMain.handle("kronos:compare-open", async (): Promise<OpenedFile | null> => {
    let p: string | undefined;
    if (E2E) {
      p = process.env.KRONOS_E2E_COMPARE;
    } else {
      const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: PCG_FILTER });
      p = r.canceled ? undefined : r.filePaths[0];
    }
    if (!p) return null;
    if (statSync(p).size > MAX_BYTES) throw new Error("file is too large to be a .PCG");
    const bytes = new Uint8Array(readFileSync(p));
    pcgBytes(bytes);
    return { name: path.basename(p), bytes };
  });

  ipcMain.handle("kronos:confirm-open", () => {
    if (!pendingPath) throw new Error("nothing is waiting to be opened");
    currentPath = pendingPath;
    pendingPath = null;
    rememberFile(currentPath);
    const c = pendingCache;
    pendingCache = null;
    // A failed cache write must never block opening the file.
    if (c) {
      try {
        writeCache(cacheDir(), currentPath, c.st, c.bytes);
      } catch (e) {
        console.error("cache write failed", e);
      }
    }
  });

  ipcMain.handle("kronos:forget-path", () => {
    currentPath = null;
  });

  ipcMain.handle("kronos:save-as", async (_e, bytes: unknown): Promise<string | null> => {
    const data = pcgBytes(bytes);
    let p: string | undefined;
    if (E2E) {
      p = process.env.KRONOS_E2E_SAVE;
    } else {
      const r = await dialog.showSaveDialog(win!, {
        defaultPath: currentPath ? path.basename(currentPath) : "Untitled.PCG",
        filters: PCG_FILTER,
      });
      p = r.canceled ? undefined : r.filePath;
    }
    if (!p) return null;
    writeKeepingBackup(p, data);
    currentPath = p;
    rememberFile(p);
    return path.basename(p);
  });

  ipcMain.handle("kronos:bank-tools-export", async (_e, format: unknown, content: unknown): Promise<string | null> => {
    if (format !== "csv" && format !== "html") throw new Error("export format must be csv or html");
    if (typeof content !== "string" || content.length > MAX_EXPORT_CHARS) throw new Error("export contents must be text of a sensible size");
    let p: string | undefined;
    if (E2E) {
      p = process.env.KRONOS_E2E_EXPORT;
    } else {
      const dir = path.join(app.getPath("home"), "OpenKronos", "Exports");
      ensureDir(dir);
      const r = await dialog.showSaveDialog(win!, {
        defaultPath: path.join(dir, `Kronos bank list.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      p = r.canceled ? undefined : r.filePath;
    }
    if (!p) return null;
    writeFileSync(p, content, "utf8");
    return path.basename(p);
  });

  // .ksound packs: the main process owns both dialogs; the renderer never sends or receives a path.
  ipcMain.handle("kronos:exchange-save", async (_e, content: unknown): Promise<string | null> => {
    if (typeof content !== "string" || content.length > MAX_PACK_BYTES) throw new Error("pack is too large to save");
    let p: string | undefined;
    if (E2E) {
      p = process.env.KRONOS_E2E_EXCHANGE_SAVE;
    } else {
      const dir = path.join(app.getPath("home"), "OpenKronos", "Exports");
      ensureDir(dir);
      const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(dir, "Sounds.ksound"), filters: [{ name: "Kronos sounds", extensions: ["ksound"] }] });
      p = r.canceled ? undefined : r.filePath;
    }
    if (!p) return null;
    writeFileSync(p, content, "utf8");
    return path.basename(p);
  });

  ipcMain.handle("kronos:exchange-open", async (): Promise<OpenedFile | null> => {
    let p: string | undefined;
    if (E2E) {
      p = process.env.KRONOS_E2E_EXCHANGE_OPEN;
    } else {
      const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: [{ name: "Kronos sounds", extensions: ["ksound"] }] });
      p = r.canceled ? undefined : r.filePaths[0];
    }
    if (!p) return null;
    if (statSync(p).size > MAX_PACK_BYTES) throw new Error(`pack is too large (size limit ${MAX_PACK_BYTES} bytes)`);
    return { name: path.basename(p), bytes: new Uint8Array(readFileSync(p)) };
  });

  ipcMain.handle("kronos:save", (_e, bytes: unknown): string => {
    const data = pcgBytes(bytes);
    if (!currentPath) throw new Error("no file to save to: use Save As");
    writeKeepingBackup(currentPath, data);
    return path.basename(currentPath);
  });

  ipcMain.handle("kronos:write-backup", (_e, name: unknown, bytes: unknown): string => {
    const file = plainName(name);
    const data = pcgBytes(bytes);
    const dir = backupDir();
    ensureDir(dir);
    const target = uniquePath(path.join(dir, file));
    writeFileSync(target, data);
    return path.basename(target);
  });

  ipcMain.handle("kronos:backup-begin", (_e, name: unknown): string => {
    const root = backupDir();
    ensureDir(root);
    const folder = uniquePath(path.join(root, backupFolderName(name)));
    mkdirSync(folder);
    return path.basename(folder);
  });

  ipcMain.handle("kronos:backup-write", (_e, folder: unknown, files: unknown): Record<string, string> => {
    const dir = path.join(backupDir(), backupFolderName(folder));
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error("no backup folder to write into");
    if (!Array.isArray(files) || files.length > 1000) throw new Error("expected a list of backup files");
    const sha: Record<string, string> = {};
    for (const f of files as Partial<BackupFile>[]) {
      const name = backupFileName(f.name);
      if (!(f.bytes instanceof Uint8Array) || f.bytes.length > MAX_BYTES) throw new Error(`bad contents for ${name}`);
      const target = backupTarget(dir, name);
      ensureDir(path.dirname(target));
      writeFileSync(target, f.bytes);
      sha[name] = createHash("sha256").update(f.bytes).digest("hex");
    }
    return sha;
  });

  // The MIDI monitor copies its text here. Only a bounded string reaches the clipboard.
  ipcMain.handle("kronos:copy-text", (_e, text: unknown): void => {
    if (typeof text !== "string" || text.length > 5_000_000) throw new Error("copy-text takes a string of up to 5 MB");
    clipboard.writeText(text);
  });
  // The route only names a provider and model; the router address comes from the saved settings and the key from the environment.
  ipcMain.handle("kronos:ai-chat", (_e, messages: unknown, tools: unknown, route?: unknown) => chatVia(route, messages, tools, currentSettings()));
  ipcMain.handle("kronos:ai-cancel", (): void => {
    cancelLocal();
    cancelCli();
  });
  // The AI connection screen: which providers are usable, and one tiny real call. The renderer names a provider; no path, command or URL comes from it.
  const providerArg = (id: unknown): ProviderId => {
    const p = PROVIDER_IDS.find((x) => x === id);
    if (!p) throw new Error("unknown AI provider");
    return p;
  };
  ipcMain.handle("kronos:ai-provider-status", (_e, id: unknown) => providerStatus(providerArg(id), currentSettings()));
  ipcMain.handle("kronos:ai-test", (_e, id: unknown) => testProvider(providerArg(id), currentSettings()));
  ipcMain.handle("kronos:ai-local-ready", (): boolean => localReady());
  // Speech for the AI window and the secrets store for its keys: the address comes from the saved settings, and the reply is a typed result, never a throw.
  registerSpeech(currentSettings);
  ipcMain.handle("kronos:open-link", (_e, url: unknown) => { if (!isAllowedLink(url)) return false; void shell.openExternal(url); return true; });
  // Run and decision rows (format in core/ai/runlog.ts) go to userData/ai-runs.jsonl, on this computer only.
  ipcMain.handle("kronos:ai-run-log", (_e, row: unknown): void => {
    appendFileSync(path.join(app.getPath("userData"), "ai-runs.jsonl"), `${runLine(row)}\n`);
  });
  // One line per finished AI run in userData/ai-usage.jsonl. Only these fields are written, and the request is cut to 80 characters.
  ipcMain.handle("kronos:ai-usage-log", (_e, row: unknown): void => {
    const r = (row ?? {}) as Record<string, unknown>;
    if (typeof r.time !== "string" || typeof r.request !== "string") throw new Error("bad usage row");
    const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const line = { time: r.time.slice(0, 40), request: r.request.slice(0, 80), steps: n(r.steps), input: n(r.input), cached: n(r.cached), output: n(r.output), total: n(r.total), song: typeof r.song === "string" ? r.song.slice(0, 200) : null };
    appendFileSync(path.join(app.getPath("userData"), "ai-usage.jsonl"), `${JSON.stringify(line)}\n`);
  });

  // Per-slot hashes of what the keyboard held after the last sync, in userData/sync-state.json. A missing or corrupt file reads as empty.
  const syncFile = (): string => path.join(app.getPath("userData"), "sync-state.json");
  ipcMain.handle("kronos:sync-state-get", (): SyncState => {
    try {
      return parseSyncState(JSON.parse(readFileSync(syncFile(), "utf8")));
    } catch {
      return parseSyncState(null);
    }
  });
  ipcMain.handle("kronos:sync-state-set", (_e, state: unknown): void => {
    writeFileSync(syncFile(), JSON.stringify(parseSyncState(state)));
  });

  ipcMain.handle("kronos:recent", (): RecentState => ({ items: recentItems(), reopenLast: reopenLastOn() }));

  ipcMain.handle("kronos:recent-open", (_e, id: unknown): OpenedFile => {
    if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) throw new Error("bad recent file id");
    return openRecent(id);
  });

  ipcMain.handle("kronos:reopen-last", (): OpenedFile | null => {
    const first = recentItems()[0];
    if (!reopenLastOn() || !first) return null;
    const entry = findRecent(first.id)!;
    let st: { size: number; mtimeMs: number } | null = null;
    try {
      st = statSync(entry.path);
    } catch {
      // Missing or offline original: st stays null.
    }
    const c = readCache(cacheDir());
    const usable = c && c.meta.originalPath === entry.path ? c : null;
    const d = decideReopen({
      reopenLast: true,
      original: st && { exists: true, ...st },
      cache: usable && { size: usable.meta.size, mtimeMs: usable.meta.mtimeMs, sha256Ok: true },
    });
    if (d.use === "original") return { ...openRecent(first.id), notice: `Reopened ${entry.name}` };
    if (d.use === "none") return openRecent(first.id);
    pendingCache = null;
    if (st) {
      pendingPath = entry.path;
      return { name: entry.name, bytes: usable!.bytes, notice: `Reopened ${entry.name}` };
    }
    pendingPath = null;
    return { name: entry.name, bytes: usable!.bytes, unnamed: true, notice: `Original ${entry.path} not found: opened the cached copy. Save As to choose where to save.` };
  });

  ipcMain.handle("kronos:clear-cache", (): void => clearCache(cacheDir()));

  ipcMain.handle("kronos:set-reopen-last", (_e, on: unknown) => {
    if (typeof on !== "boolean") throw new Error("expected true or false");
    setReopenLast(on);
  });

  ipcMain.handle("kronos:confirm-close", async () => {
    await clearSessionRecovery();
    allowClose = true;
    win?.close();
  });
}

// A saved position is used only if some connected display still shows part of that rectangle; otherwise the window opens centred at its saved size.
// shortcut: checks the work areas only, not which display was used, when a monitor is unplugged; upgrade to a display-id match if that is ever seen.
function visibleBounds(b: WindowBounds): WindowBounds {
  if (b.x === undefined || b.y === undefined) return { width: b.width, height: b.height };
  const { x, y, width, height } = b as Required<WindowBounds>;
  const on = screen.getAllDisplays().some(({ workArea: a }) => x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y);
  return on ? { x, y, width, height } : { width, height };
}

function createWindow(): void {
  const saved = windowBounds();
  const w = new BrowserWindow({
    title: "OpenKronos",
    ...(saved ? visibleBounds(saved) : { width: 1400, height: 900 }),
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Playback must keep going when the window is in the background.
      backgroundThrottling: false,
      additionalArguments: E2E ? ["--kronos-e2e", ...(process.env.KRONOS_E2E_VARIATIONS_SEED ? [`--kronos-e2e-variations-seed=${process.env.KRONOS_E2E_VARIATIONS_SEED}`] : []), ...(process.env.KRONOS_E2E_BARE_SIM === "1" ? ["--kronos-e2e-bare-sim"] : []), ...(/^[0-9,]+$/.test(process.env.KRONOS_E2E_EFFECTS_UNKNOWN ?? "") ? [`--kronos-effects-unknown=${process.env.KRONOS_E2E_EFFECTS_UNKNOWN}`] : [])] : [],
    },
  });
  win = w;
  if (saved?.maximized) w.maximize();

  w.webContents.on("will-navigate", (e, url) => {
    if (url.split("#")[0] !== APP_PAGE.split("#")[0]) e.preventDefault();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("did-finish-load", () => applySettings(w));
  w.on("page-title-updated", (e) => e.preventDefault());

  const session = w.webContents.session;
  session.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  session.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  // The renderer decides whether unsaved edits block the close.
  w.on("close", (e) => {
    rememberWindow({ ...w.getNormalBounds(), maximized: w.isMaximized() });
    if (allowClose) return;
    e.preventDefault();
    w.webContents.send("kronos:close-request");
  });
  w.on("closed", () => {
    win = null;
  });

  void (process.env.ELECTRON_RENDERER_URL ? w.loadURL(APP_PAGE) : w.loadFile(RENDERER));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
