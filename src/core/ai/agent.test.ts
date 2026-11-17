import { test } from "node:test";
import assert from "node:assert/strict";
import { answerStyle, askPrompt, PORTUGUESE_LINE, PORTUGUESE_PROMPT_LINE, systemFor, userPromptFor, compactForModel, ASK_SYSTEM, ASK_TURNS, DEFAULT_SYSTEM, REFINE_TURNS, runAgent, toOpenAiTools, type ChatFn, type ChatReply, type Message, type ToolCall } from "./agent.ts";
import { toolDefinitions, type SoundSession } from "./session.ts";

// Synthetic: the loop is tested with a stub session and tool names that never reach the library.
const stub = { touched: () => [] } as unknown as SoundSession;
const changed = { touched: () => [{}] } as unknown as SoundSession; // a run that has configured something
const call = (name: string, id: string): ToolCall => ({ id, name, arguments: {} });

function script(turns: ChatReply[]): { chat: ChatFn; seen: number } {
  let i = 0;
  const out = { seen: 0, chat: null as unknown as ChatFn };
  out.chat = async () => {
    out.seen++;
    if (i >= turns.length) throw new Error("script ran out");
    return turns[i++];
  };
  return out;
}

test("tool results go back to the model with their call ids, then the run ends", async () => {
  const s = script([{ content: "", toolCalls: [call("nope", "c1")] }, { content: "Done.", toolCalls: [] }]);
  const r = await runAgent({ session: changed, prompt: "go", chat: s.chat, maxTurns: 5 });
  assert.equal(r.status, "done");
  assert.equal(r.finalText, "Done.");
  assert.equal(s.seen, 2);
  const tool = r.messages.find((m) => m.role === "tool");
  assert.equal(tool?.toolCallId, "c1");
  assert.match(tool?.content ?? "", /unknown tool/);
});

test("the turn limit stops a model that keeps calling tools", async () => {
  const turns = Array.from({ length: 50 }, (_, n) => ({ content: "", toolCalls: [call("nope", `c${n}`)] }));
  const s = script(turns);
  const r = await runAgent({ session: stub, prompt: "go", chat: s.chat, maxTurns: 4 });
  assert.equal(r.status, "turn-limit");
  assert.equal(s.seen, 4);
});

test("a failing model is reported as an error", async () => {
  const r = await runAgent({ session: stub, prompt: "go", chat: async () => { throw new Error("router down"); }, maxTurns: 3 });
  assert.equal(r.status, "error");
  assert.equal(r.error, "router down");
});

test("a cancel stops the run before the next model call", async () => {
  const ac = new AbortController();
  const s = script([{ content: "", toolCalls: [call("nope", "c1")] }, { content: "x", toolCalls: [] }]);
  const chat: ChatFn = async (m, t) => {
    const reply = await s.chat(m, t);
    ac.abort();
    return reply;
  };
  const r = await runAgent({ session: stub, prompt: "go", chat, maxTurns: 5, signal: ac.signal });
  assert.equal(r.status, "cancelled");
  assert.equal(s.seen, 1);
});

test("the system prompt can be replaced", async () => {
  let first = "";
  const r = await runAgent({ session: stub, prompt: "go", system: "custom", maxTurns: 1, chat: async (m) => { first = m[0].content; return { content: "", toolCalls: [] }; } });
  assert.equal(r.status, "done");
  assert.equal(first, "custom");
});

test("tool definitions convert to the OpenAI function shape", () => {
  const t = toOpenAiTools(toolDefinitions());
  assert.equal(t.length, 11);
  for (const x of t) {
    assert.equal(x.type, "function");
    assert.ok(x.function.name);
    assert.equal(x.function.parameters.type, "object");
  }
});

test("a run that only looked things up is told to do the work, at most twice", async () => {
  const s = script([{ content: "", toolCalls: [call("nope", "c1")] }, { content: "It exists.", toolCalls: [] }, { content: "Still.", toolCalls: [] }, { content: "Giving up.", toolCalls: [] }]);
  const r = await runAgent({ session: stub, prompt: "go", chat: s.chat, maxTurns: 9 });
  assert.equal(r.status, "done");
  assert.equal(r.finalText, "Giving up.");
  assert.equal(s.seen, 4);
  assert.equal(r.messages.filter((m) => m.role === "user" && /not configured/.test(m.content)).length, 2);
});

