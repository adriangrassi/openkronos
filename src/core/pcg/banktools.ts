// Bank tools: batch rename plans, duplicate and empty finders, and CSV or HTML bank lists. Pure logic: no I/O.
import { getEntry, getName, listBanks, nameError, setName, type BankInfo } from "./library.ts";
import { PcgError, type PcgFile } from "./pcg.ts";

const NAME_LEN = 24;

export type NumberingOptions = { start: number; pad: number; at: "prefix" | "suffix"; sep: string };
export type NameOptions = {
  find?: string;
  replace?: string;
  ignoreCase?: boolean;
  prefix?: string;
  suffix?: string;
  numbering?: NumberingOptions;
  letterCase?: "keep" | "upper" | "lower" | "title";
};
export interface RenamePlan {
  from: string;
  to: string;
  error: string | null;
}
export interface SlotRef {
  key: string;
  index: number;
  name: string;
}
export interface DuplicateGroup {
  kind: string;
  type: "exi" | "hd1" | null;
  slots: SlotRef[];
}
export interface EmptySlot extends SlotRef {
  reason: "name" | "data";
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function replaceText(s: string, find: string, replace: string, ignoreCase: boolean): string {
  if (!ignoreCase) return s.split(find).join(replace);
  return s.replace(new RegExp(escapeRe(find), "gi"), () => replace);
}

function caseName(s: string, mode: NonNullable<NameOptions["letterCase"]>): string {
  if (mode === "upper") return s.toUpperCase();
  if (mode === "lower") return s.toLowerCase();
  if (mode === "title") return s.toLowerCase().replace(/(^| )([a-z])/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
  return s;
}

// Order: find/replace, case, prefix, suffix, numbering. The new name is never truncated or trimmed; a refused one carries its error.
export function planRename(names: string[], o: NameOptions): RenamePlan[] {
  return names.map((from, pos) => {
    let s = from;
    if (o.find) s = replaceText(s, o.find, o.replace ?? "", !!o.ignoreCase);
    s = caseName(s, o.letterCase ?? "keep");
    s = (o.prefix ?? "") + s + (o.suffix ?? "");
    if (o.numbering) {
      const n = String(o.numbering.start + pos).padStart(o.numbering.pad, "0");
      s = o.numbering.at === "prefix" ? `${n}${o.numbering.sep}${s}` : `${s}${o.numbering.sep}${n}`;
    }
    return { from, to: s, error: nameError(s) };
  });
}

// All or nothing: every name and index is checked before the first write.
export function applyRenames(file: PcgFile, key: string, changes: { index: number; name: string }[]): number {
  const differs = changes.map(({ index, name }) => {
    const before = getName(file, key, index); // throws for a bad bank or index
    const err = nameError(name);
    if (err) throw new PcgError(err);
    return before !== name;
  });
  let n = 0;
  changes.forEach(({ index, name }, i) => {
    if (!differs[i]) return;
    setName(file, key, index, name);
    n++;
  });
  return n;
}

// Bank tools skip set lists: they hold no sounds to compare or name.
const editable = (file: PcgFile): BankInfo[] => listBanks(file).filter((b) => b.kind !== "setlist");

// The bytes after the name, as a string. Two slots of the same kind and engine type are duplicates when these match.
function bodyKey(file: PcgFile, info: BankInfo, index: number): string {
  const body = getEntry(file, info.key, index).subarray(NAME_LEN);
  let s = "";
  for (let i = 0; i < body.length; i += 4096) s += String.fromCharCode(...body.subarray(i, i + 4096));
  return `${info.kind}|${info.type}|${info.entrySize}|${s}`;
}

export function findDuplicates(file: PcgFile): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const info of editable(file)) {
    for (let i = 0; i < info.count; i++) {
      const id = bodyKey(file, info, i);
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { kind: info.kind, type: info.type, slots: [] }));
      g.slots.push({ key: info.key, index: i, name: getName(file, info.key, i) });
    }
  }
  return [...groups.values()].filter((g) => g.slots.length > 1);
}

const INIT_NAME = /^init\b/i;

// shortcut: a slot is empty when its name starts with Init or its sound matches an Init slot; no check of the sound's contents, upgrade if users want blank-looking names too
export function findEmpties(file: PcgFile): EmptySlot[] {
  const rows: { slot: SlotRef; id: string; isInit: boolean }[] = [];
  const initIds = new Set<string>();
  for (const info of editable(file)) {
    for (let i = 0; i < info.count; i++) {
      const name = getName(file, info.key, i);
      const id = bodyKey(file, info, i);
      const isInit = INIT_NAME.test(name);
      if (isInit) initIds.add(id);
      rows.push({ slot: { key: info.key, index: i, name }, id, isInit });
    }
  }
  const out: EmptySlot[] = [];
  for (const r of rows) {
    if (r.isInit) out.push({ ...r.slot, reason: "name" });
    else if (initIds.has(r.id)) out.push({ ...r.slot, reason: "data" });
  }
  return out;
}

// key null = every bank listBanks returns, set lists included.
function slotRows(file: PcgFile, key: string | null): SlotRef[] {
  const banks = listBanks(file);
  if (key !== null && !banks.some((b) => b.key === key)) throw new PcgError(`no bank ${key}`);
  const out: SlotRef[] = [];
  for (const b of banks) {
    if (key !== null && b.key !== key) continue;
    for (let i = 0; i < b.count; i++) out.push({ key: b.key, index: i, name: getName(file, b.key, i) });
  }
  return out;
}

const csvField = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(file: PcgFile, key: string | null): string {
  const lines = [["bank", "index", "name"], ...slotRows(file, key).map((r) => [r.key, String(r.index), r.name])];
  return lines.map((cols) => cols.map(csvField).join(",") + "\r\n").join("");
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PRINT_CSS =
  "body{font:12px system-ui,sans-serif;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#555}" +
  "table{border-collapse:collapse;width:100%}thead{display:table-header-group}tr{break-inside:avoid}" +
  "th,td{border-bottom:1px solid #ccc;padding:3px 8px;text-align:left}th{background:#eee}" +
  "@media print{body{margin:12mm}@page{size:A4;margin:12mm}}";

export function toHtml(file: PcgFile, key: string | null, title = "Kronos bank list"): string {
  const rows = slotRows(file, key)
    .map((r) => `<tr><td>${esc(r.key)}</td><td>${r.index}</td><td>${esc(r.name)}</td></tr>`)
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${esc(title)}</title>`,
    `<style>${PRINT_CSS}</style></head><body>`,
    `<h1>${esc(title)}</h1>`,
    `<p>${esc(key ?? "All banks")}</p>`,
    "<table><thead><tr><th>Bank</th><th>Slot</th><th>Name</th></tr></thead>",
    `<tbody>\n${rows}\n</tbody></table></body></html>`,
    "",
  ].join("\n");
}
