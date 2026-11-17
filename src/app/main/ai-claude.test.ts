import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { AiError, claudeArgs, claudeChat, parseClaudeRun } from "./ai-claude.ts";
import { cancelCli } from "./ai-cli.ts";
import { claudeNotLoggedIn, claudeOk, makeFake } from "./fake-cli.ts";

const SAVED = { ...process.env };
beforeEach(() => {
  process.env.KRONOS_E2E = "1";
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

const ask = [{ role: "user" as const, content: "what does the cutoff do?" }];
const turn = { text: "It darkens the sound.", tool_calls: [{ name: "read_sound", arguments_json: '{"slot":1}' }] };
const kindOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof AiError ? e.kind : `other: ${String(e)}`;
  }
  return "no error";
};

test("a good run gives the text, the tool calls with ids, and the usage", async () => {
  const f = makeFake("claude", { stdout: claudeOk(turn) });
  process.env.KRONOS_CLAUDE_PATH = f.file;
  const r = await claudeChat([...ask, { role: "assistant", content: "" }, { role: "user", content: "and the resonance?" }], [], { model: "haiku" });
  assert.equal(r.content, "It darkens the sound.");
  assert.deepEqual(r.toolCalls, [{ id: "call_1_0", name: "read_sound", arguments: { slot: 1 } }]);
  assert.deepEqual(r.usage, { input: 4484, cached: 0, output: 50, total: 4534 });
});

test("the prompt arrives on stdin and never in argv, and the tools of the CLI itself are off", async () => {
  const f = makeFake("claude", { stdout: claudeOk({ text: "ok", tool_calls: [] }) });
  process.env.KRONOS_CLAUDE_PATH = f.file;
  const nasty = "ZZMARK \"; calc & `whoami` $(calc) | type %PATH% 'x'";
  await claudeChat([{ role: "user", content: nasty }], [], { model: "sonnet" });
  const c = f.capture();
  assert.ok(c.stdin.includes(JSON.stringify(nasty).slice(1, -1)), "the text reached stdin intact");
  assert.ok(!c.argv.join(" ").includes("ZZMARK"), "the text is not in argv");
  assert.deepEqual(c.argv.slice(c.argv.indexOf("--tools"), c.argv.indexOf("--tools") + 2), ["--tools", ""]);
  for (const flag of ["-p", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands", "--json-schema", "--system-prompt"]) assert.ok(c.argv.includes(flag), flag);
  assert.deepEqual(c.argv.slice(c.argv.indexOf("--model"), c.argv.indexOf("--model") + 2), ["--model", "sonnet"]);
  assert.ok(!c.argv.includes("--api-key") && !c.argv.some((a) => /sk-|token/i.test(a)));
  assert.notEqual(path.resolve(c.cwd), path.resolve(process.cwd()), "runs in an empty temp folder");
});

test("a model name that is not in the allowlist never reaches a command", async () => {
  const f = makeFake("claude", { stdout: claudeOk({ text: "ok", tool_calls: [] }) });
  process.env.KRONOS_CLAUDE_PATH = f.file;
  for (const bad of ["sonnet; calc", "--help", "$(calc)", "fable", "", "SONNET"]) await assert.rejects(claudeChat(ask, [], { model: bad }), /bad Claude model/, bad);
  assert.ok(!existsSync(path.join(f.dir, "capture.json")), "the CLI was never started");
  assert.ok(claudeArgs("opus").includes("opus"));
});

test("the child gets a minimal environment: no API key, no base URL, no router key", async () => {
  const f = makeFake("claude", { stdout: claudeOk({ text: "ok", tool_calls: [] }) });
  process.env.KRONOS_CLAUDE_PATH = f.file;
  Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-secret", ANTHROPIC_BASE_URL: "http://x", ANTHROPIC_AUTH_TOKEN: "t", OPENAI_API_KEY: "o", AUTOROUTER_KEY: "r", CLAUDE_CONFIG_DIR: "C:/cfg", HTTPS_PROXY: "http://p:1", SOME_OTHER: "1" });
  await claudeChat(ask, [], { model: "sonnet" });
  const env = f.capture().env;
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "AUTOROUTER_KEY", "SOME_OTHER", "KRONOS_E2E", "KRONOS_CLAUDE_PATH"]) assert.equal(env[k], undefined, k);
  assert.equal(env.CLAUDE_CONFIG_DIR, "C:/cfg");
  assert.equal(env.HTTPS_PROXY, "http://p:1");
  assert.ok(Object.keys(env).some((k) => k.toUpperCase() === "PATH"));
});

