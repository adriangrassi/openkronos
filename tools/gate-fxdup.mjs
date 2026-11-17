// Regression check (run by hand, not part of the owner's gates): editing a Combination must not add another Effects button each time.
import assert from "node:assert/strict";
import { gate, launch, load } from "./gate-kit.mjs";

const g = gate("FXDUP"), { check, finish } = g, P = await load("src/core/pcg/pcg.ts");
const ui = await launch(g, { P }), { X, win, until } = ui;
await ui.openFile();
await ui.editSlot("combi:INT-A", 0);
await check("10 slider edits leave one Effects button", async () => {
  await X("view-list").click();
  const one = win.locator('input[type=range][data-testid^="slider-"]').first(), id = await one.getAttribute("data-testid");
  for (let i = 0; i < 10; i++) {
    const b = await one.boundingBox(), before = await X(id.replace("slider-", "value-")).textContent();
    await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await win.mouse.down();
    await win.mouse.move(b.x + b.width * (i % 2 ? 0.2 : 0.8), b.y + b.height / 2, { steps: 5 }); await win.mouse.up();
    await until(async () => (await X(id.replace("slider-", "value-")).textContent()) !== before, `edit ${i} shown`);
  }
  assert.equal(await X("effects-open").count(), 1);
});
await finish();
