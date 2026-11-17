// MIDI browser in the main process: search and download from three sites, and the MIDI library folder.
// The renderer sends only a site id, a search string or a reference; every URL and file name is built here.
import { app, dialog, ipcMain, net, shell, type BrowserWindow } from "electron";
import { readFile, rename, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureDir } from "./ensure-dir.ts";
import { isPlaylistName, parsePlaylist, serializePlaylist } from "../../core/midi/playlist.ts";
import { MAX_RECORD_EVENTS } from "../../core/midi/recorder.ts";
import type { MidiLibraryEntry } from "../shared/api.ts";
import { allowedUrl, downloadRequest, isMidi, parseResults, safeFileName, searchUrl, SITES, type MidiHit, type SiteId } from "../../core/midi/sites.ts";

const E2E = process.env.KRONOS_E2E === "1";
const TIMEOUT_MS = 20000;
const MAX_BYTES = 8 * 1024 * 1024;
const UA = "OpenKronos/1.0";
const MIDI_FILTER = [{ name: "MIDI file", extensions: ["mid", "midi", "MID", "MIDI"] }];
const LIB_NAME = /^[^\\/:*?"<>|\0]{1,196}\.(mid|midi)$/i;

// Test-only switches, read at call time: fixtures replace the network, and KRONOS_E2E_MIDI_DIR replaces the library folder.
const fixture = (): Record<string, unknown> | null => (E2E && process.env.KRONOS_E2E_MIDI_WEB ? (JSON.parse(process.env.KRONOS_E2E_MIDI_WEB) as Record<string, unknown>) : null);
const testDir = (): string | undefined => (E2E && process.env.KRONOS_E2E_MIDI_DIR) || undefined;

function libraryDir(): string {
  const dir = testDir() ?? path.join(app.getPath("home"), "OpenKronos", "MIDI");
  ensureDir(dir);
  return dir;
}

function siteId(v: unknown): SiteId {
  const s = SITES.find((x) => x.id === v);
  if (!s) throw new Error("unknown MIDI site");
  return s.id;
}

// One request per user action. The body is read with a limit, and only the site's own address is ever requested.
async function getLimited(url: string, headers: Record<string, string> = {}): Promise<{ bytes: Uint8Array; cookies: string }> {
  if (!allowedUrl(url)) throw new Error("refused an address outside the MIDI sites");
  // Electron can't show where a redirect leads before following it, so redirects are refused. These addresses don't redirect today.
  const res = await net.fetch(url, { redirect: "error", headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((e: Error) => {
    throw /redirect/i.test(e.message) ? new Error("the site redirected to another address") : e;
  });
  if (!res.ok) throw new Error(`the site answered ${res.status}`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  for (;;) {
    const part = await reader?.read();
    if (!part || part.done) break;
    total += part.value.byteLength;
    if (total > MAX_BYTES) {
      await reader?.cancel();
      throw new Error("the file is over 8 MB");
    }
    chunks.push(part.value);
  }
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { bytes: Buffer.concat(chunks), cookies };
}

async function search(site: SiteId, query: string): Promise<MidiHit[]> {
  const url = searchUrl(site, query);
  const fx = fixture();
  if (fx) {
    const body = (fx[site] as { search?: unknown } | undefined)?.search;
    if (typeof body !== "string") throw new Error(`no fixture for ${site}`);
    return parseResults(site, body);
  }
  return parseResults(site, new TextDecoder().decode((await getLimited(url)).bytes));
}

async function fetchMidi(site: SiteId, ref: string): Promise<Uint8Array> {
  const req = downloadRequest(site, ref);
  const fx = fixture();
  if (fx) {
    const b64 = (fx.files as Record<string, string> | undefined)?.[`${site}:${ref}`];
    if (typeof b64 !== "string") throw new Error("no fixture file");
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  // FreeMidi: the page sets the session cookie that its file address needs.
  const headers: Record<string, string> = {};
  if (req.pageFirst) {
    const page = await getLimited(req.pageFirst);
    headers.Referer = req.pageFirst;
    if (page.cookies) headers.Cookie = page.cookies;
  }
  return (await getLimited(req.url, headers)).bytes;
}

// Same content reuses the existing file; different content gets " (2)", " (3)" and so on. Nothing is overwritten.
function saveNew(name: string, bytes: Uint8Array): string {
  const dir = libraryDir();
  const { name: base, ext } = path.parse(name);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base} (${n})${ext}`;
    const target = path.join(dir, candidate);
    try {
      writeFileSync(target, bytes, { flag: "wx" });
      return candidate;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    if (readFileSync(target).equals(bytes)) return candidate;
  }
}

// Only a plain file name ending .mid or .midi that exists directly in the library folder.
function libraryFile(v: unknown): string {
  if (typeof v !== "string" || !LIB_NAME.test(v) || v.startsWith(".") || v.includes("..")) throw new Error("not a MIDI file name");
  const p = path.join(libraryDir(), v);
  if (path.basename(p) !== v || !statSync(p, { throwIfNoEntry: false })?.isFile()) throw new Error(`no MIDI file named ${v} in the library`);
  return p;
}

async function pickMidi(win: BrowserWindow | null): Promise<string | undefined> {
  if (E2E) return process.env.KRONOS_E2E_MIDI || undefined;
  const r = await dialog.showOpenDialog(win!, { properties: ["openFile"], filters: MIDI_FILTER });
  return r.canceled ? undefined : r.filePaths[0];
}

const playlistFile = (): string => {
  const p = (E2E && process.env.KRONOS_E2E_PLAYLIST) || path.join(app.getPath("home"), "OpenKronos", "playlist.json");
  ensureDir(path.dirname(p));
  return p;
};

// Saves run one at a time, in order, and land by rename so a crash never leaves a half-written playlist.json.
let saving: Promise<unknown> = Promise.resolve();

export function registerMidi(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("kronos:playlist-load", async (): Promise<string[]> => {
    try {
      return parsePlaylist(JSON.parse(await readFile(playlistFile(), "utf8")));
    } catch {
      return []; // missing or damaged file: start with an empty queue
    }
  });

  ipcMain.handle("kronos:playlist-save", async (_e, items: unknown): Promise<void> => {
    if (!Array.isArray(items) || items.length > 5000 || !items.every(isPlaylistName)) throw new Error("not a playlist of MIDI file names");
    const file = playlistFile();
    const text = serializePlaylist(items);
    const job = saving.catch(() => undefined).then(async () => {
      await writeFile(file + ".tmp", text);
      await rename(file + ".tmp", file);
    });
    saving = job;
    await job;
  });

  ipcMain.handle("kronos:midi-search", async (_e, site: unknown, query: unknown): Promise<MidiHit[]> => {
    if (typeof query !== "string" || query.length > 200) throw new Error("bad search text");
    return search(siteId(site), query);
  });

  ipcMain.handle("kronos:midi-download", async (_e, site: unknown, ref: unknown, title: unknown): Promise<string> => {
    const s = siteId(site);
    if (typeof ref !== "string" || typeof title !== "string" || title.length > 300) throw new Error("bad file reference");
    const bytes = await fetchMidi(s, ref);
    if (!isMidi(bytes)) throw new Error("that site did not send a MIDI file for this song; nothing was saved");
    return saveNew(safeFileName(title), bytes);
  });

  ipcMain.handle("kronos:midi-library-list", (): MidiLibraryEntry[] => {
    const dir = libraryDir();
    const out: MidiLibraryEntry[] = [];
    for (const name of readdirSync(dir)) {
      if (!LIB_NAME.test(name) || name.startsWith(".")) continue;
      const st = statSync(path.join(dir, name));
      if (st.isFile()) out.push({ name, size: st.size, modified: st.mtimeMs });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle("kronos:midi-library-read", (_e, name: unknown): Uint8Array => {
    const p = libraryFile(name);
    if (statSync(p).size > MAX_BYTES) throw new Error("file is over 8 MB");
    return new Uint8Array(readFileSync(p));
  });

  ipcMain.handle("kronos:midi-library-delete", async (_e, name: unknown): Promise<void> => {
    const p = libraryFile(name);
    if (testDir()) unlinkSync(p);
    else await shell.trashItem(p);
  });

  ipcMain.handle("kronos:midi-record-max", (): number => {
    const n = Number(process.env.KRONOS_E2E_RECORD_MAX);
    return E2E && Number.isInteger(n) && n > 0 ? n : MAX_RECORD_EVENTS;
  });

  ipcMain.handle("kronos:midi-save-take", (_e, bytes: unknown): string => {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES || !isMidi(bytes)) throw new Error("not a MIDI file");
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    return saveNew(`Recording ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.mid`, bytes);
  });

  ipcMain.handle("kronos:midi-library-import", async (): Promise<string | null> => {
    const p = await pickMidi(getWin());
    if (!p) return null;
    if (statSync(p).size > MAX_BYTES) throw new Error("MIDI file is over 8 MB");
    const bytes = new Uint8Array(readFileSync(p));
    if (!isMidi(bytes)) throw new Error(`${path.basename(p)} is not a MIDI file`);
    return saveNew(safeFileName(path.basename(p)), bytes);
  });
}
