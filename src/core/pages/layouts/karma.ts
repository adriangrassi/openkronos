// KARMA page P7, tabs 7-1..7-9, for Program HD-1 (one module, group "KARMA Module") and Combination (modules A-D, groups "KARMA Module A".."D").
// Program: figures p125 (7-1) p128 (7-2) p130 (7-3) p135 (7-4) p138 (7-5) p141 (7-6) p146 (7-7) p148 (7-8); 7-9 has none and is built from the Combination figure p514.
// Combination: figures p499 (7-1) p504 (7-3) p505 (7-4) p507/p508 (7-5) p510 (7-6) p511 (7-7) p512 (7-8) p514 (7-9); 7-2 has none and is the Program screen with four module columns.
// Repeated grids (GE parameters 1..32, scenes 1..8, the 128 note map keys) are generated, so the specs stay short; rows that no screen shows stay in More.
import type { LRow, LayoutSpec, Section, Slot, TabLayout } from "../layout.ts";
import { box, cap, CHANNELS, check, head, pick, tile, toggle } from "./kit.ts";
import { combiP1Layouts } from "./combi-p1.ts";

const KC = "KARMA Common";
type Mod = { g: string; tag: string };
const PROGRAM: Mod[] = [{ g: "KARMA Module", tag: "A" }];
const COMBI: Mod[] = ["A", "B", "C", "D"].map((tag) => ({ g: `KARMA Module ${tag}`, tag }));
function nums8(prefix: string): string[] { return Array.from({ length: 8 }, (_, i) => `${prefix}${i + 1}`); }
const pad2 = (n: number) => String(n).padStart(2, "0");
const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const badge = (tag: string, w = 1): Slot => ({ caption: tag, w, badge: true });
const badges = (mods: Mod[], w = 1): Slot[] => mods.map((m) => badge(m.tag, w));
// One row of a module table: the same cell for every module column.
const mrow = (label: string, mods: Mod[], make: (g: string) => Slot): LRow => ({ label, cells: mods.map((m) => make(m.g)) });
// Rows that hold two controls per module (a pop-up and a box, a check and a pop-up): the module takes two grid columns.
const mrow2 = (label: string, mods: Mod[], make: (g: string) => [Slot, Slot]): LRow => ({ label, cells: mods.flatMap((m) => make(m.g)) });
const spacer: Slot = [];
const POL = ["+", "-"];
// Value names the guide gives (7-3b and 7-4b) where the data table has only the first and last.
const WRAP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const TRIG = ["Any", "AKR", "1st", "Dyn"];
const LATCH = ["Off", "Sus1", "Rel1", "Sus2", "Rel2"];
// The Assign column (-1..31): no controller, KARMA sliders, the sliders as switches, KARMA switches, Dynamic MIDI rows (guide 7-5b).
const ASSIGN = ["---", ...nums8("Slider"), ...nums8("Slider(SW)"), ...nums8("SW"), ...nums8("Dyn.MIDI")];
const GROUPS = ["Off", "PE", "Mix", "Control", "Trigger", "Key Zones", "Random Seeds"];
const WINDOW = ["1/16T", "1/16", "1/8T", "1/8", "1/4T", "1/4"];

// ---- 7-1 GE Setup/Key Zones ----
const strip = (multi: boolean): Section => ({ side: "full", cols: 9, rows: [
  { cells: [box(KC, "Tempo", "Tempo:", { w: 2 }), pick(KC, "Time Signature", "KARMA T.Sig:", { w: 2 }), toggle(KC, "Latch Switch", "Latch"), toggle(KC, "KARMA Fx Switch", "KARMA Fx", { w: 2 }), pick(KC, "Pad Mode", "Pad Mode:", { w: 2 })] },
  ...(multi ? [{ cells: [pick(KC, "Module Control", "Module:", { look: "radio" as const, w: 9, options: ["Master", "A", "B", "C", "D"] })] }] : []),
] });

