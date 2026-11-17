// The layout specs against the real Program HD-1 table (src/generated/params.json, built from KORG's text): no cell may name a row that is not there.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { findEnvelopes } from "../params/graphs.ts";
import { findFilters, findKeyTracks } from "../params/shapes.ts";
import type { Row } from "../params/params.ts";
import { kronosPages } from "./kronos.ts";
import { cellsOf, graphsOf, type GraphSlot, inPane, padNum, panesOf, placeBlocks, refIndex, resolve, shows, unplacedOf, type LRow, type Section, type TabLayout } from "./layout.ts";
import { combiLayouts } from "./layouts/combi.ts";
import { programHd1Layouts } from "./layouts/program-hd1.ts";
import { build, indexRows, keyOf, type Page } from "./view.ts";

const file = new URL("../../generated/params.json", import.meta.url);
const have = existsSync(file);
const tables = have ? JSON.parse(readFileSync(file, "utf8")) : {};
const rows: Row[] = tables.programHd1 ?? [];
const combiRows: Row[] = tables.combi ?? [];
const opts = { skip: have ? false : "src/generated/params.json is missing (run the prebuild)" };

const row = (ofs: number, group: string, name: string): Row => ({
  ofs, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax: 99, fixed: false, valueText: "~", signed: false,
  continuation: false, parts: [[ofs, 6, 0]], typ: null, soc: null, sub: null, pid: null, idx: null,
});
const sec = (side: Section["side"], rowSpan?: number): Section => ({ side, rowSpan, rows: [] });

test("placeBlocks packs left, right and full blocks into a two column grid", () => {
  const p = placeBlocks([sec("left", 2), sec("right"), sec("right"), sec("full"), sec("left"), sec("right")]);
  assert.deepEqual(p.map((x) => [x.col, x.colSpan, x.row, x.rowSpan]), [[1, 1, 1, 2], [2, 1, 1, 1], [2, 1, 2, 1], [1, 2, 3, 1], [1, 1, 4, 1], [2, 1, 4, 1]]);
});

test("a full block starts below the taller column", () => {
  const p = placeBlocks([sec("left", 3), sec("right"), sec("full")]);
  assert.equal(p[2].row, 4);
});

test("refIndex and resolve: one match resolves, a repeat needs an index, a miss is undefined", () => {
  const idx = refIndex([row(1, "G", "a"), row(2, "G", "b"), row(3, "G", "b"), { ...row(4, "G", ""), continuation: true }]);
  assert.equal(resolve(idx, { group: "G", name: "a" })?.ofs, 1);
  assert.equal(resolve(idx, { group: "G", name: "b" }), undefined);
  assert.equal(resolve(idx, { group: "G", name: "b", index: 1 })?.ofs, 3);
  assert.equal(resolve(idx, { group: "G", name: "nope" }), undefined);
});

test("padNum writes numbers the way the screens do: padded to the range, signed where the range is, names left alone", () => {
  assert.equal(padNum("0", { rawMin: -99, rawMax: 99 }), "+00");
  assert.equal(padNum("-6", { rawMin: -99, rawMax: 99 }), "-06");
  assert.equal(padNum("7", { rawMin: 0, rawMax: 99 }), "07");
  assert.equal(padNum("-8", { rawMin: -100, rawMax: 100 }), "-08");
  assert.equal(padNum("110", { rawMin: 0, rawMax: 127 }), "110");
  assert.equal(padNum("3", { rawMin: 0, rawMax: 10 }), "3");
  assert.equal(padNum("F2", { rawMin: 0, rawMax: 127 }), "F2");
});

test("unplacedOf lists the tab rows that the spec does not place, in table order", () => {
  const rs = [row(1, "G", "a"), row(2, "G", "b"), row(3, "G", "c")];
  const spec = { blocks: [{ side: "full" as const, rows: [{ cells: [{ group: "G", name: "b", kind: "box" as const }] }] }] };
  assert.deepEqual(unplacedOf(spec, rs, refIndex(rs)).map((r) => r.name), ["a", "c"]);
});

