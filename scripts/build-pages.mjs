// Builds src/core/pages/pages.json: which KORG screen (page and tab) each Kronos setting is on.
// Labels only. Page and tab titles follow the manual's contents pages; the placement rules are ours.
import { readFileSync, writeFileSync } from "node:fs";

const T = JSON.parse(readFileSync("src/generated/params.json", "utf8"));
const editable = (r) => !r.continuation && !r.fixed && r.name !== "Name" && !/UUID/.test(r.name) && r.name !== "Effect Type" && r.name !== "Algorithm Type";

// Tab lists: [page code, page title, [[tab id, tab title], ...]]
const PLAY = [["0-1", "Main"], ["0-2", "Performance Meters"], ["0-6", "KARMA GE"], ["0-7", "Controller View/Effect"], ["0-8", "Audio Input/Sampling"], ["0-9", "Control Surface"]];
const KARMA = [["7-1", "GE Setup/Key Zones"], ["7-2", "MIDI Filter/CC Offset"], ["7-3", "Module Parameters-Control"], ["7-4", "Module Parameters-Trigger"], ["7-5", "GE Real-Time Parameters/Scenes"], ["7-6", "Perf Real-Time Parameters"], ["7-7", "Dynamic MIDI"], ["7-8", "Random Seeds"], ["7-9", "Name/Note Map"]];
const IFX = [["8-1", "Routing"], ["8-5", "Insert FX"], ["8-6", "Track View"], ["8-7", "IFX 1-12"], ["8-9", "Common FX LFO"]];
const MASTER = [["9-1", "Routing"], ["9-2", "MFX1"], ["9-3", "MFX2"], ["9-4", "TFX1"], ["9-5", "TFX2"]];
const PAGES = {
  hd1: [
    ["P0", "Play", PLAY],
    ["P1", "Basic/Vector", [["1-1", "Program Basic"], ["1-3", "Drum Track"], ["1-5", "Vector Control"], ["1-6", "Vector Envelope"], ["1-8", "Set Up Controllers"], ["1-9", "Pads"]]],
    ["P2", "OSC/Pitch", [["2-1", "OSC1 Basic"], ["2-2", "OSC1 Pitch"], ["2-5", "OSC2 Basic"], ["2-6", "OSC2 Pitch"], ["2-9", "Pitch EG"]]],
    ["P3", "Filter", [["3-1", "Filter1"], ["3-2", "Filter1 Modulation"], ["3-3", "Filter1 LFO Modulation"], ["3-4", "Filter1 EG"], ["3-5", "Filter2"], ["3-6", "Filter2 Modulation"], ["3-7", "Filter2 LFO Modulation"], ["3-8", "Filter2 EG"]]],
    ["P4", "Amp/EQ", [["4-1", "Amp1/Driver1"], ["4-2", "Amp1 Modulation"], ["4-3", "Amp1 EG"], ["4-5", "Amp2/Driver2"], ["4-6", "Amp2 Mod."], ["4-7", "Amp2 EG"], ["4-9", "EQ"]]],
    ["P5", "LFO", [["5-1", "OSC1 LFO1"], ["5-2", "OSC1 LFO2"], ["5-5", "OSC2 LFO1"], ["5-6", "OSC2 LFO2"], ["5-9", "Common LFO"]]],
    ["P6", "AMS Mixer/Common Key Track", [["6-1", "OSC 1 AMS Mixer"], ["6-5", "OSC 2 AMS Mixer"], ["6-9", "Common Keyboard Track"]]],
    ["P7", "KARMA", KARMA],
    ["P8", "Insert Effect", IFX],
    ["P9", "Master/Total Effect", MASTER],
  ],
  exi: [
    ["P0", "Play", PLAY],
    ["P4", "Basic/Vector", [["4-1", "Program Basic"], ["4-2", "EXi Audio Input"], ["4-3", "Drum Track"], ["4-5", "Vector Control"], ["4-6", "Vector Envelope"], ["4-8", "Set Up Controllers"], ["4-9", "Pads"]]],
    ["P5", "Modulation", [["5-1", "Common Step Seq"], ["5-2", "Common LFO"], ["5-3", "Common Keyboard Track"]]],
    ["P6", "EQ", [["6-1", "EQ"]]],
    ["P7", "KARMA", KARMA],
    ["P8", "Insert Effect", IFX],
    ["P9", "Master/Total Effect", MASTER],
  ],
  combi: [
    ["P0", "Play", [["0-1", "Program Select/Mixer"], ["0-2", "Performance Meters"], ["0-6", "KARMA GE"], ["0-7", "Controller View/Effect"], ["0-8", "Audio Input/Sampling"], ["0-9", "Control Surface"]]],
    ["P1", "EQ/Vector/Controller", [["1-1", "Timbre EQ"], ["1-3", "Drum Track"], ["1-5", "Vector Volume Control"], ["1-6", "Vector CC Control"], ["1-7", "Vector Envelope"], ["1-8", "Set Up Controllers"], ["1-9", "Pads"]]],
    ["P2", "Timbre Parameters", [["2-1", "MIDI"], ["2-2", "OSC"], ["2-3", "Pitch"], ["2-4", "Delay"], ["2-5", "Wave Sequence/KARMA"], ["2-6", "EXi Audio Input"]]],
    ["P3", "MIDI Filter/Zones", [["3-1", "MIDI Filter1"], ["3-2", "MIDI Filter2"], ["3-3", "MIDI Filter3"], ["3-5", "Keyboard Zones"], ["3-6", "Velocity Zones"]]],
    ["P7", "KARMA", KARMA],
    ["P8", "Insert Effect", [["8-1", "Routing1"], ["8-2", "Routing2"], ["8-5", "Insert FX"], ["8-6", "Track View"], ["8-7", "IFX 1-12"], ["8-9", "Common FX LFO"]]],
    ["P9", "Master/Total Effect", MASTER],
  ],
};