const programSetup: TabLayout = (() => {
  const g = PROGRAM[0].g;
  return { blocks: [
    strip(false),
    { title: "GE Setup", side: "full", cols: 4, rows: [
      { cells: [badge("Module A"), pick(g, "GE Number", "GE Select:", { w: 3 })] },
      head("Key Zone"),
      { cells: [box(g, "Key Zone Bottom", "Bottom:", { w: 2 }), box(g, "Key Zone Top", "Top:", { w: 2 })] },
      { cells: [check(g, "Keyboard Thru In Zone", "Thru In Zone", { w: 2 }), box(g, "Keyboard Thru In Zone Transpose", "Transpose In Zone:", { w: 2 })] },
      { cells: [check(g, "Keyboard Thru Out Zone", "Thru Out Zone", { w: 2 }), box(g, "Keyboard Thru Out Zone Transpose", "Transpose Out Zone:", { w: 2 })] },
    ] },
    // The Program table has no page for the eight chord pads: they sit under the GE setup, drawn like the Combination Pads tab.
    // (the per-pad MIDI channel row is a Combination parameter)
    { ...combiP1Layouts["1-9"].blocks[0], title: "Chord Pads", rows: combiP1Layouts["1-9"].blocks[0].rows.filter((_, i) => i !== 1) },
  ] };
})();

const combiSetup: TabLayout = (() => {
  const m = COMBI;
  return { blocks: [
    strip(true),
    { title: "GE Setup", side: "full", cols: 4, rows: [
      { cells: badges(m) },
      mrow("Run", m, (g) => check(g, "Run GE", "Run")),
      mrow("GE Select", m, (g) => pick(g, "GE Number")),
      mrow("Key Zone", m, (g) => [box(g, "Key Zone Bottom", "Btm:"), box(g, "Key Zone Top", "Top:")]),
      mrow("Thru In Zone", m, (g) => [check(g, "Keyboard Thru In Zone", "Thru In Z"), box(g, "Keyboard Thru In Zone Transpose", "Trans:")]),
      mrow("Thru Out Zone", m, (g) => [check(g, "Keyboard Thru Out Zone", "Thru Out Z"), box(g, "Keyboard Thru Out Zone Transpose", "Trans:")]),
    ] },
    { title: "MIDI I/O", side: "full", cols: 12, labelW: 24, rows: [
      { cells: [cap("Input Ch", 2), cap("Gch Also", 1), cap("Output Ch", 2), cap("Timbres using the Output channel", 6), cap("Timbre Thru", 1)] },
      ...m.map((x): LRow => ({ label: x.tag, cells: [pick(x.g, "Input MIDI Channel", undefined, { w: 2, options: CHANNELS }), check(x.g, "Use Gch Also", ""), pick(x.g, "Output MIDI Channel", undefined, { w: 2, options: CHANNELS }), tile("Output channel map (timbres 1-16)", 6), check(x.g, "Timbre Thru", "")] })),
    ] },
  ] };
})();

// ---- 7-2 MIDI Filter/CC Offset ----
const RECEIVE: [string, string][] = [["After Touch", "After Touch"], ["Pitch Bend", "Pitch Bend"], ["Damper", "Damper (CC#64)"], ["Joy Stick(+Y)", "JS+Y (CC#01)"], ["Joy Stick(-Y)", "JS-Y (CC#02)"], ["Ribbon", "Ribbon (CC#16)"], ["Other CC", "Other CC"]];
const TRANSMIT: [string, string][] = [["Pitch Bend", "Pitch Bend"], ["CC-A", "CC-A"], ["CC-B", "CC-B"], ["Envelope1", "Envelope 1"], ["Envelope2", "Envelope 2"], ["Envelope3", "Envelope 3"], ["GE Notes", "GE Notes"], ["Waveform", "WaveSeq"]];
function midiFilter(mods: Mod[]): TabLayout {
  const filter = (title: string, kind: "Receive" | "Transmit", names: [string, string][], side: "left" | "right"): Section => ({ title: `${title} MIDI Filter`, side, cols: names.length, labelW: 24, rows: [
    { cells: names.map(([, text]) => cap(text)) },
    ...mods.map((m): LRow => ({ label: m.tag, cells: names.map(([n]) => check(m.g, `(${kind} Filter) ${n}`, "")) })),
  ] });
  const multi = mods.length > 1;
  return { blocks: [
    filter("Receive", "Receive", RECEIVE, "left"), filter("Transmit", "Transmit", TRANSMIT, "right"),
    { title: "CC Offset", side: multi ? "full" : "left", cols: mods.length * 3, labelW: 24, rows: [
      { cells: mods.flatMap((m): Slot[] => [badge(m.tag, 3)]) },
      { cells: mods.flatMap((): Slot[] => [cap("CC Number", 2), cap("Value")]) },
      ...nums(4).map((k): LRow => ({ label: String(k), cells: mods.flatMap((m): Slot[] => [pick(m.g, `CC Control${k} Source`, undefined, { w: 2 }), box(m.g, `CC Control${k} Value`)]) })),
    ] },
  ] };
}