test("captions and placeholder tiles are not parameters: only cells are counted and graphs found", () => {
  const spec = { blocks: [{ side: "full" as const, rows: [{ cells: [{ caption: "Rev." }, { graph: "placeholder" as const, group: "", label: "x" }, { group: "G", name: "a", kind: "box" as const }] }] }] };
  assert.equal(cellsOf(spec).length, 1);
  assert.equal(graphsOf(spec).length, 1);
});

// Every spec cell must resolve to exactly one row of its mapped tab, placed once; returns the unplaced count per tab.
function checkSpecs(kind: "hd1" | "combi", data: Row[], specs: Record<string, TabLayout>): string {
  const idx = refIndex(data);
  const keys = new Map(kronosPages(kind, data).pages.flatMap((p) => p.tabs.map((x) => [x.id, new Set(x.keys)] as const)));
  const counts: string[] = [];
  for (const [id, spec] of Object.entries(specs)) {
    const tab = keys.get(id);
    assert.ok(tab, `tab ${id} is not in pages.json`);
    const seen = new Set<string>();
    // A row with `when` is drawn only for some values of another row, so the same parameter may sit in rows with different conditions, never twice in one.
    const scopes = new Map<string, string[]>();
    for (const b of spec.blocks) for (const r of b.rows) {
      const scope = r.when ? `${r.when.group}/${r.when.name}=${r.when.is.join(",")}` : "";
      if (r.when) assert.ok(resolve(idx, r.when), `${id}: when ${r.when.group}/${r.when.name} does not resolve`);
      for (const c of cellsOf({ blocks: [{ side: "full", rows: [r] }] })) {
        const hit = resolve(idx, c);
        assert.ok(hit, `${id}: ${c.group}/${c.name} does not resolve to exactly one row`);
        const k = keyOf(hit);
        assert.ok(tab.has(k), `${id}: ${c.group}/${c.name} is not a row of this tab`);
        scopes.set(k, [...(scopes.get(k) ?? []), scope]);
        if (c.options) assert.equal(c.options.length, hit.rawMax - hit.rawMin + 1, `${id}: ${c.name} needs one option name per value`);
        seen.add(k);
      }
    }
    for (const [k, list] of scopes) assert.ok(new Set(list).size === list.length && (list.length === 1 || !list.includes("")), `${id}: ${k} is placed twice`);
    const un = unplacedOf(spec, [...tab].map((k) => data.find((r) => keyOf(r) === k)!), idx);
    assert.equal(un.length + seen.size, tab.size, `${id}: placed + unplaced must cover the tab`);
    counts.push(`${id}:${un.length}`);
  }
  return counts.join(" ");
}

test("every spec cell resolves to exactly one Program HD-1 row, inside its mapped tab, placed once", opts, (t) => {
  const counts = checkSpecs("hd1", rows, programHd1Layouts);
  t.diagnostic(`unplaced per tab: ${counts}`);
  console.log(`unplaced per tab: ${counts}`);
  // Pinned on purpose: a new row in a mapped tab or a dropped cell must show up here.
  assert.equal(counts, "1-1:3 1-3:4 1-5:0 1-6:0 1-8:4 2-1:0 2-2:0 2-5:0 2-6:0 2-9:0 3-1:0 3-2:0 3-3:0 3-4:0 3-5:0 3-6:0 3-7:0 3-8:0 4-1:4 4-2:0 4-3:0 4-5:4 4-6:0 4-7:0 4-9:49 5-1:0 5-2:0 5-5:0 5-6:0 5-9:0 6-1:0 6-5:0 6-9:0 7-1:0 7-2:0 7-3:0 7-4:0 7-5:0 7-6:0 7-7:0 7-8:0 7-9:0 8-1:0 8-5:0 8-9:0 9-1:0");
});

