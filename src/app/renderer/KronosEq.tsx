// A 3-band EQ response drawn from gains in dB and the mid frequency. Read only: the EQ tab holds the controls.
import { readParam, type Row } from "../../core/params/params.ts";
import { eqCurve, eqHz } from "../../core/pages/mixer.ts";
import { KGrid, KLabel } from "./KronosGraphBits.tsx";

const W = 280;
const H = 130;
const PAD = 14;
const N = 96;
const RANGE = 12;

export function KronosEq({ low, mid, high, midHz }: { low: number; mid: number; high: number; midHz: number }) {
  const ys = eqCurve({ low, mid, high, midHz }, N);
  const X = (i: number) => PAD + (i / (N - 1)) * (W - 2 * PAD);
  const Y = (db: number) => PAD + ((RANGE - Math.max(-RANGE, Math.min(RANGE, db))) / (2 * RANGE)) * (H - 2 * PAD);
  const pts = ys.map((y, i) => `${X(i)},${Y(y)}`).join(" ");
  return (
    <div className="eq" data-testid="kronos-eq">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="3 band EQ response">
        <KGrid w={W} h={H} pad={PAD} cols={6} rows={4} />
        <polygon className="eq-fill" points={`${X(0)},${Y(0)} ${pts} ${X(N - 1)},${Y(0)}`} />
        <polyline className="eq-line" points={pts} />
        <KLabel x={2} y={PAD + 4}>+12</KLabel>
        <KLabel x={2} y={H - PAD + 4}>-12</KLabel>
        <KLabel x={PAD} y={H - 2}>24</KLabel>
        <KLabel x={PAD + (W - 2 * PAD) * 0.207} y={H - 2}>100</KLabel>
        <KLabel x={PAD + (W - 2 * PAD) * 0.54} y={H - 2}>1k</KLabel>
        <KLabel x={W - PAD} y={H - 2} anchor="end">24k</KLabel>
      </svg>
    </div>
  );
}

// The EQ graph's inputs from the Track EQ rows, or null when one of the four is missing.
export function eqOf(rowOf: (group: string, name: string) => Row | undefined, cur: Uint8Array): { low: number; mid: number; high: number; midHz: number } | null {
  const [lo, mi, hi, fr] = ["Low Gain", "Mid Gain", "High Gain", "Mid Frequency"].map((n) => rowOf("Track EQ", n));
  if (!lo || !mi || !hi || !fr) return null;
  return { low: readParam(cur, lo) / 2, mid: readParam(cur, mi) / 2, high: readParam(cur, hi) / 2, midHz: eqHz(readParam(cur, fr), fr.rawMax) };
}
