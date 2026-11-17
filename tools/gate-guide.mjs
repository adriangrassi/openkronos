// Acceptance gate for the Ask & show walkthrough. The model is scripted (no AI call, nothing sent to a device).
// With GUIDE_SHOTS=<dir> it also writes a screenshot of every state at 1280x720 and 1700x950.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch } from "./gate-kit.mjs";

const g = gate("GUIDE"), { finish } = g,
  check = (t, fn) => g.check(t, async () => { try { return await fn(); } catch (e) { console.log("  why:", String(e.message).slice(0, 300)); throw e; } }), C = await core(g), { T, L, Q, parsed } = C;
const f0 = parsed(), KEY = "program:INT-A", IDX = 1, entry = L.getEntry(f0, KEY, IDX), all = Q.paramsFor(T, "exi", entry);
const E = await import("../src/core/params/effects.ts");
const idOf = (r) => `${r.ofs}.${r.bitLo ?? 0}`;
const fx = (group, name) => { const t = all.find((r) => r.group === group && r.name === "Effect Type"); return E.effectRowsAt(t.ofs, entry[t.ofs], group).find((r) => r.name === name); };
const osc = all.find((r) => r.group === "EXi1 Common" && r.name === "Transpose");
const STEPS = [
  { r: fx("Master Effect2", "Wet/Dry"), note: "Raise slightly", suggest: 30 },
  { r: fx("Master Effect2", "Reverb Time"), note: "Raise a little", suggest: 62 },
  { r: fx("Insert Effect1", "Input Trim"), note: "Lower slightly", suggest: 80 },
  { r: osc, note: "Raise slightly", suggest: 7 },
];
for (const s of STEPS) assert.ok(s.r, "scripted row exists");
const show = { id: "s1", name: "show_param", arguments: { key: KEY, index: IDX, ids: STEPS.map((s) => ({ id: idOf(s.r), note: s.note, suggest: s.suggest })) } };
const SCRIPT = [{ content: "", toolCalls: [{ id: "d1", name: "describe_sound", arguments: { key: KEY, index: IDX } }] }, { content: "", toolCalls: [show] }, { content: "Four settings widen the sound.", toolCalls: [] }];

const SHOTS = process.env.GUIDE_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(SCRIPT), KRONOS_E2E_AI_DELAY_MS: "700" });
const { win, X, seen, text, until, openBank } = ui;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
let vpName = "";
const shot = async (n) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${vpName}-${n}.png`) }); };
const size = async (w, h) => { await g.state.app.evaluate(({ BrowserWindow }, [a, b]) => { const x = BrowserWindow.getAllWindows()[0]; x.unmaximize(); x.setFullScreen(false); x.setContentSize(a, b); }, [w, h]); await until(async () => (await win.evaluate(() => [innerWidth, innerHeight])).join("x") === `${w}x${h}`, `window ${w}x${h}`); await nap(300); };
const hl = () => win.evaluate(() => [...document.querySelectorAll('[data-pointed="true"]')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }).filter((r) => r.w > 0 && r.h > 0));
const gone = async () => (await X("guide-callout").count()) === 0 && (await hl()).length === 0;
const stepNo = async () => Number(/Step (\d+) of/.exec(await text("guide-step"))?.[1] ?? 0);
// The callout is beside the highlighted control: inside the window and not over it.
const placed = async (label) => {
  await nap(350);
  const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight })), b = await X("guide-callout").boundingBox(), t = await hl();
  assert.ok(b, `${label}: no callout`); assert.equal(t.length, 1, `${label}: exactly one highlighted control, got ${t.length}`);
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.w && b.y + b.height <= vp.h, `${label}: callout outside the window ${JSON.stringify(b)} in ${vp.w}x${vp.h}`);
  const o = !(b.x + b.width <= t[0].l || t[0].r <= b.x || b.y + b.height <= t[0].t || t[0].b <= b.y);
  assert.ok(!o, `${label}: callout covers the control ${JSON.stringify(b)} ${JSON.stringify(t[0])}`);
  assert.ok(t[0].t >= 0 && t[0].b <= vp.h && t[0].l >= 0 && t[0].r <= vp.w, `${label}: the control is not in view ${JSON.stringify(t[0])}`);
};
const ask = async () => { await X("ask-text").fill("how i make this sound more expansive"); await X("ask-go").click(); await seen("guide-callout", 30000); await until(async () => (await hl()).length > 0, "highlight"); await nap(300); };
const next = async (n) => { await X("guide-next").click(); await until(async () => (await stepNo()) === n, `step ${n}`); await until(async () => (await hl()).length > 0, `target of step ${n}`); };

await ui.openFile();
await openBank(KEY); await X(`row-${IDX}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title");
await X("view-kronos").click(); await seen("kronos-view");
await X("ai-open").click(); await seen("ask-text");