// ---- 7-3 Module Parameters-Control ----
function control(mods: Mod[]): TabLayout {
  const multi = mods.length > 1;
  return { blocks: [{ title: "Module Parameters-Control", side: multi ? "full" : "left", cols: mods.length, labelW: 170, rows: [
    { cells: badges(mods) },
    head("Control"),
    mrow("Transpose", mods, (g) => box(g, "Transpose")),
    mrow("Force Range", mods, (g) => pick(g, "Force Range")),
    mrow("Force Range Wrap", mods, (g) => pick(g, "Force Range Wrap", undefined, { options: WRAP })),
    ...(multi ? [mrow("Timbre Zone Bypass", mods, (g) => check(g, "Timbre Zone Bypass", ""))] : []),
    mrow("Root Position", mods, (g) => check(g, "Root Position", "")),
    head("Clock Advance"),
    mrow("Mode", mods, (g) => pick(g, "Clock Advance Mode")),
    mrow("Size", mods, (g) => pick(g, "Clock Advance Size")),
    mrow("Chord Trigger Mode", mods, (g) => pick(g, "Clock Advance Chord Trigger", undefined, { options: ["Off", "1st", "Chord1", "Chord2", "Chord3"] })),
    mrow("Velocity Sense Bottom", mods, (g) => box(g, "Clock Advance Velocity Sense")),
    head("Note Map"),
    mrow("Mode", mods, (g) => pick(g, "Note Map On Mode", undefined, { options: ["Off", "On-Main", "On-Repeat", "On-All"] })),
    mrow("Table", mods, (g) => pick(g, "Note Map Table")),
    mrow("Transpose", mods, (g) => box(g, "Note Map Transpose")),
    mrow("Chord Track", mods, (g) => check(g, "Chord Track On", "")),
    mrow("Keyboard Track(C2 Ref)", mods, (g) => check(g, "Keyboard Track On", "")),
    { label: "Map curve", cells: mods.map(() => tile("Note map curve")) },
  ] }] };
}

