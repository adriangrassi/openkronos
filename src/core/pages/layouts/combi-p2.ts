// Combination P2 Timbre Parameters: 2-1 MIDI, 2-2 OSC, 2-3 Pitch, 2-4 Delay, 2-5 Wave Sequence/KARMA, 2-6 EXi Audio Input. Every tab is 16 timbre columns of titled rows.
import type { LayoutSpec, TabLayout } from "../layout.ts";
import { box, CHANNELS, check, pick, timbreTable, trow } from "./kit.ts";

const table = (rows: Parameters<typeof timbreTable>[0]): TabLayout => ({ blocks: [timbreTable(rows)] });

const midi = table([
  // KORG's table names only Off and INT; the other three values stay numbers.
  trow("Status", (g) => pick(g, "Status", undefined, { options: ["Off", "INT", "2", "3", "4"] })),
  trow("MIDI Channel", (g) => box(g, "MIDI Channel", undefined, { options: CHANNELS })),
  trow("Bank Select MSB (When Status=EX2)", (g) => box(g, "Bank MSB")),
  trow("Bank Select LSB (When Status=EX2)", (g) => box(g, "Bank LSB")),
  trow("Timbre Priority", (g) => check(g, "Timbre Priority", "")),
]);

const osc = table([
  trow("Force OSC Mode", (g) => pick(g, "Osc Mode")),
  trow("OSC Select", (g) => pick(g, "Osc Select")),
  trow("Portamento", (g) => box(g, "Portamento Time")),
  trow("Max # of Notes", (g) => pick(g, "Max # of Notes")),
  trow("Chord", (g) => pick(g, "Chord Mode")),
  trow("Chord Source Pad", (g) => pick(g, "Chord Source")),
]);

// The Scale row is not per timbre: it is the Combination's own scale.
const pitch: TabLayout = { blocks: [
  timbreTable([
    trow("Transpose", (g) => box(g, "Transpose")),
    trow("Detune (Use BPM Adjust in Page Menu)", (g) => box(g, "Detune")),
    trow("Bend Range", (g) => box(g, "Bend Range")),
    trow("Use Program's Scale", (g) => check(g, "Use Program Scale", "")),
  ]),
  { side: "full", cols: 8, rows: [{ band: "Scale", cells: [pick("Common", "Scale Type", "Type:", { w: 3 }), pick("Common", "Scale Key", "Key:", { w: 2 }), box("Common", "Scale Random", "Random:", { w: 2 })] }] },
] };

const delay = table([
  trow("Mode", (g) => pick(g, "Delay Mode", undefined, { options: ["Time", "Tempo"] })),
  trow("Time[ms]", (g) => box(g, "Delay Time")),
  trow("Base Note", (g) => pick(g, "Delay Tempo Base Note")),
  trow("Times", (g) => box(g, "Delay Tempo Times")),
]);

const waveSeq = table([
  trow("Wave Sequence Key Sync", (g) => pick(g, "Key Sync")),
  trow("Wave Sequence Swing[%]", (g) => box(g, "Swing")),
  trow("Wave Sequence Quantize Trigger", (g) => pick(g, "Quantize Trigger")),
  trow("KARMA Timbre Off Control", (g) => pick(g, "Osc On/Off By KARMA")),
]);

const exiInput = table([
  trow("EXi1 Input Source", (g) => pick(g, "EXi1 Input Source Bus")),
  trow("EXi1 Channel Select", (g) => pick(g, "EXi1 Input Source Channel")),
  trow("EXi2 Input Source", (g) => pick(g, "EXi2 Input Source Bus")),
  trow("EXi2 Channel Select", (g) => pick(g, "EXi2 Input Source Channel")),
]);

export const combiP2Layouts: LayoutSpec = { "2-1": midi, "2-2": osc, "2-3": pitch, "2-4": delay, "2-5": waveSeq, "2-6": exiInput };
