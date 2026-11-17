import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ifxChainLinks, ifxRoute, masterRoute, type Read } from "./fx-kronos-route.ts";
import { parsePcg } from "../pcg/pcg.ts";
import { getEntry } from "../pcg/library.ts";
import { paramsFor, readParam, type ParamTables } from "./params.ts";
import { effectTypeName } from "./effects.ts";

const dir = import.meta.dirname;
const tables = JSON.parse(readFileSync(path.join(dir, "../../generated/params.json"), "utf8")) as ParamTables;
const FACTORY = path.join(dir, "../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG");
const typeName = (id: number) => effectTypeName(tables, id);

// Reads from one real entry the way the layout engine does: find the row by group and name, then read its bits.
function readerOf(kind: "hd1" | "combi", entry: Uint8Array): Read {
  const rows = paramsFor(tables, kind, entry);
  return (g, n) => {
    const r = rows.find((x) => x.group === g && x.name === n);
    return r ? readParam(entry, r) : undefined;
  };
}

// Keys are "group|name", values are raw.
const fakeRead = (values: Record<string, number>): Read => (g, n) => values[`${g}|${n}`];

const factory = parsePcg(new Uint8Array(readFileSync(FACTORY)));
const intB0 = getEntry(factory, "program:INT-B", 0);

test("INT-B 000: IFX1 to IFX3 chain, IFX3 out on L/R, Program source feeds IFX1", () => {
  const g = ifxRoute("hd1", readerOf("hd1", intB0), typeName);
  for (let n = 1; n <= 12; n++) assert.ok(g.nodes.some((x) => x.id === `ifx${n}`), `ifx${n} node`);
  const node = (id: string) => g.nodes.find((x) => x.id === id)!;
  assert.equal(node("ifx1").detail, "Piano Body/Damper");
  assert.equal(node("ifx2").detail, "Reverb Wet Plate");
  assert.equal(node("ifx3").detail, "Stereo Mastering Limiter");
  assert.equal(node("ifx1").state, "on");
  assert.deepEqual(g.edges.find((e) => e.from === "src"), { from: "src", to: "ifx1", kind: "main" });
  assert.ok(g.edges.some((e) => e.kind === "chain" && e.from === "ifx1" && e.to === "ifx2"));
  assert.ok(g.edges.some((e) => e.kind === "chain" && e.from === "ifx2" && e.to === "ifx3"));
  assert.equal(node("out3").label, "L/R");
  assert.ok(g.edges.some((e) => e.from === "ifx3" && e.to === "out3"));
  assert.ok(!g.nodes.some((x) => x.id === "out1"), "chained IFX1 has no out tag");
});

test("combi: Timbre1 Bus Select 10 feeds IFX10, dim when IFX10 is off", () => {
  const on = ifxRoute("combi", fakeRead({ "Timbre1|Bus Select": 10, "Insert Effect10|Switch": 1 }), typeName);
  assert.deepEqual(on.edges.find((e) => e.from === "t1"), { from: "t1", to: "ifx10", kind: "main" });
  const off = ifxRoute("combi", fakeRead({ "Timbre1|Bus Select": 10, "Insert Effect10|Switch": 0 }), typeName);
  assert.equal(off.edges.find((e) => e.from === "t1")?.kind, "dim");
});

test("master: Chain Direction flips the MFX1/MFX2 chain, off when Chain Switch is off", () => {
  const base = { "Master Effect|Chain Switch": 1, "Master Effect1|Switch": 1, "Master Effect2|Switch": 1 };
  const d0 = masterRoute(fakeRead({ ...base, "Master Effect|Chain Direction": 0 }), typeName);
  assert.ok(d0.edges.some((e) => e.kind === "chain" && e.from === "mfx1" && e.to === "mfx2"));
  const d1 = masterRoute(fakeRead({ ...base, "Master Effect|Chain Direction": 1 }), typeName);
  assert.ok(d1.edges.some((e) => e.kind === "chain" && e.from === "mfx2" && e.to === "mfx1"));
  const off = masterRoute(fakeRead({ ...base, "Master Effect|Chain Switch": 0, "Master Effect|Chain Direction": 0 }), typeName);
  assert.ok(!off.edges.some((e) => e.kind === "chain"));
  assert.equal(d0.nodes.find((x) => x.id === "mfx1")?.go, "9-2");
});

test("INT-B 000: chain links are IFX1 to IFX2 and IFX2 to IFX3 only", () => {
  const on = ifxChainLinks(readerOf("hd1", intB0)).filter((l) => l.on);
  assert.deepEqual(on.map((l) => [l.from, l.to]), [[1, 2], [2, 3]]);
});
