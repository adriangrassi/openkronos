// Acceptance gate for the Kronos mode buttons.
import assert from "node:assert/strict";
import { gate, core, launch, testsAndTypes } from "./gate-kit.mjs";

const g = gate("MODES"), { check, finish } = g, C = await core(g);
await testsAndTypes(g, ["core/midi/modes.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C, {}), { X, win, until } = ui;
const log = () => win.evaluate(() => window.__kronosE2E.midiLog());
await ui.openFile();
await check("the buttons wait for a keyboard", async () => assert.equal(await X("kronos-mode-7").isDisabled(), true));
await ui.connectSim();
for (const id of [2, 0, 4, 6, 7, 8, 9]) {
  await check(`button ${id} sends its Mode Change and lights up`, async () => {
    const n = (await log()).length;
    await X(`kronos-mode-${id}`).click();
    await until(async () => (await log()).slice(n).some((m) => m.join() === [0xf0, 0x42, 0x30, 0x68, 0x4e, id, 0xf7].join()), "Mode Change sent");
    await until(async () => (await X(`kronos-mode-${id}`).getAttribute("data-active")) === "true", "button lit");
    assert.equal(await win.locator('.mode-bar button[data-active="true"]').count(), 1);
  });
}
await ui.noErrors();
await finish();
