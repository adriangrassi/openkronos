// Usage: node tools/combi-karma-readback.mjs <file.PCG> [combi:INT-E] [index]
// Reads the PCG (never writes it), applies configure_combi to one Combi in memory only, and prints the readback. Not a test; no gate runs it.
import { readFileSync } from "node:fs";
import { getEntry } from "../src/core/pcg/library.ts";
import { parsePcg } from "../src/core/pcg/pcg.ts";
import { formatValue, readParam } from "../src/core/params/params.ts";
import { runTool, SoundSession } from "../src/core/ai/session.ts";

const [path, key = "combi:INT-E", idx = "2"] = process.argv.slice(2);
if (!path) throw new Error("give a PCG path");
const index = Number(idx);
const T = JSON.parse(readFileSync(new URL("../src/generated/params.json", import.meta.url), "utf8"));
const f = parsePcg(new Uint8Array(readFileSync(path)));
const s = new SoundSession(T, f);

const show = (label) => {
  const e = getEntry(f, key, index);
  console.log(`-- ${label}`);
  for (const [g, n] of [["KARMA Common", "Tempo"], ["Drum Track Common", "Drum Track On"], ["Drum Track Common", "Pattern Number"], ["Drum Track Common", "Output MIDI Channel"], ["KARMA Module A", "GE Number"], ["KARMA Module A", "Output MIDI Channel"], ["KARMA Module A", "Key Zone Bottom"], ["KARMA Module A", "Key Zone Top"], ["KARMA Module A", "Transpose"]]) {
    const r = T.combi.find((x) => x.group === g && x.name === n);
    const v = readParam(e, r);
    console.log(`${g} / ${n}: ${v} (${formatValue(r, v, T)})`);
  }
};

const ge = runTool(s, "search_ge", { query: "bass funk", limit: 3 });
console.log("search_ge 'bass funk':", JSON.stringify(ge.results));
show("before");
const r = runTool(s, "configure_combi", { key, index, tempo: 123, drumTrack: { on: true, pattern: 5, channel: 9 }, karma: { modules: [{ module: "A", ge: ge.results[0].number, channel: 1, keyBottom: 0, keyTop: 59, transpose: 0 }] } });
console.log(JSON.stringify(r, null, 1));
show("after (in memory only)");
console.log("undo restores:", s.undoAll(), "slot(s)");
