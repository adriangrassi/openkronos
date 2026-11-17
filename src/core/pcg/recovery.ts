import { parsePcg } from "./pcg.ts";

// Crash-recovery copies: "<docId>.<seq>.recovery", a few rotations per document.
export const RECOVERY_KEEP = 3;
const MAX_RECOVERY_BYTES = 64 * 1024 * 1024;
const DOC_ID = /^[a-z0-9]{6,32}$/;
const NAME = /^([a-z0-9]{6,32})\.(0|[1-9][0-9]{0,14})\.recovery$/;

export function recoveryFileName(docId: string, seq: number): string {
  if (typeof docId !== "string" || !DOC_ID.test(docId)) throw new Error("bad recovery document id");
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("bad recovery sequence number");
  return `${docId}.${seq}.recovery`;
}

export function parseRecoveryFileName(name: string): { docId: string; seq: number } | null {
  const m = typeof name === "string" ? NAME.exec(name) : null;
  const seq = m ? Number(m[2]) : -1;
  return m && Number.isSafeInteger(seq) ? { docId: m[1], seq } : null;
}

export function planRotation(names: string[], docId: string, keep: number = RECOVERY_KEEP): { write: string; remove: string[] } {
  const mine = names
    .map((n) => ({ n, p: parseRecoveryFileName(n) }))
    .filter((x) => x.p !== null && x.p.docId === docId)
    .sort((a, b) => a.p!.seq - b.p!.seq);
  const write = recoveryFileName(docId, mine.length ? mine[mine.length - 1].p!.seq + 1 : 0);
  // The new file takes one slot, so keep-1 old ones stay.
  const drop = Math.max(0, mine.length - Math.max(0, keep - 1));
  return { write, remove: mine.slice(0, drop).map((x) => x.n) };
}

export function isValidRecovery(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length < 28 || bytes.length > MAX_RECOVERY_BYTES) return false;
  try {
    parsePcg(bytes);
    return true;
  } catch {
    return false;
  }
}
