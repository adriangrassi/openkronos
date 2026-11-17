// Acceptance gate G1 for the effect pages (routing diagram, 8-5, 8-7, 9-x). Owned by the architect: builders must not edit it.
// Factory file, INT-B 000 (program) and INT-A 000 (combination), Kronos view, simulator only, nothing goes to a keyboard.
import assert from "node:assert/strict";
import { gate, core, launch, load } from "./gate-kit.mjs";

const g = gate("FXPAGES"), { check, finish } = g, C = await core(g), { T, P, L, Q } = C;
const F = await load("src/core/params/effects.ts");
const file = P.parsePcg(C.raw);
const PK = "program:INT-B", CK = "combi:INT-A";
const orig = L.getEntry(file, PK, 0);
const slot = (id) => F.effectSlots(T, "program").find((s) => s.id === id);
const pad3 = (n) => String(n).padStart(3, "0");
const T_FAST = 6000;

const ui = await launch(g, C), { X, seen, text, until, win } = ui;
const count = (sel) => win.locator(sel).count();
const attr = async (id, a) => X(id).getAttribute(a);
const on = async (id) => (await attr(id, "data-active")) === "true" || (await attr(id, "aria-pressed")) === "true";
const entryNow = async (key = PK) => L.getEntry(P.parsePcg(await ui.saved()), key, 0);
const diff = (a, b) => { const d = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d.push(i); return d; };
// Page buttons are kv-page-<slot>-<P?>; the tab buttons only exist for the current page.
const goTab = async (id) => { await X(`kv-page-0-P${id.split("-")[0]}`).click(); await seen(`kv-tab-${id}`, T_FAST); await X(`kv-tab-${id}`).click(); };
const pickType = async (n, type) => {
  await goTab("8-7"); await X(`kv-ifx-${n}`).click(); await seen("fxt-button", T_FAST); await X("fxt-button").click();
  for (let c = 0; c < 20 && !(await X(`fxp-type-${type}`).isVisible()); c++) { if (!(await X(`fxp-cat-${c}`).isVisible())) break; await X(`fxp-cat-${c}`).click(); }
  await seen(`fxp-type-${type}`, T_FAST); await X(`fxp-type-${type}`).click(); await X("fxp-ok").click();
  await until(async () => (await text("fxt-button")).startsWith(pad3(type)), `type ${type} shown`, T_FAST);
};

await ui.openFile();
await ui.connectSim();
await ui.editSlot(PK, 0);
await X("view-kronos").click(); await seen("kronos-view");

await check("1 8-1 routing: ifx1..ifx12 nodes, ifx1 detail, chain edges 1>2 and 2>3", async () => {
  await goTab("8-1");
  for (let n = 1; n <= 12; n++) await seen(`fxr-node-ifx${n}`, T_FAST);
  assert.match(await text("fxr-node-ifx1"), /Piano Body\/Damper/);
  await seen("fxr-edge-chain-ifx1-ifx2", T_FAST); await seen("fxr-edge-chain-ifx2-ifx3", T_FAST);
});
await check("2 8-5: 12 IFX rows, first fxt-button reads 025: Piano Body/Damper", async () => {
  await goTab("8-5"); await win.locator(`[data-testid="fxt-button"]`).first().waitFor({ timeout: T_FAST });
  assert.equal(await count('[data-testid="fxt-button"]'), 12);
  assert.equal(await win.locator('[data-testid="fxt-button"]').first().innerText().then((s) => s.trim()), "025: Piano Body/Damper");
});
await check("3 click ifx3 node: tab 8-7, IFX3 selected, title Stereo Mastering Limiter, fx-graph-dyn", async () => {
  await goTab("8-1"); await seen("fxr-node-ifx3", T_FAST); await X("fxr-node-ifx3").click();
  await seen("kv-tab-8-7", T_FAST); await until(() => on("kv-tab-8-7"), "tab 8-7 active", T_FAST);
  await seen("kv-ifx-3", T_FAST); assert.ok(await on("kv-ifx-3"), "IFX3 not selected");
  await seen("fxp-title", T_FAST); assert.equal(await text("fxp-title"), "Stereo Mastering Limiter");
  await seen("fx-graph-dyn", T_FAST);
});
await check("4 pick type 011 for IFX4: byte = 11, params in range, one undo restores bytes exactly", async () => {
  const ofs = slot("ifx4").typeOfs;
  await pickType(4, 11);
  const e = await entryNow(); assert.equal(e[ofs], 11);
  const rows = F.effectParamRows(T, "program", "ifx4", 11); assert.ok(rows && rows.length > 10, "no rows for type 11");
  const bad = rows.filter((r) => { const v = Q.readParam(e, r); return v < r.rawMin || v > r.rawMax; }).map((r) => r.name);
  assert.deepEqual(bad, []);
  await X("undo").click(); await until(async () => (await entryNow())[ofs] === orig[ofs], "undone", 15000);
  assert.deepEqual(diff(await entryNow(), orig), [], "bytes differ after one undo");
});
await check("5 Band1 Gain raw 12 stores 12 and shows +6.0; fx-graph-peq exists", async () => {
  // Spec said raw 48, but the table range is -36..36 and descText(12) is "+6.0" (fx-kronos.test.ts); 12 is the valid equivalent.
  await pickType(4, 11);
  const r = F.effectParamRows(T, "program", "ifx4", 11).find((x) => x.name === "Band1 Gain"), k = `${r.ofs}.${r.bitLo ?? 0}`;
  await seen(`input-${k}`, T_FAST); await X(`input-${k}`).fill("12"); await X(`input-${k}`).press("Enter");
  await until(async () => /\+6\.0/.test(await text(`value-${k}`)), "+6.0 shown", T_FAST);
  assert.equal(Q.readParam(await entryNow(), r), 12);
  await seen("fx-graph-peq", T_FAST);
});
await check("6 9-1: fxr-node-mfx1 detail is the MFX1 type name; click opens 9-2", async () => {
  await goTab("9-1"); await seen("fxr-node-mfx1", T_FAST);
  const name = F.effectTypeName(T, orig[slot("mfx1").typeOfs]); assert.ok(name);
  assert.match(await text("fxr-node-mfx1"), new RegExp(name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
  await X("fxr-node-mfx1").click(); await until(() => on("kv-tab-9-2"), "tab 9-2 active", T_FAST);
});
await check("7 combination INT-A 000: 16 timbre source nodes on 8-1; tab 8-2 exists", async () => {
  await ui.closeEditor(); await ui.editSlot(CK, 0); await X("view-kronos").click(); await seen("kronos-view");
  await goTab("8-1");
  await seen("fxr-node-t1", T_FAST);
  assert.equal(await win.locator('[data-testid^="fxr-node-t"]').evaluateAll((els) => els.filter((e) => /^fxr-node-t\d+$/.test(e.getAttribute("data-testid"))).length), 16);
  await seen("kv-tab-8-2", T_FAST);
});
await check("8 perf: 8-7 with type 86 draws fewer than 80 inputs/buttons outside the IFX list", async () => {
  await ui.closeEditor(); await ui.editSlot(PK, 0); await X("view-kronos").click(); await seen("kronos-view");
  await pickType(5, 86); await seen("fxp-title", T_FAST);
  const n = await win.evaluate(() => [...document.querySelectorAll('[data-testid="kv-body"] input, [data-testid="kv-body"] button, [data-testid="kv-body"] select')].filter((e) => !(e.getAttribute("data-testid") ?? "").startsWith("kv-ifx-")).length);
  assert.ok(n > 0 && n < 80, `${n} controls`);
});

await finish();
