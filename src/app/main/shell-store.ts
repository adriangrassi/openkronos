// The shell's saved state in userData/shell.json: Recent Files (paths stay here), the reopen setting and the window bounds.
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RecentItem } from "../shared/api.ts";
import { addRecent, newRecentId, withoutRecent, type RecentEntry } from "./recent.ts";

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

interface ShellData {
  recent: RecentEntry[];
  reopenLast: boolean;
  reopenChosen: boolean; // true only once the owner has used the checkbox
  window: WindowBounds | null;
}

const ID = /^[0-9a-f]{32}$/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isEntry = (v: unknown): v is RecentEntry => {
  const e = v as Partial<RecentEntry> | null;
  return !!e && typeof e.id === "string" && ID.test(e.id) && typeof e.name === "string" && typeof e.path === "string";
};
const isBounds = (v: unknown): v is WindowBounds => {
  const b = v as Partial<WindowBounds> | null;
  return !!b && finite(b.width) && finite(b.height) && b.width >= 400 && b.height >= 300 && b.width <= 10000 && b.height <= 10000 && (b.x === undefined || finite(b.x)) && (b.y === undefined || finite(b.y)) && (b.maximized === undefined || typeof b.maximized === "boolean");
};

let cache: ShellData | null = null;
const file = (): string => path.join(app.getPath("userData"), "shell.json");

function load(): ShellData {
  if (cache) return cache;
  let raw: Partial<ShellData> = {};
  try {
    raw = JSON.parse(readFileSync(file(), "utf8")) as Partial<ShellData>;
  } catch {
    // No file yet, or a damaged one: start from empty settings.
  }
  cache = {
    recent: Array.isArray(raw.recent) ? raw.recent.filter(isEntry) : [],
    // Older builds saved reopenLast:false without the owner choosing it, so only a recorded choice can keep it off.
    reopenChosen: raw.reopenChosen === true,
    reopenLast: raw.reopenChosen === true ? raw.reopenLast === true : true,
    window: isBounds(raw.window) ? raw.window : null,
  };
  return cache;
}

function save(): void {
  writeFileSync(file(), JSON.stringify(load()));
}

export function recentItems(): RecentItem[] {
  return load().recent.map((e) => ({ id: e.id, name: e.name }));
}

export function findRecent(id: string): RecentEntry | undefined {
  return load().recent.find((e) => e.id === id);
}

export function rememberFile(p: string): void {
  const d = load();
  // The same path keeps its id when it moves to the top, so an id the renderer holds stays valid.
  d.recent = addRecent(d.recent, p, d.recent.find((e) => e.path === p)?.id ?? newRecentId());
  save();
}

export function forgetRecent(id: string): void {
  const d = load();
  d.recent = withoutRecent(d.recent, id);
  save();
}

export function reopenLastOn(): boolean {
  return load().reopenLast;
}

export function setReopenLast(on: boolean): void {
  load().reopenLast = on;
  load().reopenChosen = true;
  save();
}

export function windowBounds(): WindowBounds | null {
  return load().window;
}

// Called from the window's close handler, so a failed write must not throw there. Settings are not worth a crash; the next close retries.
export function rememberWindow(b: WindowBounds): void {
  if (!isBounds(b)) return;
  load().window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: b.maximized === true };
  try {
    save();
  } catch {
    // Disk full or read-only userData: the window state is simply not remembered this time.
  }
}