// ---- 7-4 Module Parameters-Trigger ----
function trigger(mods: Mod[]): TabLayout {
  const multi = mods.length > 1;
  return { blocks: [{ title: "Module Parameters-Trigger", side: multi ? "full" : "left", cols: mods.length * 2, labelW: 170, rows: [
    { cells: badges(mods, 2) },
    head("Control"),
    mrow2("Quantize Trig / Window", mods, (g) => [check(g, "Quantize Trigger", ""), pick(g, "Quantize Window", undefined, { options: WINDOW })]),
    mrow2("Update On Release", mods, (g) => [check(g, "Update On Release", ""), spacer]),
    mrow2("Link to Drum Track", mods, (g) => [check(g, "Link To Drum Track", ""), spacer]),
    head("Delay"),
    mrow2("Delay Start / Fixed", mods, (g) => [pick(g, "Delay Start Mode"), box(g, "Delay Start ms", undefined, { unit: "ms" })]),
    head("Note"),
    mrow2("Trigger / Latch", mods, (g) => [pick(g, "Note Trigger Mode", undefined, { options: TRIG }), pick(g, "Note Latch", undefined, { options: ["Off", "On"] })]),
    ...nums(3).flatMap((k): LRow[] => [head(`Envelope${k}`), mrow2("Trigger / Latch", mods, (g) => [pick(g, `Envelope${k} Trigger Mode`, undefined, { options: TRIG }), pick(g, `Envelope${k} Latch Mode`, undefined, { options: LATCH })])]),
    ...(multi ? [
      head("Module Trigger"),
      { label: "Trigger By Module", cells: mods.map((m): Slot => pick(m.g, "Triggered By Module", undefined, { w: 2, options: ["Off", "A", "B", "C", "D"] })) },
      { label: "GE Phrase Length", cells: mods.map((m): Slot => box(m.g, "Module %", undefined, { w: 2, unit: "%" })) },
      ...["A", "B", "C", "D"].map((x) => mrow2(`Cutoff Module ${x}`, mods, (g) => [check(g, `Module ${x} Cutoff`, ""), spacer])),
    ] : []),
  ] }] };
}

// ---- 7-5 GE Real-Time Parameters/Scenes ----
// Thirty-two GE parameters as two columns of 16 rows (Min, Max, Value, the fader or switch that drives it, Polarity). The GE's own parameter names are not in the tables: rows are numbered.
function rtp(g: string, scope: "All" | "Module", pane: string): Section[] {
  const half = (n: number, side: "left" | "right"): Section => ({ title: `GE Real-Time Parameters ${n * 16 - 15}-${n * 16}`, side, pane, cols: 6, labelW: 24, rows: [
    { cells: [cap("Min"), cap("Max"), cap("Value"), cap("Assign", 2), cap("Pol.")] },
    ...Array.from({ length: 16 }, (_, k): LRow => {
      const i = (n - 1) * 16 + k, at = { index: i };
      return { label: pad2(i + 1), cells: [box(g, `(GE - ${scope}) Min Value`, undefined, at), box(g, `(GE - ${scope}) Max Value`, undefined, at), box(g, `(GE - ${scope}) Value`, undefined, at), pick(g, `(GE - ${scope}) Fader/Switch Number`, undefined, { ...at, w: 2, options: ASSIGN }), pick(g, `(GE - ${scope}) Polarity`, undefined, { ...at, options: POL })] };
    }),
  ] });
  return [half(1, "left"), half(2, "right")];
}
// Eight scenes as columns: Run, the eight switches (check boxes) and eight faders. Run exists for the Master scenes only.
function sceneGrid(g: string, title: string, pane: string, run: boolean): Section {
  const col = (make: (s: number) => Slot): Slot[] => nums(8).map(make);
  return { title, side: "full", pane, cols: 8, labelW: 70, rows: [
    { cells: nums(8).map((s) => cap(`Scene ${s}`)) },
    ...(run ? [{ label: "Run", cells: col((s) => check(g, `Scene ${s} Run DT`, "")) }] : []),
    ...nums(8).map((k): LRow => ({ label: `Switch ${k}`, cells: col((s) => check(g, `(Scene${s}) Switch${k}`, "")) })),
    ...nums(8).map((k): LRow => ({ label: `Fader ${k}`, cells: col((s) => box(g, `(Scene${s}) Fader${k}`)) })),
  ] };
}
// The Combination's Master scene pick is the first row of its Scene Matrix, so only the quantize is left there.
const sceneSelect = (pane: string, select = true): Section => ({ side: "full", pane, cols: 9, rows: [{ cells: [...(select ? [pick(KC, "Scene Select", "Master Scene:", { look: "radio" as const, w: 6 })] : []), pick(KC, "Scene Change Quantize", "Change Quantize:", { w: 3 })] }] });

const programRtp: TabLayout = { blocks: [...rtp(PROGRAM[0].g, "All", "Master A"), sceneSelect("Scenes"), sceneGrid(KC, "Scenes", "Scenes", true)] };

