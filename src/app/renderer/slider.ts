import type { CSSProperties } from "react";

// styles.css paints the filled part of a range track from --p. shortcut: a range without this style shows an empty track, add it where a new slider is made.
export const fillOf = (value: number, min: number, max: number): CSSProperties =>
  ({ "--p": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` }) as CSSProperties;
