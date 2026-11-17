// Which control draws a Kronos-view row, from its range and its value texts. Pure: no DOM.
import { isEditable, type Row } from "../params/params.ts";

export type ControlKind = "toggle" | "segmented" | "select" | "dial" | "field" | "readonly";

// A number, optionally signed and with a unit; anything else counts as a name.
const NUM = /^[+-]?\d+([.,]\d+)?\s*(%|'|hz|khz|k|ms|s|db|cents?)?$/i;

// texts: the value text of every value from rawMin to rawMax.
export function controlKind(r: Row, texts: string[]): ControlKind {
  if (!isEditable(r)) return "readonly";
  const n = r.rawMax - r.rawMin + 1;
  const named = texts.filter((t) => !NUM.test(t.trim())).length;
  if (n === 2) return named === 0 || (texts[0] === "Off" && texts[1] === "On") ? "toggle" : "segmented";
  if (named * 2 >= n) return n <= 8 ? "segmented" : "select";
  return n <= 128 ? "dial" : "field";
}

// Where a dial's value arc starts: the zero of a raw range that crosses zero, else the left end.
export const bipolarOf = (r: Row): number | null => (r.rawMin < 0 && r.rawMax > 0 ? 0 : null);
