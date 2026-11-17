import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectParamRows, effectSlots, effectTypeName } from "./effects.ts";
import { formatValue, readParam, writeParam, type ParamTables } from "./params.ts";

const T = JSON.parse(readFileSync(new URL("../../generated/params.json", import.meta.url), "utf8")) as ParamTables;

test("16 slots with the Kronos offsets, and real effect names", () => {
  const s = effectSlots(T, "program");
  assert.equal(s.length, 16);
  assert.deepEqual([s[0].typeOfs, s[1].typeOfs, s[12].typeOfs, s[15].typeOfs], [88, 162, 976, 1184]);
  assert.equal(effectTypeName(T, 2), "Stereo Compressor");
  assert.equal(effectTypeName(T, 198), "");
});

test("Stereo Compressor rows are named, slot-shifted and write only their own bits", () => {
  assert.deepEqual(effectParamRows(T, "program", "ifx1", 0), []);
  assert.equal(effectParamRows(T, "program", "nope", 2), null);
  assert.equal(effectParamRows(T, "program", "ifx1", 1.5), null);
  const a = effectParamRows(T, "program", "ifx1", 2)!, b = effectParamRows(T, "program", "ifx2", 2)!;
  const ratio = a.find((r) => r.name === "Ratio")!;
  assert.equal(b.find((r) => r.name === "Ratio")!.ofs - ratio.ofs, 74);
  assert.equal(formatValue(ratio, 0, T), "1.0:1");
  const e = new Uint8Array(4960).fill(0xff), before = e.slice();
  writeParam(e, ratio, 77);
  assert.equal(readParam(e, ratio), 77);
  assert.ok(e.some((x, i) => x !== before[i]));
});
