import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SYSTEM, runAgent, type Message, type ToolDef } from "./agent.ts";
import { ARGS_ERROR, fromOpenAI, toOpenAI } from "./openai.ts";
import { SoundSession, toolDefinitions } from "./session.ts";

const tools: ToolDef[] = [{ name: "search_sounds", description: "Find sounds", input_schema: { type: "object", properties: { text: { type: "string" } } } }];
const reply = (message: Record<string, unknown>, usage?: Record<string, unknown>) => ({ choices: [{ message }], ...(usage ? { usage } : {}) });
const callWith = (args: unknown, id = "c1") => ({ id, type: "function", function: { name: "search_sounds", arguments: args } });

test("toOpenAI maps messages, tool calls and tool results", () => {
  const msgs: Message[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "search_sounds", arguments: { text: "jump" } }] },
    { role: "tool", toolCallId: "c1", content: '{"ok":true}' },
    { role: "assistant", content: "done", toolCalls: [] },
  ];
  const r = toOpenAI(msgs, tools);
  assert.deepEqual(r.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_sounds", arguments: '{"text":"jump"}' } }] },
    { role: "tool", content: '{"ok":true}', tool_call_id: "c1" },
    { role: "assistant", content: "done" },
  ]);
  assert.deepEqual(r.tools, [{ type: "function", function: { name: "search_sounds", description: "Find sounds", parameters: tools[0].input_schema } }]);
  assert.equal("tools" in toOpenAI(msgs, []), false);
});

test("fromOpenAI reads text, tool calls and usage", () => {
  const r = fromOpenAI(reply({ content: "ok", tool_calls: [callWith('{"text":"jump"}')] }, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 64 } }));
  assert.deepEqual(r, { content: "ok", toolCalls: [{ id: "c1", name: "search_sounds", arguments: { text: "jump" } }], usage: { input: 100, cached: 64, output: 20, total: 120 } });
});

test("fromOpenAI tolerates null content, object arguments, missing ids and no usage", () => {
  const r = fromOpenAI(reply({ content: null, tool_calls: [callWith({ text: "a" }, ""), callWith(undefined, "")] }), 3);
  assert.equal(r.content, "");
  assert.deepEqual(r.toolCalls.map((c) => [c.id, c.arguments]), [["call_3_0", { text: "a" }], ["call_3_1", {}]]);
  assert.equal("usage" in r, false);
  assert.equal(fromOpenAI(reply({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).content, "ab");
});

test("malformed tool arguments get one repair attempt", () => {
  const fixed = (raw: string) => fromOpenAI(reply({ tool_calls: [callWith(raw)] })).toolCalls[0].arguments;
  assert.deepEqual(fixed('```json\n{"text":"jump"}\n```'), { text: "jump" });
  assert.deepEqual(fixed('{"text":"jump",}'), { text: "jump" });
  assert.deepEqual(fixed('{"text":"jump","x":[1,2'), { text: "jump", x: [1, 2] });
  assert.deepEqual(fixed('{"text":"ju'), { text: "ju" });
  assert.deepEqual(fixed('Sure! {"text":"jump"} hope that helps'), { text: "jump" });
});

test("arguments that cannot be repaired become an error the agent can see", () => {
  for (const raw of ["not json at all", "[1,2]", '{"text": }']) {
    const a = fromOpenAI(reply({ tool_calls: [callWith(raw)] })).toolCalls[0].arguments;
    assert.equal(typeof a[ARGS_ERROR], "string", raw);
    assert.match(String(a[ARGS_ERROR]), /valid JSON object/);
  }
});

test("a router error or an empty reply throws a readable message", () => {
  assert.throws(() => fromOpenAI({ error: { message: "model not found" } }), /model not found/);
  assert.throws(() => fromOpenAI({ choices: [] }), /no message/);
  assert.throws(() => fromOpenAI("x"), /not JSON/);
});

test("the agent loop answers an undecodable call with the error and never runs the tool", async () => {
  const f = { hits: 0 };
  const turns = [fromOpenAI(reply({ tool_calls: [callWith("garbage", "c1")] })), ...Array(3).fill({ content: "gave up", toolCalls: [] })]; // a run that touched nothing is nudged twice
  const seen: Message[][] = [];
  let i = 0;
  const session = new SoundSession({ effectTypes: [], valueLists: {}, programHd1: [], programExiCommon: [], combi: [], global: [], drumkit: [], waveseq: [], engines: {} } as never, { bytes: new Uint8Array(0) } as never);
  const r = await runAgent({ session, prompt: "x", maxTurns: 6, chat: async (m) => { seen.push(JSON.parse(JSON.stringify(m)) as Message[]); f.hits++; return turns[i++]; } });
  const tool = seen[1].find((m) => m.role === "tool");
  assert.match(tool?.content ?? "", /valid JSON object/);
  assert.equal(r.status, "done");
});

test("the system prompt stays small enough for a local model (about 3k tokens at 4 chars each)", () => {
  assert.ok(DEFAULT_SYSTEM.length < 12_000, `DEFAULT_SYSTEM is ${DEFAULT_SYSTEM.length} chars: add a trimmed LOCAL_SYSTEM`);
  assert.ok(toolDefinitions().length > 0);
});