// Engine pages. Tab titles are the manual's; page titles of the later engine pages are our best reading.
const ENGINE_PAGES = {
  "AL-1": [["P0", "Play", PLAY], ["P4", "OSC/Pitch", [["4-1", "OSC Basic"], ["4-2", "Sub/Noise/Ring Mod"], ["4-3", "Mixer"], ["4-4", "Pitch Common"], ["4-5", "Pitch EG/Mod"]]], ["P5", "Filter", [["5-1", "Filter Basic"], ["5-2", "Multi Filter"], ["5-3", "Filter Modulation"], ["5-4", "Filter LFO Mod"]]], ["P6", "Amp", [["6-1", "Amp/Driver"], ["6-2", "Amp Modulation"], ["6-3", "Amp EG"]]], ["P7", "EG 1-4", [["7-1", "EG 1 (Filter)"], ["7-2", "EG 2 (Pitch)"], ["7-3", "EG 3"], ["7-4", "EG 4"]]], ["P8", "Step Seq/LFO", [["8-1", "Step Sequencer"], ["8-2", "LFO 1"], ["8-3", "LFO 2"], ["8-4", "LFO 3"], ["8-5", "LFO 4"]]], ["P9", "AMS Mixer", [["9-1", "AMS Mixer"]]]],
  "CX-3": [["P0", "Play", PLAY], ["P4", "Basic", [["4-1", "Basic"], ["4-2", "Controllers"]]], ["P5", "Split & Drawbars", [["5-1", "Keyboard Split"], ["5-2", "Drawbars"], ["5-3", "EX Drawbars"]]], ["P6", "Percussion", [["6-1", "Percussion"], ["6-2", "EX Percussion"]]], ["P7", "Amp, V/C, Rotary Speaker", [["7-1", "Amp & V/C"], ["7-2", "Rotary Speaker"]]], ["P9", "AMS Mixer", [["9-1", "AMS Mixer"]]]],
  "STR-1": [["P0", "Play", PLAY], ["P4", "String", [["4-1", "Pluck and Noise"], ["4-2", "PCM Oscillator"], ["4-3", "PCM Oscillator Pitch"], ["4-4", "Excitation Mixer"], ["4-5", "String Main"], ["4-6", "Damping and Dispersion"], ["4-7", "String Pitch"], ["4-8", "Pickups and Feedback"], ["4-9", "Mixer"]]], ["P5", "Filter", [["5-1", "Filter Basic"], ["5-2", "Multi Filter"], ["5-3", "Filter Modulation"], ["5-4", "Filter LFO Mod"]]], ["P6", "Amp", [["6-1", "Amp"], ["6-2", "Amp Modulation"], ["6-3", "Amp EG"]]], ["P7", "EG 1-4", [["7-1", "EG 1 (Filter)"], ["7-2", "EG 2 (Pitch)"], ["7-3", "EG 3"], ["7-4", "EG 4"]]], ["P8", "LFO 1-4", [["8-1", "LFO 1"], ["8-2", "LFO 2"], ["8-3", "LFO 3"], ["8-4", "LFO 4"]]], ["P9", "AMS Mixers and String Track", [["9-1", "AMS Mixers 1-2"], ["9-2", "AMS Mixers 3-4"], ["9-9", "String Track"]]]],
  "MS-20EX": [["P0", "Play", PLAY], ["P4", "Oscillators & Filters", [["4-1", "Oscillators & Filters"]]], ["P5", "MG, EG, & Modulation", [["5-1", "MG, EG, & Modulation"]]], ["P6", "Patch Panel", [["6-1", "Patch Panel"]]], ["P7", "EG 3-6", [["7-1", "EG 3"], ["7-2", "EG 4"], ["7-3", "EG 5"], ["7-4", "EG 6"]]], ["P8", "LFO 1-4", [["8-1", "LFO 1"], ["8-2", "LFO 2"], ["8-3", "LFO 3"], ["8-4", "LFO 4"]]], ["P9", "AMS Mixers", [["9-1", "AMS Mixers 1-2"], ["9-2", "AMS Mixers 3-4"]]]],
  "PolysixEX": [["P0", "Play", PLAY], ["P4", "Main", [["4-1", "Main"]]], ["P5", "Modulation & Arpeggiator", [["5-1", "Modulation & Arpeggiator"]]], ["P7", "EG 2-3", [["7-1", "EG 2"], ["7-2", "EG 3"]]], ["P8", "LFO 1-2", [["8-1", "LFO 1"], ["8-2", "LFO 2"]]], ["P9", "AMS Mixers", [["9-1", "AMS Mixers 1-2"], ["9-2", "AMS Mixers 3-4"]]]],
  "MOD-7": [["P0", "Play", PLAY], ["P4", "Patch Panel", [["4-1", "Patch Panel"]]], ["P5", "Oscillators", [["5-1", "Osc Main"], ["5-2", "PCM Osc"], ["5-3", "PCM Mod"], ["5-4", "VPM Osc1"], ["5-5", "VPM Osc 2"], ["5-6", "VPM Osc 3"], ["5-7", "VPM Osc 4"], ["5-8", "VPM Osc 5"], ["5-9", "VPM Osc 6"]]], ["P6", "Filter", [["6-1", "Filter Basic"], ["6-2", "Multi Filter"], ["6-3", "Filter Modulation"], ["6-4", "Filter LFO Mod"]]], ["P7", "Amp", [["7-1", "Mixers 1-3"], ["7-2", "Output Mixer"], ["7-3", "Amp"], ["7-4", "Amp Modulation"], ["7-5", "Amp EG"]]], ["P8", "EG 1-9", [["8-1", "EG 1"], ["8-2", "EG 2"], ["8-3", "EG 3"], ["8-4", "EG 4"], ["8-5", "EG 5"], ["8-6", "EG 6"], ["8-7", "EG 7"], ["8-8", "EG 8"], ["8-9", "EG 9"]]], ["P9", "Step Sequencer, LFO 1-4, and AMS Mixers", [["9-1", "Step Sequencer"], ["9-2", "LFO 1"], ["9-3", "LFO 2"], ["9-4", "LFO 3"], ["9-5", "LFO 4"], ["9-6", "AMS Mixers 1-2"], ["9-7", "AMS Mixers 3-4"], ["9-8", "AMS Mixers 5-6"], ["9-9", "AMS Mixers 7-8"]]]],
  "SGX-2": [["P0", "Play", PLAY], ["P4", "Main", [["4-1", "Main"]]], ["P5", "String Resonance/Una Corda", [["5-1", "String Resonance/Una Corda"]]]],
  "EP-1": [["P0", "Play", PLAY], ["P4", "Basic/Oscillator", [["4-1", "Basic"], ["4-2", "Oscillator"]]], ["P5", "Panel/IFX/Amp & Cabinet", [["5-1", "Common"]]]],
};

