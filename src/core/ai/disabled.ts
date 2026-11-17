// Why the Ask and Refine buttons are greyed out, as a tooltip and as visible text; null when they work.
export const NO_SOUND = "No sound is open: select one row or open it";
export function askDisabledReason(o: { selected: boolean; busy: boolean; locked: boolean; routeBlocked: boolean; text: string }): string | null {
  if (!o.selected) return NO_SOUND;
  if (o.busy) return "A run is in progress";
  if (o.locked) return "The file is locked right now";
  if (o.routeBlocked) return "The local model is not ready (AUTOROUTER_KEY is not set)";
  if (o.text.trim() === "") return "Type a request first";
  return null;
}

// What Ask and Refine work on, shown under the fields; the three kinds without parameter tables are named so the owner is not left guessing.
export const SUPPORTED_HINT = "Ask and Refine work on a Program, Combination, Drum Kit or Wave Sequence. Sequences, songs and patterns are not editable yet.";

// True when the sound open in the editor is not the one a run was started on, so its result needs a "Go to sound" button.
export const awayFrom = (open: { key: string; index: number } | null, target: { key: string; index: number }): boolean => !open || open.key !== target.key || open.index !== target.index;
