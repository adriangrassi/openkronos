// Gate: selecting the Set List bank shows the pad grid as the main view (no header button), the plain 128 rows are one toggle away.
import assert from "node:assert/strict";
import { gate, core, launch } from "./gate-kit.mjs";

const g = gate("SETPAD"), { check, finish } = g, C = await core(g);
const SHOT = process.env.SETPAD_SHOT ?? "setpad.png";
const ui = await launch(g, C), { X, seen, until, win, connectSim } = ui;
const count = (sel) => win.locator(sel).count();
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
try {
  await ui.openFile();
  await connectSim();
  await check("the SET bank opens the pad grid as the main view, not the 128 rows", async () => {
    await X("bank-setlist:SET").click(); await seen("setlists-main"); await seen("setlists-panel");
    await until(async () => (await count('[data-testid^="setlists-pad-"]')) === 16, "16 pads");
    assert.equal(await win.locator('[data-testid="setlists-main"] [data-testid="setlists-panel"]').count(), 1, "grid is not inside the main area");
    assert.equal(await count('[data-testid^="row-name-"]'), 0, "plain rows are shown");
    assert.ok((await X("setlists-pad-0").textContent()).length > 0);
    await win.screenshot({ path: SHOT });
  });
  await check("Play view: clicking a pad records the select message", async () => {
    const n0 = (await log()).length;
    await X("setlists-view-play").click(); await X("setlists-pad-3").click();
    await until(async () => (await log()).length > n0, "select message"); assert.equal(await X("setlists-pad-3").getAttribute("data-current"), "true");
    await X("setlists-exit").click(); await seen("setlists-main");
  });
  await check("Pad size slider sets the pad height, Fit window restores filling, and the choice is kept", async () => {
    await X("bank-setlist:SET").click(); await seen("setlists-main");
    const h = async () => Math.round((await X("setlists-pad-0").boundingBox()).height);
    const fit = await h();
    await X("setlists-size-range").fill("80"); await until(async () => (await h()) === 80, "pad height 80");
    assert.equal(await X("setlists-panel").getAttribute("data-sized"), "true");
    assert.equal(await win.evaluate(() => localStorage.getItem("kronos.setlists.padh")), "80");
    await X("setlists-size-fit").click(); await until(async () => (await h()) === fit, "back to fit"); assert.equal(await win.evaluate(() => localStorage.getItem("kronos.setlists.padh")), "0");
  });
  await check("List view shows the plain rows, Pad view brings the grid back", async () => {
    await X("setlists-list-view").click(); await seen("row-name-0"); assert.equal(await count('[data-testid^="row-name-"]'), 128); assert.equal(await count('[data-testid="setlists-main"]'), 0);
    await X("setlists-pad-view").click(); await seen("setlists-main"); assert.equal(await count('[data-testid^="row-name-"]'), 0);
  });
  await check("the header button still opens the panel on another bank", async () => {
    await X("bank-program:INT-A").click(); await seen("row-name-0"); await until(async () => (await count('[data-testid="setlists-panel"]')) === 0, "panel gone");
    await X("setlists-open").click(); await seen("setlists-panel"); assert.equal(await count('[data-testid="setlists-main"]'), 0);
  });
  await ui.noErrors();
} finally { await finish(); }
