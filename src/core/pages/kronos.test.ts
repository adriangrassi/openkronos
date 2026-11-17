// Synthetic rows against the real page map (no KORG data).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Row } from "../params/params.ts";
import { kronosPages, locateRow } from "./kronos.ts";

const row = (ofs: number, group: string, name: string): Row => ({
  ofs, bitHi: null, bitLo: null, group, name, rawMin: 0, rawMax: 127, fixed: false, valueText: "~", signed: false,
  continuation: false, parts: [[ofs, 6, 0]], typ: null, soc: null, sub: null, pid: null, idx: null,
});
const rows = [row(1, "OSC1 Filter A", "Cutoff"), row(2, "OSC1 Filter EG", "y"), row(3, "Nowhere", "z")];

test("HD-1 rows give P3 Filter with numbered tabs, empty tabs hidden", () => {
  const { pages } = kronosPages("hd1", rows);
  const p3 = pages.find((p) => p.page === "P3");
  assert.equal(p3?.title, "Filter");
  assert.ok(p3!.tabs.length > 0 && p3!.tabs.length < 6);
  assert.ok(p3!.tabs.every((t) => /^3-\d$/.test(t.id) && t.keys.length > 0));
});

test("each mapped row is in exactly one tab; unmapped rows are listed", () => {
  const { pages, unmapped } = kronosPages("hd1", rows);
  const all = pages.flatMap((p) => p.tabs.flatMap((t) => t.keys));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(unmapped, ["3.0"]);
  assert.equal(all.length + unmapped.length, rows.length);
});

test("locateRow finds the page and tab, or null", () => {
  const { pages } = kronosPages("hd1", rows);
  const hit = locateRow(pages, "2.0");
  assert.ok(hit && hit.page === "0-P3" && hit.tab === "3-4");
  assert.equal(locateRow(pages, "3.0"), null);
});

import { defaultSpot, withPlay } from "./kronos.ts";

test("defaultSpot skips the audio-input block: HD-1 opens on the Main dashboard, EXi on Basic/Vector, Combi on the mixer", () => {
  const hd1 = withPlay(kronosPages("hd1", rows).pages, "hd1");
  assert.deepEqual(defaultSpot(hd1, "hd1"), { page: "0-P0", tab: "0-1" });
  const exi = kronosPages("exi", rows, []).pages;
  const spot = defaultSpot(exi, "exi");
  assert.ok(spot === null || !spot.tab.endsWith("-8"));
  assert.equal(defaultSpot([], "combi"), null);
});

test("defaultSpot keeps a remembered spot that still exists, drops one that does not", () => {
  const pages = withPlay(kronosPages("hd1", rows).pages, "hd1");
  assert.deepEqual(defaultSpot(pages, "hd1", { page: "0-P3", tab: "3-4" }), { page: "0-P3", tab: "3-4" });
  assert.deepEqual(defaultSpot(pages, "hd1", { page: "9-P9", tab: "x" }), { page: "0-P0", tab: "0-1" });
});

test("withPlay adds a Main tab first on the HD-1 Play page, only for HD-1", () => {
  const hd1 = withPlay(kronosPages("hd1", rows).pages, "hd1");
  assert.equal(hd1[0].page, "P0");
  assert.equal(hd1[0].tabs[0].title, "Main");
  const combi = kronosPages("combi", rows).pages;
  assert.equal(withPlay(combi, "combi"), combi);
});
