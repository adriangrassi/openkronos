import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulate, formatUsage, parseClaudeUsage, parseUsage, type Usage } from "./usage.ts";

// Trimmed from a real `codex exec --json` run (codex-cli 0.162.1): usage arrives only on turn.completed.
const SAMPLE = [
  '{"type":"thread.started","thread_id":"01a1bea1-f291-7371-9812-14990728245e"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}',
  '{"type":"turn.completed","usage":{"input_tokens":14431,"cached_input_tokens":5888,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
].join("\n");

test("parseUsage reads the turn.completed event of a real Codex run", () => {
  assert.deepEqual(parseUsage(SAMPLE), { input: 14431, cached: 5888, output: 5, total: 14436 });
});

test("parseUsage tolerates commas in the numbers and sums every turn", () => {
  const text = [
    '{"type":"turn.completed","usage":{"input_tokens":"14,431","cached_input_tokens":"5,888","output_tokens":"5"}}',
    '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":20}}',
  ].join("\n");
  assert.deepEqual(parseUsage(text), { input: 14531, cached: 5888, output: 25, total: 14556 });
});

test("parseUsage returns null when no usage is present, and skips lines that are not JSON", () => {
  assert.equal(parseUsage(""), null);
  assert.equal(parseUsage("ok\nnot json at all"), null);
  assert.equal(parseUsage('{"type":"item.completed","item":{"text":"ok"}}'), null);
  assert.equal(parseUsage('{"type":"turn.completed"}'), null);
});

test("accumulate adds each field", () => {
  const a: Usage = { input: 10, cached: 4, output: 2, total: 12 };
  assert.deepEqual(accumulate(a, { input: 1, cached: 1, output: 1, total: 2 }), { input: 11, cached: 5, output: 3, total: 14 });
});

test("formatUsage names the steps, the total and the cached count", () => {
  assert.equal(formatUsage({ input: 200000, cached: 41200, output: 1000, total: 258400 }, 12), "12 steps, 258,400 tokens (41,200 cached)");
  assert.equal(formatUsage({ input: 5, cached: 0, output: 5, total: 10 }, 1), "1 step, 10 tokens (0 cached)");
});

test("parseClaudeUsage reads the usage of a real claude -p run (2.1.326) and counts cache tokens as input", () => {
  const real = { input_tokens: 2, cache_creation_input_tokens: 719, cache_read_input_tokens: 0, output_tokens: 4, service_tier: "standard" };
  assert.deepEqual(parseClaudeUsage(real), { input: 721, cached: 0, output: 4, total: 725 });
  assert.deepEqual(parseClaudeUsage({ input_tokens: 3, cache_read_input_tokens: 4482, output_tokens: 50 }), { input: 4485, cached: 4482, output: 50, total: 4535 });
  for (const bad of [null, undefined, "x", [], {}, { input_tokens: "a", output_tokens: 1 }, { input_tokens: 1 }, { input_tokens: -1, output_tokens: 1 }]) assert.equal(parseClaudeUsage(bad), null, JSON.stringify(bad));
});
