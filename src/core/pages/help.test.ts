// The Parameter Guide parser on a short made-up excerpt laid out like the real PDF text (two columns, "Label   [range]", description under it), and the matcher on hand-written entries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHelp, norm } from "./help.ts";
import { clean, parseGuide, trimText, type HelpEntry } from "./helpParse.ts";

const SHY = String.fromCharCode(0xad);
const W = 66;
const spread = (left: string[], right: string[]) => Array.from({ length: Math.max(left.length, right.length) }, (_, i) => (left[i] ?? "").padEnd(W) + (right[i] ?? "")).join("\n");

const left = [
  "Program mode: HD-1",
  "",
  `3${SHY}4: Filter1 EG`,
  "",
  "Level",
  "",
  "Each of the five levels can be either positive or negative.",
  "",
  "Start                          [" + SHY + "99...+99]",
  "This sets the initial EG level, at note-on.",
  "",
  "Attack                         [" + SHY + "99...+99]",
  "",
  "This sets the level at the end of the Attack time.",
];
const right = [
  "Time",
  "",
  "Higher values mean longer times, as shown in the table.",
  "",
  "Attack                         [00...99]",
  "",
  "This sets how long the EG takes to move from the Start level",
  "to the Attack level.",
  "",
  "Release                        [00...99]",
  "",
  "This sets how long it takes the EG to move from the Sustain",
  "level to the Release level.",
];
const guide = `${spread(left, right)}\n\n${" ".repeat(100)}82\n\f`;

test("parseGuide reads each labelled description with its section, tab and printed page", () => {
  const { entries } = parseGuide(guide);
  const at = (label: string, section: string) => entries.find((e) => e.label === label && e.section === section);
  assert.equal(entries.length, 4);
  assert.equal(at("Start", "Level")?.text, "This sets the initial EG level, at note-on.");
  assert.equal(at("Attack", "Level")?.text, "This sets the level at the end of the Attack time.");
  assert.equal(at("Attack", "Time")?.text, "This sets how long the EG takes to move from the Start level to the Attack level.");
  assert.deepEqual([at("Release", "Time")?.mode, at("Release", "Time")?.tab, at("Release", "Time")?.tabTitle, at("Release", "Time")?.page], ["program", "3-4", "Filter1 EG", 82]);
});

test("parseGuide drops the page menu list, figure text and the next tab's entries", () => {
  const page2 = ["Program mode: HD-1", "", `v 3${SHY}4: Page Menu Commands`, "", "The number before each command shows its shortcut here.", "", "Decay                          [00...99]", "", "This text belongs to no tab and must not be a description."];
  const { entries } = parseGuide(`${spread(left, right)}\n\n${" ".repeat(100)}82\n\f${page2.join("\n")}\n\n${" ".repeat(60)}83\n`);
  assert.equal(entries.some((e) => e.label === "Decay"), false);
});

test("parseGuide notes the second oscillator's tabs as copies of the first one's", () => {
  const g = ["Program mode: HD-1", "", "3-1: Filter1", "", "Cutoff                         [00...99]", "", "This sets the cutoff frequency of the filter.", "", "3-5: Filter2", "", "The parameters are identical to those for Oscillator 1, as", `described under "3-1: Filter1," on page 73.`, "", "5"].join("\n");
  assert.deepEqual(parseGuide(g).aliases, [{ mode: "program", from: "3-5", to: "3-1" }]);
});

test("parseGuide leaves out a description that only points at another section", () => {
  const g = ["Program mode: HD-1", "", "0-8: Audio Input", "", "Level                          [00...99]", "", "These parameters are the same as in Program mode.", "", "Pan                            [L001...R127]", "", "This sets the stereo position of the input signal.", "", "5"].join("\n");
  assert.deepEqual(parseGuide(g).entries.map((e) => e.label), ["Pan"]);
});

