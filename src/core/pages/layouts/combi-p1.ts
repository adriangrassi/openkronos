// Combination P1 EQ/Vector/Controller: 1-1 Timbre EQ, 1-3 Drum Track, 1-5 Vector Volume, 1-6 Vector CC, 1-7 Vector Envelope, 1-8 Set Up Controllers, 1-9 Pads.
// 1-3 has no figure in the guide: it is built from the Program Drum Track screen and the guide's text. 1-7 and 1-8 are the same screens as in Program mode (same groups), so they are reused.
import type { LRow, LayoutSpec, Slot, TabLayout } from "../layout.ts";
import { box, CHANNELS, check, dial, fader, graph, pick, timbreTable, toggle, trow } from "./kit.ts";
import { p1Layouts } from "./program-hd1-p1.ts";

const VC = "Vector Control", DTC = "Drum Track Common", KC = "KARMA Common";
const MODES = ["Positive", "Negative", "Xfade", "Split"];
// A timbre's check box with no caption: the row band names it.
const tick = (name: string) => (g: string) => check(g, name, "");

const eq: TabLayout = { blocks: [timbreTable([
  trow("Auto Load Program EQ", tick("Auto Load Program EQ")),
  trow("Bypass / Input Trim", (g): Slot => [check(g, "(Track EQ) Bypass", ""), fader(g, "(Track EQ) Trim", undefined, { h: 56 })]),
  trow("High Gain[dB]", (g) => dial(g, "(Track EQ) High Gain")),
  trow("Mid Frequency[Hz]", (g) => dial(g, "(Track EQ) Mid Frequency", undefined, { hz: true })),
  trow("Mid Gain[dB]", (g) => dial(g, "(Track EQ) Mid Gain")),
  trow("Low Gain[dB]", (g) => dial(g, "(Track EQ) Low Gain")),
])] };

const drumTrack: TabLayout = { blocks: [
  { title: "Drum Pattern", side: "left", cols: 4, rows: [
    { cells: [pick(DTC, "Pattern Bank", "Bank:", { w: 2 }), box(DTC, "Pattern Number", "Pattern:", { w: 2 })] },
    { cells: [box(DTC, "Shift", "Shift:", { w: 2 }), toggle(DTC, "Drum Track On", "Play", { w: 2 })] },
  ] },
  { title: "MIDI Channel", side: "right", rows: [{ cells: [pick(DTC, "Output MIDI Channel", "Output:", { options: CHANNELS })] }] },
  { title: "Trigger", side: "left", rows: [
    { cells: [pick(DTC, "Trigger Button Mode", "Mode:", { options: ["Start Immediately", "Wait KBD Trig"] })] },
    { cells: [pick(DTC, "Trigger Latch Mode", "Latch:", { options: ["Off", "On", "Use KARMA Latch"] })] },
    { cells: [pick(DTC, "Trigger Sync Mode", "Sync:")] },
  ] },
  { title: "Keyboard Trigger Zone", side: "right", rows: [
    { label: "Keyboard", cells: [[box(DTC, "Trigger Key Zone Top", "Top:"), box(DTC, "Trigger Key Zone Bottom", "Bottom:")]] },
    { label: "Velocity", cells: [[box(DTC, "Trigger Velocity Zone Top", "Top:"), box(DTC, "Trigger Velocity Zone Bottom", "Bottom:")]] },
  ] },
] };

const vectorVolume: TabLayout = { blocks: [
  { title: "Vector Volume Control", side: "left", rows: [
    { cells: [check(VC, "Enable Volume Control", "Enable Volume Control")] },
    { cells: [check(VC, "Equal Power", "Equal Amount")] },
  ] },
  { side: "right", rows: [{ cells: [graph("vector", VC)] }] },
  timbreTable([
    trow("VJS Assign", (g) => pick(g, "VJS Assign", undefined, { options: ["Off", "+X", "-X", "+Y", "-Y"] })),
    trow("Center Volume", (g) => box(g, "Volume Center")),
    trow("Enable Program Vector Volume", tick("Program Vector Volume")),
  ]),
] };

const vectorCc: TabLayout = { blocks: [
  { title: "Vector CC Control", side: "left", rows: [
    { cells: [check(VC, "Enable Control Change", "Enable CC Control")] },
    { cells: [pick(VC, "X Mode", "VJS X Mode:", { options: MODES })] },
    { cells: [pick(VC, "JS +X Assign", "+X:")] },
    { cells: [pick(VC, "JS -X Assign", "-X:")] },
    { cells: [pick(VC, "Y Mode", "VJS Y Mode:", { options: MODES })] },
    { cells: [pick(VC, "JS +Y Assign", "+Y:")] },
    { cells: [pick(VC, "JS -Y Assign", "-Y:")] },
  ] },
  { side: "right", rows: [{ cells: [graph("vector", VC)] }] },
  timbreTable([
    trow("Enable Combi Vector CC", tick("Combi Vector CC")),
    trow("Enable Program Vector CC", tick("Program Vector CC")),
  ]),
] };

// Eight pads of two columns (note, velocity): the pad's channel on top, then its eight notes. The notes are repeats of one name, so index picks the slot.
const pads: TabLayout = { blocks: [{ title: "Pads (touch to play)", side: "full", cols: 16, rows: [
  { cells: [1, 2, 3, 4, 5, 6, 7, 8].map((n): Slot => ({ caption: `Pad ${n}`, w: 2 })) },
  { cells: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => pick(KC, `(Chord Pad ${n}) MIDI Channel`, undefined, { w: 2, options: CHANNELS })) },
  ...Array.from({ length: 8 }, (_, k): LRow => ({ cells: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((n): Slot[] => [box(KC, `(Chord Pad ${n}) Note`, undefined, { index: k }), box(KC, `(Chord Pad ${n}) Velocity`, undefined, { index: k })]) })),
] }] };

export const combiP1Layouts: LayoutSpec = { "1-1": eq, "1-3": drumTrack, "1-5": vectorVolume, "1-6": vectorCc, "1-7": p1Layouts["1-6"], "1-8": p1Layouts["1-8"], "1-9": pads };
