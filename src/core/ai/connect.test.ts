import assert from "node:assert/strict";
import { test } from "node:test";
import { CARDS, chipOf, classifyFailure, encodeAiError, friendlyError, parseAiError, parseClaudeAuth, parseCodexLogin, parseVersion, PROVIDER_IDS } from "./connect.ts";

test("the chip follows what the status can and cannot know", () => {
  assert.equal(chipOf(null), "not-checked");
  assert.equal(chipOf({ installed: false, signedIn: false, detail: "" }), "not-installed");
  assert.equal(chipOf({ installed: true, signedIn: false, detail: "" }), "not-signed-in");
  assert.equal(chipOf({ installed: true, signedIn: "unknown", detail: "" }), "unknown");
  assert.equal(chipOf({ installed: true, signedIn: true, detail: "" }), "ready");
});

test("a typed error survives the IPC prefix and anything around it", () => {
  const wire = `Error invoking remote method 'kronos:ai-chat': Error: ${encodeAiError("not-signed-in", "sign in please")}`;
  assert.deepEqual(parseAiError(wire), { kind: "not-signed-in", message: "sign in please" });
  assert.equal(parseAiError("plain failure"), null);
  assert.equal(parseAiError("[ai:made-up] x"), null);
});

test("every kind has friendly words that name the provider", () => {
  for (const p of PROVIDER_IDS) for (const k of ["not-installed", "not-signed-in", "rate-limit-or-plan", "timeout", "bad-output", "failed"] as const) assert.match(friendlyError(p, k, "x"), /[A-Za-z]/);
  assert.match(friendlyError("claude", "not-signed-in"), /Claude Code/);
  assert.match(friendlyError("cloud", "failed", "boom"), /Codex failed: boom/);
});

test("account problems are told apart from program problems", () => {
  assert.equal(classifyFailure("Not logged in · Please run /login"), "not-signed-in");
  assert.equal(classifyFailure("Claude AI usage limit reached|1760000000"), "rate-limit-or-plan");
  assert.equal(classifyFailure("429 Too Many Requests"), "rate-limit-or-plan");
  assert.equal(classifyFailure("segmentation fault"), null);
});

test("claude auth status: only the flag and a plain method name are read", () => {
  assert.deepEqual(parseClaudeAuth('{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","orgId":"x"}'), { signedIn: true, method: "claude.ai" });
  assert.deepEqual(parseClaudeAuth('{"loggedIn":false,"authMethod":"none"}'), { signedIn: false, method: "none" });
  assert.deepEqual(parseClaudeAuth('{"loggedIn":true,"authMethod":"a b\\nc"}'), { signedIn: true });
  for (const bad of ["", "not json", "{}", '{"loggedIn":"yes"}', "error: unknown command 'auth'"]) assert.deepEqual(parseClaudeAuth(bad), { signedIn: "unknown" }, bad);
});

test("codex login status text and versions", () => {
  assert.equal(parseCodexLogin("Logged in using ChatGPT"), true);
  assert.equal(parseCodexLogin("WARNING: x\nNot logged in"), false);
  assert.equal(parseCodexLogin("something else"), "unknown");
  assert.equal(parseVersion("2.1.326 (Claude Code)"), "2.1.326");
  assert.equal(parseVersion("codex-cli 0.169.0"), "0.169.0");
  assert.equal(parseVersion("nope"), undefined);
});

test("each card is honest about plan limits and the sign-in", () => {
  for (const p of ["claude", "cloud"] as const) {
    assert.match(CARDS[p].what, /usage limits/);
    assert.match(CARDS[p].what, /never sees your password/);
    assert.ok(CARDS[p].steps.flatMap((s) => s.commands ?? []).length >= 2);
    assert.ok(CARDS[p].docs.every((d) => d.url.startsWith("https://")));
  }
  assert.match(CARDS.local.what, /AUTOROUTER_KEY/);
});