// The Scene Matrix of p508: each module's scene bar, the link and the RTC enable, plus the module scene each master scene recalls.
const matrix: Section = { title: "Module Control / Scene Matrix", side: "full", pane: "Scenes", cols: 10, labelW: 70, rows: [
  { cells: [cap("Scene", 8), cap("Link to Master"), cap("RTC by Master")] },
  { label: "Master", cells: [pick(KC, "Scene Select", undefined, { look: "radio", w: 8 })] },
  ...COMBI.map((m): LRow => ({ label: m.tag, cells: [pick(m.g, "Scene Select", undefined, { look: "radio", w: 8 }), check(m.g, "Enable Link Scene To Master", ""), check(m.g, "Enable RTC Control By Master", "")] })),
] };
const masterMap: Section = { title: "Module scene for each Master scene", side: "full", pane: "Scenes", cols: 8, labelW: 70, rows: [
  { cells: nums(8).map((s) => cap(`Master ${s}`)) },
  ...COMBI.map((m): LRow => ({ label: m.tag, cells: nums(8).map((s): Slot => pick(m.g, `Master Scene Scene${s}`)) })),
] };
const combiRtp: TabLayout = { blocks: [
  ...COMBI.flatMap((m) => rtp(m.g, "All", `Master ${m.tag}`)),
  ...COMBI.flatMap((m) => [...rtp(m.g, "Module", `Module ${m.tag}`), sceneGrid(m.g, `Scenes of Module ${m.tag}`, `Module ${m.tag}`, false)]),
  matrix, masterMap, sceneSelect("Scenes", false), sceneGrid(KC, "Master Scenes", "Scenes", true),
] };

// ---- 7-6 Perf Real-Time Parameters ----
function perfRtp(mods: Mod[]): TabLayout {
  const group = ["A", "B", "C", "D"].slice(0, mods.length);
  return { blocks: [{ title: "Perf Real-Time Parameters", side: "full", cols: 10 + group.length, labelW: 24, rows: [
    { cells: [cap("Group", 2), cap("Parameter", 2), cap("Min"), cap("Max"), cap("Value"), ...group.map((x) => cap(x)), cap("Assign", 2), cap("Pol.")] },
    ...nums(8).map((i): LRow => {
      const n = `(RT Param.${i})`;
      return { label: String(i), cells: [pick(KC, `${n} Param.Group`, undefined, { w: 2, options: GROUPS }), box(KC, `${n} Param.Assign`, undefined, { w: 2 }), box(KC, `${n} Min Value`), box(KC, `${n} Max Value`), box(KC, `${n} Value`), ...group.map((x): Slot => check(KC, `${n} Module ${mods.length > 1 ? x : "A"} Control`, "")), pick(KC, `${n} Fader/Switch Number`, undefined, { w: 2, options: ASSIGN }), pick(KC, `${n} Polarity`, undefined, { options: POL })] };
    }),
  ] }] };
}

// ---- 7-7 Dynamic MIDI ----
function dynamic(multi: boolean): TabLayout {
  const mods = ["A", "B", "C", "D"];
  return { blocks: [{ title: "Dynamic MIDI", side: "full", cols: 12 + (multi ? 6 : 0), labelW: 24, rows: [
    { cells: [cap("Input", multi ? 2 : 1), cap("Source", 3), cap("Bottom"), cap("Top"), cap("Action", 2), cap("Destination", 3), ...(multi ? [...mods, "L"].map((x) => cap(x)) : []), cap("Pol.")] },
    ...nums(8).map((i): LRow => {
      const n = `(Dynamic MIDI ${i})`;
      return { label: String(i), cells: [multi ? pick(KC, `${n} Input Module`, undefined, { w: 2 }) : cap("A"), pick(KC, `${n} Source ID`, undefined, { w: 3 }), box(KC, `${n} Zone Bottom`), box(KC, `${n} Zone Top`), pick(KC, `${n} Action`, undefined, { w: 2 }), pick(KC, `${n} Destination ID`, undefined, { w: 3 }),
        ...(multi ? [...mods.map((x) => `Module ${x} Control`), "Last Triggered Module"].map((c): Slot => check(KC, `${n} ${c}`, "")) : []), pick(KC, `${n} Polarity`, undefined, { options: POL })] };
    }),
  ] }] };
}

