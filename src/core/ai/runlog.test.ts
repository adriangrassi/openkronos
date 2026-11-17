import { test } from "node:test";
import assert from "node:assert/strict";
import { runLine, transcriptOf } from "./runlog.ts";

const run = { type: "run", id: "r1", time: "2026-11-09T00:00:00Z", kind: "build", provider: "local", model: "spark/auto:code:low:proxy", prompt: "warm pad", seconds: 12.5, steps: 3, tokens: { input: 10, cached: 2, output: 5, total: 15 }, status: "done", slots: [{ key: "program:INT-A", index: 3 }], candidate: "B",
  transcript: [{ role: "user", content: "warm pad" }, { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "copy_sound", arguments: { name: "Pad" } }] }, { role: "tool", toolCallId: "c1", content: "x".repeat(9000) }] };

test("a run row keeps the fields and cuts long tool results", () => {
  const o = JSON.parse(runLine(run));
  assert.equal(o.provider, "local");
  assert.equal(o.candidate, "B");
  assert.equal(o.transcript[1].toolCalls[0].name, "copy_sound");
  assert.equal(o.transcript[2].content.length, 4000);
  assert.deepEqual(o.tokens, { input: 10, cached: 2, output: 5, total: 15 });
});

test("only known fields are written, so a key can not ride along", () => {
  const line = runLine({ ...run, AUTOROUTER_KEY: "sekret", headers: { "X-Q2-Proxy-Key": "sekret" } });
  assert.equal(line.includes("sekret"), false);
});

test("decision rows validate and bad rows throw", () => {
  assert.deepEqual(JSON.parse(runLine({ type: "decision", id: "r1", time: "t", decision: "keep", candidate: "A" })), { type: "decision", id: "r1", time: "t", decision: "keep", candidate: "A" });
  assert.throws(() => runLine({ type: "decision", id: "r1", time: "t", decision: "maybe" }));
  assert.equal(JSON.parse(runLine({ type: "decision", id: "r1", time: "t", decision: "keep", destination: "new-program", destinationNote: "n" })).destination, "new-program");
  assert.throws(() => runLine({ ...run, provider: "x" }));
  assert.throws(() => runLine(null));
});

test("the transcript leaves out the system prompt", () => {
  assert.deepEqual(transcriptOf([{ role: "system", content: "s" }, { role: "user", content: "u" }]), [{ role: "user", content: "u" }]);
});
