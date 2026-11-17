// Named snapshots of one Program or Combi. Pure: no DOM, no node imports.
import { paramsFor, readParam, type ParamTables, type ParamType } from "../params/params.ts";

export const MAX_SNAPSHOTS = 200;

export interface Snapshot {
  id: string;
  label: string;
  time: number;
  type: ParamType;
  data: string;
}

const ENGINES = ["hd1", "exi", "combi"];
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// The hash keeps names that clean up to the same text apart (and makes reserved names like CON safe).
export function snapshotFile(name: string, engine: ParamType): string {
  let h = 0x811c9dc5;
  for (const c of `${engine}\0${name}`) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  const safe = name.replace(/[^A-Za-z0-9 _-]/g, "_").slice(0, 60).trim() || "sound";
  return `${safe}-${engine}-${h.toString(16).padStart(8, "0")}.json`;
}

export function makeSnapshot(label: string, type: ParamType, entry: Uint8Array, time: number): Snapshot {
  let bin = "";
  for (const b of entry) bin += String.fromCharCode(b);
  return { id: crypto.randomUUID(), label: label.trim() || "Snapshot", time, type, data: btoa(bin) };
}

export function snapshotEntry(s: Snapshot): Uint8Array {
  return Uint8Array.from(atob(s.data), (c) => c.charCodeAt(0));
}

export function addSnapshot(list: readonly Snapshot[], s: Snapshot): Snapshot[] {
  return [...list, s].slice(-MAX_SNAPSHOTS);
}

export function serializeSnapshots(list: readonly Snapshot[]): string {
  return JSON.stringify(list);
}

// Checks the shape of a whole list; used by the main process for IPC input too.
export function validSnapshots(v: unknown): v is Snapshot[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_SNAPSHOTS &&
    v.every((s) => {
      if (typeof s !== "object" || s === null) return false;
      const o = s as Record<string, unknown>;
      return (
        typeof o.id === "string" && o.id !== "" && typeof o.label === "string" && typeof o.time === "number" && Number.isFinite(o.time) &&
        typeof o.type === "string" && ENGINES.includes(o.type) && typeof o.data === "string" && B64.test(o.data)
      );
    })
  );
}

export function parseSnapshots(text: string): Snapshot[] | null {
  try {
    const j: unknown = JSON.parse(text);
    return validSnapshots(j) ? j : null;
  } catch {
    return null;
  }
}

export function countDiffs(tables: ParamTables, type: ParamType, a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (const r of paramsFor(tables, type, a)) if (readParam(a, r) !== readParam(b, r)) n++;
  return n;
}
