import { test } from "node:test";
import assert from "node:assert/strict";
import type { ParamTables, Row } from "../params/params.ts";
import { buildCatalog, categoryLabel, encodeLibrary, filterSounds, parseLibrary, sortSounds, soundKey, type Sound } from "./catalog.ts";
import { parsePcg } from "./pcg.ts";
import { bank, container, entry, file, leaf } from "./synthetic.ts";

// A Category row that reads one byte's low 5 bits at the given offset.
const row = (ofs: number): Row => ({ ofs, bitHi: 4, bitLo: 0, group: "Common", name: "Category", rawMin: 0, rawMax: 17, fixed: false, valueText: "", signed: false, continuation: false, parts: [[ofs, 4, 0]], typ: null, soc: null, sub: null, pid: null, idx: null });
// Byte 30 is past the name, so entry(name, size, fill) puts the category there.
const tables = { programHd1: [row(30)], programExiCommon: [row(30)], combi: [row(30)], global: [] } as unknown as ParamTables;

const S = (order: number, name: string, extra: Partial<Sound> = {}): Sound => ({ order, key: "program:INT-A", index: order, bank: "INT-A", kind: "program", engine: "HD-1", name, category: 0, ...extra });

test("buildCatalog lists programs and combis in bank then slot order, with the category read from the table", () => {
  const f = parsePcg(
    file(
      container(
        "PCG1",
        leaf("DIV1", new Uint8Array(4)),
        container("PRG1", bank("PBK1", 40, 0, [entry("Hd A", 40, 3), entry("Hd B", 40, 0)]), bank("MBK1", 40, 0x8000, [entry("Exi A", 40, 5)])),
        container("CMB1", bank("CBK1", 40, 0, [entry("Combi A", 40, 1)])),
      ),
    ),
  );
  const got = buildCatalog(f, tables).map((s) => [s.order, s.key, s.index, s.bank, s.kind, s.engine, s.name, s.category]);
  assert.deepEqual(got, [
    [0, "program:INT-A", 0, "INT-A", "program", "HD-1", "Hd A", 3],
    [1, "program:INT-A", 1, "INT-A", "program", "HD-1", "Hd B", 0],
    [2, "program:INT-F", 0, "INT-F", "program", "EXi", "Exi A", 5],
    [3, "combi:INT-A", 0, "INT-A", "combi", null, "Combi A", 1],
  ]);
});

test("filters combine and search covers name, tags and note", () => {
  const list = [S(0, "Grand"), S(1, "Bell", { kind: "combi", engine: null }), S(2, "Pad", { engine: "EXi", category: 4 })];
  const lib = { version: 1 as const, sounds: { [soundKey(list[0])]: { favorite: true as const, tags: ["warm"] }, [soundKey(list[1])]: { note: "Church" } } };
  const ids = (r: Sound[]) => r.map((s) => s.order);
  assert.deepEqual(ids(filterSounds(list, { favoritesOnly: true }, lib)), [0]);
  assert.deepEqual(ids(filterSounds(list, { tag: "warm" }, lib)), [0]);
  assert.deepEqual(ids(filterSounds(list, { text: "CHURCH" }, lib)), [1]);
  assert.deepEqual(ids(filterSounds(list, { kind: "combi", text: "bell" }, lib)), [1]);
  assert.deepEqual(ids(filterSounds(list, { engine: "EXi", category: 4 }, lib)), [2]);
});

test("sortSounds sorts names case-insensitively and restores slot order by bank", () => {
  const list = [S(0, "banjo"), S(1, "Apple"), S(2, "apple"), S(3, "Cello")];
  assert.deepEqual(sortSounds(list, "name").map((s) => s.order), [1, 2, 0, 3]);
  assert.deepEqual(sortSounds(sortSounds(list, "name"), "bank").map((s) => s.order), [0, 1, 2, 3]);
  assert.deepEqual(list.map((s) => s.order), [0, 1, 2, 3]);
});

test("parseLibrary keeps valid data and reports bad JSON or bad shape as corrupt", () => {
  assert.deepEqual(parseLibrary(null), { data: { version: 1, sounds: {} }, corrupt: false });
  assert.equal(parseLibrary("{not json").corrupt, true);
  assert.equal(parseLibrary('{"version":1,"sounds":{"A|HD-1":{"favorite":"yes"}}}').corrupt, true);
  assert.equal(parseLibrary('{"version":1,"sounds":{"A|HD-1":{"tags":["x"],"note":"n"}}}').corrupt, false);
});

test("encodeLibrary drops entries with nothing in them and refuses bad data", () => {
  const text = encodeLibrary({ version: 1, sounds: { "A|HD-1": { favorite: true }, "B|Combi": { tags: [] }, "C|EXi": { note: "" } } });
  assert.deepEqual(JSON.parse(text), { version: 1, sounds: { "A|HD-1": { favorite: true } } });
  assert.throws(() => encodeLibrary({ version: 1, sounds: { "A|Nope": {} } }));
  assert.throws(() => encodeLibrary(null));
});

test("categoryLabel shows the name, or the number when the name is blank", () => {
  assert.equal(categoryLabel(["", "Organ"], 1), "Organ");
  assert.equal(categoryLabel(["", "x"], 0), "0");
  assert.equal(categoryLabel([], 7), "7");
});
