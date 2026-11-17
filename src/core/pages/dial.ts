// Rotary control maths. Pure: no DOM. The dial sweeps 270 degrees, 0 degrees straight up.
export const SWEEP = 270;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const fracOf = (v: number, min: number, max: number): number => (max > min ? clamp((v - min) / (max - min), 0, 1) : 0);
export const angleOf = (v: number, min: number, max: number): number => -SWEEP / 2 + fracOf(v, min, max) * SWEEP;
export const valueAtFrac = (f: number, min: number, max: number): number => clamp(Math.round(min + f * (max - min)), min, max);

// A drag of 100 px covers the whole range; Shift makes it 8 times finer.
export function dragValue(start: number, dyUp: number, min: number, max: number, fine: boolean): number {
  return clamp(Math.round(start + (dyUp * (max - min)) / 100 / (fine ? 8 : 1)), min, max);
}

export const wheelValue = (v: number, deltaY: number, min: number, max: number): number => clamp(v + (deltaY < 0 ? 1 : -1), min, max);

// One arrow press: 1 step, 10 with Shift, held inside the range.
export const stepValue = (v: number, dir: 1 | -1, big: boolean, min: number, max: number): number => clamp(v + dir * (big ? 10 : 1), min, max);

// A relative drag keeps a fractional position, so pressing or releasing Shift mid-drag never makes the value jump. The caller rounds it.
export function dragPos(pos: number, dyUp: number, min: number, max: number, fine: boolean): number {
  return clamp(pos + (dyUp * (max - min)) / 100 / (fine ? 8 : 1), min, max);
}

// One wheel notch: 1 step, or a 128th of a wide range (at least 1) so a 0..16383 row is reachable; Shift is always 1. Chrome turns Shift+wheel into a horizontal delta, so either axis counts.
export function wheelNotch(v: number, dx: number, dy: number, min: number, max: number, fine: boolean): number {
  const d = dy || dx;
  if (!d) return v;
  return clamp(v + (d < 0 ? 1 : -1) * (fine ? 1 : Math.max(1, Math.round((max - min) / 128))), min, max);
}

// Double click: back to the saved value, held inside the range.
export const resetValue = (saved: number, min: number, max: number): number => clamp(Math.round(saved), min, max);

// SVG arc from fraction f0 to f1 of the sweep; empty when they are equal.
export function arcPath(cx: number, cy: number, r: number, f0: number, f1: number): string {
  if (f0 === f1) return "";
  const pt = (f: number): string => {
    const a = ((-SWEEP / 2 + f * SWEEP) * Math.PI) / 180;
    return `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  };
  return `M ${pt(f0)} A ${r} ${r} 0 ${Math.abs(f1 - f0) * SWEEP > 180 ? 1 : 0} ${f1 > f0 ? 1 : 0} ${pt(f1)}`;
}
