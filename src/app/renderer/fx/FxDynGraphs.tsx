// Dynamics transfer curve and drive (waveshaper) drawings, generic over FxGraphSpec.
import type { FxGet, FxGraphSpec } from "../../../core/fx/graphs.ts";
import { KGrid, KLabel } from "../KronosGraphBits.tsx";
import { W, H, PAD, dynPoints, drivePoints, toStr } from "./fx-graphs-a.ts";
import "./fx-graphs-a.css";

export { dynPoints, drivePoints } from "./fx-graphs-a.ts";

export function FxDynGraph({ spec, get }: { spec: Extract<FxGraphSpec, { graph: "dyn" }>; get: FxGet }) {
  const { curve, diag, thr } = dynPoints(spec, get, 64);
  const ox = (W - H) / 2; // square plot, centred in the frame
  return (
    <div className="eq fxg" data-testid="fx-graph-dyn">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dynamics transfer curve">
        <g transform={`translate(${ox},0)`}>
          <KGrid w={H} h={H} pad={PAD} cols={6} rows={6} />
          <line className="fxg-thr" x1={thr} x2={thr} y1={PAD} y2={H - PAD} />
          <polyline className="fxg-diag" points={toStr(diag)} />
          <polyline className="eq-line" points={toStr(curve)} />
          <KLabel x={PAD - 12} y={PAD + 4}>0</KLabel>
          <KLabel x={PAD - 12} y={H / 2}>out</KLabel>
          <KLabel x={PAD - 12} y={H - PAD - 2}>-60</KLabel>
          <KLabel x={H / 2} y={H - 2} anchor="middle">in dB</KLabel>
          <KLabel x={H - PAD} y={H - 2} anchor="end">0</KLabel>
        </g>
      </svg>
    </div>
  );
}

export function FxDriveGraph({ spec, get }: { spec: Extract<FxGraphSpec, { graph: "drive" }>; get: FxGet }) {
  const { curve, diag } = drivePoints(spec, get, 65);
  return (
    <div className="eq fxg" data-testid="fx-graph-drive">
      <svg className="eq-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Drive transfer curve">
        <KGrid w={W} h={H} pad={PAD} cols={8} rows={4} />
        <polyline className="fxg-diag" points={toStr(diag)} />
        <polyline className="eq-line" points={toStr(curve)} />
        <KLabel x={PAD} y={H - 2}>-1</KLabel>
        <KLabel x={W - PAD} y={H - 2} anchor="end">+1</KLabel>
      </svg>
    </div>
  );
}
