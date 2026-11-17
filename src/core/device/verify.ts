// Compares the open sound with the keyboard's edit buffer read back, naming the settings that differ.
import { formatValue, readParam, type ParamTables } from "../params/params.ts";
import { rowsForKind, type LiveKind } from "./paramSend.ts";

export type EditDiff = { name: string; group: string; sent: string; got: string };
export type EditCompare = { equal: boolean; sizeSent: number; sizeGot: number; differing: EditDiff[]; more: number; unknownBytes: number };

const MAX_LISTED = 20;
const NAME_LEN = 24;

export function soundName(entry: Uint8Array): string {
  return String.fromCharCode(...entry.subarray(0, NAME_LEN)).replace(/[\0 ]+$/, "");
}

// The one-line verdict shown to the owner; a different name means the keyboard has another sound loaded.
export function checkText(c: EditCompare, sentName: string, gotName: string, what: string): string {
  if (gotName !== sentName) return `The keyboard has a different ${what} loaded: ${gotName || "(no name)"} (this one is ${sentName}).`;
  if (c.equal) return "Keyboard matches this sound";
  const rows = c.differing.map((d) => `${d.group ? d.group + " / " : ""}${d.name}: sent ${d.sent}, keyboard ${d.got}`);
  if (c.more) rows.push(`${c.more} more`);
  if (c.unknownBytes) rows.push(`${c.unknownBytes} bytes outside the named settings`);
  if (c.sizeSent !== c.sizeGot) rows.push(`size sent ${c.sizeSent}, keyboard ${c.sizeGot}`);
  const k = c.differing.length + c.more;
  return `Keyboard differs in ${k} setting${k === 1 ? "" : "s"}: ${rows.join("; ")}`;
}

export function compareEditBuffer(sent: Uint8Array, got: Uint8Array, tables: ParamTables, kind: LiveKind): EditCompare {
  const n = Math.min(sent.length, got.length);
  const named = new Uint8Array(n);
  const all: EditDiff[] = [];
  for (const r of rowsForKind(tables, kind)) {
    if (r.continuation || !r.name || r.parts.some(([o]) => o >= n)) continue;
    for (const [o] of r.parts) named[o] = 1;
    const a = readParam(sent, r);
    const b = readParam(got, r);
    if (a !== b) all.push({ name: r.name, group: r.group, sent: formatValue(r, a, tables), got: formatValue(r, b, tables) });
  }
  let unknownBytes = 0;
  for (let i = 0; i < n; i++) if (sent[i] !== got[i] && !named[i]) unknownBytes++;
  const equal = sent.length === got.length && unknownBytes === 0 && all.length === 0;
  return { equal, sizeSent: sent.length, sizeGot: got.length, differing: all.slice(0, MAX_LISTED), more: Math.max(0, all.length - MAX_LISTED), unknownBytes };
}
