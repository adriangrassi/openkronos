// Acceptance gate for keeping the last whole-keyboard pull on this PC.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gate, core, launch } from "./gate-kit.mjs";

const g = gate("PULLCACHE"), { check, finish } = g, C = await core(g);
const dir = mkdtempSync(path.join(os.tmpdir(), "pullcache-")), cached = path.join(dir, "keyboard.PCG");
copyFileSync(fileURLToPath(new URL("../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG", import.meta.url)), cached);
const ui = await launch(g, C, { KRONOS_E2E_CACHE_DIR: dir }), { X, seen, text, until } = ui;

await check("a saved pull opens by itself at startup", async () => {
  await seen("bank-program:INT-A");
  assert.match(await text("file-name"), /pulled/i);
  assert.match(await text("transfer-note"), /Pull Whole Keyboard/);
});
await check("a new whole-keyboard pull replaces the saved one", async () => {
  const before = statSync(cached).mtimeMs;
  await ui.connectSim();
  await X("pull-keyboard").click();
  await until(() => statSync(cached).mtimeMs !== before, "saved pull updated", 300000);
  assert.ok(statSync(cached).size > 1024);
});
await ui.noErrors();
await finish();
