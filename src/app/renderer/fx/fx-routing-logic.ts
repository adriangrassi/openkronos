import { edgePoints, type RouteEdge, type RouteGraph, type RouteNode } from "../../../core/fx/routing.ts";

export const pointsAttr = (g: RouteGraph, e: RouteEdge): string => edgePoints(g, e).map(([x, y]) => `${x},${y}`).join(" ");
export const badgeText = (s: RouteNode["state"]): string | null => (s === "on" ? "On" : s === "off" ? "Off" : null);
export const nodeTestId = (id: string): string => `fxr-node-${id}`;
export const edgeTestId = (e: RouteEdge): string => `fxr-edge-${e.kind}-${e.from}-${e.to}`;
export const nodeKeyGo = (key: string): boolean => key === "Enter" || key === " ";