test("trimText cuts at a sentence end within 400 characters and never keeps the soft hyphen glyph", () => {
  const long = `${"This sets the level. ".repeat(30)}`.trim();
  const t = trimText(long);
  assert.ok(t.length <= 400 && t.endsWith("."), t.slice(-20));
  assert.equal(clean(`0${SHY}1 ${String.fromCharCode(0x2018)}x${String.fromCharCode(0x2019)}`), "0-1 'x'");
});

const E = (o: Partial<HelpEntry> & Pick<HelpEntry, "label" | "text">): HelpEntry => ({ mode: "program", tab: "3-4", tabTitle: "Filter1 EG", sub: "Envelope", section: "", page: 82, ...o });
const row = (group: string, name: string) => ({ group, name });
const help = createHelp({
  entries: [
    E({ label: "Attack", section: "Level", text: "level text" }),
    E({ label: "Attack", section: "Time", text: "time text" }),
    E({ label: "Attack", sub: "Time Modulation", text: "time mod text", page: 84 }),
    E({ label: "Cutoff", tab: "3-1", tabTitle: "Filter1", sub: "", text: "cutoff text", page: 74 }),
    E({ label: "Resonance", tab: "3-1", tabTitle: "Filter1", sub: "", text: "reso text on 3-1", page: 75 }),
    E({ label: "Resonance", tab: "6-1", tabTitle: "AMS", sub: "", text: "reso text on 6-1", page: 100 }),
    E({ label: "Hold", tab: "1-1", tabTitle: "Program Basic", sub: "", text: "hold text", page: 44 }),
    E({ label: "Hold", tab: "9-9", tabTitle: "Other", sub: "", text: "hold text", page: 44 }),
    E({ label: "Intensity", tab: "4-1", tabTitle: "Amp", sub: "Panpot Modulation", text: "pan intensity", page: 87 }),
  ],
  aliases: [{ mode: "program", from: "3-5", to: "3-1" }],
});

test("helpFor takes the entry on the row's own tab, by the heading the row's name spells out", () => {
  assert.equal(help("hd1", "3-4", row("OSC1 Filter EG", "Attack Level"), "Attack:")?.text, "level text");
  assert.equal(help("hd1", "3-4", row("OSC1 Filter EG", "Attack Time"), "Attack:")?.text, "time text");
  assert.equal(help("hd1", "3-4", row("OSC1 Filter EG", "Time Mod.1 Intensity To Attack Time"), "Attack:")?.text, "time mod text");
  assert.equal(help("program", "3-1", row("OSC1 Filter A", "Cutoff"), "Frequency:")?.page, 74);
});

test("helpFor follows a tab alias and the 'Filter 1' / 'Filter1' spellings", () => {
  assert.equal(help("hd1", "3-5", row("OSC2 Filter A", "Cutoff"))?.text, "cutoff text");
  assert.equal(norm("Filter 1 Mod."), norm("Filter1 Modulation"));
});

test("helpFor falls back to the name alone without a tab: equal descriptions are fine, different ones give null", () => {
  assert.equal(help("hd1", undefined, row("Common", "Hold"))?.text, "hold text");
  assert.equal(help("hd1", undefined, row("Common", "Resonance")), null);
});

test("helpFor returns null for a missing name, a vague caption without its heading, and with no data at all", () => {
  assert.equal(help("hd1", "3-4", row("OSC1 Filter EG", "Nothing Like It")), null);
  assert.equal(help("hd1", "4-1", row("OSC1 Drive", "Drive Mod.Intensity"), "Intensity:"), null);
  assert.equal(help("hd1", "4-1", row("OSC1 Output", "Panpot Mod.Intensity"), "Intensity:")?.text, "pan intensity");
  assert.equal(createHelp({})("hd1", "3-4", row("G", "Attack Level")), null);
  assert.equal(help("hd1", "3-4", row("OSC1 Filter EG", "Attack Level")) !== null, true);
});

test("helpFor does not take a description from another tab when the row's own tab has none", () => {
  assert.equal(help("hd1", "3-4", row("OSC1 Filter A", "Cutoff")), null);
  assert.equal(help("combi", "3-4", row("OSC1 Filter EG", "Attack Level")), null);
});
