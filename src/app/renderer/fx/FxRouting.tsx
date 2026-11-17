// Generic routing diagram: nodes, orthogonal arrows, On/Off badges, click or Enter on a node jumps (onGo). Colours via --k-* in fx-routing.css.
import type { RouteGraph } from "../../../core/fx/routing.ts";
import { badgeText, edgeTestId, nodeKeyGo, nodeTestId, pointsAttr } from "./fx-routing-logic.ts";
import "./fx-routing.css";

export * from "./fx-routing-logic.ts";

const BW = 22;
const BH = 11;

export function FxRouting({ graph, onGo }: { graph: RouteGraph; onGo?: (go: string) => void }) {
  return (
    <svg className="fxr-svg" viewBox={`0 0 ${graph.w} ${graph.h}`} width="100%" role="img" aria-label="Effect routing">
      <defs>
        {(["main", "chain", "dim"] as const).map((k) => (
          <marker key={k} id={`fxr-arrow-${k}`} className={`fxr-arrow fxr-arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" />
          </marker>
        ))}
      </defs>
      {graph.edges.map((e) => (
        <polyline key={edgeTestId(e)} data-testid={edgeTestId(e)} className={`fxr-edge fxr-edge-${e.kind}`} points={pointsAttr(graph, e)} fill="none" markerEnd={`url(#fxr-arrow-${e.kind})`} />
      ))}
      {graph.nodes.map((n) => {
        const badge = badgeText(n.state);
        const go = n.go;
        const jump = go && onGo ? () => onGo(go) : undefined;
        return (
          <g
            key={n.id}
            data-testid={nodeTestId(n.id)}
            className={`fxr-node-g${n.dim ? " fxr-dim" : ""}${jump ? " fxr-go" : ""}`}
            role={go ? "button" : undefined}
            tabIndex={go ? 0 : undefined}
            onClick={jump}
            onKeyDown={jump ? (ev) => { if (nodeKeyGo(ev.key)) { ev.preventDefault(); jump(); } } : undefined}
          >
            <rect className="fxr-node" data-state={n.state} x={n.x} y={n.y} width={n.w} height={n.h} rx={3} />
            <text className="fxr-label" x={n.x + 6} y={n.y + n.h / 2} dominantBaseline="central">{n.label}</text>
            {n.detail && n.w >= 60 && <text className="fxr-detail" x={n.x + n.w - (badge ? BW + 10 : 6)} y={n.y + n.h / 2} textAnchor="end" dominantBaseline="central">{n.detail}</text>}
            {badge && (
              <g className={`fxr-badge fxr-badge-${n.state}`}>
                <rect x={n.x + n.w - BW - 3} y={n.y + (n.h - BH) / 2} width={BW} height={BH} rx={2} />
                <text x={n.x + n.w - BW / 2 - 3} y={n.y + n.h / 2} textAnchor="middle" dominantBaseline="central">{badge}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