test("a model that answers without using any tool is not pushed", async () => {
  const s = script([{ content: "Which sound?", toolCalls: [] }]);
  const r = await runAgent({ session: stub, prompt: "go", chat: s.chat, maxTurns: 9 });
  assert.equal(r.finalText, "Which sound?");
  assert.equal(s.seen, 1);
});

test("compactForModel removes only long tool results before the second-to-last assistant turn", () => {
  const long = "x".repeat(401);
  const msgs: Message[] = [
    { role: "system", content: "s" },
    { role: "user", content: "u" },
    { role: "assistant", content: "a1", toolCalls: [call("describe_sound", "c1")] },
    { role: "tool", toolCallId: "c1", content: long },
    { role: "tool", toolCallId: "c1b", content: '{"slot":12}' },
    { role: "assistant", content: "a2", toolCalls: [call("set_params", "c2")] },
    { role: "tool", toolCallId: "c2", content: long },
    { role: "assistant", content: "a3", toolCalls: [call("describe_sound", "c3")] },
    { role: "tool", toolCallId: "c3", content: long },
  ];
  const out = compactForModel(msgs);
  const removed = '{"removed":"Older result removed to save space. Call the tool again if you still need it."}';
  assert.equal(out[3].content, removed);
  assert.equal(out[4].content, '{"slot":12}');
  assert.equal(out[6].content, long);
  assert.equal(out[8].content, long);
  assert.equal(out.length, msgs.length);
});

test("compactForModel does not mutate its input", () => {
  const long = "y".repeat(500);
  const msgs: Message[] = [
    { role: "user", content: "u" },
    { role: "assistant", content: "a1" },
    { role: "tool", toolCallId: "t", content: long },
    { role: "assistant", content: "a2" },
    { role: "tool", toolCallId: "t2", content: long },
    { role: "assistant", content: "a3" },
  ];
  const snapshot = structuredClone(msgs);
  const out = compactForModel(msgs);
  assert.notEqual(out, msgs);
  assert.deepEqual(msgs, snapshot);
  assert.notEqual(out[2].content, long);
  assert.notEqual(out[2], msgs[2]);
});

test("compactForModel returns the same content with fewer than two assistant turns", () => {
  const long = "z".repeat(900);
  const msgs: Message[] = [
    { role: "user", content: "u" },
    { role: "assistant", content: "a1" },
    { role: "tool", toolCallId: "t", content: long },
  ];
  assert.deepEqual(compactForModel(msgs), msgs);
  assert.deepEqual(compactForModel([{ role: "user", content: "u" }]), [{ role: "user", content: "u" }]);
});

test("usage from each step is summed, and the run reports its step count", async () => {
  const u = { input: 100, cached: 10, output: 5, total: 105 };
  const s = script([
    { content: "", toolCalls: [call("nope", "c1")], usage: u },
    { content: "", toolCalls: [call("nope", "c2")], usage: u },
    { content: "Done.", toolCalls: [], usage: u },
  ]);
  const r = await runAgent({ session: changed, prompt: "go", chat: s.chat, maxTurns: 5 });
  assert.equal(r.status, "done");
  assert.deepEqual(r.usage, { input: 300, cached: 30, output: 15, total: 315 });
  assert.equal(r.steps, 3);
});

test("a model that reports no usage still runs, and the run has no usage", async () => {
  const s = script([{ content: "", toolCalls: [call("nope", "c1")] }, { content: "Done.", toolCalls: [] }]);
  const r = await runAgent({ session: changed, prompt: "go", chat: s.chat, maxTurns: 5 });
  assert.equal(r.status, "done");
  assert.equal(r.usage, undefined);
  assert.equal(r.steps, 2);
});