// Engine group -> tab key, per engine.
const ENGINE_MAP = {
  "AL-1": { OSC: "P4/4-1", "Sub OSC": "P4/4-2", "Ring Modulator": "P4/4-2", "Noise Generator": "P4/4-2", "Common Pitch": "P4/4-4", "OSC1 Pitch": "P4/4-4", "OSC2 Pitch": "P4/4-4", OSC1: "P4/4-1", OSC2: "P4/4-1", "Filter": "P5/5-1", "Filter A": "P5/5-1", "Filter B": "P5/5-2", "Filter Keyboard Track": "P5/5-3", Drive: "P6/6-1", Amplifier: "P6/6-1", "Amplifier Keyboard Track": "P6/6-2", "Amplifier EG": "P6/6-3", "EG1 (Filter)": "P7/7-1", "EG2 (Pitch)": "P7/7-2", EG3: "P7/7-3", EG4: "P7/7-4", "Step Sequence": "P8/8-1", LFO1: "P8/8-2", LFO2: "P8/8-3", LFO3: "P8/8-4", LFO4: "P8/8-5" },
  "CX-3": { Basic: "P4/4-1", Drawbar: "P5/5-2", Percussion: "P6/6-1", "Vibrato/Chorus": "P7/7-1", Amplifier: "P7/7-1", "Rotary Speaker": "P7/7-2" },
  "STR-1": { OSC: "P4/4-1", "Mod.Mixer3": "P9/9-2", "Mod.Mixer4": "P9/9-2", Feedback: "P4/4-8", LFO1: "P8/8-1", LFO2: "P8/8-2", LFO3: "P8/8-3", LFO4: "P8/8-4", "Amplifier EG": "P6/6-3", "EG1 (Filter)": "P7/7-1", "EG2 (Pitch)": "P7/7-2", EG3: "P7/7-3", EG4: "P7/7-4", "String Track": "P9/9-9", "String Track1": "P9/9-9", "String Track2": "P9/9-9", "String Pitch": "P4/4-7", "PCM Pitch": "P4/4-3", "Noise Generator": "P4/4-1", "Excitation Mixer": "P4/4-4", Pluck: "P4/4-1", String: "P4/4-5", Mixer: "P4/4-9", Harmonic: "P4/4-5", "Excitation Filter": "P4/4-4", "Damping String Track": "P4/4-6", "Dispersion String Track": "P4/4-6", PCM: "P4/4-2", Filter: "P5/5-1", "Filter A": "P5/5-1", "Filter B": "P5/5-2", "Filter Keyboard Track": "P5/5-3", Amplifier: "P6/6-1", "Amplifier Keyboard Track": "P6/6-2" },
  "MS-20EX": { OSC: "P4/4-1", "Mod.Mixer3": "P9/9-2", "Mod.Mixer4": "P9/9-2", MG: "P5/5-1", LFO1: "P8/8-1", LFO2: "P8/8-2", LFO3: "P8/8-3", LFO4: "P8/8-4", EG3: "P7/7-1", EG4: "P7/7-2", EG5: "P7/7-3", EG6: "P7/7-4", VCO1: "P4/4-1", VCO2: "P4/4-1", Pitch: "P4/4-1", "VCO Mixer": "P4/4-1", HPF: "P4/4-1", LPF: "P4/4-1", ESP: "P4/4-1", Controller: "P4/4-1", Mixer: "P4/4-1", VCA: "P4/4-1", "Input Jack": "P6/6-1", "External Modulation1": "P6/6-1", "External Modulation2": "P6/6-1", Patch: "P6/6-1", EG2: "P5/5-1", EG1: "P5/5-1" },
  "PolysixEX": { OSC: "P4/4-1", VCO: "P4/4-1", Effect: "P4/4-1", VCA: "P4/4-1", Pitch: "P4/4-1", Filter: "P4/4-1", EG: "P4/4-1", Arpeggiator: "P5/5-1", MG: "P5/5-1", "External Modulation1": "P5/5-1", "External Modulation2": "P5/5-1", EG2: "P7/7-1", EG3: "P7/7-2", LFO1: "P8/8-1", LFO2: "P8/8-2", "Mod.Mixer3": "P9/9-1", "Mod.Mixer4": "P9/9-2" },
  "MOD-7": { "Mod.Mixer3": "P9/9-7", "Mod.Mixer4": "P9/9-7", "Mod.Mixer5": "P9/9-8", "Mod.Mixer6": "P9/9-8", "Mod.Mixer7": "P9/9-9", "Mod.Mixer8": "P9/9-9", LFO1: "P9/9-2", LFO2: "P9/9-3", LFO3: "P9/9-4", LFO4: "P9/9-5", "Step Sequence": "P9/9-1", EG1: "P8/8-1", EG2: "P8/8-2", EG3: "P8/8-3", EG4: "P8/8-4", EG5: "P8/8-5", EG6: "P8/8-6", EG7: "P8/8-7", EG8: "P8/8-8", EG9: "P8/8-9", "Amplifier EG": "P7/7-5", "Common Pitch": "P5/5-1", "PCM Pitch": "P5/5-2", "Noise Generator": "P5/5-2", "PCM OSC": "P5/5-2", "PCM OSC Keyboard Track": "P5/5-3", OSC1: "P5/5-4", "OSC1 Keyboard Track": "P5/5-4", OSC2: "P5/5-5", "OSC2 Keyboard Track": "P5/5-5", OSC3: "P5/5-6", "OSC3 Keyboard Track": "P5/5-6", OSC4: "P5/5-7", "OSC4 Keyboard Track": "P5/5-7", OSC5: "P5/5-8", "OSC5 Keyboard Track": "P5/5-8", OSC6: "P5/5-9", "OSC6 Keyboard Track": "P5/5-9", Mixer1: "P7/7-1", Mixer2: "P7/7-1", Mixer3: "P7/7-1", Filter: "P6/6-1", "Filter A": "P6/6-1", "Filter B": "P6/6-2", "Filter Keyboard Track": "P6/6-1", "Output Mixer": "P7/7-2", Amplifier: "P7/7-3", "Amplifier Keyboard Track": "P7/7-4", OSC: "P4/4-1", "Input Jack": "P4/4-1", Pitch: "P4/4-1", Mixer: "P4/4-1", Macro: "P4/4-1", "Audio In": "P4/4-1" },
  "SGX-2": { "User Param": "P4/4-1" },
  "EP-1": { Self: "P4/4-1", Osc: "P4/4-2", "EP Amp": "P5/5-1", "IFX Small Phaser": "P5/5-1", "IFX Orange Black Phaser": "P5/5-1", "IFX Vintage Chorus": "P5/5-1", "IFX Black Chorus": "P5/5-1", "IFX EP Chorus": "P5/5-1", "IFX Vintage Flanger": "P5/5-1", "IFX Red Comp": "P5/5-1", "IFX Vox Wah": "P5/5-1" },
};

