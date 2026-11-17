// Gate for the AI window's pointer handling and size: drag from any non-interactive area, never from controls or message text, header pinned, reset, persistence.
// Run: KRONOS_GATE_THEME=a node tools/gate-aidrag.mjs
import assert from "node:assert/strict";
import { gate, core, launch } from "./gate-kit.mjs";

const g = gate("AIDRAG"), { check, finish } = g, C = await core(g);
const long = (n) => "Round " + n + ": **bold** and `code`.\n\n- first point of round " + n + ", long enough to wrap onto a second line of the answer card here\n- second point\n\n" + "More words to read in the answer. ".repeat(8);
const search = (t) => ({ id: "s" + t, name: "search_sounds", arguments: { text: t } });
const AIP = [
  { content: long(1), toolCalls: [search("a")] }, { content: long(2), toolCalls: [search("b")] }, { content: long(3), toolCalls: [search("c")] },
  { content: "", toolCalls: [{ id: "a", name: "build_combi", arguments: { name: "AI Split", parts: [{ key: "program:U-A", index: 3, keyBottom: 0, keyTop: 59 }, { key: "program:INT-B", index: 5, keyBottom: 60, keyTop: 127 }] } }] },
  { content: long(4), toolCalls: [] },
];
const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(AIP) }), { win, X, seen, until, openBank, openFile, noErrors } = ui;
await openFile();
await openBank("combi:INT-F");
await X("row-100").dblclick(); await X("rename-input").fill("Init Combi"); await X("rename-input").press("Enter"); await ui.until(async () => (await ui.text("row-name-100")) === "Init Combi", "renamed");
await X("ai-open").click(); await seen("ai-head");
const box = (sel) => win.locator(sel).first().boundingBox();
const panel = () => box(".ai-panel");
const head = () => box('[data-testid="ai-head"]');
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const press = async (x, y, dx, dy, steps = 8) => { await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x + dx, y + dy, { steps }); await win.mouse.up(); await wait(80); };
const resetPos = async () => { const h = await head(); await win.mouse.dblclick(h.x + h.width * 0.45, h.y + h.height / 2); await wait(150); };
let home;

await check("the default window is about 520 x 640 at 1400 x 900 and clears the top bar, the bank column and the dock", async () => {
  home = await panel();
  assert.ok(home.width >= 500 && home.width <= 545, "width " + home.width);
  assert.ok(home.height >= 610 && home.height <= 670, "height " + home.height);
  const top = await box(".topbar"), banks = await box(".banks"), dock = await box(".dock");
  assert.ok(home.y >= top.y + top.height - 1, "covers the top bar");
  assert.ok(home.x >= banks.x + banks.width - 1, "covers the bank column");
  if (dock) assert.ok(home.y + home.height <= dock.y + 1, "covers the dock");
});

await check("a run fills the window, and the header stays pinned while the body scrolls to the bottom", async () => {
  await X("ai-prompt").fill("bass left, brass right"); await X("ai-go").click(); await seen("ai-approve", 30000);
  const before = await head();
  const r = await win.evaluate(() => { const b = document.querySelector(".ai-body"); b.scrollTop = b.scrollHeight; return { over: b.scrollHeight - b.clientHeight, panelTop: document.querySelector(".ai-panel").scrollTop }; });
  assert.ok(r.over > 100, "the body did not overflow, the test is empty: " + r.over);
  assert.equal(r.panelTop, 0, "the window itself scrolled");
  const after = await head(), p = await panel();
  assert.ok(near(before.y, after.y, 1) && after.y >= p.y && after.y + after.height <= p.y + p.height, "header moved from " + before.y + " to " + after.y);
});

const moveCheck = (name, point, dx = -90, dy = 50) => check(name, async () => {
  await resetPos();
  const a = await panel(), [x, y] = await point(a);
  await press(x, y, dx, dy);
  const b = await panel();
  assert.ok(near(b.x - a.x, dx) && near(b.y - a.y, dy), "moved by " + (b.x - a.x) + "," + (b.y - a.y) + ", expected " + dx + "," + dy);
});
await moveCheck("a drag from the header moves the window by the drag distance", async () => { const h = await head(); return [h.x + h.width * 0.45, h.y + h.height / 2]; });
await moveCheck("a drag from the window padding moves it", async (a) => { const b = await box(".ai-body"); return [a.x + 10, b.y + b.height / 2]; });
await moveCheck("a drag from the gap between two messages moves it", async () => {
  const find = () => win.evaluate(() => {
    const items = [...document.querySelectorAll(".ai-log > li")];
    const k = items.findIndex((el, n) => n > 0 && el.getBoundingClientRect().top - items[n - 1].getBoundingClientRect().bottom >= 6);
    if (k < 1) return null;
    items[k].scrollIntoView({ block: "center" });
    const a = items[k - 1].getBoundingClientRect(), b = items[k].getBoundingClientRect(), log = document.querySelector(".ai-log").getBoundingClientRect();
    return [log.x + log.width - 14, (a.bottom + b.top) / 2];
  });
  assert.ok(await find(), "no gap between messages found");
  await wait(150);
  return await find();
});
await moveCheck("a drag from the footer margin (below the last control) moves it", async (a) => {
  await win.evaluate(() => { const b = document.querySelector(".ai-body"); b.scrollTop = b.scrollHeight; });
  const b = await box(".ai-body"); return [a.x + a.width / 2, b.y + b.height - 11];
});

