// Types `name` into `text` over the selection start..end, adding a space on a side that touches a word.
// from..to is where the name itself sits, so a second Shift-click can turn it into a range.
export function insertName(text: string, start: number, end: number, name: string): { text: string; caret: number; from: number; to: number } {
  const before = text.slice(0, start), after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const ins = lead + name + (after && !/^\s/.test(after) ? " " : "");
  return { text: before + ins + after, caret: before.length + ins.length, from: before.length + lead.length, to: before.length + lead.length + name.length };
}

// Replaces the first note's name (from..to) with "low to high", ordered by note number.
export function toRange(text: string, from: number, to: number, a: { name: string; note: number }, b: { name: string; note: number }): { text: string; caret: number } {
  const label = a.note === b.note ? a.name : a.note < b.note ? `${a.name} to ${b.name}` : `${b.name} to ${a.name}`;
  return { text: text.slice(0, from) + label + text.slice(to), caret: from + label.length };
}