// KARMA screens, placed by setting name (shared by hd1, exi, combi).
function karma(group, n) {
  if (/Name ID|Note Map/.test(n)) return "P7/7-9";
  if (/Dynamic MIDI/.test(n)) return "P7/7-7";
  if (/Scene/.test(n)) return "P7/7-5";
  if (/RT Param|Fader|Switch\d|Knob|Assign/.test(n)) return "P7/7-6";
  if (/Seed/.test(n)) return "P7/7-8";
  if (/MIDI|Offset|CC/.test(n)) return "P7/7-2";
  if (/Trigger|Trig/.test(n)) return "P7/7-4";
  if (group === "KARMA Common") return "P7/7-1";
  if (/Key Zone|Velocity|GE Number|Transpose|Zone/.test(n)) return "P7/7-1";
  return "P7/7-3";
}

// Insert effects, master and total effects, and common FX LFOs (shared by hd1, exi, combi).
function fx(group, n) {
  if (/^Insert Effect\d+$/.test(group)) return /Switch|Chain|Panpot|Bus|Send|Level/.test(n) ? "P8/8-1" : "P8/8-7";
  if (group === "Master Effect1") return "P9/9-2";
  if (group === "Master Effect2") return "P9/9-3";
  if (group === "Master Effect") return "P9/9-1";
  if (group === "Total Effect1") return "P9/9-4";
  if (group === "Total Effect2") return "P9/9-5";
  if (group === "Total Effect") return "P9/9-1";
  if (/^Effect LFO\d$/.test(group)) return "P8/8-9";
  if (/^Audio Input|^S\/PDIF/.test(group)) return "P0/0-8";
  return undefined;
}