await check("a press on a button, an input or message text does not move it, and text selection works", async () => {
  await resetPos();
  const a = await panel();
  await win.evaluate(() => { document.querySelector(".ai-body").scrollTop = 0; });
  const go = await box('[data-testid="ai-go"]'), ta = await box('[data-testid="ai-prompt"]');
  await press(go.x + go.width / 2, go.y + go.height / 2, -80, 40);
  await press(ta.x + 20, ta.y + 10, -80, 40);
  const p = await win.evaluate(() => { const el = document.querySelector(".ai-card p.ai-text"); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + 6, r.y + 8]; });
  await wait(120);
  const q = await win.evaluate(() => { const r = document.querySelector(".ai-card p.ai-text").getBoundingClientRect(); return [r.x + 6, r.y + 8]; });
  await press(q[0], q[1], 120, 4);
  const b = await panel();
  assert.ok(near(b.x, a.x) && near(b.y, a.y), "moved by " + (b.x - a.x) + "," + (b.y - a.y));
  const sel = await win.evaluate(() => String(getSelection()));
  assert.ok(sel.length > 3, "nothing was selected: " + JSON.stringify(sel) + " " + p);
  await win.evaluate(() => getSelection().removeAllRanges());
});

await check("a press on the body's own scrollbar scrolls, it does not move the window", async () => {
  const a = await panel(), b = await box(".ai-body"), sw = await win.evaluate(() => { const e = document.querySelector(".ai-body"); return e.offsetWidth - e.clientWidth; });
  assert.ok(sw > 4, "no visible scrollbar (" + sw + "px), the test is empty");
  await press(b.x + b.width - sw / 2 - 1, b.y + b.height / 2, -60, 30);
  const c = await panel();
  assert.ok(near(c.x, a.x) && near(c.y, a.y), "moved by " + (c.x - a.x) + "," + (c.y - a.y));
});

await check("a click without movement does not move it", async () => {
  const a = await panel(), h = await head();
  await win.mouse.click(h.x + h.width * 0.45, h.y + h.height / 2);
  await press(h.x + h.width * 0.45, h.y + h.height / 2, 2, 1, 2);
  const b = await panel();
  assert.ok(near(b.x, a.x, 0) && near(b.y, a.y, 0), "moved by " + (b.x - a.x) + "," + (b.y - a.y));
});

await check("the window can never be dragged off the screen, and the header stays reachable", async () => {
  const vw = await win.evaluate(() => innerWidth), vh = await win.evaluate(() => innerHeight);
  for (const [dx, dy] of [[3000, 3000], [-4000, -4000]]) {
    const h = await head();
    await press(h.x + h.width * 0.45, h.y + h.height / 2, dx, dy, 12);
    const b = await panel(), h2 = await head();
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= vw + 1 && b.y + b.height <= vh + 1, JSON.stringify(b));
    assert.ok(h2.y >= 0 && h2.y + h2.height <= vh && h2.x + 80 <= vw, "header off screen");
  }
});

await check("the position is kept across closing and reopening; double-click on an empty area resets it", async () => {
  await resetPos();
  const h = await head();
  await press(h.x + h.width * 0.45, h.y + h.height / 2, -200, 80);
  const moved = await panel();
  assert.ok(!near(moved.x, home.x, 4), "did not move");
  await X("ai-close").click(); await X("ai-open").click(); await seen("ai-head");
  const again = await panel();
  assert.ok(near(again.x, moved.x, 1) && near(again.y, moved.y, 1) && near(again.width, moved.width, 1), "reopened at " + again.x + "," + again.y + ", was " + moved.x + "," + moved.y);
  const b = await box(".ai-body");
  await win.mouse.dblclick(again.x + 10, b.y + b.height / 2);
  await until(async () => near((await panel()).x, home.x, 2) && near((await panel()).y, home.y, 2), "reset to the default");
  assert.equal(await win.evaluate(() => localStorage.getItem("kronos.ai.rect")), null);
});

await check("the resize grips still work", async () => {
  const a = await panel(), s = await box('[data-testid="ai-resize-sw"]');
  await press(s.x + 3, s.y + 3, 60, -40);
  const b = await panel();
  assert.ok(b.width < a.width - 40 && b.height < a.height - 30, a.width + "x" + a.height + " -> " + b.width + "x" + b.height);
  await resetPos();
});

await check("A- / A+ change the answer size, are kept, stop at 14 and 20, and work from the keyboard", async () => {
  const size = () => win.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".ai-card p.ai-text")).fontSize));
  assert.equal(await size(), 16);
  await X("ai-fs-up").click(); assert.equal(await size(), 18);
  await X("ai-fs-up").click(); assert.equal(await size(), 20);
  assert.ok(await X("ai-fs-up").isDisabled());
  await X("ai-close").click(); await X("ai-open").click(); await seen("ai-head");
  assert.equal(await size(), 20, "not kept");
  for (let i = 0; i < 3; i++) await X("ai-fs-down").click();
  assert.equal(await size(), 14); assert.ok(await X("ai-fs-down").isDisabled());
  await X("ai-fs-up").click(); await X("ai-fs-up").click(); assert.equal(await size(), 18);
  await X("ai-fs-down").focus(); await win.keyboard.press("Enter"); assert.equal(await size(), 16);
});

await check("an answer renders as elements: bold, code, lists, and a collapsed Tool activity line", async () => {
  const r = await win.evaluate(() => ({ strong: document.querySelectorAll(".ai-prose strong").length, code: document.querySelectorAll(".ai-prose code").length, li: document.querySelectorAll(".ai-prose li").length, tools: document.querySelector(".ai-tools summary")?.textContent, open: document.querySelector(".ai-tools details")?.open }));
  assert.ok(r.strong >= 3 && r.code >= 3 && r.li >= 6, JSON.stringify(r));
  assert.match(r.tools, /Tool activity \(\d+\)/); assert.equal(r.open, false);
});

await noErrors();
await finish();
