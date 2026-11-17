import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTurn, promptFor } from "./ai.ts";
import { compactForModel, type Message } from "../../core/ai/agent.ts";
import { toolDefinitions } from "../../core/ai/session.ts";

test("a reply becomes tool calls with unique ids", () => {
  const r = parseTurn('{"text":"ok","tool_calls":[{"name":"a","arguments_json":"{\\"x\\":1}"},{"name":"b","arguments_json":"{}"}]}', 3);
  assert.equal(r.content, "ok");
  assert.deepEqual(r.toolCalls.map((c) => [c.id, c.name, c.arguments]), [["call_3_0", "a", { x: 1 }], ["call_3_1", "b", {}]]);
});

test("arguments that are not a JSON object become empty", () => {
  for (const bad of ["nope", "[1]", "3"]) {
    assert.deepEqual(parseTurn(JSON.stringify({ text: "", tool_calls: [{ name: "a", arguments_json: bad }] }), 0).toolCalls[0].arguments, {});
  }
});

test("a reply of the wrong shape is an error", () => {
  assert.throws(() => parseTurn('{"text":1,"tool_calls":[]}', 0));
  assert.throws(() => parseTurn('{"text":""}', 0));
  assert.throws(() => parseTurn("not json", 0));
});

test("the prompt carries the tools and the conversation", () => {
  const p = promptFor([{ role: "user", content: "find brass" }], [{ name: "search_sounds", description: "d", parameters: {} }] as never);
  assert.match(p, /search_sounds/);
  assert.match(p, /find brass/);
});

test("compacting the history keeps the prompt under 37% of its uncompacted size over a long run", () => {
  const defs = toolDefinitions();
  const result = "r".repeat(3000);
  const msgs: Message[] = [{ role: "system", content: "sys" }, { role: "user", content: "make a bass" }];
  let plain = 0;
  let compact = 0;
  for (let turn = 0; turn < 12; turn++) {
    msgs.push({ role: "assistant", content: "working" });
    for (let k = 0; k < 9; k++) msgs.push({ role: "tool", toolCallId: `t${turn}_${k}`, content: result });
    plain += promptFor(msgs, defs).length;
    compact += promptFor(compactForModel(msgs), defs).length;
  }
  console.log(`prompt chars over 12 steps: uncompacted ${plain}, compacted ${compact} (${((100 * compact) / plain).toFixed(1)}%)`);
  assert.ok(compact < 0.37 * plain, `compacted ${compact} is not under 37% of ${plain}`);
});
