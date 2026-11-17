// Gate for the AI connection screen and the Claude provider. FULLY OFFLINE: the Claude and Codex command lines are replaced by tools/fakes/*.mjs through
// KRONOS_CLAUDE_PATH / KRONOS_CODEX_PATH (honoured only when KRONOS_E2E=1, which gate-kit sets). No router key is set (the gate blanks the machine's AUTOROUTER_KEY), so the local card must say so.
// KRONOS_GATE_THEME=a (the default) | normal | studio picks the theme.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate, core, launch, root, testsAndTypes } from "./gate-kit.mjs";

const g = gate("CONNECT"), { check, finish } = g, C = await core(g);
await testsAndTypes(g, ["core/ai/connect.test.ts", "app/main/ai-claude.test.ts", "app/main/ai-connect.test.ts", "app/main/ai-cli.test.ts"]);
if (g.fails.length) await finish();

const fakes = mkdtempSync(path.join(os.tmpdir(), "kronos-gate-fakes-"));
const fake = (name) => {
  const dir = path.join(fakes, name); mkdirSync(dir);
  const file = path.join(dir, `fake-${name}.mjs`); copyFileSync(path.join(root, "tools", "fakes", `fake-${name}.mjs`), file);
  const mode = (m) => writeFileSync(path.join(dir, "mode.json"), JSON.stringify(m)); mode({});
  return { file, mode, capture: () => JSON.parse(readFileSync(path.join(dir, "capture.json"), "utf8")) };
};
const claude = fake("claude"), codex = fake("codex");
// The shapes a real `claude -p --output-format json --json-schema` run prints (2.1.326) and `claude auth status` prints.
const okRun = (text) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: { text, tool_calls: [] }, usage: { input_tokens: 2, cache_creation_input_tokens: 700, cache_read_input_tokens: 0, output_tokens: 20 } });
const signedOutRun = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login", usage: { input_tokens: 0, output_tokens: 0 } });
const SIGNED_IN = { auth: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "someone@example.com", orgId: "x" }) };
const SIGNED_OUT = { auth: JSON.stringify({ loggedIn: false, authMethod: "none" }), authCode: 1 };

const SHIFT = { modifiers: ["Shift"] };
const kill = async (app) => { try { spawnSync("taskkill", ["/PID", String(app.process().pid), "/T", "/F"]); } catch {} await new Promise((r) => setTimeout(r, 1200)); };

// Opens a Program's panel view and returns a function that Shift-clicks the first dial and waits for the AI window's answer.
async function prep(ui) {
  const { win, X, seen, openFile, connectSim, openBank, until } = ui;
  await openFile(); await connectSim(); await openBank("program:INT-A"); await X("row-5").click(); await X("edit-params").click(); await seen("editor-title");
  if (!(await win.locator(".kc-dial").count()) && (await win.locator('[data-testid="view-kronos"]').count())) await X("view-kronos").click();
  if (!(await win.locator(".kc-dial").count()) && (await win.locator('[data-testid="view-panel"]').count())) await X("view-panel").click();
  await win.locator(".kc-dial").first().waitFor({ timeout: 15000 });
  const dials = win.locator(".kc-dial");
  const note = async () => (await win.locator('[data-testid="ai-note"]').first().textContent().catch(() => "")) ?? "";
  const idle = async () => (await win.locator('[data-testid="ai-banner"]').count()) === 0;
  return async (i = 0) => {
    if (await win.locator('[data-testid="ai-close"]').count()) await X("ai-close").click();
    await dials.nth(i).locator("svg").first().click({ ...SHIFT });
    await seen("ai-prompt");
    await until(async () => (await note()).length > 20 && (await idle()), "the answer", 20000);
    return note();
  };
}
const openSettings = async (ui) => { await ui.X("settings-open").click(); await ui.seen("settings-dialog"); await ui.seen("ai-conn-section"); };
const chip = (ui, id) => ui.text(`ai-conn-chip-${id}`);
const settingsNow = (ui) => ui.win.evaluate(() => window.kronos.settingsGet());

// ---- Run 1: both tools present ----
const ui = await launch(g, C, { AUTOROUTER_KEY: "", KRONOS_CLAUDE_PATH: claude.file, KRONOS_CODEX_PATH: codex.file }), { X, seen, until, win } = ui;
const APPDATA = path.join(ui.tmp, "appdata");
const explain = await prep(ui);
await openSettings(ui);

