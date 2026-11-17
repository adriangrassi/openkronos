import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParamTables, Row } from "../params/params.ts";
import { buildOverview, soundsInCategory } from "./overview.ts";
import { parsePcg } from "./pcg.ts";
import { bank, container, entry, file, leaf } from "./synthetic.ts";

const row = (ofs: number): Row => ({ ofs, bitHi: 4, bitLo: 0, group: "Common", name: "Category", rawMin: 0, rawMax: 17, fixed: false, valueText: "", signed: false, continuation: false, parts: [[ofs, 4, 0]], typ: null, soc: null, sub: null, pid: null, idx: null });
const tables = { programHd1: [row(30)], programExiCommon: [row(30)], combi: [row(30)], global: [] } as unknown as ParamTables;

test("overview counts engines, categories, empty and edited slots", () => {
  const f = parsePcg(file(container("PCG1", leaf("DIV1", new Uint8Array(4)),
    container("PRG1", bank("PBK1", 40, 0, [entry("Hd A", 40, 3), entry("Init Program", 40, 3)]), bank("MBK1", 40, 0x8000, [entry("Exi A", 40, 5)])),
    container("CMB1", bank("CBK1", 40, 0, [entry("Combi A", 40, 1)])))));
  const o = buildOverview(f, tables, [{ key: "program:INT-A", index: 0 }, { key: "program:INT-A", index: 0 }, { key: "global", index: -1 }]);
  assert.deepEqual(o.engines, { hd1: 2, exi: 1 });
  assert.equal(o.categories.program[3], 2); assert.equal(o.categories.program[5], 1); assert.equal(o.categories.combi[1], 1);
  assert.equal(o.empty, 1); assert.equal(o.edited, 1);
  assert.equal(soundsInCategory(f, tables, "program", 3).length, 2);
  assert.deepEqual(soundsInCategory(f, tables, "program", 18), []);
});