test("every Combination spec cell resolves to exactly one row of its tab; timbre columns name Timbre1..16 once each", opts, (t) => {
  const counts = checkSpecs("combi", combiRows, combiLayouts);
  t.diagnostic(`combi unplaced per tab: ${counts}`);
  console.log(`combi unplaced per tab: ${counts}`);
  // 7-5: the per-module (Scene n - Modified State) rows are runtime state the screen does not show; they stay in More.
  // 8-9: the Combination Effect LFO1/2 MIDI Channel rows (1..Global) are editable there (fixed in a Program); the figure-less spec does not place them.
  // 1-3: Input MIDI Channel (0..255, no screen text in the guide); the rows the real screens do not show were taken off the tabs in pages.json.
  assert.equal(counts, "0-8:0 1-1:0 1-3:193 1-5:0 1-6:0 1-7:0 1-8:1300 1-9:0 2-1:16 2-2:0 2-3:0 2-4:0 2-5:0 2-6:0 3-1:0 3-2:0 3-3:0 3-5:0 3-6:0 7-1:0 7-2:0 7-3:0 7-4:0 7-5:768 7-6:0 7-7:0 7-8:0 7-9:0 8-1:0 8-2:0 8-5:0 8-9:2 9-1:0");
  for (const [id, spec] of Object.entries(combiLayouts)) {
    for (const b of spec.blocks.filter((x) => x.timbres)) for (const r of b.rows.filter((x) => x.cells.length > 0)) {
      const groups = [...new Set(cellsOf({ blocks: [{ side: "full", rows: [r] }] }).map((c) => c.group))];
      assert.deepEqual(groups, Array.from({ length: 16 }, (_, i) => `Timbre${i + 1}`), `${id}: a timbre row must run Timbre1..Timbre16`);
    }
  }
});

test("KARMA P7 has a spec for all nine tabs in both modes; the GE parameter grid is generated for every module", () => {
  const ids = Array.from({ length: 9 }, (_, i) => `7-${i + 1}`);
  for (const specs of [programHd1Layouts, combiLayouts]) for (const id of ids) assert.ok(specs[id], `no spec for ${id}`);
  // Program: one module, 32 GE rows; Combination: Master and Module scope for A-D.
  const count = (t: TabLayout, name: string) => cellsOf(t).filter((c) => c.name === name).length;
  assert.equal(count(programHd1Layouts["7-5"], "(GE - All) Min Value"), 32);
  assert.equal(count(combiLayouts["7-5"], "(GE - All) Min Value") + count(combiLayouts["7-5"], "(GE - Module) Min Value"), 256);
});

test("panes: a tab lists its pane names once, in order; a section shows in its own pane and a pane-less section in every pane", () => {
  const s = (pane?: string): Section => ({ side: "full", pane, rows: [] });
  const t: TabLayout = { blocks: [s("Master A"), s(), s("Scenes"), s("Master A")] };
  assert.deepEqual(panesOf(t), ["Master A", "Scenes"]);
  assert.deepEqual(inPane(t, "Scenes").map((b) => b.pane), [undefined, "Scenes"]);
  assert.equal(inPane(t, "Master A").length, 3);
  assert.deepEqual(panesOf({ blocks: [s()] }), []);
});

test("shows draws a row with no condition always, and a conditional row only while the value is listed", () => {
  const row = (when?: LRow["when"]): LRow => ({ cells: [], when });
  const at = (v: number) => (_: { group: string; name: string }) => v;
  assert.equal(shows(row(), at(5)), true);
  assert.equal(shows(row({ group: "G", name: "Type", is: [0, 1] }), at(1)), true);
  assert.equal(shows(row({ group: "G", name: "Type", is: [0, 1] }), at(2)), false);
});

// route and fxtype tiles are not parameter cells: route names ifx or master, fxtype an effect group with an Effect Type row.
const fxGraphOk = (data: Row[], g: GraphSlot): boolean => (g.graph === "chain" ? g.group === "ifx" : g.graph === "route" ? g.group === "ifx" || g.group === "master" : data.some((r) => r.group === g.group && r.name === "Effect Type"));

