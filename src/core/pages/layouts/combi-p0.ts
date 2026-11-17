// Combination P0 Play tabs beyond the mixer: 0-8 Audio Input/Sampling. The Sampling Setup, Metronome and recording level parts of that screen are not in the Combination table.
// Perf Meters, KARMA GE, Ctrl View/Effect and Control Surface show other tabs' data or live meters and stay disabled.
import type { LayoutSpec, LRow, Slot } from "../layout.ts";
import { cap, check, dial, fader, pick, toggle } from "./kit.ts";

const INPUTS = [["Audio Input 1", "INPUT 1"], ["Audio Input 2", "INPUT 2"], ["Audio Input 3", "INPUT 3"], ["Audio Input 4", "INPUT 4"], ["S/PDIF L", "S/PDIF L"], ["S/PDIF R", "S/PDIF R"]] as const;
const col = (label: string, make: (g: string) => Slot): LRow => ({ label, cells: INPUTS.map(([g]) => make(g)) });

export const combiP0Layouts: LayoutSpec = { "0-8": { blocks: [{ title: "Audio Input", side: "full", cols: 6, rows: [
  { cells: [check("Audio Input", "Use Global Setting", "Use Global Setting", { w: 6 })] },
  { label: "", cells: INPUTS.map(([, t]) => cap(t)) },
  col("Bus Select (IFX/Indiv.)", (g) => pick(g, "Bus Select")),
  col("FX Ctrl Bus", (g) => pick(g, "Fx Control Bus")),
  col("REC Bus", (g) => pick(g, "Rec Bus")),
  col("Send1 (to MFX1)", (g) => dial(g, "Send1")),
  col("Send2 (to MFX2)", (g) => dial(g, "Send2")),
  col("Mute", (g) => toggle(g, "Mute", "Mute")),
  col("Pan", (g) => dial(g, "Pan")),
  col("Level", (g) => fader(g, "Level")),
] }] } };
