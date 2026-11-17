// Kronos routing diagrams for the 8-1/8-2 (IFX) and 9-1 (master/total) pages. Geometry is the generic RouteGraph; this file only maps Kronos rows to it.
import type { ChainLink } from "../fx/chain.ts";
import type { RouteEdge, RouteGraph, RouteNode } from "../fx/routing.ts";
import { IFX_OUT_BUS, SOURCE_BUS } from "../pages/layouts/fx.ts";

// Raw value of one row by group and name; undefined when the row is absent.
export type Read = (group: string, name: string) => number | undefined;

const onOff = (v: number | undefined): "on" | "off" => (v ? "on" : "off");
const txt = (v: number | undefined) => (v === undefined ? "?" : String(v));
const named = (list: readonly string[], v: number | undefined) => (v === undefined ? undefined : list[v]);

export function ifxRoute(kind: "hd1" | "combi", read: Read, typeName: (id: number) => string): RouteGraph {
  const ifxOn = (n: number) => !!read(`Insert Effect${n}`, "Switch");
  const chains = (n: number) => n < 12 && !!read(`Insert Effect${n}`, "Chain Switch");
  const sources: { node: RouteNode; bus: number | undefined }[] = kind === "hd1"
    ? [
        { node: { id: "src", x: 10, y: 246, w: 110, h: 18, label: "Program", detail: named(SOURCE_BUS, read("Common", "Bus Select")) }, bus: read("Common", "Bus Select") },
        { node: { id: "drum", x: 200, y: 246, w: 110, h: 18, label: "Drum Track", detail: named(SOURCE_BUS, read("Drum Track", "Bus Select")) }, bus: read("Drum Track", "Bus Select") },
      ]
    : Array.from({ length: 16 }, (_, i) => ({ node: { id: `t${i + 1}`, x: 10 + i * 26, y: 248, w: 20, h: 16, label: `${i + 1}` }, bus: read(`Timbre${i + 1}`, "Bus Select") }));

  const edges: RouteEdge[] = [];
  for (const { node, bus } of sources) {
    if (bus !== undefined && bus >= 1 && bus <= 12) edges.push({ from: node.id, to: `ifx${bus}`, kind: ifxOn(bus) ? "main" : "dim" });
  }
  for (let n = 1; n <= 11; n++) {
    const to = read(`Insert Effect${n}`, "Chain To");
    if (chains(n) && to !== undefined) edges.push({ from: `ifx${n}`, to: `ifx${to}`, kind: "chain" });
  }

  const nodes: RouteNode[] = sources.map((s) => s.node);
  const ifxNodes: RouteNode[] = [];
  for (let n = 1; n <= 12; n++) {
    const type = read(`Insert Effect${n}`, "Effect Type") ?? 0;
    const dim = type === 0 && !edges.some((e) => e.to === `ifx${n}`);
    ifxNodes.push({
      id: `ifx${n}`, x: 440, y: 6 + (n - 1) * 19, w: 230, h: 17, label: `IFX${n}`, detail: typeName(type),
      state: ifxOn(n) ? "on" : "off", dim, go: `8-7#${n}`,
    });
    if (!dim && !chains(n)) {
      const y = 6 + (n - 1) * 19;
      const bus = read(`Insert Effect${n}`, "Bus Select");
      nodes.push({ id: `out${n}`, x: 716, y, w: 40, h: 17, label: bus === undefined ? "" : IFX_OUT_BUS[bus] });
      edges.push({ from: `ifx${n}`, to: `out${n}`, kind: "main" });
    }
  }
  nodes.push(...ifxNodes);
  return { w: 760, h: 270, nodes, edges };
}

export function masterRoute(read: Read, typeName: (id: number) => string): RouteGraph {
  const eff = (id: string, y: number, group: string, go: string): RouteNode => ({
    id, x: 100, y, w: 280, h: 50, label: id.toUpperCase(), detail: typeName(read(group, "Effect Type") ?? 0),
    state: onOff(read(group, "Switch")), go,
  });
  const nodes: RouteNode[] = [
    { id: "send1", x: 0, y: 40, w: 60, h: 16, label: "Send1" },
    eff("mfx1", 20, "Master Effect1", "9-2"),
    { id: "send2", x: 0, y: 110, w: 60, h: 16, label: "Send2" },
    eff("mfx2", 90, "Master Effect2", "9-3"),
    { id: "ret", x: 420, y: 150, w: 130, h: 44, label: "Return1/2", detail: `${txt(read("Master Effect", "Return 1"))} / ${txt(read("Master Effect", "Return 2"))}` },
    { id: "lr", x: 0, y: 164, w: 60, h: 16, label: "L/R" },
    eff("tfx1", 192, "Total Effect1", "9-4"),
    eff("tfx2", 252, "Total Effect2", "9-5"),
    { id: "master", x: 560, y: 252, w: 130, h: 50, label: "Master Volume", detail: txt(read("Total Effect", "Master Volume")) },
    { id: "out", x: 710, y: 267, w: 50, h: 20, label: "L/R" },
  ];
  const edges: RouteEdge[] = [
    { from: "send1", to: "mfx1", kind: "main" }, { from: "send2", to: "mfx2", kind: "main" },
    { from: "mfx1", to: "ret", kind: "main" }, { from: "mfx2", to: "ret", kind: "main" },
    { from: "ret", to: "tfx1", kind: "main" }, { from: "lr", to: "ret", kind: "main" },
    { from: "tfx1", to: "tfx2", kind: "main" }, { from: "tfx2", to: "master", kind: "main" },
    { from: "master", to: "out", kind: "main" },
  ];
  if (read("Master Effect", "Chain Switch")) {
    edges.push(read("Master Effect", "Chain Direction") ? { from: "mfx2", to: "mfx1", kind: "chain" } : { from: "mfx1", to: "mfx2", kind: "chain" });
  }
  return { w: 760, h: 312, nodes, edges };
}

// IFX1..IFX11 can chain; IFX12 has no Chain Switch row.
export function ifxChainLinks(read: Read): ChainLink[] {
  return Array.from({ length: 11 }, (_, i) => ({ from: i + 1, to: read(`Insert Effect${i + 1}`, "Chain To") ?? 0, on: !!read(`Insert Effect${i + 1}`, "Chain Switch") }));
}
