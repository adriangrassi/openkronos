import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// One level at a time, so a blocked folder fails with an error. The app froze when Windows blocked a recursive mkdirSync.
export function ensureDir(dir: string): void {
  if (existsSync(dir)) return;
  const parent = path.dirname(dir);
  if (parent !== dir) ensureDir(parent);
  mkdirSync(dir);
}