test("the effect pages: Program 8-1/8-5/8-9/9-1 and Combination 8-1/8-2/8-5/8-9/9-1 have specs; 8-7 and 9-2..9-5 stay with the effect page", () => {
  for (const id of ["8-1", "8-5", "8-9", "9-1"]) assert.ok(programHd1Layouts[id], `program ${id}`);
  for (const id of ["8-1", "8-2", "8-5", "8-9", "9-1"]) assert.ok(combiLayouts[id], `combi ${id}`);
  for (const id of ["8-7", "9-2", "9-3", "9-4", "9-5"]) assert.ok(!programHd1Layouts[id] && !combiLayouts[id], id);
  assert.equal(graphsOf(programHd1Layouts["8-1"]).map((g) => `${g.graph}:${g.group}`).join(), "route:ifx");
  assert.equal(graphsOf(programHd1Layouts["8-5"]).filter((g) => g.graph === "fxtype").length, 12);
  assert.equal(graphsOf(programHd1Layouts["9-1"]).map((g) => `${g.graph}:${g.group}`).join(), "route:master");
});

test("a tab's except list keeps rows out of a groups entry; params still name them", () => {
  const rs = [row(1, "G", "a"), row(2, "G", "b"), row(3, "H", "c")];
  const idx = indexRows(rs);
  const pg = (t: Page["tabs"][number]): Page[] => [{ page: "P", title: "P", tabs: [t]}];
  const one = build(pg({ id: "1-1", title: "x", groups: ["G", "H"], except: ["G/b"] }), idx, new Set(), "", {});
  assert.deepEqual(one[0].tabs[0].rows.map((r) => r.name), ["a", "c"]);
  const two = build(pg({ id: "1-1", title: "x", groups: ["G"], except: ["G/b"], params: ["G/b"] }), idx, new Set(), "", {});
  assert.deepEqual(two[0].tabs[0].rows.map((r) => r.name), ["a", "b"]);
});

test("every graph slot finds its shape with the same finders the Kronos view uses", opts, () => {
  const envs = findEnvelopes(rows).map((e) => e.group), filters = findFilters(rows).map((f) => f.group), kts = findKeyTracks(rows).map((k) => k.group);
  const groups = new Set(rows.map((r) => r.group));
  let n = 0;
  for (const [id, spec] of Object.entries(programHd1Layouts)) {
    for (const g of graphsOf(spec)) {
      if (g.graph === "placeholder") continue;
      if (g.graph === "route" || g.graph === "fxtype" || g.graph === "chain") { assert.ok(fxGraphOk(rows, g), `${id}: bad ${g.graph} ${g.group}`); continue; }
      n++;
      const list = g.graph === "env" ? envs : g.graph === "filter" ? filters : g.graph === "keytrack" ? kts : [...groups];
      assert.ok(list.includes(g.group), `${id}: no ${g.graph} graph for ${g.group}`);
    }
  }
  assert.ok(n >= 10);
  // Combination: the vector graph reads the Vector Control group of the Combination table; zone maps name their window kind.
  const cGroups = new Set(combiRows.map((r) => r.group));
  for (const [id, spec] of Object.entries(combiLayouts)) {
    for (const g of graphsOf(spec)) assert.ok(g.graph === "placeholder" || ((g.graph === "route" || g.graph === "fxtype" || g.graph === "chain") && fxGraphOk(combiRows, g)) || (g.graph === "zones" ? g.group === "key" || g.group === "vel" : g.graph === "vector" && cGroups.has(g.group)), `${id}: unexpected graph ${g.graph} ${g.group}`);
  }
});

test("the selected tab keeps its accent fill under hover and press (the global button:hover rule must not win)", () => {
  const css = readFileSync(new URL("../../app/renderer/KronosView.css", import.meta.url), "utf8");
  const rule = css.split("\n").find((l) => l.includes('.kv-subtabs button[data-active="true"]') && l.includes("var(--k-tab-active-bg)")) ?? "";
  assert.ok(rule.includes('[data-active="true"]:hover:not(:disabled)') && rule.includes('[data-active="true"]:active:not(:disabled)'));
});
