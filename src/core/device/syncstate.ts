// What the keyboard held per slot after the last successful sync. Hashes only, so the record stays small.
export type SyncState = { version: 1; banks: Record<string, Record<string, string>> };

export const emptySyncState = (): SyncState => ({ version: 1, banks: {} });

// Two FNV-1a lanes with different seeds. The length is mixed in first so an extra zero byte changes the hash.
export function slotHash(bytes: Uint8Array): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  const step = (x: number) => {
    a = Math.imul(a ^ x, 0x01000193);
    b = Math.imul(b ^ x, 0x01000193);
  };
  const n = bytes.length;
  for (let s = 0; s < 32; s += 8) step((n >>> s) & 0xff);
  for (const x of bytes) step(x);
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

// Anything malformed gives an empty state: the next Sync then checks every bank in full, which is safe.
export function parseSyncState(raw: unknown): SyncState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return emptySyncState();
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || typeof r.banks !== "object" || r.banks === null || Array.isArray(r.banks)) return emptySyncState();
  const banks: Record<string, Record<string, string>> = {};
  for (const [key, slots] of Object.entries(r.banks as Record<string, unknown>)) {
    if (typeof slots !== "object" || slots === null || Array.isArray(slots)) return emptySyncState();
    const out: Record<string, string> = {};
    for (const [i, h] of Object.entries(slots as Record<string, unknown>)) {
      if (typeof h !== "string") return emptySyncState();
      out[i] = h;
    }
    banks[key] = out;
  }
  return { version: 1, banks };
}

export const bankKnown = (state: SyncState, key: string): boolean => Object.hasOwn(state.banks, key);

export function changedSinceSync(state: SyncState, key: string, count: number, entry: (i: number) => Uint8Array): number[] {
  const rec = state.banks[key] ?? {};
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (rec[String(i)] !== slotHash(entry(i))) out.push(i);
  return out;
}

export function recordSlots(state: SyncState, key: string, idx: number[], entry: (i: number) => Uint8Array): SyncState {
  const rec = { ...(state.banks[key] ?? {}) };
  for (const i of idx) rec[String(i)] = slotHash(entry(i));
  return { version: 1, banks: { ...state.banks, [key]: rec } };
}

// A fully checked bank replaces its record, so slots past the bank's new count do not linger.
export function recordBank(state: SyncState, key: string, count: number, entry: (i: number) => Uint8Array): SyncState {
  const rec: Record<string, string> = {};
  for (let i = 0; i < count; i++) rec[String(i)] = slotHash(entry(i));
  return { version: 1, banks: { ...state.banks, [key]: rec } };
}
