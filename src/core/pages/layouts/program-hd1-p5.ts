// Program HD-1 P5 LFO: OSC1 LFO1 5-1, LFO2 5-2, OSC2 LFO1 5-5, LFO2 5-6 (the same screen, no figure for 5-2/5-5/5-6) and Common LFO 5-9.
import type { LayoutSpec, LRow, TabLayout } from "../layout.ts";
import { LFO_WAVEFORMS } from "../../params/graphs2.ts";
import { ams, box, check, graph, pick } from "./kit.ts";

// Start Phase moves in 5 degree steps from -180 to +180; the last value is Random.
const PHASES = Array.from({ length: 74 }, (_, i) => (i === 73 ? "RND" : `${i < 36 ? "-" : "+"}${Math.abs(i - 36) * 5}`));

const lfoTab = (g: string, common: boolean): TabLayout => {
  const tail: LRow[] = common
    ? [{ cells: [pick(g, "Reset Source", "Reset AMS:", { w: 6 })] }, { cells: [box(g, "Offset", "Offset:", { w: 3 })] }]
    : [{ rule: true, cells: [check(g, "Key Sync", "Key Sync.", { w: 6 })] }, { cells: [box(g, "Offset", "Offset:", { w: 2 }), box(g, "Fade In", "Fade:", { w: 2 }), box(g, "Delay", "Delay:", { w: 2 })] }];
  return { blocks: [
    { title: g, side: "left", cols: 6, rows: [
      { cells: [pick(g, "Waveform", "Waveform:", { w: 3, options: [...LFO_WAVEFORMS] }), box(g, "Start Phase", "Start Phase:", { w: 3, options: PHASES })] },
      { cells: [box(g, "Shape", "Shape:", { w: 3 }), ams(g, "Shape Mod.Source", "Shape Mod.Intensity", "AMS:", 3)] },
      { rule: true, cells: [box(g, "Frequency", "Frequency:", { w: 2 }), box(g, "Frequency Fine", "Fine:", { w: 2 }), check(g, "Stop", "Stop", { w: 2 })] },
      ...tail,
    ] },
    { side: "right", rows: [{ cells: [graph("lfo", g)] }] },
    { title: "Frequency Modulation", side: "full", cols: 6, rows: [{ cells: common
      ? [pick(g, "Frequency Mod.Source", "AMS:", { w: 2 }), box(g, "Frequency Mod.Intensity", "Intensity:", { w: 2 }), ams(g, "Frequency Mod.Int.Mod.Source", "Frequency Mod.Int.Mod.Intensity", "Intensity Mod. AMS:", 2)]
      : [[pick(g, "Frequency Mod.1 Source", "AMS1:", { w: 2 }), pick(g, "Frequency Mod.2 Source", "AMS2:")], [box(g, "Frequency Mod.1 Intensity", "Intensity:", { w: 2 }), box(g, "Frequency Mod.2 Intensity", "Intensity:")], ams(g, "Frequency Mod.1 Int.Mod.Source", "Frequency Mod.1 Int.Mod.Intensity", "Intensity Mod. AMS:", 2)] }] },
    { title: "Frequency MIDI/Tempo Sync.", side: "left", cols: 2, rows: [
      { cells: [check(g, "MIDI Sync", "MIDI/Tempo Sync.", { w: 2 })] },
      { cells: [pick(g, "MIDI Sync Base Note", "Base Note:"), box(g, "MIDI Sync Times", "Times:")] },
    ] },
  ] };
};

export const p5Layouts: LayoutSpec = { "5-1": lfoTab("OSC1 LFO1", false), "5-2": lfoTab("OSC1 LFO2", false), "5-5": lfoTab("OSC2 LFO1", false), "5-6": lfoTab("OSC2 LFO2", false), "5-9": lfoTab("Common LFO", true) };
