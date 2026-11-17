// Pure placement rules for FxPage (kept out of the .tsx so node:test can load them).
import type { FxSection } from "../../../core/fx/desc.ts";
import type { FxGraphSpec } from "../../../core/fx/graphs.ts";

// A graph goes to the section whose title equals spec.section; the rest go in a first full-width block.
export function placeGraphs(sections: FxSection[], graphs: FxGraphSpec[]): { top: FxGraphSpec[]; bySection: Map<string, FxGraphSpec[]> } {
  const titles = new Set(sections.map((s) => s.title));
  const top: FxGraphSpec[] = [];
  const bySection = new Map<string, FxGraphSpec[]>();
  for (const g of graphs) {
    if (!titles.has(g.section)) { top.push(g); continue; }
    bySection.set(g.section, [...(bySection.get(g.section) ?? []), g]);
  }
  return { top, bySection };
}

export function isWide(s: FxSection, hasGraph: boolean): boolean {
  return !!s.table || hasGraph || s.lines.length > 10 || s.title === "Output";
}
