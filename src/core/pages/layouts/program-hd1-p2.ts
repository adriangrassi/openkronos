// Program HD-1 P2 OSC/Pitch: OSC1 Basic 2-1 and Pitch 2-2, OSC2 Basic 2-5 and Pitch 2-6 (same shape), Pitch EG 2-9.
import type { LRow, LayoutSpec, TabLayout } from "../layout.ts";
import { ams, box, cap, check, CURVES, graph, pick, STAGES, tile } from "./kit.ts";

const oscBasic = (n: 1 | 2): TabLayout => {
  const T = `OSC${n} Trigger`, P = `OSC${n} Pitch`;
  // Zone i has a bottom velocity, crossfade and curve towards zone i+1; the last zone has none.
  const zone = (i: number): LRow => {
    const to = `Zone${i} - ${i + 1}`;
    return { label: String(i), cells: [
      pick(T, `Zone${i} MS Type`, undefined, { w: 2, options: ["Off", "Multi", "Wave Sequence"] }), box(T, `Zone${i} MS Number`, undefined, { w: 2 }), pick(T, `Zone${i} MS Start Offset`, undefined, { w: 2 }), check(T, `Zone${i} MS Reverse`, "", { w: 1 }), box(T, `Zone${i} MS Level`),
      ...(i < 8 ? [box(T, `${to} Bottom Velocity`), box(T, `${to} Crossfade Range`), pick(T, `${to} Curve`, undefined, { w: 2 })] : [cap("", 4)]),
    ] };
  };
  return { blocks: [
    { title: `OSC${n} Frequency`, side: "full", cols: 5, rows: [{ cells: [
      pick(P, "Octave", "Octave:", { options: ["-2[32']", "-1[16']", "+0[8']", "+1[4']"] }), box(P, "Transpose", "Transpose:"), box(P, "Tune", "Tune:"), box(P, "Frequency Offset", "Frequency Offset:", { unit: "[Hz]", w: 2 }),
    ] }] },
    { title: `OSC${n} Velocity Zone`, side: "right", cols: 2, rows: [{ cells: [box(T, "Velocity Zone Top", "Top:"), box(T, "Velocity Zone Bottom", "Bottom:")] }, { cells: [tile("OSC2 velocity zones"), tile("OSC1 velocity zones")] }] },
    { title: "Note-On Control", side: "left", cols: 2, rows: [{ cells: [box(T, "Delay Start", "Delay:"), pick(T, "Damper Control", "Mode:", { options: ["Key", "Key + Damper"] })] }] },
    { title: "Multisample/Wave Sequence", side: "full", cols: 12, rows: [
      { label: "MS", cells: [cap("Type", 2), cap("Number", 2), cap("Start Offset", 2), cap("Rev."), cap("Level"), cap("Bottom Vel."), cap("Xfade Range"), cap("Curve", 2)] },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(zone),
    ] },
  ] };
};

const oscPitch = (n: 1 | 2): TabLayout => {
  const P = `OSC${n} Pitch`;
  const lfo = (k: 1 | 2): LRow[] => [
    { label: `LFO${k}`, cells: [] },
    { cells: [[box(P, `LFO${k} Intensity`, "Intensity:"), box(P, `LFO${k} JS(+Y) Intensity`, "JS+Y Intensity:")], ams(P, `LFO${k} Int.Mod.Source`, `LFO${k} Int.Mod.Intensity`)] },
  ];
  return { blocks: [
    { title: "Pitch", side: "left", cols: 2, rows: [{ cells: [
      [box(P, "Pitch Slope", "Pitch Slope:"), box(P, "Pitch Bend Ribbon", "Ribbon:"), box(P, "Pitch Bend JS(+X)", "JS(+X):"), box(P, "Pitch Bend JS(-X)", "JS(-X):")],
      ams(P, "Mod.Source", "Mod.Intensity"),
    ] }] },
    { side: "right", rows: [{ cells: [tile("Pitch against the keyboard (pitch slope)")] }] },
    { title: "Pitch EG", side: "left", cols: 2, rows: [{ cells: [box(P, "Pitch EG Intensity", "Intensity:"), ams(P, "Pitch EG Int.Mod.Source", "Pitch EG Int.Mod.Intensity")] }] },
    { title: "LFO1/2", side: "right", rowSpan: 2, cols: 2, rows: [...lfo(1), ...lfo(2)] },
    { title: "Portamento", side: "left", cols: 2, rows: [{ cells: [
      [check(P, "Portamento Switch", "Enable"), check(P, "Portamento Fingered", "Fingered")],
      [pick(P, "Portamento Mode", "Mode:"), box(P, "Portamento Time", "Time:")],
    ] }] },
  ] };
};

// The Pitch EG screen: Reset and graph, Envelope (no Sustain level), two Level modulations and one Time modulation.
const pitchEg = (): TabLayout => {
  const g = "Pitch EG";
  const levelMod = (k: 1 | 2): LRow => ({ cells: [pick(g, `Level Mod.${k} Source`, `AMS${k}:`), ...["Start", "Attack", "Break"].map((s) => box(g, `Level Mod.${k} Intensity To ${s} Level`, `${s}:`))] });
  return { blocks: [
    { title: "EG Reset", side: "left", cols: 2, rows: [{ cells: [pick(g, "Reset Source", "AMS:"), box(g, "Reset Threshold", "Threshold:")] }] },
    { side: "right", rows: [{ cells: [graph("env", g)] }] },
    { title: "Envelope", side: "full", cols: 5, rows: [
      { label: "Level", cells: [box(g, "Start Level", "Start:"), box(g, "Attack Level", "Attack:"), box(g, "Break Level", "Break:"), [], box(g, "Release Level", "Release:")] },
      { label: "Time", cells: STAGES.map((s) => box(g, `${s} Time`, `${s}:`)) },
      { label: "Curve", cells: STAGES.map((s) => box(g, `${s} Time EG Curve`, `${s}:`, { options: CURVES })) },
    ] },
    { title: "Level Modulation", side: "full", cols: 5, rows: [levelMod(1), levelMod(2)] },
    { title: "Time Modulation", side: "full", cols: 5, rows: [{ cells: [pick(g, "Time Mod.Source", "AMS:"), ...["Attack", "Decay", "Slope"].map((s) => box(g, `Time Mod.Intensity To ${s} Time`, `${s}:`))] }] },
  ] };
};

export const p2Layouts: LayoutSpec = { "2-1": oscBasic(1), "2-2": oscPitch(1), "2-5": oscBasic(2), "2-6": oscPitch(2), "2-9": pitchEg() };
