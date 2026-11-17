export type FxVal = { raw: number; n: number | null; t: number; text: string };  // n physical or linear approx, t 0..1
export type FxGet = (name: string) => FxVal | undefined;
export type FxGraphSpec =
  | { graph: "peq"; section: string; bands: { hz: string; q?: string; gain: string; shape: "peak" | "lowshelf" | "highshelf"; shapeRow?: string }[] }
  | { graph: "geq"; section: string; gains: string[] }
  | { graph: "dyn"; section: string; mode: "comp" | "expand" | "limit"; threshold: string; ratio?: string; knee?: string; ceiling?: string }
  | { graph: "drive"; section: string; drive: string }
  | { graph: "decay"; section: string; time: string; preDelay?: string; damp?: string; early?: boolean }
  | { graph: "taps"; section: string; taps: { label: string; time?: string; note?: string; times?: string; level?: string }[]; feedback?: string; bpm?: string }
  | { graph: "lfo"; section: string; wave: string; shape?: string; phase?: string; freq?: string; sync?: string; note?: string; times?: string };

export type FxCategory = { name: string; items: { id: number; label: string }[] };

const names = (...xs: (string | undefined)[]): string[] => xs.filter((x): x is string => x !== undefined);

export function specNames(s: FxGraphSpec): string[] {
  switch (s.graph) {
    case "peq": return s.bands.flatMap((b) => names(b.hz, b.q, b.gain, b.shapeRow));
    case "geq": return [...s.gains];
    case "dyn": return names(s.threshold, s.ratio, s.knee, s.ceiling);
    case "drive": return [s.drive];
    case "decay": return names(s.time, s.preDelay, s.damp);
    case "taps": return [...s.taps.flatMap((t) => names(t.time, t.note, t.times, t.level)), ...names(s.feedback, s.bpm)];
    case "lfo": return names(s.wave, s.shape, s.phase, s.freq, s.sync, s.note, s.times);
  }
}
