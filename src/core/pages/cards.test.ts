import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { cardsFor, type ListRow } from "./cards.ts";
import { keyOf } from "./view.ts";
import { exiEngines, isEditable, paramsFor, type ParamTables, type Row } from "../params/params.ts";
import { getEntry, listBanks } from "../pcg/library.ts";
import { parsePcg } from "../pcg/pcg.ts";

let ofs = 0;
const row = (group: string, name: string, rawMax = 99): ListRow => ({ group, r: { ofs: ofs++, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax, fixed: false, valueText: "", signed: false, continuation: false, parts: [[ofs, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null } as Row });
const keys = (s: ReturnType<typeof cardsFor>) => [...s.cards.flatMap((c) => c.cells.map((x) => keyOf(x.row))), ...s.other.flatMap((g) => g.rows.map(keyOf))];

test("a named parameter lands on its card, the rest goes to other, nothing twice", () => {
  const rows = [row("OSC1 Filter A", "Cutoff"), row("OSC1 Filter A", "Trim"), row("OSC1 Pitch", "Tune"), row("Insert Effect1", "Send1")];
  const s = cardsFor(rows, "hd1");
  assert.deepEqual(s.cards.map((c) => c.id), ["osc1", "filter1"]);
  assert.equal(s.cards.find((c) => c.id === "filter1")!.cells[0].name, "Cutoff");
  assert.deepEqual(s.other.map((g) => [g.group, g.rows.map((r) => r.name)]), [["OSC1 Filter A", ["Trim"]], ["Insert Effect1", ["Send1"]]]);
  assert.equal(keys(s).length, rows.length);
  assert.equal(new Set(keys(s)).size, rows.length);
  assert.equal(s.placed, 2);
});

test("a card whose rows are missing is left out, and a Program without a Pitch EG gets an LFO card", () => {
  const s = cardsFor([row("Common LFO", "Frequency")], "exi");
  assert.deepEqual(s.cards.map((c) => [c.id, c.title]), [["pitch", "LFO"]]);
});

test("an EXi gets an engine card from the first numeric rows of its engine group", () => {
  const g = "EXi1 SGX-2: User Param";
  const s = cardsFor([row(g, "Piano Type", 255), row(g, "Mode", 5), row(g, "Patch Level", 127), row(g, "Resonance On", 1), row(g, "Octave", 3)], "exi");
  const e = s.cards.find((c) => c.id === "engine1")!;
  assert.equal(e.title, "EXi1 SGX-2");
  assert.deepEqual(e.cells.map((x) => x.name), ["Patch Level", "Octave"]);
});

test("sound-shaping cards come first in the panel's order, engine pages after them", () => {
  const g1 = "EXi1 SGX-2: User Param";
  const e = cardsFor([row(g1, "Patch Level", 127), row("EXi1 Output", "Patch Level", 127), row("Track EQ", "Low Gain"), row("Common LFO", "Frequency"), row("KARMA Common", "Tempo")], "exi");
  assert.deepEqual(e.cards.map((c) => c.id), ["pitch", "eq", "karma", "exi1", "engine1"]);
  const h = cardsFor([row("Track EQ", "Low Gain"), row("OSC2 Pitch", "Tune"), row("OSC1 Pitch", "Tune"), row("Insert Effect1", "Switch", 1), row("Common", "Hold", 1)], "hd1");
  assert.deepEqual(h.cards.map((c) => c.id), ["osc1", "osc2", "eq", "insert", "voice"]);
});

const tablesPath = new URL("../../generated/params.json", import.meta.url), pcgPath = new URL("../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG", import.meta.url);
test("every parameter of every factory Program is in exactly one card or in other", { skip: !existsSync(tablesPath) || !existsSync(pcgPath) }, () => {
  const T = JSON.parse(readFileSync(tablesPath, "utf8")) as ParamTables;
  const file = parsePcg(new Uint8Array(readFileSync(pcgPath)));
  let sounds = 0;
  for (const b of listBanks(file).filter((x) => x.kind === "program")) {
    const type = b.type === "exi" ? "exi" : "hd1";
    for (const i of [0, 1, 63, 127]) {
      const e = getEntry(file, b.key, i), all = paramsFor(T, type, e);
      const list: ListRow[] = [];
      let g = "General";
      for (const r of all) { if (r.group.trim() !== "") g = r.group; if (isEditable(r) || r.name === "Effect Type" || r.name === "Algorithm Type") list.push({ r, group: g }); }
      const s = cardsFor(list, type);
      const k = keys(s);
      assert.equal(k.length, list.length, `${b.key} ${i}`);
      assert.equal(new Set(k).size, list.length, `${b.key} ${i}: a parameter is on two cards`);
      assert.ok(s.cards.length >= 3 && s.placed >= 15, `${b.key} ${i}: only ${s.placed} parameters on cards`);
      if (type === "hd1") assert.ok(s.cards.find((c) => c.id === "filter1")!.cells.some((x) => x.name === "Cutoff"), "Cutoff is on the Filter1 card");
      else assert.ok(exiEngines(T, e).length > 0);
      sounds++;
    }
  }
  assert.ok(sounds > 40);
});
