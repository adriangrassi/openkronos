// Decay, multitap and LFO graphs for effect pages. Generic: values come through `get`, no Kronos tables.
import type { FxGet, FxGraphSpec } from "../../../core/fx/graphs.ts";
import { KGrid, KLabel } from "../KronosGraphBits.tsx";
import { decayPoints, lfoPoints, tapsPoints, H, PAD, W } from "./fx-time-points.ts";
import "./fx-graphs-b.css";

const N = 96;
const str = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");

export function FxDecayGraph({ spec, get }: { spec: Extract<FxGraphSpec, { graph: "decay" }>; get: FxGet }) {
  const d = decayPoints(spec, get, N);
  return (
    <div className="eq" data-testid="fx-graph-decay">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Decay, level over time">
        <KGrid w={W} h={H} pad={PAD} cols={8} rows={4} />
        {d.spikes.map((s, i) => <line key={i} className="fxg-spike" x1={s.x} x2={s.x} y1={s.y0} y2={s.y1} />)}
        <polyline className="eq-line" points={str(d.curve)} />
        {d.damp && <polyline className="eq-line fxg-dash" points={str(d.damp)} />}
        <KLabel x={2} y={PAD + 4}>0</KLabel>
        <KLabel x={2} y={H - PAD - 2}>-60</KLabel>
        <KLabel x={PAD} y={H - 2}>0 ms</KLabel>
        <KLabel x={W - PAD} y={H - 2} anchor="end">{`${Math.round(d.xMax)} ms`}</KLabel>
      </svg>
    </div>
  );
}

export function FxTapsGraph({ spec, get, tempo }: { spec: Extract<FxGraphSpec, { graph: "taps" }>; get: FxGet; tempo?: number }) {
  const t = tapsPoints(spec, get, tempo);
  return (
    <div className="eq" data-testid="fx-graph-taps">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Delay taps over time">
        <KGrid w={W} h={H} pad={PAD} cols={8} rows={4} />
        {t.echoes.map((e, i) => <line key={`e${i}`} className="fxg-tap fxg-dash" x1={e.x} x2={e.x} y1={e.y0} y2={e.y1} />)}
        {t.lines.map((l, i) => (
          <g key={i}>
            <line className="fxg-tap" x1={l.x} x2={l.x} y1={l.y0} y2={l.y1} />
            <KLabel x={l.x} y={Math.max(PAD - 2, l.y1 - 3)} anchor="middle">{l.label}</KLabel>
          </g>
        ))}
        <KLabel x={PAD} y={H - 2}>0 ms</KLabel>
        <KLabel x={W - PAD} y={H - 2} anchor="end">{`${Math.round(t.xMax)} ms`}</KLabel>
      </svg>
      {t.lines.length === 1 && <p className="fxg-caption">{t.lines[0].caption}</p>}
    </div>
  );
}

// `tempo` is accepted for a uniform props shape with the other graphs; the LFO rate itself is not drawn to scale.
export function FxLfoGraph({ spec, get }: { spec: Extract<FxGraphSpec, { graph: "lfo" }>; get: FxGet; tempo?: number }) {
  const l = lfoPoints(spec, get, N);
  return (
    <div className="eq" data-testid="fx-graph-lfo">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${l.wave}, one cycle`}>
        <KGrid w={W} h={H} pad={PAD} cols={8} rows={2} />
        {l.second && <polyline className="eq-line fxg-dash" points={str(l.second)} />}
        <polyline className="eq-line" points={str(l.main)} />
        <KLabel x={PAD + 4} y={PAD + 10}>{l.wave}</KLabel>
        {l.caption && <KLabel x={W - PAD - 4} y={PAD + 10} anchor="end">{l.caption}</KLabel>}
      </svg>
    </div>
  );
}
