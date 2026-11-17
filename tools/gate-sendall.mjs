// Acceptance gate for Send: every changed slot in every bank goes in one transfer, each bank gets its own backup. Owned by the architect: builders must not edit it.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { gate, core, launch } from "./gate-kit.mjs";

const g = gate("SENDALL"), { check, finish } = g, C = await core(g);
const ui = await launch(g, C), { X, seen, text, until, openBank, ok, win, BACKUPS } = ui;
const rename = async (i, v) => { await X(`row-${i}`).dblclick(); await X("rename-input").fill(v); await X("rename-input").press("Enter"); await until(async () => (await text(`row-name-${i}`)) === v, `renamed ${v}`); };
const ramName = (key, i) => win.evaluate(([k, n]) => window.__kronosE2E.ramName(k, n), [key, i]);

await ui.openFile();
await ui.connectSim();

await check("nothing changed: Send says so and opens no dialog", async () => {
  await openBank("program:INT-A"); await X("push-bank").click(); await seen("error-message");
  assert.match(await text("error-message"), /Nothing has changed, so there is nothing to send\./);
  assert.equal(await X("confirm-message").count(), 0, "a dialog opened");
});

await check("changes in two banks reach the simulator in one Send, each bank with its own backup", async () => {
  await openBank("program:INT-A"); await rename(2, "Send Prog");
  await openBank("combi:INT-B"); await rename(3, "Send Combi");
  await openBank("program:INT-C");
  await X("push-bank").click(); await ok();
  await until(async () => /Sent 2 slot\(s\) in 2 bank\(s\)/.test(await text("transfer-note")), "success note", 60000);
  assert.equal(await ramName("program:INT-A", 2), "Send Prog");
  assert.equal(await ramName("combi:INT-B", 3), "Send Combi");
  const files = readdirSync(BACKUPS);
  assert.equal(files.length, 2, `backups: ${files.join(", ")}`);
  assert.ok(files.some((f) => f.startsWith("program-INT-A-before-send-")), `no program backup: ${files.join(", ")}`);
  assert.ok(files.some((f) => f.startsWith("combi-INT-B-before-send-")), `no combi backup: ${files.join(", ")}`);
});

await check("Send is enabled with the Global page open", async () => {
  await X("global-item").click(); await seen("editor-title");
  assert.equal(await X("push-bank").isDisabled(), false, "Send is disabled on the Global page");
});

await ui.noErrors();
await finish();
