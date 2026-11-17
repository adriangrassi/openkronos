// Recent Files as pure list operations. Paths stay in the main process; the renderer only gets id and name.
import { randomBytes } from "node:crypto";

export const RECENT_LIMIT = 10;

export interface RecentEntry {
  id: string;
  name: string;
  path: string;
}

export function newRecentId(): string {
  return randomBytes(16).toString("hex");
}

// The file moves to the top; an older entry for the same path is dropped; the list is capped.
export function addRecent(list: RecentEntry[], path: string, id: string): RecentEntry[] {
  const name = path.split(/[\\/]/).pop() ?? path;
  return [{ id, name, path }, ...list.filter((e) => e.path !== path)].slice(0, RECENT_LIMIT);
}

export function withoutRecent(list: RecentEntry[], id: string): RecentEntry[] {
  return list.filter((e) => e.id !== id);
}
