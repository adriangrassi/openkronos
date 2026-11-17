// The Keyboard Track line across the 88 keys, drawn above its parameter list. Read only: the rows below hold the controls.
import { KGrid, KLabel } from "./KronosGraphBits.tsx";
import { readParam } from "../../core/params/params.ts";
import { keyTrackCurve, type KeyTrack } from "../../core/params/shapes.ts";
import "./Graphs3.css";

const W = 560;
const H = 140;
const PAD = 12;
const KEYS = 88;

export function KeyTrackGraph({ kt, entry, kv }: { kt: KeyTrack; entry: Uint8Array; kv?: boolean }) {
  const pts = keyTrackCurve({
    lowKey: readParam(entry, kt.lowKey),
    centerKey: readParam(entry, kt.centerKey),
    highKey: readParam(entry, kt.highKey),
    lowRamp: readParam(entry, kt.lowRamp),
    centerLowRamp: readParam(entry, kt.centerLowRamp),
    centerHighRamp: readParam(entry, kt.centerHighRamp),
    highRamp: readParam(entry, kt.highRamp),
    // A track with no intensity row of its own (not a filter track) acts at full strength.
    intensity: kt.intensity ? readParam(entry, kt.intensity) : 99,
  }, KEYS);
  const X = (i: number) => PAD + (i / (KEYS - 1)) * (W - 2 * PAD);
  // Ramps run -100..100, so the middle of the graph is 0.
  const Y = (v: number) => PAD + ((100 - v) / 200) * (H - 2 * PAD);

  return (
    <div className="g3" data-testid="graphs3-keytrack">
      <svg className="g3-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${kt.group} across the keys`}>
        {kv && <KGrid w={W} h={H} pad={PAD} cols={11} rows={4} />}
        {kv && <KLabel x={PAD + 4} y={H - PAD - 4}>A0</KLabel>}
        {kv && <KLabel x={W - PAD - 4} y={H - PAD - 4} anchor="end">C8</KLabel>}
        <line className="g3-zero" x1={PAD} x2={W - PAD} y1={Y(0)} y2={Y(0)} />
        <polyline data-testid="graphs3-keytrack-line" className="g3-line" points={pts.map((v, i) => `${X(i)},${Y(v)}`).join(" ")} />
      </svg>
      <p className="g3-caption muted" data-testid="graphs3-keytrack-caption">
        Keyboard Track, a shape, not a measurement. Left is A0, right is C8.
      </p>
    </div>
  );
}
