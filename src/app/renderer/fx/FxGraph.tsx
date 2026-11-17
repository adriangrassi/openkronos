// One effect graph picked by spec.graph; generic, values come through `get`.
import type { FxGet, FxGraphSpec } from "../../../core/fx/graphs.ts";
import { FxDriveGraph, FxDynGraph } from "./FxDynGraphs.tsx";
import { FxGeqGraph, FxPeqGraph } from "./FxEqGraphs.tsx";
import { FxDecayGraph, FxLfoGraph, FxTapsGraph } from "./FxTimeGraphs.tsx";

const TITLES: Record<FxGraphSpec["graph"], string> = {
  peq: "EQ response (Hz / dB)", geq: "Band gain (dB)", dyn: "Level transfer, in / out (dB)", drive: "Waveshaper, in / out",
  decay: "Reverb decay (dB over ms)", taps: "Delay taps (ms)", lfo: "LFO, one cycle",
};

export function FxGraph(p: { spec: FxGraphSpec; get: FxGet; tempo?: number }) {
  return (
    <>
      <div className="fxg-title" data-testid="fx-graph-title">{TITLES[p.spec.graph]}</div>
      <FxGraphBody {...p} />
    </>
  );
}

function FxGraphBody({ spec, get, tempo }: { spec: FxGraphSpec; get: FxGet; tempo?: number }) {
  switch (spec.graph) {
    case "peq": return <FxPeqGraph spec={spec} get={get} />;
    case "geq": return <FxGeqGraph spec={spec} get={get} />;
    case "dyn": return <FxDynGraph spec={spec} get={get} />;
    case "drive": return <FxDriveGraph spec={spec} get={get} />;
    case "decay": return <FxDecayGraph spec={spec} get={get} />;
    case "taps": return <FxTapsGraph spec={spec} get={get} tempo={tempo} />;
    case "lfo": return <FxLfoGraph spec={spec} get={get} tempo={tempo} />;
  }
}