function hd1(group, n) {
  const f = fx(group, n); if (f) return f;
  if (group === "KARMA Common" || group === "KARMA Module") return karma(group, n);
  if (group === "Common") return "P1/1-1";
  if (group === "Vector Control") return /Envelope|EG/.test(n) ? "P1/1-6" : "P1/1-5";
  if (group === "Controller" || group === "Assignable Controller") return "P1/1-8";
  if (group === "Drum Track Common" || group === "Drum Track") return "P1/1-3";
  if (group === "Track EQ" || group === "Tone Adjust") return "P4/4-9";
  if (group === "OSC1 Trigger") return "P2/2-1";
  if (group === "OSC2 Trigger") return "P2/2-5";
  if (group === "Pitch EG") return "P2/2-9";
  if (group === "Common LFO") return "P5/5-9";
  if (group === "Common Keyboard Track1" || group === "Common Keyboard Track2") return "P6/6-9";
  const m = /^OSC([12]) (.*)$/.exec(group);
  if (!m) return undefined;
  const map = {
    1: { "LFO1": "P5/5-1", "LFO2": "P5/5-2", "Pitch": "P2/2-2", "Filter": "P3/3-1", "Filter A": "P3/3-1", "Filter B": "P3/3-5", "Filter Keyboard Track": "P3/3-2", "Filter EG": "P3/3-4", "Drive": "P4/4-1", "Amplifier": "P4/4-1", "Amplifier Keyboard Track": "P4/4-2", "Amplifier EG": "P4/4-3", "Output": "P4/4-1", "Mod.Mixer1": "P6/6-1", "Mod.Mixer2": "P6/6-1" },
    2: { "LFO1": "P5/5-5", "LFO2": "P5/5-6", "Pitch": "P2/2-6", "Filter": "P3/3-1", "Filter A": "P3/3-1", "Filter B": "P3/3-5", "Filter Keyboard Track": "P3/3-6", "Filter EG": "P3/3-8", "Drive": "P4/4-5", "Amplifier": "P4/4-5", "Amplifier Keyboard Track": "P4/4-6", "Amplifier EG": "P4/4-7", "Output": "P4/4-5", "Mod.Mixer1": "P6/6-5", "Mod.Mixer2": "P6/6-5" },
  };
  return map[m[1]][m[2]];
}

