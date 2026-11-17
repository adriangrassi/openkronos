import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { KRONOS_BASE_NOTES, KRONOS_DMOD_SOURCES, kronosFxCategories, kronosFxDescs } from "./fx-kronos.ts";
import { changeEffectType, effectRowsAt, effectSlots, effectTypeWrites } from "./effects.ts";
import { writeParam, type ParamTables } from "./params.ts";
import { descText, groupDescs, type ParamDesc } from "../fx/desc.ts";
import { parsePcg } from "../pcg/pcg.ts";
import { getEntry } from "../pcg/library.ts";
import effects from "../../generated/effects.json" with { type: "json" };

const T = JSON.parse(readFileSync(new URL("../../generated/params.json", import.meta.url), "utf8")) as ParamTables;
const FACTORY = path.join(import.meta.dirname, "../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG");
type RawDef = { pid: number; name: string; rawMin: number; rawMax: number; fixed: boolean; valueText: string };
const TYPES = effects.types as { id: number; name: string; params: RawDef[] | null }[];
const ALL = Array.from({ length: 198 }, (_, i) => i);
const norm = (s: string) => s.replace(/\s*\[[^\]]*\]/g, "").trim();
const find = (type: number, name: string): ParamDesc => {
  const d = kronosFxDescs(type).find((x) => x.name === name);
  assert.ok(d, `type ${type} has no ${name}`);
  return d;
};

test("every effect type builds descriptors; type 0 and unknown ids give none", () => {
  for (const id of ALL) assert.ok(Array.isArray(kronosFxDescs(id)));
  assert.deepEqual(kronosFxDescs(0), []);
  assert.deepEqual(kronosFxDescs(198), []);
});

test("descriptor ends read the same as the data's two end names", () => {
  const bad: string[] = [];
  for (const t of TYPES) {
    const descs = kronosFxDescs(t.id);
    for (const p of t.params ?? []) {
      if (p.fixed) continue;
      const d = descs.find((x) => x.key === String(p.pid));
      const [a, b] = norm(p.valueText).split("~");
      if (!d) { bad.push(`${t.id} ${p.name}: no desc`); continue; }
      if (descText(d, p.rawMin) !== a || descText(d, p.rawMax) !== b) bad.push(`${t.id} ${p.name}: ${descText(d, p.rawMin)} / ${descText(d, p.rawMax)} vs ${p.valueText}`);
    }
  }
  assert.deepEqual(bad.slice(0, 20), []);
});

test("every value list has one name per raw value", () => {
  for (const id of ALL) for (const d of kronosFxDescs(id)) {
    if (d.values) assert.equal(d.values.length, d.max - d.min + 1, `${id} ${d.name}`);
  }
});

test("pinned value texts from the data", () => {
  assert.equal(descText(find(11, "Band1 Cutoff"), 50), "520");
  assert.equal(descText(find(11, "Band1 Cutoff"), 98), "1.00k");
  assert.equal(descText(find(11, "Band2 Cutoff"), 995), "10.0k");
  assert.equal(descText(find(11, "Band1 Gain"), 12), "+6.0");
  assert.equal(descText(find(11, "Wet/Dry"), 50), "50:50");
  assert.equal(descText(find(40, "Wet/Dry"), 0), "Dry");
  assert.equal(descText(find(40, "Wet/Dry"), -100), "-Wet");
  assert.equal(descText(find(40, "LFO Type"), 1), "Effect LFO1");
  assert.equal(descText(find(11, "Wet/Dry Mod.Source"), 37), "Tempo");
  assert.equal(descText(find(40, "LFO BPM"), 3999), "MIDI");
  assert.equal(descText(find(40, "LFO BPM"), 12000), "120.00");
  assert.equal(descText(find(141, "(Effect1) Pan"), 64), "C064");
  assert.equal(descText(find(22, "Sampling Frequency"), 480), "48.0k");
});

test("Band table of the parametric EQ: sections, columns and rows", () => {
  const secs = groupDescs(kronosFxDescs(11));
  assert.deepEqual(secs.map((s) => s.title), ["Input", "Parameters", "Output"]);
  const table = secs[1].table!;
  assert.deepEqual(table.cols, ["Type", "Cutoff", "Q", "Gain"]);
  assert.deepEqual(table.rows.map((r) => r.label), ["Band1", "Band2", "Band3", "Band4"]);
});

test("Dmod source list: 38 unique ASCII names, Off first, Tempo last", () => {
  assert.equal(KRONOS_DMOD_SOURCES.length, 38);
  assert.equal(KRONOS_DMOD_SOURCES[0], "Off");
  assert.equal(KRONOS_DMOD_SOURCES[37], "Tempo");
  assert.equal(new Set(KRONOS_DMOD_SOURCES).size, 38);
  assert.ok(KRONOS_DMOD_SOURCES.every((s) => /^[\x20-\x7e]+$/.test(s)));
  const mod = find(11, "Wet/Dry Mod.Source");
  assert.deepEqual(mod.values, [...KRONOS_DMOD_SOURCES]);
});

test("base notes: ten names, 1/32 to 1/1", () => {
  assert.deepEqual([...KRONOS_BASE_NOTES], ["1/32", "1/24", "1/16", "1/12", "1/8", "1/6", "1/4", "1/3", "1/2", "1/1"]);
});

test("categories cover types 0..197 once each, labelled with the three-digit id", () => {
  const cats = kronosFxCategories();
  const ids = cats.flatMap((c) => c.items.map((i) => i.id));
  assert.deepEqual(ids, ALL);
  assert.equal(cats[0].items[0].label, "000: No Effect");
  assert.equal(cats[0].items[10].label, "010: Stereo Noise Reduction");
  assert.equal(cats[0].name, "Dynamics");
});

test("effectTypeWrites applied equals changeEffectType, byte for byte", () => {
  const f = parsePcg(new Uint8Array(readFileSync(FACTORY)));
  const base = getEntry(f, "program:INT-B", 0).slice();
  const ofs = effectSlots(T, "program")[0].typeOfs;
  for (const id of [0, 2, 11, 40, 141, 197]) {
    const a = base.slice();
    const b = base.slice();
    changeEffectType(a, ofs, id);
    for (const w of effectTypeWrites(b, ofs, id)) writeParam(b, w.row, w.value);
    assert.deepEqual(b, a, `type ${id}`);
  }
  const blank = base.slice();
  blank.fill(0xff, ofs - 64, ofs);
  const writes = effectTypeWrites(blank, ofs, 2);
  assert.ok(writes.length > 1, "out-of-range leftovers are reset");
});

test("effectRowsAt returns the identical array for the same key", () => {
  const ofs = effectSlots(T, "program")[0].typeOfs;
  assert.equal(effectRowsAt(ofs, 11, "Insert Effect1"), effectRowsAt(ofs, 11, "Insert Effect1"));
  assert.notEqual(effectRowsAt(ofs, 11, "Insert Effect1"), effectRowsAt(ofs, 12, "Insert Effect1"));
});
