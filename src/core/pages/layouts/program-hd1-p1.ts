// Program HD-1 P1 Basic/Vector: 1-1 Program Basic, 1-3 Drum Track, 1-5 Vector Control, 1-6 Vector Envelope, 1-8 Set Up Controllers. 1-9 Pads has no rows in the tables.
import type { LRow, LayoutSpec, Slot, TabLayout } from "../layout.ts";
import { box, cap, check, dial, graph, pick, tile, toggle } from "./kit.ts";

const C = "Common", DT = "Drum Track", DTC = "Drum Track Common", VC = "Vector Control";

const programBasic: TabLayout = { blocks: [
  { title: "Oscillator Mode", side: "left", rows: [{ cells: [pick(C, "Oscillator Mode", undefined, { look: "radio" })] }] },
  { title: "Play Page MS/WS/DKit Display", side: "right", cols: 2, rows: [{ cells: [pick("OSC1 Trigger", "MS/WS/D.Kit Display", "OSC1:"), pick("OSC2 Trigger", "MS/WS/D.Kit Display", "OSC2:")] }] },
  { title: "Voice Assign Mode", side: "full", cols: 12, rows: [
    { cells: [pick(C, "Assign Mode", undefined, { look: "radio", w: 2 }), check(C, "Poly Legato", "Poly Legato", { w: 2 }), check(C, "Single Trigger", "Single Trigger", { w: 2 }), pick(C, "Max # of Notes", "Max # of Notes:", { w: 2 }), pick(C, "Chord Mode", "Chord:", { w: 2 }), pick(C, "Chord Source", "Source Pad:", { w: 2 })] },
    { rule: true, cells: [check(C, "Legato", "Mono Legato", { w: 3 }), pick(C, "Legato using S.Offset", "Mode:", { w: 3 }), check(C, "Unison", "Unison", { w: 2 }), box(C, "Unison Voices", "Number of Voices:", { w: 2 }), box(C, "Stereo Spread", "Stereo Spread:", { w: 2 })] },
    { cells: [pick(C, "Key Priority", "Priority:", { w: 6 }), box(C, "Unison Detune", "Detune [cents]:", { w: 3 }), box(C, "Unison Thickness", "Thickness:", { w: 3 })] },
  ] },
  { title: "Key Zone", side: "left", rowSpan: 3, cols: 3, rows: [
    { label: "OSC1", cells: [[], box("OSC1 Trigger", "Key Zone Bottom", "Bottom:"), box("OSC1 Trigger", "Key Zone Top", "Top:")] },
    { label: "OSC2", cells: [[], box("OSC2 Trigger", "Key Zone Bottom", "Bottom:"), box("OSC2 Trigger", "Key Zone Top", "Top:")] },
    { rule: true, cells: [check(C, "Hold", "Hold"), box(C, "Hold Bottom Key", "Bottom:"), box(C, "Hold Top Key", "Top:")] },
    { cells: [tile("Key zones of OSC1, OSC2 and Hold across the keyboard", 3)] },
  ] },
  { title: "Scale", side: "right", cols: 4, rows: [{ cells: [pick(C, "Scale Type", "Type:", { w: 2 }), pick(C, "Scale Key", "Key:"), box(C, "Scale Random", "Random:")] }] },
  { title: "Wave Sequence", side: "right", cols: 3, rows: [{ cells: [box(C, "Swing", "Swing:"), check(C, "Key Sync", "Key Sync"), check(C, "Quantize Trigger", "Quantize Triggers")] }] },
  { title: "Half-Damper Control", side: "right", rows: [{ cells: [check(C, "Enable Half Damper", "Enable Half-Damper")] }] },
] };

// The table names the drum track's two Track EQ rows the other way round: the 0..99 one called Bypass is the Input Trim (Track EQ has Trim 0..99 and Bypass Off/On at the same bits).
const drumTrack: TabLayout = { blocks: [
  { title: "Drum Pattern", side: "left", cols: 3, rows: [
    { cells: [pick(DTC, "Pattern Bank", "Pattern:", { w: 1 }), box(DTC, "Pattern Number", undefined, { w: 2 })] },
    { cells: [box(DTC, "Shift", "Shift:", { w: 3 })] },
  ] },
  { title: "Drum Track Parameters", side: "right", cols: 4, rows: [
    { cells: [pick(DT, "Program Bank", "Program:", { w: 2 }), box(DT, "Program Number", undefined, { w: 2 })] },
    { cells: [box(DT, "Volume", "Volume:"), box(DT, "Detune", "Detune:", { w: 2 }), toggle(DTC, "Drum Track On", "Play")] },
  ] },
  { title: "Trigger", side: "left", rows: [
    { cells: [pick(DTC, "Trigger Button Mode", "Mode:", { options: ["Start Immediately", "Wait KBD Trig"] })] },
    { cells: [pick(DTC, "Trigger Latch Mode", "Latch:", { options: ["Off", "On", "Use KARMA Latch"] })] },
    { cells: [pick(DTC, "Trigger Sync Mode", "Sync:")] },
  ] },
  { title: "Keyboard Trigger Zone", side: "left", rows: [
    { label: "Keyboard", cells: [[box(DTC, "Trigger Key Zone Top", "Top:"), box(DTC, "Trigger Key Zone Bottom", "Bottom:")]] },
    { label: "Velocity", cells: [[box(DTC, "Trigger Velocity Zone Top", "Top:"), box(DTC, "Trigger Velocity Zone Bottom", "Bottom:")]] },
  ] },
  { title: "EQ", side: "right", cols: 2, rows: [
    { cells: [check(DT, "Auto Load Program EQ", "Auto Load Program EQ", { w: 2 })] },
    { cells: [check(DT, "(Track EQ) Trim", "Bypass"), box(DT, "(Track EQ) Bypass", "Input Trim:")] },
    { rule: true, cells: [dial(DT, "(Track EQ) High Gain", "High Gain", { unit: "[dB]" }), dial(DT, "(Track EQ) Mid Frequency", "Mid Freq", { unit: "[Hz]", hz: true })] },
    { cells: [dial(DT, "(Track EQ) Low Gain", "Low Gain", { unit: "[dB]" }), dial(DT, "(Track EQ) Mid Gain", "Mid Gain", { unit: "[dB]" })] },
  ] },
  { title: "BUS", side: "right", cols: 2, rows: [
    { cells: [pick(DT, "Bus Select", "Bus Select:"), check(DT, "Use D.Kit Setting", "Use DKit")] },
    { cells: [pick(DT, "Fx Bus Select", "FX Control Bus:", { w: 2 })] },
    { cells: [pick(DT, "Rec Bus", "Rec Bus:", { w: 2 })] },
    { cells: [box(DT, "Send1", "Send 1:"), box(DT, "Send2", "Send 2:")] },
    { rule: true, cells: [cap("IFX Patch", 2)] },
    ...[0, 1, 2, 3, 4, 5].map((i): LRow => ({ cells: [pick(DT, `IFX Patch ${i}`, `IFX${i + 1}:`), pick(DT, `IFX Patch ${i + 6}`, `IFX${i + 7}:`)] })),
  ] },
] };

