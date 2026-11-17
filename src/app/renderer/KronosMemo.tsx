// The Kronos controls, redrawn only when their own row, value, saved value or look changes, so one edit does not redraw a page of 1,500 controls.
// fmt, onCommit and help are skipped: they are fresh closures every render, and the parents send commits through a stable ref and give one row the same fmt each time.
import { memo, type ComponentType } from "react";
import { BoxField, Cell, Check, Choice, Dial, Fader, KControl, Pick, ReadOnly, Segmented, Toggle } from "./KronosControls.tsx";

const SKIP = new Set(["fmt", "onCommit", "help"]);

export function sameCtl(a: object, b: object): boolean {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) if (!SKIP.has(k) && !Object.is(x[k], y[k])) return false;
  return true;
}

const once = <P extends object>(c: ComponentType<P>) => memo(c, sameCtl as (a: Readonly<P>, b: Readonly<P>) => boolean);

export const MBoxField = once(BoxField);
export const MCell = once(Cell);
export const MCheck = once(Check);
export const MChoice = once(Choice);
export const MDial = once(Dial);
export const MFader = once(Fader);
export const MKControl = once(KControl);
export const MPick = once(Pick);
export const MReadOnly = once(ReadOnly);
export const MSegmented = once(Segmented);
export const MToggle = once(Toggle);