function exi(group, n) {
  const f = fx(group, n); if (f) return f;
  if (group === "KARMA Common" || group === "KARMA Module") return karma(group, n);
  if (group === "Common") return "P4/4-1";
  if (group === "Vector Control") return /Envelope|EG/.test(n) ? "P4/4-6" : "P4/4-5";
  if (group === "Controller" || group === "Assignable Controller") return "P4/4-8";
  if (group === "Drum Track Common" || group === "Drum Track") return "P4/4-3";
  if (group === "Track EQ" || group === "Tone Adjust") return "P6/6-1";
  if (group === "EXi1 Common" || group === "EXi2 Common") return "P0/0-1";
  if (group === "EXi1 Output" || group === "EXi2 Output" || /Mod\.Mixer/.test(group)) return "P4/4-1";
  if (group === "EXi1 Input" || group === "EXi2 Input") return "P4/4-2";
  if (group === "Common Step Sequence") return "P5/5-1";
  if (group === "Common LFO") return "P5/5-2";
  if (group === "Common Keyboard Track1" || group === "Common Keyboard Track2") return "P5/5-3";
  return undefined;
}

// Combi timbre settings: the 174 per-timbre settings are split across the combi screens by name.
function timbre(n) {
  if (/^\(Note Map\)/.test(n)) return "P7/7-9";
  if (/^\(Filter\)/.test(n)) return "P3/3-1";
  if (/^\(Track EQ\)/.test(n)) return "P1/1-1";
  if (/^\(?Scene/.test(n)) return "P7/7-5";
  if (/^\(RT Param/.test(n)) return "P7/7-6";
  if (/^\(Dynamic MIDI/.test(n)) return "P7/7-7";
  if (/^\(Chord Pad/.test(n)) return "P1/1-9";
  if (/^(Knob|Switch|Fader|Master Fader|VJS)/.test(n)) return "P1/1-8";
  if (/Vector|Volume Center/.test(n)) return /CC/.test(n) ? "P1/1-6" : "P1/1-5";
  if (/^EXi\d/.test(n)) return "P2/2-6";
  if (/Drum Kit Patch|Use Drum Kit/.test(n)) return "P1/1-3";
  if (/^(Program Number|Bank|Status|Volume|Pan|Send|Mute|Bus Select|Fx Bus|Rec Bus)/.test(n)) return "P0/0-1";
  if (/Waveform SysEx|Chord|Max # of Notes|Wave/.test(n)) return "P2/2-5";
  if (/Key Window|Vel\.Window/.test(n)) return /Vel/.test(n) ? "P3/3-6" : "P3/3-5";
  if (/Delay/.test(n)) return "P2/2-4";
  if (/Transpose|Detune|Bend Range|Portamento Time|Pitch/.test(n)) return "P2/2-3";
  if (/Osc|Timbre Priority/.test(n)) return "P2/2-2";
  if (/Track EQ|Trim|Auto Load Program EQ|Use Program Scale/.test(n)) return "P1/1-1";
  return "P2/2-1";
}

function combi(group, n) {
  if (/^Timbre\d+$/.test(group)) return timbre(n);
  const f = fx(group, n); if (f) return f;
  if (group === "KARMA Common" || /^KARMA Module/.test(group)) return karma(group, n);
  if (group === "Common") return "P0/0-1";
  if (group === "Vector Control") return /CC/.test(n) ? "P1/1-6" : /Envelope|EG/.test(n) ? "P1/1-7" : "P1/1-5";
  if (group === "Controller" || group === "Assignable Controller") return "P1/1-8";
  if (group === "Drum Track Common") return "P1/1-3";
  if (group === "Effect LFO1" || group === "Effect LFO2") return "P8/8-9";
  return undefined;
}

// Groups the rows by tab key, emitting whole groups where a group sits on one tab and single params otherwise.
// Rows with no rule go to the fallback key, which the gate counts as More.
function buildTable(rows, pageDefs, placeFn, fallbackKey) {
  const groupSize = new Map();
  for (const r of rows) groupSize.set(r.group, (groupSize.get(r.group) ?? 0) + 1);
  const keyed = new Map();
  const unplaced = [];
  for (const r of rows) {
    let k = placeFn(r);
    if (k === undefined) { unplaced.push(`${r.group}/${r.name}`); k = fallbackKey; }
    if (!keyed.has(k)) keyed.set(k, []);
    keyed.get(k).push(r);
  }
  const pages = pageDefs.map(([code, title, tabs]) => {
    const outTabs = [];
    const defs = [...tabs];
    if (keyed.has(`${code}/more`)) defs.push(["more", "More"]);
    for (const [id, tabTitle] of defs) {
      const list = keyed.get(`${code}/${id}`);
      if (!list) continue;
      const byGroup = new Map();
      for (const r of list) { if (!byGroup.has(r.group)) byGroup.set(r.group, []); byGroup.get(r.group).push(r); }
      const groups = [], params = [];
      for (const [g, gl] of byGroup) {
        if (gl.length === groupSize.get(g)) groups.push(g);
        else for (const r of gl) params.push(`${g}/${r.name}`);
      }
      const tab = { id: id === "more" ? `${code}-more` : id, title: tabTitle };
      if (groups.length) tab.groups = groups;
      if (params.length) tab.params = [...new Set(params)];
      outTabs.push(tab);
    }
    return { page: code, title, tabs: outTabs };
  });
  return { pages, unplaced };
}

const out = { program: { hd1: null, exiCommon: null, engines: {} }, combi: null };
const report = [];
{
  const rows = T.programHd1.filter(editable);
  const { pages, unplaced } = buildTable(rows, PAGES.hd1, (r) => hd1(r.group, r.name), "P1/more");
  out.program.hd1 = pages; report.push(["hd1", rows.length, unplaced]);
}
{
  const rows = T.programExiCommon.filter(editable);
  const { pages, unplaced } = buildTable(rows, PAGES.exi, (r) => exi(r.group, r.name), "P4/more");
  out.program.exiCommon = pages; report.push(["exiCommon", rows.length, unplaced]);
}
{
  const rows = T.combi.filter(editable);
  const { pages, unplaced } = buildTable(rows, PAGES.combi, (r) => combi(r.group, r.name), "P0/more");
  out.combi = pages; report.push(["combi", rows.length, unplaced]);
}
for (const e of Object.keys(T.engines)) {
  const defs = ENGINE_PAGES[e];
  const rows = T.engines[e].filter(editable);
  const first = defs.find(([c]) => c !== "P0")[0];
  const { pages, unplaced } = buildTable(rows, defs, (r) => ENGINE_MAP[e][r.group], `${first}/more`);
  out.program.engines[e] = pages; report.push([e, rows.length, unplaced]);
}
writeFileSync("src/core/pages/pages.json", JSON.stringify(out, null, 1) + "\n");
for (const [name, n, unplaced] of report) console.log(`${name}: ${n} editable, ${unplaced.length} unplaced`, unplaced.slice(0, 12).join(" | "));
