import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { chipOf } from "../../core/ai/connect.ts";
import { DEFAULT_SETTINGS } from "../../core/settings.ts";
import { chatVia, providerStatus, testProvider } from "./ai-connect.ts";
import { claudeNotLoggedIn, claudeOk, makeFake } from "./fake-cli.ts";

const SAVED = { ...process.env };
beforeEach(() => {
  process.env.KRONOS_E2E = "1";
  delete process.env.AUTOROUTER_KEY;
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
});
const S = DEFAULT_SETTINGS;
const claude = (mode: Record<string, unknown>) => {
  const f = makeFake("claude", mode);
  process.env.KRONOS_CLAUDE_PATH = f.file;
  return f;
};

test("claude status: ready, signed out, an old tool that cannot say, and not installed", async () => {
  claude({ auth: '{"loggedIn":true,"authMethod":"claude.ai","email":"someone@example.com","orgId":"o"}' });
  const ready = await providerStatus("claude", S);
  assert.deepEqual([ready.installed, ready.signedIn, ready.version], [true, true, "2.1.326"]);
  assert.equal(chipOf(ready), "ready");
  assert.ok(!JSON.stringify(ready).includes("someone@example.com"), "no account detail is kept");

  claude({ auth: '{"loggedIn":false,"authMethod":"none"}', authCode: 1 });
  assert.equal(chipOf(await providerStatus("claude", S)), "not-signed-in");

  claude({ authStderr: "error: unknown command 'auth'\n", authCode: 1 });
  const old = await providerStatus("claude", S);
  assert.equal(old.signedIn, "unknown");
  assert.match(old.detail, /Test connection/);

  claude({ version: "garbled" });
  assert.equal((await providerStatus("claude", S)).signedIn, "unknown");

  process.env.KRONOS_CLAUDE_PATH = "/no/such/claude.mjs";
  assert.equal(chipOf(await providerStatus("claude", S)), "not-installed");
});

test("codex status reads the login line from either stream", async () => {
  const f = makeFake("codex", { loggedIn: true });
  process.env.KRONOS_CODEX_PATH = f.file;
  const ok = await providerStatus("cloud", S);
  assert.deepEqual([ok.installed, ok.signedIn, ok.version], [true, true, "0.169.0"]);
  process.env.KRONOS_CODEX_PATH = makeFake("codex", { loggedIn: false }).file;
  assert.equal(chipOf(await providerStatus("cloud", S)), "not-signed-in");
  process.env.KRONOS_CODEX_PATH = "/no/such/codex.mjs";
  assert.equal(chipOf(await providerStatus("cloud", S)), "not-installed");
});

test("local status: no key, a router that accepts the key, one that refuses it, and one that is not there", async () => {
  assert.equal(chipOf(await providerStatus("local", S)), "not-installed");
  process.env.AUTOROUTER_KEY = "secret-router-key";
  let seen = "";
  let code = 200;
  const srv = http.createServer((req, res) => {
    seen = String(req.headers["x-q2-proxy-key"]);
    res.statusCode = code;
    res.end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  const s = { ...S, aiBaseUrl: `http://127.0.0.1:${port}/v1` };
  const ok = await providerStatus("local", s);
  assert.equal(chipOf(ok), "ready");
  assert.equal(seen, "secret-router-key");
  assert.ok(!JSON.stringify(ok).includes("secret-router-key"));
  code = 403;
  assert.equal(chipOf(await providerStatus("local", s)), "not-signed-in");
  srv.close();
  const gone = await providerStatus("local", s);
  assert.equal(gone.signedIn, "unknown");
  assert.equal(chipOf(await providerStatus("local", { ...S, aiBaseUrl: "http://example.com/v1" })), "not-signed-in", "the key is never sent off the local network");
});

test("Test connection reports the latency, or the typed failure", async () => {
  claude({ stdout: claudeOk({ text: "OK", tool_calls: [] }) });
  const ok = await testProvider("claude", S);
  assert.ok(ok.ok && ok.ms >= 0);
  claude({ stdout: claudeNotLoggedIn, code: 1 });
  const bad = await testProvider("claude", S);
  assert.ok(!bad.ok && bad.kind === "not-signed-in" && /not signed in/.test(bad.message));
  process.env.KRONOS_CLAUDE_PATH = "/no/such/claude.mjs";
  const none = await testProvider("claude", S);
  assert.ok(!none.ok && none.kind === "not-installed");
  const c = makeFake("codex", { loggedIn: true });
  process.env.KRONOS_CODEX_PATH = c.file;
  assert.ok((await testProvider("cloud", S)).ok);
  assert.ok(c.capture().argv.includes("--ephemeral"));
});

test("chatVia sends the Claude route to the Claude tool with the model from the settings, and marks a typed failure for the window", async () => {
  const f = claude({ stdout: claudeOk({ text: "hi", tool_calls: [] }) });
  const r = await chatVia({ provider: "claude" }, [{ role: "user", content: "q" }], [], { ...S, aiClaudeModel: "haiku" });
  assert.equal(r.content, "hi");
  assert.ok(f.capture().argv.join(" ").includes("--model haiku"));
  process.env.KRONOS_CLAUDE_PATH = "/no/such/claude.mjs";
  await assert.rejects(chatVia({ provider: "claude" }, [{ role: "user", content: "q" }], [], S), /\[ai:not-installed\]/);
  process.env.KRONOS_CODEX_PATH = makeFake("codex", { loggedIn: false }).file;
  await assert.rejects(chatVia(undefined, [{ role: "user", content: "q" }], [], S), /\[ai:not-signed-in\]/);
});
