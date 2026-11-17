// Effect screens: P8 Insert Effect (8-1 Routing, 8-5 Insert FX, 8-9 Common FX LFO; Combination also 8-2 Routing2) and P9 Master/Total Effect (9-1 Routing).
// 8-7 and 9-2..9-5 are the per-effect pages (not a LayoutSpec: the effect parameters are not table rows). The route and fxtype graph slots are drawn by the effect components.
import type { LRow, LayoutSpec, Section, TabLayout } from "../layout.ts";
import { box, cap, check, dial, graph, pick, timbreTable, toggle, trow } from "./kit.ts";

// Bus names, one per raw value, lowest first. Single source: the routing diagram imports them too.
export const IFX_OUT_BUS = ["L/R", "1", "2", "3", "4", "5", "6", "7", "8", "1/2", "3/4", "5/6", "7/8", "Off"];
export const SOURCE_BUS = ["L/R", ...Array.from({ length: 12 }, (_, i) => `IFX${i + 1}`), "1", "2", "3", "4", "5", "6", "7", "8", "1/2", "3/4", "5/6", "7/8", "Off"];
export const REC_BUS = ["Off", "1", "2", "3", "4", "1/2", "3/4"];
export const FX_CTRL_BUS = ["Off", "FX Control1", "FX Control2"];

// Panpot 0..127 as the screens print it.
const PAN = Array.from({ length: 128 }, (_, v) => (v < 64 ? `L${String(v).padStart(3, "0")}` : v === 64 ? "C064" : `R${String(v).padStart(3, "0")}`));

const route = (group: "ifx" | "master"): Section => ({ side: "full", rows: [{ cells: [graph("route", group)] }] });

// 8-5: one row per insert effect, columns as the real screen's header.
const IFX_COLS = ["IFX", "Type", "Chain", "Chain to", "Pan(CC#8)", "Bus Sel.", "REC Bus", "Ctrl Bus", "Send1", "Send2"];
function insertFx(): TabLayout {
  const rows: LRow[] = [{ cells: IFX_COLS.map((c) => (c === "Type" ? cap(c, 3) : c === "Chain" ? graph("chain", "ifx") : cap(c))) }];
  for (let n = 1; n <= 12; n++) {
    const G = `Insert Effect${n}`;
    rows.push({ label: `IFX${n}`, cells: [
      toggle(G, "Switch", "On"), graph("fxtype", G, 3),
      // Fixed rows are not on the tab: IFX12 has no Chain Switch or Chain To, IFX11 can only chain to IFX12 (Chain To fixed).
      n < 12 ? check(G, "Chain Switch", "") : [], n < 11 ? pick(G, "Chain To", undefined, { options: Array.from({ length: 12 - n }, (_, i) => `IFX${n + 1 + i}`) }) : [],
      dial(G, "Panpot", undefined, { options: PAN }), pick(G, "Bus Select", undefined, { options: IFX_OUT_BUS }), pick(G, "Rec Bus", undefined, { options: REC_BUS }),
      pick(G, "Fx Control Bus", undefined, { options: FX_CTRL_BUS }), dial(G, "Send1"), dial(G, "Send2"),
    ] });
  }
  return { blocks: [{ side: "full", rows }] };
}

const lfo = (n: 1 | 2): Section => {
  const G = `Effect LFO${n}`;
  return { title: `Common FX LFO${n}`, side: n === 1 ? "left" : "right", cols: 1, rows: [
    { cells: [box(G, "Frequency", "Frequency [Hz]:")] },
    { cells: [check(G, "Sync", "Sync (Reset)")] },
    { cells: [pick(G, "Source", "Source:")] },
    { cells: [check(G, "MIDI Sync", "MIDI/Tempo Sync")] },
    { cells: [box(G, "BPM", "BPM:")] },
    { cells: [pick(G, "MIDI Sync Base Note", "Base Note:")] },
    { cells: [box(G, "MIDI Sync Base Times", "Times:")] },
  ] };
};
const lfoTab: TabLayout = { blocks: [lfo(1), lfo(2)] };

const masterTab: TabLayout = { blocks: [
  route("master"),
  { title: "Return", side: "left", cols: 2, rows: [{ cells: [dial("Master Effect", "Return 1", "Return1"), dial("Master Effect", "Return 2", "Return2")] }] },
  { title: "Chain", side: "right", cols: 1, rows: [
    { cells: [pick("Master Effect", "Chain Direction", "Direction:")] },
    { cells: [check("Master Effect", "Chain Switch", "Chain")] },
    { cells: [box("Master Effect", "Chain Level", "Level:")] },
  ] },
  { title: "Master Volume", side: "right", cols: 1, rows: [{ cells: [dial("Total Effect", "Master Volume")] }] },
] };

export const fxProgramLayouts: LayoutSpec = {
  "8-1": { blocks: [
    route("ifx"),
    { title: "Bus Select (IFX/Indiv.Out Assign)", side: "left", cols: 1, rows: [
      { cells: [pick("Common", "Bus Select", "All OSCs to:", { options: SOURCE_BUS })] },
      { cells: [check("Common", "Use Drum.Inst Bus Select/Send", "Use DKit Setting")] },
    ] },
    { title: "FX Control Bus", side: "right", cols: 1, rows: [{ cells: [pick("Common", "Fx Control Bus", "All OSCs to:", { options: FX_CTRL_BUS })] }] },
    { title: "REC Bus", side: "right", cols: 1, rows: [{ cells: [pick("Common", "Rec Bus", "All OSCs to:", { options: REC_BUS })] }] },
  ] },
  "8-5": insertFx(),
  "8-9": lfoTab,
  "9-1": masterTab,
};

const routing = (rows: LRow[]): TabLayout => ({ blocks: [route("ifx"), timbreTable(rows)] });
export const fxCombiLayouts: LayoutSpec = {
  "8-1": routing([
    trow("DKit", (g) => check(g, "Use Drum Kit Bus Setting", "DKit")),
    trow("Bus Select (IFX/Indiv.Out Assign)", (g) => pick(g, "Bus Select", undefined, { options: SOURCE_BUS })),
    trow("Send1 (MFX1)", (g) => box(g, "Send1")),
    trow("Send2 (MFX2)", (g) => box(g, "Send2")),
  ]),
  "8-2": routing([
    trow("FX Control Bus", (g) => pick(g, "Fx Bus Select", undefined, { options: FX_CTRL_BUS })),
    trow("REC Bus", (g) => pick(g, "Rec Bus", undefined, { options: REC_BUS })),
  ]),
  "8-5": insertFx(),
  "8-9": lfoTab,
  "9-1": masterTab,
};
