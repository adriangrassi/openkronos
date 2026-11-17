export type RouteNode = { id: string; x: number; y: number; w: number; h: number; label: string; detail?: string; state?: "on" | "off"; dim?: boolean; go?: string };
export type RouteEdge = { from: string; to: string; kind: "main" | "chain" | "dim" };
export type RouteGraph = { w: number; h: number; nodes: RouteNode[]; edges: RouteEdge[] };

export function edgePoints(g: RouteGraph, e: RouteEdge): [number, number][] {
  const a = g.nodes.find((n) => n.id === e.from);
  const b = g.nodes.find((n) => n.id === e.to);
  if (!a || !b) throw new Error(`edge ${e.from}>${e.to}: unknown node`);
  const sx = a.x + a.w, sy = a.y + a.h / 2;
  const ex = b.x, ey = b.y + b.h / 2;
  if (e.kind === "chain") {
    const x = Math.max(sx, b.x + b.w) + 10;
    return [[sx, sy], [x, sy], [x, ey], [b.x + b.w, ey]];
  }
  if (a.y >= b.y + b.h) return [[a.x + a.w / 2, a.y], [a.x + a.w / 2, ey], [ex, ey]];
  if (ex < sx) return [[sx, sy], [sx + 20, sy], [sx + 20, b.y - 8], [b.x - 20, b.y - 8], [b.x - 20, ey], [ex, ey]];
  const mx = (sx + ex) / 2;
  return [[sx, sy], [mx, sy], [mx, ey], [ex, ey]];
}
