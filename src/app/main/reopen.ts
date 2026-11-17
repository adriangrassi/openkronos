// Which copy a startup reopen should load. Cache size/mtimeMs describe the original as it was when cached.
export interface ReopenInput {
  reopenLast: boolean;
  original: { exists: boolean; size: number; mtimeMs: number } | null;
  cache: { size: number; mtimeMs: number; sha256Ok: boolean } | null;
}

export interface ReopenDecision {
  use: "original" | "cache" | "none";
  refreshCache: boolean;
}

export function decideReopen({ reopenLast, original, cache }: ReopenInput): ReopenDecision {
  if (!reopenLast) return { use: "none", refreshCache: false };
  const good = cache !== null && cache.sha256Ok;
  if (!original || !original.exists) return { use: good ? "cache" : "none", refreshCache: false };
  if (good && cache.size === original.size && cache.mtimeMs === original.mtimeMs) return { use: "cache", refreshCache: false };
  return { use: "original", refreshCache: true };
}