test("the system prompt says to build the Combi early and to read a sound's groups in one call", () => {
  assert.match(DEFAULT_SYSTEM, /[Bb]uild the Combi early/);
  assert.match(DEFAULT_SYSTEM, /before (you )?tun(e|ing) any part/);
  assert.match(DEFAULT_SYSTEM, /ONE describe_sound call/);
  assert.match(DEFAULT_SYSTEM, /turn limit/);
});

test("the richness checklist is in the prompt and names only real Program groups", async () => {
  assert.match(DEFAULT_SYSTEM, /Richness checklist/);
  assert.match(DEFAULT_SYSTEM, /say what you added/);
  const { readFileSync } = await import("node:fs");
  const T = JSON.parse(readFileSync(new URL("../../generated/params.json", import.meta.url), "utf8"));
  const groups = new Set<string>([...T.programHd1, ...T.programExiCommon].map((r: { group: string }) => r.group));
  const block = DEFAULT_SYSTEM.split("Richness checklist")[1].split("\n\n")[0];
  const named = [...block.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  assert.ok(named.length >= 4);
  for (const n of named) assert.ok(groups.has(n), `${n} is not a Program group`);
});

test("a refine run is capped at 6 steps", () => {
  assert.equal(REFINE_TURNS, 6);
});

test("an ask run is capped at 5 steps and has its own short prompt", () => {
  assert.equal(ASK_TURNS, 5);
  assert.ok(ASK_SYSTEM.length > 100 && !DEFAULT_SYSTEM.includes(ASK_SYSTEM) && !DEFAULT_SYSTEM.includes("show_param"));
  assert.match(ASK_SYSTEM, /show_param/);
});

test("the Ask prompt tells the model to give each target a concrete suggest, in the order the owner should do them", () => {
  assert.match(ASK_SYSTEM, /suggest/);
  assert.match(ASK_SYSTEM, /order/);
});

test("the Ask prompt grounds the sound, never works on a blank Init sound when another is named, and plans layers", () => {
  assert.match(ASK_SYSTEM, /search_sounds/);
  assert.match(ASK_SYSTEM, /Init/);
  assert.match(ASK_SYSTEM, /propose_layer/);
  assert.match(ASK_SYSTEM, /combi/);
  assert.match(ASK_SYSTEM, /osc2/);
  assert.match(ASK_SYSTEM, /Never say the sound was changed/);
});

test("askPrompt names the open sound with bank, slot, engine and whether it is a blank Init sound", () => {
  const open = { key: "program:INT-F", index: 5, name: "Init EXi Program", kind: "program", engine: "AL-1", bank: "INT-F" };
  const p = askPrompt(open, "add string");
  assert.match(p, /INT-F 005 "Init EXi Program"/);
  assert.match(p, /program:INT-F 5/);
  assert.match(p, /engine AL-1/);
  assert.match(p, /blank Init sound/);
  assert.match(p, /Question: add string$/);
  assert.doesNotMatch(askPrompt({ ...open, name: "Berlin Grand" }, "x"), /blank/);
});

test("the build and refine prompt makes the AI check its own changes are audible", () => {
  for (const phrase of ["less than about 10%", "send level that feeds it", "old to new values"]) assert.ok(DEFAULT_SYSTEM.includes(phrase), phrase);
});

test("the prompt reads 'N repeats' as feedback and keeps delay times audible", () => {
  for (const phrase of ["means feedback sized so N echoes", "above about 250 ms", "say which one you chose"]) assert.ok(DEFAULT_SYSTEM.includes(phrase), phrase);
});

test("answerStyle: plain wording always, length and Portuguese lines on request", () => {
  const en = answerStyle("en", "normal");
  assert.match(en, /plain musical words/);
  assert.match(en, /never as raw numbers/);
  assert.doesNotMatch(en, /Portuguese|at most 2 short/);
  assert.match(answerStyle("en", "brief"), /at most 2 short sentences \(about 35 words\)/);
  assert.match(answerStyle("en", "detailed"), /typical settings and the common gotchas/);
  const pt = answerStyle("pt", "brief");
  assert.match(pt, /Brazilian Portuguese/);
  assert.match(pt, /C4, INT-A 000/);
  assert.match(pt, /at most 2 short sentences/);
  assert.ok(pt.startsWith("\n"));
});