test("not installed: a missing, relative or non-file path", async () => {
  const f = makeFake("claude", { stdout: "{}" });
  for (const p of [path.join(f.dir, "nope.mjs"), "relative/claude.mjs", f.dir]) {
    process.env.KRONOS_CLAUDE_PATH = p;
    assert.equal(await kindOf(claudeChat(ask, [], { model: "sonnet" })), "not-installed", p);
  }
});

test("signed out, over the limit, and a generic failure each get their own kind with the stderr tail", async () => {
  const f = makeFake("claude", { stdout: claudeNotLoggedIn, code: 1 });
  process.env.KRONOS_CLAUDE_PATH = f.file;
  assert.equal(await kindOf(claudeChat(ask, [], { model: "sonnet" })), "not-signed-in");
  const g = makeFake("claude", { stdout: JSON.stringify({ is_error: true, result: "Claude AI usage limit reached|1760000000" }), code: 1 });
  process.env.KRONOS_CLAUDE_PATH = g.file;
  assert.equal(await kindOf(claudeChat(ask, [], { model: "sonnet" })), "rate-limit-or-plan");
  const h = makeFake("claude", { stdout: "", stderr: "warming up\nreal problem here\n", code: 2 });
  process.env.KRONOS_CLAUDE_PATH = h.file;
  await assert.rejects(claudeChat(ask, [], { model: "sonnet" }), (e: AiError) => e.kind === "failed" && /real problem here/.test(e.message) && !/warming up/.test(e.message));
  const old = makeFake("claude", { stdout: "", stderr: "error: unknown option '--json-schema'\n", code: 1 });
  process.env.KRONOS_CLAUDE_PATH = old.file;
  await assert.rejects(claudeChat(ask, [], { model: "sonnet" }), /claude update/);
});

test("a run that does not answer in time is killed and reported as a timeout", async () => {
  const f = makeFake("claude", { hang: true });
  process.env.KRONOS_CLAUDE_PATH = f.file;
  const t0 = Date.now();
  assert.equal(await kindOf(claudeChat(ask, [], { model: "sonnet", timeoutMs: 700 })), "timeout");
  assert.ok(Date.now() - t0 < 10_000);
});

test("cancelling stops the run", async () => {
  const f = makeFake("claude", { hang: true });
  process.env.KRONOS_CLAUDE_PATH = f.file;
  const p = claudeChat(ask, [], { model: "sonnet" });
  await new Promise((r) => setTimeout(r, 1200));
  cancelCli();
  await assert.rejects(p, /cancelled/);
});

test("malformed output is a bad-output error, never a crash", async () => {
  const cases: Record<string, unknown> = {
    "not json": { stdout: "hello" },
    "empty": { stdout: "" },
    "wrong shape": { stdout: JSON.stringify({ is_error: false, result: "x", structured_output: { text: 1 } }) },
    "plain text answer": { stdout: JSON.stringify({ is_error: false, result: "just words" }) },
    "invalid utf-8": { rawHex: "7b22ff22" },
    "too big": { big: true },
  };
  for (const [name, mode] of Object.entries(cases)) {
    const f = makeFake("claude", mode as Record<string, unknown>);
    process.env.KRONOS_CLAUDE_PATH = f.file;
    assert.equal(await kindOf(claudeChat(ask, [], { model: "sonnet" })), "bad-output", name);
  }
});

test("without a structured answer, JSON text in the result (even fenced) still parses", () => {
  const body = JSON.stringify({ is_error: false, result: '```json\n{"text":"hi","tool_calls":[]}\n```' });
  assert.equal(parseClaudeRun(0, body, "", 0).content, "hi");
});

test("the messages and tools are checked like the Codex path checks them", async () => {
  process.env.KRONOS_CLAUDE_PATH = makeFake("claude", { stdout: "{}" }).file;
  await assert.rejects(claudeChat([], [], { model: "sonnet" }), /chat messages/);
  await assert.rejects(claudeChat(ask, new Array(21).fill({}), { model: "sonnet" }), /tools/);
});
