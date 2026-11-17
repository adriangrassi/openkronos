// Program HD-1 screens: P3 Filter and P4 Amp/EQ here (OSC1 tabs 3-1..3-4 and 4-1..4-3, OSC2 the same shape at 3-5..3-8 and 4-5..4-7, EQ 4-9), P1, P2, P5 and P6 in program-hd1-p1.ts, -p2.ts, -p5.ts and -p6.ts.
// Row and column captions are the product's own UI labels, read off its screens; the refs are names in the parameter table.
import type { LRow, LayoutSpec, Section, Slot, TabLayout } from "../layout.ts";
import { ams, box, check, CURVES, dial, fader, graph, head, pick, side, STAGES } from "./kit.ts";
import { p1Layouts } from "./program-hd1-p1.ts";
import { p2Layouts } from "./program-hd1-p2.ts";
import { p5Layouts } from "./program-hd1-p5.ts";
import { p6Layouts } from "./program-hd1-p6.ts";
import { karmaProgramLayouts } from "./karma.ts";
import { fxProgramLayouts } from "./fx.ts";
// A row's box of one Filter A / Filter B pair, A over B.
const ab = (F: string, name: string, label: string): Slot => (["A", "B"] as const).map((x) => box(`${F} ${x}`, name, `${label} to ${x}:`));

// ---- P3 Filter ----
function filterTabs(n: 1 | 2): LayoutSpec {
  const F = `OSC${n} Filter`, KT = `${F} Keyboard Track`;
  const t = (i: number) => `3-${(n - 1) * 4 + i}`;
  const pane = (x: "A" | "B"): Section => {
    const g = `${F} ${x}`;
    const pair = (label: string, name: string, src: string, amt: string): LRow => ({ rule: true, cells: [box(g, name, label, { w: 2 }), ams(g, src, amt, "AMS:", 2)] });
    return { title: `Filter ${x}`, side: side(x), cols: 4, rows: [
      { cells: [pick(g, "Filter Type", "Type:", { w: 3, options: ["Low Pass", "High Pass", "Band Pass", "Band Reject"] }), check(g, "Bypass", "Bypass")] },
      { cells: [box(g, "Cutoff", "Frequency:")] },
      { cells: [box(g, "Trim", "Input Trim:")] },
      pair("Resonance:", "Resonance", "Resonance Mod.Source", "Resonance Mod.Intensity"),
      pair("Output Level:", "Output", "Output Mod.Source", "Output Mod.Intensity"),
    ] };
  };
  const modPane = (x: "A" | "B"): Section => ({ title: `Filter ${x} Modulation`, side: side(x), cols: 3, rows: [
    { cells: [pick(`${F} ${x}`, "Mod.1 Source", "AMS1:", { w: 2 }), box(`${F} ${x}`, "Mod.1 Intensity", "Intensity:")] },
    { cells: [pick(`${F} ${x}`, "Mod.2 Source", "AMS2:", { w: 2 }), box(`${F} ${x}`, "Mod.2 Intensity", "Intensity:")] },
  ] });
  const lfoRow = (lfo: string): LRow => ({ cells: [ab(F, `${lfo} Intensity`, "Intensity"), ab(F, `${lfo} JS(-Y) Intensity`, "JS-Y Intensity"), [pick(F, `${lfo} Int.Mod.Source`, "AMS:")], ab(F, `${lfo} Int.Mod.Intensity`, "Intensity")] });
  return {
    [t(1)]: { blocks: [
      { title: `Filter ${n} Routing`, side: "left", rows: [{ cells: [pick(F, "Routing", undefined, { look: "radio", options: ["Single", "Serial", "Parallel", "24dB(4-Pole)"] })] }] },
      { side: "right", rows: [{ cells: [graph("filter", `${F} A`)] }] },
      pane("A"), pane("B"),
    ] },
    [t(2)]: { blocks: [
      { title: "Keyboard Track", side: "full", cols: 4, rows: [
        { cells: [ab(F, "Keyboard Track", "Intensity"), graph("keytrack", KT, 2)] },
        { label: "Key", cells: [box(KT, "Low Key", "Low Break:"), box(KT, "Center Key", "Center:"), box(KT, "High Key", "High Break:")] },
        { label: "Ramp", cells: [box(KT, "Low Ramp", "Bottom-Low:"), box(KT, "Center Low Ramp", "Low-Center:"), box(KT, "Center High Ramp", "Center-High:"), box(KT, "High Ramp", "High-Top:")] },
      ] },
      { title: "Filter EG", side: "full", cols: 4, rows: [{ cells: [ab(F, "Velocity EG Intensity", "Velocity"), ab(F, "EG Intensity", "Intensity"), [pick(F, "EG Int.Mod.Source", "AMS:")], ab(F, "EG Int.Mod.Intensity", "Intensity")] }] },
      modPane("A"), modPane("B"),
    ] },
    [t(3)]: { blocks: [
      { title: "LFO 1/2", side: "full", cols: 4, rows: [head("LFO1"), lfoRow("LFO1"), head("LFO2"), lfoRow("LFO2")] },
      { title: "Common LFO", side: "full", cols: 4, rows: [lfoRow("Common LFO")] },
    ] },
    [t(4)]: egTab(`${F} EG`, true),
  };
}