const vectorControl: TabLayout = { blocks: [
  { title: "Vector Volume Control", side: "left", rows: [
    { cells: [check(VC, "Enable Volume Control", "Enable Volume Control")] },
    { cells: [check(VC, "Equal Power", "Equal Power")] },
    { cells: [pick("OSC1 Output", "Vector Center Level", "OSC1 Center Volume:")] },
    { cells: [pick("OSC2 Output", "Vector Center Level", "OSC2 Center Volume:")] },
  ] },
  { side: "right", rowSpan: 2, rows: [{ cells: [graph("vector", VC)] }] },
  { title: "Vector CC Control", side: "left", rows: [
    { cells: [check(VC, "Enable Control Change", "Enable CC Control")] },
    { cells: [pick(VC, "X Mode", "VJS X Mode:")] },
    { cells: [pick(VC, "JS +X Assign", "+X:")] },
    { cells: [pick(VC, "JS -X Assign", "-X:")] },
    { cells: [pick(VC, "Y Mode", "VJS Y Mode:")] },
    { cells: [pick(VC, "JS +Y Assign", "+Y:")] },
    { cells: [pick(VC, "JS -Y Assign", "-Y:")] },
  ] },
] };

// Stack of one point's time, base note and multiplier.
const timing = (kind: "Hold" | "Transition", span: string, caption?: string): Slot => [
  box(VC, `(${span}) ${kind} Time`, caption),
  pick(VC, `(${span}) ${kind} Time Base Note`),
  box(VC, `(${span}) ${kind} Time Times`, "x"),
];
const hold = ["0to1", "1to2", "2to3", "3to4"];
const vectorEnvelope: TabLayout = { blocks: [
  { title: "Basic", side: "left", cols: 2, rows: [
    { cells: [check(VC, "Enable Vector", "Vector Envelope On", { w: 2 })] },
    { cells: [check(VC, "Key Sync", "Key Sync", { w: 2 })] },
    { cells: [pick(VC, "Tempo Based", "Mode:", { w: 2, look: "radio", options: ["Time", "Tempo"] })] },
  ] },
  { side: "right", rowSpan: 2, rows: [{ cells: [graph("vector", VC)] }] },
  { title: "Vector Envelope Loop", side: "left", cols: 2, rows: [{ cells: [pick(VC, "Loop Direction", "Loop Type:"), box(VC, "Loop Repeat", "Loop Repeat:")] }] },
  { title: "Vector Envelope", side: "full", cols: 5, rows: [
    { label: "Point", cells: [0, 1, 2, 3, 4].map((i) => cap(String(i))) },
    { label: "Position", cells: [0, 1, 2, 3, 4].map((i): Slot => [box(VC, `(${i}) Position X`, "X:"), box(VC, `(${i}) Position Y`, "Y:")]) },
    { label: "Hold Time", cells: [...hold.map((s) => timing("Hold", s)), []] },
    { label: "Transition", cells: [timing("Transition", "0to1"), timing("Transition", "1to2"), timing("Transition", "2to3"), timing("Transition", "3toLoop", "Loop:"), timing("Transition", "3to4", "Release:")] },
  ] },
] };

const setUp: TabLayout = { blocks: [
  { title: "Panel Switch Assign", side: "full", cols: 2, rows: [{ cells: [1, 2].map((n): Slot => [
    toggle("Assignable Controller", `Switch${n} Status`, `SW${n}`),
    pick("Assignable Controller", `Switch${n} Assign`),
    pick("Assignable Controller", `Switch${n} Mode`, "Mode:"),
  ]) }] },
  { title: "Modulation Knob Assign", side: "full", cols: 4, rows: [{ cells: [5, 6, 7, 8].map((n) => pick("Assignable Controller", `Knob${n} Assign`, `Knob${n}`)) }] },
] };

export const p1Layouts: LayoutSpec = { "1-1": programBasic, "1-3": drumTrack, "1-5": vectorControl, "1-6": vectorEnvelope, "1-8": setUp };
