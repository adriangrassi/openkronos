import type { PointAt, PointStep } from "./point.ts";
// The guided walkthrough behind Ask & show: pure state, no DOM. `navigating` is true while the page change the tour itself asked for is in flight.
export type TourState = { steps: PointStep[]; index: number; active: boolean; navigating: boolean };
export type TourAction = { type: "next" | "back" | "cancel" | "newQuestion" | "userNavigated" | "finished" | "settled" };

export const stepsOf = (p: PointAt): PointStep[] => p.steps ?? p.ids.map((id, i) => ({ id, note: p.notes[i] ?? "" }));

export const tourStart = (steps: PointStep[]): TourState => ({ steps, index: 0, active: steps.length > 0, navigating: steps.length > 0 });

const end = (s: TourState): TourState => ({ ...s, active: false, navigating: false });

export function tourReduce(s: TourState, a: TourAction): TourState {
  if (!s.active) return s;
  switch (a.type) {
    case "next": return s.index >= s.steps.length - 1 ? end(s) : { ...s, index: s.index + 1, navigating: true };
    case "back": return s.index === 0 ? s : { ...s, index: s.index - 1, navigating: true };
    case "settled": return s.navigating ? { ...s, navigating: false } : s;
    case "userNavigated": return s.navigating ? s : end(s);
    default: return end(s); // cancel, newQuestion, finished
  }
}

// What the editors are pointed at now: the current step only, so only that control is highlighted and opened.
export function tourPoint(base: PointAt, s: TourState): PointAt | null {
  const step = s.active ? s.steps[s.index] : undefined;
  if (!step) return null;
  const i = base.ids.indexOf(step.id);
  return { key: base.key, index: base.index, ids: [step.id], notes: [base.notes[i] ?? step.note], names: [base.names[i] ?? step.id], steps: [step] };
}
