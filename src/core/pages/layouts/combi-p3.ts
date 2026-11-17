// Combination P3 MIDI Filter/Zones: 3-1 MIDI Filter1, 3-2 MIDI Filter2, 3-3 MIDI Filter3, 3-5 Keyboard Zones, 3-6 Velocity Zones.
// 3-6 has no figure in the guide: it is the Keyboard Zones screen with velocity windows in place of key windows.
import type { LayoutSpec, TabLayout } from "../layout.ts";
import { box, check, graph, timbreTable, trow } from "./kit.ts";

const filter = (names: [string, string][]): TabLayout => ({ blocks: [timbreTable(names.map(([band, name]) => trow(band, (g) => check(g, `(Filter) ${name}`, ""))))] });
const knobs = [1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, string] => [`Enable Realtime Control Knob ${n}`, `Knob${n}`]);

// A zone screen: the map of all 16 windows on top, then the window edges per timbre.
const zones = (kind: "key" | "vel", top: [string, string], topSlope: string, bottomSlope: string, bottom: [string, string]): TabLayout => ({ blocks: [
  { side: "full", rows: [{ cells: [graph("zones", kind)] }] },
  timbreTable([
    trow(top[0], (g) => box(g, top[1])),
    trow("Top Slope", (g) => box(g, topSlope)),
    trow("Bottom Slope", (g) => box(g, bottomSlope)),
    trow(bottom[0], (g) => box(g, bottom[1])),
  ]),
] });

export const combiP3Layouts: LayoutSpec = {
  "3-1": filter([["Enable Program Change", "Program Change"], ["Enable After Touch", "After Touch"], ["Enable Damper", "Damper"], ["Enable Portamento SW", "Portamento"], ["Enable JS X as AMS", "JSX As Mod."], ["Enable JS+Y", "JS+Y"], ["Enable JS-Y", "JS-Y"], ["Enable Ribbon", "Ribbon"]]),
  "3-2": filter(knobs),
  "3-3": filter([["Enable SW1", "Switch1"], ["Enable SW2", "Switch2"], ["Enable Foot Switch", "Foot Switch"], ["Enable Foot Pedal", "Foot Pedal"], ["Enable Other Control Change Messages", "Other CC#"], ["Enable KARMA Waveform SysEx", "Waveform SysEx"]]),
  "3-5": zones("key", ["Top Key", "Key Window Top"], "Key Window Top Slope", "Key Window Bottom Slope", ["Bottom Key", "Key Window Bottom"]),
  "3-6": zones("vel", ["Top Velocity", "Vel.Window High"], "Vel.Window High Slope", "Vel.Window Low Slope", ["Bottom Velocity", "Vel.Window Low"]),
};