// ---- 7-8 Random Seeds ----
// The Program screen has only the Start block. The Combination one adds the four-way seed pick per seed kind; the screen draws these as bars, here each is a 1-4 pop-up.
const SEEDS: [string, string][] = [["Rhythm", "Rhythm"], ["Duration", "Duration"], ["Index", "Index"], ["Cluster", "Cluster"], ["Velocity", "Velocity"], ["Pan", "CC-A/B/Pitch"], ["Drums", "Drum"], ["Waveform", "WaveSeq"]];
function seeds(mods: Mod[]): TabLayout {
  const multi = mods.length > 1;
  const start: Section = { title: multi ? "Start/Loop" : "Start", side: multi ? "full" : "left", cols: mods.length, labelW: 150, rows: [
    ...(multi ? [{ cells: badges(mods) }] : []),
    mrow("Start Seed", mods, (g) => box(g, "Start Seed", undefined, { fill: true })),
    mrow("Freeze Loop Length", mods, (g) => pick(g, "Freeze Loop")),
    mrow("Retrigger Each Time", mods, (g) => check(g, "Freeze Loop Retrigger", "")),
  ] };
  return { blocks: multi ? [
    { title: "Seeds", side: "full", cols: 8, labelW: 24, rows: [
      { cells: SEEDS.map(([, text]) => cap(text)) },
      ...mods.map((m): LRow => ({ label: m.tag, cells: SEEDS.map(([n]): Slot => pick(m.g, `(Seed) ${n}`)) })),
    ] },
    start,
  ] : [start] };
}

// ---- 7-9 Name/Note Map ----
const nameBlocks = (g: string, pane: string): Section[] => [
  { title: "KARMA Slider Name", side: "left", pane, rows: nums(8).map((k): LRow => ({ cells: [pick(g, `Fader${k} Name ID`, `Slider${k}:`)] })) },
  { title: "KARMA Switch Name", side: "right", pane, rows: nums(8).map((k): LRow => ({ cells: [pick(g, `Switch${k} Name ID`, `SW${k}:`)] })) },
];
const NOTES = WRAP;
// 128 keys as an 11 x 12 grid (octave -1 at the top); the last octave stops at G9.
const noteMap: Section = { title: "Note Map", side: "full", pane: "Note Map", cols: 12, labelW: 50, rows: [
  { cells: NOTES.map((n) => cap(n)) },
  ...Array.from({ length: 11 }, (_, o): LRow => ({ label: `Oct ${o - 1}`, cells: NOTES.slice(0, o === 10 ? 8 : 12).map((n): Slot => box(KC, `(Note Map) ${n}${o - 1}`)) })),
] };
const names = (mods: Mod[]): TabLayout => ({ blocks: [
  ...nameBlocks(KC, "Master"),
  ...(mods.length > 1 ? mods.flatMap((m) => nameBlocks(m.g, `Module ${m.tag}`)) : []),
  noteMap,
] });

export const karmaProgramLayouts: LayoutSpec = { "7-1": programSetup, "7-2": midiFilter(PROGRAM), "7-3": control(PROGRAM), "7-4": trigger(PROGRAM), "7-5": programRtp, "7-6": perfRtp(PROGRAM), "7-7": dynamic(false), "7-8": seeds(PROGRAM), "7-9": names(PROGRAM) };
export const karmaCombiLayouts: LayoutSpec = { "7-1": combiSetup, "7-2": midiFilter(COMBI), "7-3": control(COMBI), "7-4": trigger(COMBI), "7-5": combiRtp, "7-6": perfRtp(COMBI), "7-7": dynamic(true), "7-8": seeds(COMBI), "7-9": names(COMBI) };
