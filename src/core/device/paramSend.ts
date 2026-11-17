// Single-parameter Live edits: builds KORG function 0x43 "Parameter Change (integer)" messages from rows of the dump tables.
// The id bytes are the TYP, SOC, SUB, PID, IDX columns of the same table row (KRONOS_MIDI_SysEx.txt [43]); anything not certain returns null.
import { buildKorg, Fn } from "../sysex/message.ts";
import { isEditable, readParam, writeParam, type ParamTables, type Row } from "../params/params.ts";

export type LiveKind = "hd1" | "exi" | "combi";

// More changed rows than this is a bulk edit (paste, swap, restore, AI Keep): the whole dump is the safer way to send it.
export const MAX_PARAM_ROWS = 4;

// KARMA and Drum Track have their own message functions (0x6D, 0x6E); which TYPs they own is not stated, so those groups are not sent here.
const OWN_FUNCTION = /^(KARMA|Drum Track)/;
// Prog_EXi.txt writes TYP as "11/12" for engine rows, which the table keeps as 11 only: engine rows stay on the whole dump.
const ENGINE = /^EXi[12] (AL-1|CX-3|STR-1|MS-20EX|PolysixEX|MOD-7|SGX-2|EP-1)\b/;
// The tables' own notes: Switch is "-> bypass, Invert Value"; Assign rows are "SUB = (Assign >> 7) & 0x01, Value = Assign & 0x7f".
const INVERTED = (r: Row) => r.name === "Switch" && /^(Insert|Master|Total) Effect\d*$/.test(r.group);
const SPLIT_ASSIGN = (r: Row) => /Assign$/.test(r.name);

const BIT21 = 2 ** 20;
const idOf = (r: Row): number[] | null => {
  const id = [r.typ, r.soc, r.sub, r.pid, r.idx];
  if (id.some((x) => x === null || x < 0 || x > 0x7f)) return null;
  // The 14-bit form of the id is deprecated, so PID 127 and up is not sent.
  return (id as number[])[3] > 126 ? null : (id as number[]);
};
const keyOf = (r: Row) => [r.typ, r.soc, r.sub, r.pid, r.idx].join(",");

const sendable = new WeakMap<Row[], Set<Row>>();

// Rows whose dump value is the parameter value with certainty. A repeated id (Chain Switch and Chain To share PID 2) is two fields in one parameter: left out.
function sendableRows(rows: Row[]): Set<Row> {
  const hit = sendable.get(rows);
  if (hit) return hit;
  const count = new Map<string, number>();
  // KARMA and Drum Track rows reuse the same ids (TYP 0 PID 0 is a KARMA tempo and the Oscillator Mode): their own function code tells them apart, so they do not count.
  for (const r of rows) if (!r.continuation && r.typ !== null && !OWN_FUNCTION.test(r.group)) count.set(keyOf(r), (count.get(keyOf(r)) ?? 0) + 1);
  const out = new Set<Row>();
  for (const r of rows) {
    if (r.continuation || !isEditable(r) || idOf(r) === null || count.get(keyOf(r)) !== 1) continue;
    if (OWN_FUNCTION.test(r.group) || ENGINE.test(r.group) || INVERTED(r) || SPLIT_ASSIGN(r)) continue;
    if (r.rawMin < -BIT21 || r.rawMax >= BIT21) continue;
    out.add(r);
  }
  sendable.set(rows, out);
  return out;
}

export function rowsForKind(tables: ParamTables, kind: LiveKind): Row[] {
  return kind === "hd1" ? tables.programHd1 : kind === "exi" ? tables.programExiCommon : tables.combi;
}

// The complete message for one row's value in `entry`, or null when the row cannot be mapped with certainty.
export function encodeParamChange(channel: number, row: Row, entry: Uint8Array, rows: Row[]): Uint8Array | null {
  const id = idOf(row);
  if (!id || !sendableRows(rows).has(row)) return null;
  const v = readParam(entry, row);
  if (v < row.rawMin || v > row.rawMax) return null;
  // Value is 21-bit two's complement, 7 bits per byte, high first (note *4).
  const u = v & 0x1fffff;
  return buildKorg(channel, Fn.parameterChangeInteger, [...id, (u >> 14) & 0x7f, (u >> 7) & 0x7f, u & 0x7f]);
}

// The rows whose value differs between the two copies, or null when the difference is not exactly a set of rows
// (a changed byte no row owns, a bit field shared with another row, ...).
export function rowsChanged(rows: Row[], before: Uint8Array, after: Uint8Array): Row[] | null {
  if (before.length !== after.length) return null;
  const changed = new Set<number>();
  for (let i = 0; i < after.length; i++) if (before[i] !== after[i]) changed.add(i);
  if (changed.size === 0) return [];
  const hit = rows.filter((r) => !r.continuation && r.parts.some(([o]) => changed.has(o)) && readParam(before, r) !== readParam(after, r));
  // Rebuild `after` from `before` by the rows alone: any byte they do not explain shows up as a mismatch.
  const check = Uint8Array.from(before);
  try {
    for (const r of hit) writeParam(check, r, readParam(after, r));
  } catch {
    return null;
  }
  return check.every((b, i) => b === after[i]) ? hit : null;
}

// One parameter change per changed row, or null when the edit must go as a whole dump.
export function planParamChanges(channel: number, rows: Row[], before: Uint8Array, after: Uint8Array): Uint8Array[] | null {
  const hit = rowsChanged(rows, before, after);
  if (!hit || hit.length > MAX_PARAM_ROWS) return null;
  const msgs: Uint8Array[] = [];
  for (const r of hit) {
    const m = encodeParamChange(channel, r, after, rows);
    if (!m) return null;
    msgs.push(m);
  }
  return msgs;
}
