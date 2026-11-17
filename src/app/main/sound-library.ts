// The Sound Browser's library file: <home>/OpenKronos/library.json. Written only here, atomically, after validation.
import { app, ipcMain } from "electron";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeLibrary, parseLibrary, type LibraryData } from "../../core/pcg/catalog.ts";
import { ensureDir } from "./ensure-dir.ts";

const FILE = "library.json";

// The test folder is read only in a KRONOS_E2E=1 launch.
const folder = (): string => (process.env.KRONOS_E2E === "1" && process.env.KRONOS_E2E_SOUNDS_DIR) || path.join(app.getPath("home"), "OpenKronos");

// A corrupt library is kept aside as library.json.bad (a second corrupt one gets a time stamp, so nothing is overwritten).
function keepBad(file: string): void {
  const bad = `${file}.bad`;
  renameSync(file, existsSync(bad) ? `${bad}-${Date.now()}` : bad);
}

export function registerSoundLibrary(): void {
  ipcMain.handle("kronos:sound-library-load", (): { data: LibraryData; corrupt: boolean } => {
    const file = path.join(folder(), FILE);
    if (!existsSync(file)) return parseLibrary(null);
    const r = parseLibrary(readFileSync(file, "utf8"));
    if (r.corrupt) keepBad(file);
    return r;
  });

  // Validation happens before anything is written, so refused data leaves the file as it was.
  ipcMain.handle("kronos:sound-library-save", (_e, data: unknown): void => {
    const text = encodeLibrary(data);
    const dir = folder();
    ensureDir(dir);
    const file = path.join(dir, FILE);
    const tmp = path.join(dir, `${FILE}.${process.pid}.tmp`);
    try {
      writeFileSync(tmp, text);
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
