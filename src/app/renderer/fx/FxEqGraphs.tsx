// Parametric and graphic EQ response drawings, generic over FxGraphSpec. Styling: .eq-* (KronosView.css) plus fx-graphs-a.css.
import type { FxGet, FxGraphSpec } from "../../../core/fx/graphs.ts";
import { KGrid, KLabel } from "../KronosGraphBits.tsx";
import { W, H, PAD, EQ_RANGE, eqY, peqPoints, geqBars, toStr } from "./fx-graphs-a.ts";
import "./fx-graphs-a.css";

export { peqPoints, geqBars } from "./fx-graphs-a.ts";

const AXIS = [[0, "20", "start"], [1 / 3, "200", "middle"], [0.566, "1k", "middle"], [0.833, "10k", "middle"], [1, "20k", "end"]] as const; // log positions on 20 Hz..20 kHz

export function FxPeqGraph({ spec, get }: { spec: Extract<FxGraphSpec, { graph: "peq" }>; get: FxGet }) {
  const { curve, dots } = peqPoints(spec, get, 96);
  const pts = toStr(curve);
  const zero = eqY(0);
  return (
    <div className="eq fxg" data-testid="fx-graph-peq">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="EQ response">
        <KGrid w={W} h={H} pad={PAD} cols={6} rows={4} />
        <polygon className="eq-fill" points={`${curve[0].x},${zero} ${pts} ${curve[curve.length - 1].x},${zero}`} />
        <polyline className="eq-line" points={pts} />
        {dots.map((d, i) => <circle key={i} className="fxg-dot" cx={d.x} cy={d.y} r={3} />)}
        <KLabel x={2} y={PAD + 4}>+{EQ_RANGE}</KLabel>
        <KLabel x={2} y={H - PAD - 2}>-{EQ_RANGE}</KLabel>
        {AXIS.map(([p, t, a]) => <KLabel key={t} x={PAD + p * (W - 2 * PAD)} y={H - 2} anchor={a}>{t}</KLabel>)}
      </svg>
    </div>
  );
}

export function FxGeqGraph({ spec, get }: { spec: Extract<FxGraphSpec, { graph: "geq" }>; get: FxGet }) {
  const bars = geqBars(spec, get);
  const bw = Math.min(18, ((W - 2 * PAD) / bars.length) * 0.6);
  return (
    <div className="eq fxg" data-testid="fx-graph-geq">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Graphic EQ gains">
        <KGrid w={W} h={H} pad={PAD} cols={bars.length} rows={4} />
        {bars.map((b, i) => (
          <g key={i}>
            <rect className="fxg-bar" x={b.x - bw / 2} y={Math.min(b.y0, b.y1)} width={bw} height={Math.abs(b.y1 - b.y0)} />
            <KLabel x={b.x} y={H - 2} anchor="middle">{i + 1}</KLabel>
          </g>
        ))}
        <line className="fxg-zero" x1={PAD} x2={W - PAD} y1={eqY(0)} y2={eqY(0)} />
        <KLabel x={2} y={PAD + 4}>+{EQ_RANGE}</KLabel>
        <KLabel x={2} y={H - PAD - 2}>-{EQ_RANGE}</KLabel>
      </svg>
    </div>
  );
}
