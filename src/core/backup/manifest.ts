import { createHash } from "node:crypto";

// Reading and checking a backup's manifest.json. Used by the main process (needs node:crypto); the renderer imports only the types.
export type BackupSummary = { created: string; os: string; banks: number; objects: number; failed: string[] };
type Entry = { file: string; sha256: string };
type Manifest = { created: string; os: string; pcg: Entry; banks: unknown[]; objects: Entry[]; failed: string[] };

const bad = (): never => {
  throw new Error("not a Kronos backup manifest");
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isEntry = (v: unknown): v is Entry => isObj(v) && typeof v.file === "string" && typeof v.sha256 === "string";

function asManifest(m: unknown): Manifest {
  if (!isObj(m) || typeof m.created !== "string" || typeof m.os !== "string" || !isEntry(m.pcg)) return bad();
  if (!Array.isArray(m.banks) || !Array.isArray(m.objects) || !m.objects.every(isEntry)) return bad();
  if (!Array.isArray(m.failed) || !m.failed.every((f) => typeof f === "string")) return bad();
  return m as unknown as Manifest;
}

export function parseManifest(text: string): unknown {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return bad();
  }
  return asManifest(v);
}

export function summarizeManifest(m: unknown): BackupSummary {
  const x = asManifest(m);
  return { created: x.created, os: x.os, banks: x.banks.length, objects: x.objects.length, failed: x.failed };
}

export function expectedFiles(m: unknown): Entry[] {
  const x = asManifest(m);
  return [x.pcg, ...x.objects].map((e) => ({ file: e.file, sha256: e.sha256 }));
}

export const unsafe = (f: string): boolean => f === "" || f.startsWith("/") || f.includes("\\") || f.includes(":") || f.split("/").includes("..");

export function verifyFiles(
  m: unknown,
  read: (file: string) => Uint8Array | null,
): { ok: boolean; checked: number; problems: { file: string; kind: "missing" | "mismatch" | "unsafe" }[] } {
  const list = expectedFiles(m);
  const problems: { file: string; kind: "missing" | "mismatch" | "unsafe" }[] = [];
  for (const e of list) {
    if (unsafe(e.file)) {
      problems.push({ file: e.file, kind: "unsafe" });
      continue;
    }
    const bytes = read(e.file);
    if (!bytes) problems.push({ file: e.file, kind: "missing" });
    else if (createHash("sha256").update(bytes).digest("hex") !== e.sha256.toLowerCase()) problems.push({ file: e.file, kind: "mismatch" });
  }
  return { ok: problems.length === 0, checked: list.length, problems };
}

export function isBackupFolderName(name: string): boolean {
  return typeof name === "string" && /^Kronos Backup [A-Za-z0-9][A-Za-z0-9 ._()-]{0,100}$/.test(name) && !name.includes("..");
}
