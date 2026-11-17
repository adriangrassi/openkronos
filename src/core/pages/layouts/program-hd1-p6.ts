// Program HD-1 P6 AMS Mixer/Common Key Track: OSC1 AMS Mixer 6-1 and OSC2 AMS Mixer 6-5 (same screen; 6-5 has no figure), Common Keyboard Track 6-9.
import type { LRow, LayoutSpec, Section, TabLayout } from "../layout.ts";
import { box, check, graph, head, pick, tile } from "./kit.ts";

const TYPES = ["A+B", "Amt AxB", "Offset", "Smoothing", "Shape", "Quantize", "Gate"];

// The real screen shows the part for the chosen Mixer Type only, so each part is a row group drawn for that type's value.
const mixer = (n: 1 | 2, k: 1 | 2): Section => {
  const g = `OSC${n} Mod.Mixer${k}`;
  const at = (is: number[], ...rows: LRow[]): LRow[] => rows.map((r) => ({ ...r, when: { group: g, name: "Type", is } }));
  const srcA = (...more: LRow["cells"]): LRow => ({ cells: [pick(g, "Source A", "AMS A:", { w: 3 }), ...more] });
  return { title: `AMS Mixer ${k}`, side: k === 1 ? "left" : "right", cols: 6, rows: [
    { cells: [pick(g, "Type", "Mixer Type:", { w: 3, options: TYPES }), tile("AMS Mixer routing diagram", 3)] },
    ...at([0], head("A + B")), ...at([1], head("Amt A x B")),
    ...at([0, 1], srcA(box(g, "Amount A", "Amount:", { index: 0, w: 3 })), { cells: [pick(g, "Source B", "AMS B:", { w: 3 }), box(g, "Amount B", "Amount:", { w: 3 })] }),
    ...at([2], head("Offset"), srcA(box(g, "Amount A", "Amount:", { index: 1, w: 3 })), { cells: [box(g, "Offset", "Offset:", { w: 3 })] }),
    ...at([3], head("Smoothing"), srcA(), { cells: [box(g, "Attack", "Attack:", { w: 3 }), box(g, "Decay", "Decay:", { w: 3 })] }),
    ...at([4], head("Shape"), srcA(), { cells: [pick(g, "Shape Type", "Mode:", { w: 3, options: ["Symmetric", "Asymmetric"] }), box(g, "Shape", "Shape:", { w: 3 })] }),
    ...at([5], head("Quantize"), srcA(), { cells: [box(g, "Number Of Steps", "# Of Steps:", { w: 3 })] }),
    ...at([6], head("Gate"),
      { cells: [pick(g, "Source", "Control Source:", { w: 3 }), box(g, "Threshold", "Threshold:", { w: 3 })] },
      { cells: [check(g, "Control At Note On Only", "Control at Note-On Only", { w: 6 })] },
      { rule: true, cells: [pick(g, "Below Threshold", "Below Threshold:", { w: 3, options: ["Fixed Value", "AMS A"] }), box(g, "Below Fixed Value", "Fixed Value:", { w: 3 })] },
      srcA(),
      { rule: true, cells: [pick(g, "At&Above Threshold", "At & Above Threshold:", { w: 3, options: ["Fixed Value", "AMS B"] }), box(g, "At&Above Fixed Value", "Fixed Value:", { w: 3 })] },
      { cells: [pick(g, "Source B", "AMS B:", { w: 3 })] }),
  ] };
};

const keyTrack = (k: 1 | 2): Section => {
  const KT = `Common Keyboard Track${k}`;
  return { title: `Keyboard Track${k}`, side: "full", cols: 4, rows: [
    { cells: [[], graph("keytrack", KT, 2)] },
    { label: "Key", cells: [box(KT, "Low Key", "Low Break:"), box(KT, "Center Key", "Center:"), box(KT, "High Key", "High Break:")] },
    { label: "Ramp", cells: [box(KT, "Low Ramp", "Bottom-Low:"), box(KT, "Center Low Ramp", "Low-Center:"), box(KT, "Center High Ramp", "Center-High:"), box(KT, "High Ramp", "High-Top:")] },
  ] };
};

const ams = (n: 1 | 2): TabLayout => ({ blocks: [mixer(n, 1), mixer(n, 2)] });
export const p6Layouts: LayoutSpec = { "6-1": ams(1), "6-5": ams(2), "6-9": { blocks: [keyTrack(1), keyTrack(2)] } };