// The EG screen shared by Filter and Amp: Reset and graph, Envelope, Level and Time Modulation. The Amp EG has no Release level.
function egTab(g: string, releaseLevel: boolean): TabLayout {
  const stages = STAGES;
  const levels = ["Start", "Attack", "Break", "Sustain", ...(releaseLevel ? ["Release"] : [])];
  const timeMod = (k: number): LRow => ({ cells: [pick(g, `Time Mod.${k} Source`, `AMS${k}:`), ...stages.map((s) => box(g, `Time Mod.${k} Intensity To ${s} Time`, `${s}:`))] });
  return { blocks: [
    { title: "EG Reset", side: "left", cols: 2, rows: [{ cells: [pick(g, "Reset Source", "AMS:"), box(g, "Reset Threshold", "Threshold:")] }] },
    { side: "right", rows: [{ cells: [graph("env", g)] }] },
    { title: "Envelope", side: "full", cols: 5, rows: [
      { label: "Level", cells: levels.map((s) => box(g, `${s} Level`, `${s}:`)) },
      { label: "Time", cells: stages.map((s) => box(g, `${s} Time`, `${s}:`)) },
      { label: "Curve", cells: stages.map((s) => box(g, `${s} Time EG Curve`, `${s}:`, { options: CURVES })) },
    ] },
    { title: "Level Modulation", side: "full", cols: 5, rows: [{ cells: [pick(g, "Level Mod.Source", "AMS:"), ...["Start", "Attack", "Break"].map((s) => box(g, `Level Mod.Intensity To ${s} Level`, `${s}:`))] }] },
    { title: "Time Modulation", side: "full", cols: 5, rows: [timeMod(1), timeMod(2), timeMod(3)] },
  ] };
}

// ---- P4 Amp/EQ ----
function ampTabs(n: 1 | 2): LayoutSpec {
  const D = `OSC${n} Drive`, A = `OSC${n} Amplifier`, O = `OSC${n} Output`, KT = `${A} Keyboard Track`;
  const t = (i: number) => `4-${(n - 1) * 4 + i}`;
  const lfo = (k: 1 | 2): LRow[] => [head(`LFO${k}`), { rule: true, cells: [box(A, `LFO${k} Intensity`, "Intensity:", { w: 2 }), ams(A, `LFO${k} Int.Mod.Source`, `LFO${k} Int.Mod.Intensity`, "AMS:", 2)] }];
  return {
    [t(1)]: { blocks: [
      { title: "Driver", side: "left", rowSpan: 2, cols: 2, rows: [
        { cells: [check(D, "Bypass", "Bypass", { w: 2 })] },
        { rule: true, cells: [dial(D, "Drive", "Drive"), ams(D, "Drive Mod.Source", "Drive Mod.Intensity")] },
        { rule: true, cells: [dial(D, "Boost", "Low Boost"), ams(D, "Boost Mod.Source", "Boost Mod.Intensity")] },
      ] },
      { title: `Amp Level${n}`, side: "right", rows: [{ cells: [fader(A, "Level", `Amp Level${n}`)] }] },
      { title: "Pan", side: "right", cols: 2, rows: [
        { cells: [dial(O, "Panpot", "Pan"), ams(O, "Panpot Mod.Source", "Panpot Mod.Intensity", "AMS:")] },
        { rule: true, cells: [check(O, "Use Drum.Inst Panpot", "Use DKit Setting", { w: 2 })] },
      ] },
    ] },
    [t(2)]: { blocks: [
      { title: "Keyboard Track", side: "full", cols: 4, rows: [
        { cells: [[], graph("keytrack", KT, 2)] },
        { label: "Key", cells: [box(KT, "Low Key", "Low Break:"), box(KT, "Center Key", "Center:"), box(KT, "High Key", "High Break:")] },
        { label: "Ramp", cells: [box(KT, "Low Ramp", "Bottom-Low:"), box(KT, "Center Low Ramp", "Low-Center:"), box(KT, "Center High Ramp", "Center-High:"), box(KT, "High Ramp", "High-Top:")] },
      ] },
      { title: "Amp Modulation", side: "left", cols: 4, rows: [{ cells: [box(A, "Velocity EG Intensity", "Velocity Intensity:", { w: 2 }), ams(A, "EG Int.Mod.Source", "EG Int.Mod.Intensity", "AMS:", 2)] }] },
      { title: "LFO 1/2", side: "right", rows: [...lfo(1), ...lfo(2)] },
    ] },
    [t(3)]: egTab(`${A} EG`, false),
  };
}

const eq: TabLayout = { blocks: [{ title: "3 Band Parametric EQ", side: "full", cols: 4, rows: [
  head("(All OSCs)"),
  { cells: [[check("Track EQ", "Bypass", "Bypass"), box("Track EQ", "Trim", "Input Trim:")], graph("eq", "Track EQ", 3)] },
  { rule: true, cells: [
    dial("Track EQ", "Low Gain", "Low Gain", { unit: "[dB]" }), dial("Track EQ", "Mid Frequency", "Mid Cutoff", { unit: "[Hz]", hz: true }),
    dial("Track EQ", "Mid Gain", "Mid Gain", { unit: "[dB]" }), dial("Track EQ", "High Gain", "High Gain", { unit: "[dB]" }),
  ] },
] }] };

export const programHd1Layouts: LayoutSpec = { ...p1Layouts, ...p2Layouts, ...filterTabs(1), ...filterTabs(2), ...ampTabs(1), ...ampTabs(2), "4-9": eq, ...p5Layouts, ...p6Layouts, ...karmaProgramLayouts, ...fxProgramLayouts };