await check("three cards render with the Not checked chip, a setup guide button and a privacy note", async () => {
  for (const id of ["claude", "cloud", "local"]) { await seen(`ai-conn-card-${id}`); assert.equal(await chip(ui, id), "Not checked", id); await seen(`ai-conn-check-${id}`); await seen(`ai-conn-test-${id}`); await seen(`ai-conn-use-${id}`); }
  assert.match(await ui.text("ai-conn-card-claude"), /Claude \(your Claude plan\)/); assert.match(await ui.text("ai-conn-card-cloud"), /ChatGPT \/ Codex \(your ChatGPT plan\)/); assert.match(await ui.text("ai-conn-card-local"), /Local server \(advanced\)/);
  assert.match(await ui.text("ai-conn-card-claude"), /usage limits/); assert.match(await ui.text("ai-conn-card-claude"), /never sees your password/);
  await seen("ai-conn-guide"); await seen("ai-conn-model"); assert.match(await ui.text("ai-conn-privacy"), /never reads, stores or logs your sign-in/);
  assert.equal((await settingsNow(ui)).aiProvider, "cloud", "the default provider is unchanged");
});

await check("Check: Ready for a signed-in Claude and Codex, Not installed for the local card without a key", async () => {
  claude.mode(SIGNED_IN); codex.mode({ loggedIn: true });
  await X("ai-conn-check-claude").click(); await until(async () => (await chip(ui, "claude")) === "Ready", "claude ready"); assert.match(await ui.text("ai-conn-detail-claude"), /2\.1\.326/);
  assert.ok(!(await ui.text("ai-conn-card-claude")).includes("someone@example.com"), "no account detail is shown");
  await X("ai-conn-check-cloud").click(); await until(async () => (await chip(ui, "cloud")) === "Ready", "codex ready"); assert.match(await ui.text("ai-conn-detail-cloud"), /0\.169\.0/);
  await X("ai-conn-check-local").click(); await until(async () => (await chip(ui, "local")) === "Not installed", "local not installed"); assert.match(await ui.text("ai-conn-detail-local"), /AUTOROUTER_KEY/);
});

await check("Check: Not signed in shows the exact commands, and Copy puts a command on the clipboard", async () => {
  claude.mode(SIGNED_OUT);
  await X("ai-conn-check-claude").click(); await until(async () => (await chip(ui, "claude")) === "Not signed in", "claude signed out");
  await seen("ai-conn-steps-claude"); const steps = await ui.text("ai-conn-steps-claude");
  for (const c of ["claude", "/login", "npm install -g @anthropic-ai/claude-code", "irm https://claude.ai/install.ps1 | iex", "curl -fsSL https://claude.ai/install.sh | bash"]) assert.ok(steps.includes(c), c);
  await X("ai-conn-copy-claude-0-2").click(); await until(async () => (await X("ai-conn-copy-claude-0-2").textContent()) === "Copied", "copied");
  assert.equal(await g.state.app.evaluate(({ clipboard }) => clipboard.readText()), "npm install -g @anthropic-ai/claude-code");
  assert.match(await ui.text("ai-conn-card-claude"), /code\.claude\.com\/docs\/en\/setup/);
  codex.mode({ loggedIn: false }); await X("ai-conn-check-cloud").click(); await until(async () => (await chip(ui, "cloud")) === "Not signed in", "codex signed out");
  assert.ok((await ui.text("ai-conn-steps-cloud")).includes("npm install -g @openai/codex") && (await ui.text("ai-conn-steps-cloud")).includes("codex login"));
});

await check("an old tool that cannot report its sign-in is shown as such, not as ready", async () => {
  claude.mode({ authStderr: "error: unknown command 'auth'\n", authCode: 1 });
  await X("ai-conn-check-claude").click(); await until(async () => (await chip(ui, "claude")) === "Installed, sign-in not known", "unknown chip"); assert.match(await ui.text("ai-conn-detail-claude"), /Test connection/);
});

await check("Test connection shows the latency when it works and the friendly error when it does not", async () => {
  claude.mode({ stdout: okRun("OK") });
  await X("ai-conn-test-claude").click(); await seen("ai-conn-result-claude"); await until(async () => /It works: answered in [\d.]+ s/.test(await ui.text("ai-conn-result-claude")), "claude test ok");
  assert.equal(await chip(ui, "claude"), "Ready", "a working test settles an unknown sign-in");
  assert.match(claude.capture().stdin, /Reply with OK/);
  claude.mode({ stdout: signedOutRun, code: 1 });
  await X("ai-conn-test-claude").click(); await until(async () => /not signed in/i.test(await ui.text("ai-conn-result-claude")), "claude test signed out"); assert.match(await ui.text("ai-conn-result-claude"), /Claude Code is installed but not signed in/);
  codex.mode({ loggedIn: true }); await X("ai-conn-test-cloud").click(); await until(async () => /It works/.test(await ui.text("ai-conn-result-cloud").catch(() => "")), "codex test ok");
  await X("ai-conn-test-local").click(); await until(async () => /AUTOROUTER_KEY/.test(await ui.text("ai-conn-result-local").catch(() => "")), "local test says why");
});

