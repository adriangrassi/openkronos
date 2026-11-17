// Constructors shared by the Program HD-1 and Combination layout files (program-hd1*.ts, combi*.ts): one line per cell, so the data reads like the screen.
import type { Caption, Cell, GraphSlot, LRow, Section, Slot } from "../layout.ts";

const cell = (kind: Cell["kind"], group: string, name: string, label?: string, more: Partial<Cell> = {}): Cell => ({ group, name, kind, label, ...more });
export const box = (g: string, n: string, label?: string, more?: Partial<Cell>) => cell("box", g, n, label, more);
export const pick = (g: string, n: string, label?: string, more?: Partial<Cell>) => cell("pick", g, n, label, more);
export const dial = (g: string, n: string, label?: string, more?: Partial<Cell>) => cell("dial", g, n, label, more);
export const check = (g: string, n: string, label?: string, more?: Partial<Cell>) => cell("check", g, n, label, more);
export const fader = (g: string, n: string, label?: string, more?: Partial<Cell>) => cell("fader", g, n, label, more);
export const toggle = (g: string, n: string, label?: string, more?: Partial<Cell>) => cell("toggle", g, n, label, more);
export const graph = (graph: GraphSlot["graph"], group: string, w?: number): GraphSlot => ({ graph, group, w });
// A labelled empty tile where the real screen has a picture we have no component for.
export const tile = (label: string, w?: number): GraphSlot => ({ graph: "placeholder", group: "", w, label });
export const cap = (caption: string, w?: number): Caption => ({ caption, w });
export const head = (label: string): LRow => ({ label, cells: [] });
export const side = (x: "A" | "B"): "left" | "right" => (x === "A" ? "left" : "right");
// The AMS pop-up over its Intensity box: how every modulation pair is drawn.
export const ams = (g: string, src: string, amt: string, caption = "AMS:", w?: number): Slot => [pick(g, src, caption, { w }), box(g, amt, "Intensity:")];

// The envelope screens' stage names and the 0(Lin)..10(Exp) curve names.
export const STAGES = ["Attack", "Decay", "Slope", "Release"];
export const CURVES = Array.from({ length: 11 }, (_, i) => (i === 0 ? "0(Lin)" : i === 10 ? "10(Exp)" : String(i)));
// A Combination screen's timbre columns: one slot per timbre, make() gets the group Timbre1..Timbre16. band is the row's centred caption.
export const perTimbre = (make: (group: string) => Slot): Slot[] => Array.from({ length: 16 }, (_, i) => make(`Timbre${i + 1}`));
export const trow = (band: string, make: (group: string) => Slot): LRow => ({ band, cells: perTimbre(make) });
// A full-width section of timbre rows (no title bar: the numbered strip is its top).
export const timbreTable = (rows: LRow[]): Section => ({ side: "full", cols: 16, timbres: true, rows });
// Timbre and pad MIDI channel: 01..16 then Gch, which is how the screens write the Global channel.
export const CHANNELS = [...Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(2, "0")), "Gch"];
