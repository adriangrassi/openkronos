// Generic chain column: hooks from row `from` to a later row `to`, as polylines in a column that starts `top` px down with rows `pitch` px apart.
export type ChainLink = { from: number; to: number; on: boolean };
export type ChainGeom = { rows: number; top: number; pitch: number; x: number; step: number };
export type ChainPath = { from: number; to: number; points: [number, number][]; pointsAttr: string };

export function chainPaths(links: ChainLink[], g: ChainGeom): ChainPath[] {
  const y = (row: number) => g.top + (row - 0.5) * g.pitch;
  return links
    .filter((l) => l.on && l.from >= 1 && l.to <= g.rows && l.to > l.from)
    .map((l) => {
      const bx = g.x + g.step * (l.to - l.from);
      const points: [number, number][] = [[g.x, y(l.from)], [bx, y(l.from)], [bx, y(l.to)], [g.x, y(l.to)]];
      return { from: l.from, to: l.to, points, pointsAttr: points.map((p) => p.join(",")).join(" ") };
    });
}