await check("Use this one persists the provider, and the Claude model is chosen from the allowlist", async () => {
  await X("ai-conn-use-claude").check(); await until(async () => (await settingsNow(ui)).aiProvider === "claude", "claude stored");
  assert.equal(await X("ai-conn-use-cloud").isChecked(), false);
  assert.deepEqual(await X("ai-conn-model").locator("option").evaluateAll((o) => o.map((x) => x.value)), ["sonnet", "haiku", "opus"]);
  await X("ai-conn-model").selectOption("haiku"); await until(async () => (await settingsNow(ui)).aiClaudeModel === "haiku", "haiku stored");
  const bad = await win.evaluate(() => window.kronos.settingsSet({ aiClaudeModel: "--dangerously; calc" })); assert.equal(bad.aiClaudeModel, "haiku");
  const file = path.join(APPDATA, "openkronos", "settings.json");
  await until(async () => { try { const s = JSON.parse(readFileSync(file, "utf8")); return s.aiProvider === "claude" && s.aiClaudeModel === "haiku"; } catch { return false; } }, "settings.json written");
  assert.ok(!/sk-|token|password/i.test(readFileSync(file, "utf8")), "no secret in the settings file");
});

await check("the Setup guide opens in the dialog with its table", async () => {
  await X("ai-conn-guide").click(); await seen("ai-conn-guide-text");
  const t = await ui.text("ai-conn-guide-text"); for (const s of ["Connect an AI to OpenKronos", "Set up Claude", "Set up ChatGPT / Codex", "Privacy", "AUTOROUTER_KEY"]) assert.ok(t.includes(s), s);
  assert.ok((await win.locator('[data-testid="ai-conn-guide-text"] table tbody tr').count()) >= 6, "the troubleshooting table has rows");
  await X("ai-conn-guide").click(); await X("ai-conn-guide-text").waitFor({ state: "hidden", timeout: 5000 });
});
await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden", timeout: 10000 });

await check("signed out: the AI window says so in plain words and the button opens the AI connection settings", async () => {
  claude.mode({ stdout: signedOutRun, code: 1 });
  await explain(0); await seen("ai-not-ready"); assert.match(await ui.text("ai-not-ready"), /Claude Code is installed but not signed in/);
  assert.ok(!(await win.locator('[data-testid="ai-log"]').textContent()).includes("[ai:"), "the marker is not shown");
  await X("ai-open-connection").click(); await seen("settings-dialog"); await seen("ai-conn-section");
  await X("settings-close").click(); await X("settings-dialog").waitFor({ state: "hidden", timeout: 10000 });
});

await check("an Ask runs through the fake claude and its answer is shown; the question is on stdin and the chosen model in argv", async () => {
  claude.mode({ stdout: okRun("Fake Claude says: this control darkens the sound as you turn it down.") });
  const answer = await explain(1); assert.match(answer, /Fake Claude says: this control darkens the sound/);
  await until(async () => !(await win.locator('[data-testid="ai-not-ready"]').count()), "the not-ready line is gone");
  const c = claude.capture(); assert.ok(/--model\s*haiku/.test(c.argv.join(" ")), "the model from Settings"); assert.ok(c.stdin.includes("CONVERSATION:"), "the conversation reached stdin");
  assert.ok(!c.argv.join(" ").includes("Question"), "no question text in argv");
  assert.equal(c.env.ANTHROPIC_API_KEY, undefined); assert.equal(c.env.AUTOROUTER_KEY, undefined);
});
await ui.noErrors();
await kill(g.state.app);

// ---- Run 2: no claude on the computer ----
const ui2 = await launch(g, C, { AUTOROUTER_KEY: "", KRONOS_CLAUDE_PATH: path.join(fakes, "nothing-here", "claude.mjs"), KRONOS_CODEX_PATH: codex.file });
await ui2.win.evaluate(() => window.kronos.settingsSet({ aiProvider: "claude" }));
const explain2 = await prep(ui2);
await check("a missing Claude shows Not installed with the steps, and the AI window shows the friendly line and the button", async () => {
  await openSettings(ui2); await ui2.X("ai-conn-check-claude").click(); await until(async () => (await chip(ui2, "claude")) === "Not installed", "claude missing");
  await ui2.seen("ai-conn-steps-claude"); await ui2.X("ai-conn-test-claude").click(); await until(async () => /not installed/i.test(await ui2.text("ai-conn-result-claude").catch(() => "")), "test says not installed");
  await ui2.X("settings-close").click(); await ui2.X("settings-dialog").waitFor({ state: "hidden", timeout: 10000 });
  const shown = await explain2(0); assert.match(shown, /help text built into the app/, "the offline explanation still teaches");
  await ui2.seen("ai-not-ready"); assert.match(await ui2.text("ai-not-ready"), /Claude Code is not installed/); await ui2.seen("ai-open-connection");
});
await ui2.noErrors();
try { rmSync(fakes, { recursive: true, force: true }); } catch {}
await finish();
