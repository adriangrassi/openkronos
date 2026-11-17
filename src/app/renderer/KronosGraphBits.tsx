// Drawing pieces the graphs share in the Kronos view: grid lines and small labels. Styling lives in KronosView.css (.kg-*).
import type { ReactNode } from "react";

export function KGrid({ w, h, pad, cols = 8, rows = 4 }: { w: number; h: number; pad: number; cols?: number; rows?: number }) {
  const xs = Array.from({ length: cols + 1 }, (_, i) => pad + (i / cols) * (w - 2 * pad));
  const ys = Array.from({ length: rows + 1 }, (_, i) => pad + (i / rows) * (h - 2 * pad));
  return (
    <g className="kg-grid" aria-hidden="true">
      {xs.map((x) => <line key={`x${x}`} x1={x} x2={x} y1={pad} y2={h - pad} />)}
      {ys.map((y) => <line key={`y${y}`} x1={pad} x2={w - pad} y1={y} y2={y} />)}
    </g>
  );
}

export function KLabel({ x, y, anchor, children }: { x: number; y: number; anchor?: "start" | "middle" | "end"; children: ReactNode }) {
  return <text className="kg-text" x={x} y={y} textAnchor={anchor ?? "start"} aria-hidden="true">{children}</text>;
}
