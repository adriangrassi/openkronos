// One verbatim copy of the last PCG opened from disk, in <dir>/last.pcg with its description in last.json.
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureDir } from "./ensure-dir.ts";

export interface CacheMeta {
  originalPath: string;
  name: string;
  size: number;
  mtimeMs: number;
  cachedAt: number;
  sha256: string;
}

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

// Temp file then rename for both files; the .pcg lands first, so a crash between them leaves a sha mismatch that readCache discards.
export function writeCache(dir: string, originalPath: string, st: { size: number; mtimeMs: number }, bytes: Uint8Array): void {
  ensureDir(dir);
  const meta: CacheMeta = { originalPath, name: path.basename(originalPath), size: st.size, mtimeMs: st.mtimeMs, cachedAt: Date.now(), sha256: sha(bytes) };
  const pcg = path.join(dir, "last.pcg");
  const json = path.join(dir, "last.json");
  writeFileSync(`${pcg}.tmp`, bytes);
  writeFileSync(`${json}.tmp`, JSON.stringify(meta));
  renameSync(`${pcg}.tmp`, pcg);
  renameSync(`${json}.tmp`, json);
}

export function clearCache(dir: string): void {
  for (const f of ["last.pcg", "last.json", "last.pcg.tmp", "last.json.tmp", "keyboard.PCG", "keyboard.PCG.tmp"]) rmSync(path.join(dir, f), { force: true });
}

// A copy whose bytes do not hash to the recorded sha256 (or that cannot be read) is deleted and reported as no cache.
export function readCache(dir: string): { meta: CacheMeta; bytes: Uint8Array } | null {
  let meta: CacheMeta;
  try {
    meta = JSON.parse(readFileSync(path.join(dir, "last.json"), "utf8")) as CacheMeta;
  } catch {
    return null;
  }
  try {
    const bytes = new Uint8Array(readFileSync(path.join(dir, "last.pcg")));
    const ok = typeof meta.originalPath === "string" && Number.isFinite(meta.size) && Number.isFinite(meta.mtimeMs) && bytes.length === meta.size && sha(bytes) === meta.sha256;
    if (ok) return { meta, bytes };
  } catch {
    // Unreadable copy: fall through and discard it.
  }
  clearCache(dir);
  return null;
}
