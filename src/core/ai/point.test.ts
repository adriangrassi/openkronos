import { test } from "node:test";
import assert from "node:assert/strict";
import { rowIndexIn, scrollOffsetFor } from "./point.ts";
import type { Row } from "../params/params.ts";

test("rowIndexIn finds first and last rows and returns -1 for a row outside the list", () => {
  const ids = ["10.0", "12.0", "14.3"];
  assert.equal(rowIndexIn(ids, "10.0"), 0);
  assert.equal(rowIndexIn(ids, "14.3"), 2);
  assert.equal(rowIndexIn(ids, "99.0"), -1);
});

test("scrollOffsetFor centres the row, and never goes below 0 or past the end", () => {
  assert.equal(scrollOffsetFor(0, 32, 480, 100), 0);
  assert.equal(scrollOffsetFor(50, 32, 480, 100), 50 * 32 - (480 - 32) / 2);
  assert.equal(scrollOffsetFor(99, 32, 480, 100), 100 * 32 - 480);
  assert.equal(scrollOffsetFor(1, 32, 480, 3), 0);
});

test("pointer survives an edit and is cleared by page, sound, mode, new question or close", async () => {
  const { clearsPointOn } = await import("./point.ts");
  assert.equal(clearsPointOn("edit"), false);
  for (const e of ["page", "sound", "mode", "ask", "close"] as const) assert.equal(clearsPointOn(e), true, e);
});

test("pointTarget sends list rows to their group and effect parameters to the effects page", async () => {
  const { pointTarget, fxSpot } = await import("./point.ts");
  const list = [{ id: "10.0", group: "Filter1" }];
  const fx = [{ id: "300.0", group: "Insert Effect2" }, { id: "400.0", group: "Effect LFO1" }];
  assert.deepEqual(pointTarget("10.0", list, fx), { kind: "list", group: "Filter1" });
  assert.deepEqual(pointTarget("300.0", list, fx), { kind: "fx", group: "Insert Effect2" });
  assert.equal(pointTarget("999.0", list, fx), null);
  assert.deepEqual(fxSpot("Insert Effect2"), { tab: "8-7", ifx: 2 });
  assert.deepEqual(fxSpot("Master Effect2"), { tab: "9-3" });
  assert.deepEqual(fxSpot("Total Effect1"), { tab: "9-4" });
  assert.equal(fxSpot("Effect LFO1"), null);
});

test("pointUi decides which UI a pointer opens", async () => {
  const { pointUi } = await import("./point.ts");
  const listRows = [{ id: "10.0", group: "Filter1" }, { id: "20.0", group: "Amp" }];
  const fxRows = [{ id: "98.1", group: "Insert Effect2" }, { id: "912.1", group: "Master Effect1" }, { id: "1.0", group: "Effect LFO1" }];
  const o = (view: "list" | "kronos", kronosFx: boolean, kronosHolds = false) => ({ view, kronosFx, kronosHolds, listRows, fxRows });
  assert.deepEqual(pointUi("98.1", o("kronos", false)), { ui: "effects", group: "Insert Effect2" }, "EXi has no effect pages in the Kronos view");
  assert.deepEqual(pointUi("98.1", o("kronos", true)), { ui: "kronos" });
  assert.deepEqual(pointUi("912.1", o("kronos", true)), { ui: "kronos" });
  assert.deepEqual(pointUi("98.1", o("list", true)), { ui: "effects", group: "Insert Effect2" });
  assert.deepEqual(pointUi("1.0", o("kronos", true)), { ui: "effects", group: "Effect LFO1" }, "no Kronos tab holds an Effect LFO");
  assert.deepEqual(pointUi("20.0", o("list", true)), { ui: "list", group: "Amp" });
  assert.deepEqual(pointUi("20.0", o("kronos", true, true)), { ui: "kronos" });
  assert.deepEqual(pointUi("20.0", o("kronos", true, false)), { ui: "list", group: "Amp" });
  assert.equal(pointUi("999.0", o("list", true)), null);
});

test("pointRow finds table rows and effect parameters, and nothing for an unknown id", async () => {
  const { pointRow } = await import("./point.ts");
  const { effectRowsAt } = await import("../params/effects.ts");
  const typeId = [...Array(198).keys()].find((i) => (effectRowsAt(4000, i, "Insert Effect1") ?? []).filter((r) => !r.fixed).length > 0)!;
  const fx = effectRowsAt(4000, typeId, "Insert Effect1")!.find((r) => !r.fixed)!;
  const typeRow = { ofs: 4000, bitHi: 7, bitLo: 0, group: "Insert Effect1", name: "Effect Type", rawMin: 0, rawMax: 197, fixed: false, valueText: "", signed: false, continuation: false, parts: [[4000, 7, 0]], typ: null, soc: null, sub: null, pid: null, idx: null } as Row;
  const plain = { ...typeRow, ofs: 10, name: "Cutoff", group: "Filter1", parts: [[10, 7, 0]] } as Row;
  const cur = new Uint8Array(5000);
  cur[4000] = typeId;
  assert.equal(pointRow([plain, typeRow], cur, "10.0"), plain);
  assert.equal(pointRow([plain, typeRow], cur, `${fx.ofs}.${fx.bitLo ?? 0}`), fx);
  assert.equal(pointRow([plain, typeRow], cur, "999.0"), undefined);
});
