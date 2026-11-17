// One cycle of an LFO's wave, drawn above its parameter list. Read only: the rows below hold the controls.
import { LFO_WAVEFORMS, lfoPoints, type Lfo } from "../../core/params/graphs2.ts";
import { KGrid, KLabel } from "./KronosGraphBits.tsx";
import { readParam } from "../../core/params/params.ts";

const W = 560;
const H = 120;
const PAD = 12;
const N = 96;

export function LfoGraph({ lfo, entry, kv }: { lfo: Lfo; entry: Uint8Array; kv?: boolean }) {
  const wave = readParam(entry, lfo.fields.waveform);
  const shape = lfo.fields.shape ? readParam(entry, lfo.fields.shape) : 0;
  const name = LFO_WAVEFORMS[wave] ?? "";
  const pts = lfoPoints(wave, shape, N);
  const X = (i: number) => PAD + (i / (N - 1)) * (W - 2 * PAD);
  const Y = (v: number) => PAD + ((1 - v) / 2) * (H - 2 * PAD);

  return (
    <div className="lfo" data-testid="lfo-graph">
      <svg className="lfo-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}, one cycle`}>
        {kv && <KGrid w={W} h={H} pad={PAD} rows={2} />}
        {kv && <KLabel x={PAD + 4} y={PAD + 12}>{name}</KLabel>}
        <line className="lfo-zero" x1={PAD} x2={W - PAD} y1={Y(0)} y2={Y(0)} />
        <polyline className="lfo-line" points={pts.map((y, i) => `${X(i)},${Y(y)}`).join(" ")} />
      </svg>
      <p className="lfo-caption muted">
        <span data-testid="lfo-name">{name}</span>
        <span>, one cycle; the curve is an approximation</span>
      </p>
    </div>
  );
}