for (const [w, h] of [[1280, 720], [1700, 950]]) {
  vpName = `${w}x${h}`;
  await size(w, h);
  await check(`${vpName}: the question starts a tour; step 1 shows name, note, value and suggestion beside the control`, async () => {
    await ask(); await placed("step 1"); await shot("1-step1");
    assert.equal(await text("guide-step"), "Step 1 of 4"); assert.equal(await text("guide-name"), STEPS[0].r.name); assert.equal(await text("guide-note"), STEPS[0].note);
    assert.equal(await text("guide-now"), "12"); assert.equal(await text("guide-suggest"), "30");
    assert.equal(await X("guide-back").isDisabled(), true); assert.equal(await text("guide-next"), "Next");
    assert.equal(await X("point-note").count(), 0, "no second banner");
  });
  await check(`${vpName}: Next walks all four steps, navigating each time, and the last one says Done`, async () => {
    for (let n = 2; n <= 4; n++) { await next(n); await placed(`step ${n}`); await shot(`${n}-step${n}`); assert.equal(await text("guide-name"), STEPS[n - 1].r.name); }
    assert.equal(await text("guide-next"), "Done"); assert.equal(await X("guide-apply").count(), 1);
  });
  await check(`${vpName}: Back returns to the previous step`, async () => { await X("guide-back").click(); await until(async () => (await stepNo()) === 3, "step 3"); await placed("back"); await shot("5-back"); assert.equal(await text("guide-name"), STEPS[2].r.name); });
  await check(`${vpName}: Do it for me writes the suggestion as one undo step, stays on the step; Undo restores it`, async () => {
    await X("guide-apply").click(); await until(async () => (await text("guide-now")) === "80", "value written");
    assert.equal(await stepNo(), 3); assert.equal(await X("guide-apply").isDisabled(), true); await seen("guide-done"); await placed("applied"); await shot("6-applied");
    await X("undo").click(); await until(async () => (await text("guide-now")) === "93", "undone to 93"); assert.equal(await stepNo(), 3);
  });
  await check(`${vpName}: editing the highlighted value by hand keeps the tour, then Next moves on`, async () => {
    await X("guide-back").click(); await until(async () => (await stepNo()) === 2, "step 2"); await placed("step 2 again");
    const box = win.locator('[data-pointed="true"] input[type="number"], [data-pointed="true"] input:not([type="range"])').first();
    if (await box.count()) { await box.fill("55"); await box.press("Enter"); } else { await win.locator('[data-pointed="true"]').first().click(); await win.keyboard.press("ArrowUp"); }
    await until(async () => (await text("guide-now")) !== "50", "value changed by hand"); assert.equal(await stepNo(), 2); assert.equal(await X("guide-callout").count(), 1);
    await shot("7-edited"); await next(3); await placed("step 3 after edit");
  });
  await check(`${vpName}: Done on the last step ends the tour`, async () => { await next(4); await X("guide-next").click(); await until(gone, "tour gone"); });
  await check(`${vpName}: Cancel removes the highlight and the callout`, async () => { await ask(); await X("guide-cancel").click(); await until(gone, "gone"); await shot("8-cancelled"); });
  await check(`${vpName}: a new AI question ends the tour at once`, async () => { await ask(); await X("ask-text").fill("and darker?"); await X("ask-go").click(); await until(gone, "gone while the AI works", 2000); await seen("guide-callout", 30000); await X("guide-cancel").click(); await until(gone, "gone"); });
  await check(`${vpName}: Escape cancels; Enter (focus outside inputs) is Next`, async () => {
    await ask(); await win.locator(".kv").first().click({ position: { x: 2, y: 2 }, force: true }).catch(() => {}); await win.evaluate(() => document.activeElement?.blur?.());
    await win.keyboard.press("Enter"); await until(async () => (await stepNo()) === 2, "Enter = Next");
    await win.keyboard.press("Escape"); await until(gone, "Escape cancels"); assert.equal(await X("ask-text").count(), 1, "the AI window stays open");
  });
  await check(`${vpName}: a page change by the user ends the tour`, async () => { await ask(); await X("kv-page-0-P0").dispatchEvent("click"); await until(gone, "gone"); });
  await check(`${vpName}: switching the editor view ends the tour`, async () => { await ask(); await X("view-list").click(); await until(gone, "gone"); await X("view-kronos").click(); await seen("kronos-view"); });
  await check(`${vpName}: opening another sound ends the tour`, async () => { await ask(); await openBank("program:INT-B"); await until(gone, "gone"); await openBank(KEY); await X(`row-${IDX}`).click({ position: { x: 12, y: 8 } }); await X("edit-params").click(); await seen("editor-title"); await X("view-kronos").click(); await seen("kronos-view"); });
}
vpName = "list";
await check("List view: the walkthrough opens each group and effect slot, with the callout beside the row", async () => {
  await size(1280, 720); await X("view-list").click(); await seen("param-list");
  await ask(); await placed("list 1"); await shot("1-step1");
  for (let n = 2; n <= 4; n++) { await next(n); await placed(`list ${n}`); await shot(`${n}-step${n}`); }
  await X("guide-cancel").click(); await until(gone, "gone");
});
await check("a control that is not on screen docks the callout at the top, and Open it brings the control up", async () => {
  await ask(); await next(2); await win.evaluate(() => { document.querySelectorAll('[data-pointed="true"]').forEach((e) => e.removeAttribute("data-pointed")); });
  await until(async () => (await X("guide-callout").getAttribute("data-docked")) === "true", "docked", 5000); await shot("9-docked"); await X("guide-open").click(); await until(async () => (await X("guide-callout").getAttribute("data-docked")) !== "true", "floating again", 5000);
  await X("guide-cancel").click(); await until(gone, "gone");
});
await ui.noErrors();
await finish();
