import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { compactForModel, type ChatReply, type Message } from "../../core/ai/agent.ts";
import { toolDefinitions } from "../../core/ai/session.ts";
import { promptFor } from "./ai.ts";
import { cancelLocal, isLocalHost, localChat, localReady, routeChat } from "./ai-local.ts";

const msgs: Message[] = [{ role: "system", content: "sys" }, { role: "user", content: "warm pad" }];
const CLOUD: ChatReply = { content: "cloud", toolCalls: [] };

// Serves one canned reply and records what it was sent. Loopback only: no model is involved.
async function server(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const seen: { headers: http.IncomingHttpHeaders; body: string; url: string }[] = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ headers: req.headers, body, url: req.url ?? "" });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { seen, baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`, close: () => { srv.closeAllConnections(); srv.close(); } };
}
const json = (res: http.ServerResponse, status: number, obj: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

test("golden: the cloud request is byte-identical whatever the provider setting is", () => {
  const p = promptFor(compactForModel(msgs), toolDefinitions());
  assert.equal(createHash("sha256").update(p).digest("hex"), GOLDEN);
});

test("the cloud route and a missing route call the cloud function with the same arguments, and never the router", async () => {
  process.env.AUTOROUTER_KEY = "test-key";
  const calls: unknown[][] = [];
  const cloud = async (m: unknown, t: unknown) => { calls.push([m, t]); return CLOUD; };
  const o = { baseUrl: "http://127.0.0.1:1/v1", defaultModel: "x", cloud };
  for (const route of [undefined, null, {}, { provider: "cloud", model: "ignored" }, { provider: "banana" }]) assert.equal(await routeChat(route, msgs, [], o), CLOUD);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c[0] === msgs));
});

test("the local route posts an OpenAI request with the router headers and reads the tool calls", async () => {
  process.env.AUTOROUTER_KEY = "test-key";
  const s = await server((_r, _b, res) => json(res, 200, { choices: [{ message: { content: "", tool_calls: [{ id: "a", type: "function", function: { name: "free_slots", arguments: "{}" } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
  try {
    const r = await localChat(msgs, toolDefinitions(), { baseUrl: `${s.baseUrl}/`, model: "spark/auto:code:low:proxy" });
    assert.deepEqual(r.toolCalls, [{ id: "a", name: "free_slots", arguments: {} }]);
    assert.equal(r.usage?.total, 7);
    const got = s.seen[0];
    assert.equal(got.url, "/v1/chat/completions");
    assert.equal(got.headers["x-q2-proxy-key"], "test-key");
    assert.equal(got.headers["x-autorouter-forward-key"], "1");
    const body = JSON.parse(got.body) as { model: string; messages: unknown[]; tools: unknown[] };
    assert.equal(body.model, "spark/auto:code:low:proxy");
    assert.equal(body.messages.length, 2);
    assert.equal(body.tools.length, toolDefinitions().length);
    assert.equal(got.body.includes("test-key"), false);
  } finally {
    s.close();
  }
});

test("a router error never repeats the key", async () => {
  process.env.AUTOROUTER_KEY = "test-key";
  const s = await server((_r, _b, res) => json(res, 401, { error: "bad key test-key" }));
  try {
    await assert.rejects(() => localChat(msgs, [], { baseUrl: s.baseUrl, model: "m" }), (e: Error) => /HTTP 401/.test(e.message) && !e.message.includes("test-key"));
  } finally {
    s.close();
  }
});

test("without AUTOROUTER_KEY the local option is not ready and a call is refused before any request", async () => {
  delete process.env.AUTOROUTER_KEY;
  assert.equal(localReady(), false);
  await assert.rejects(() => localChat(msgs, [], { baseUrl: "http://127.0.0.1:1/v1", model: "m" }), /AUTOROUTER_KEY is not set/);
  process.env.AUTOROUTER_KEY = "test-key";
  assert.equal(localReady(), true);
});

test("a request times out, and Cancel stops one in flight", async () => {
  process.env.AUTOROUTER_KEY = "test-key";
  const s = await server(() => {}); // never answers
  try {
    await assert.rejects(() => localChat(msgs, [], { baseUrl: s.baseUrl, model: "m" }, 80), /did not answer within/);
    const p = localChat(msgs, [], { baseUrl: s.baseUrl, model: "m" });
    setTimeout(cancelLocal, 50);
    await assert.rejects(() => p, /cancelled/);
  } finally {
    s.close();
  }
});

test("an unreachable router is reported by address", async () => {
  process.env.AUTOROUTER_KEY = "test-key";
  const s = await server(() => {});
  const base = s.baseUrl;
  s.close();
  await assert.rejects(() => localChat(msgs, [], { baseUrl: base, model: "m" }), /not reachable/);
});

test("scripted runs: with KRONOS_E2E the local route answers from KRONOS_E2E_AI_SCRIPT_LOCAL and makes no request", async () => {
  delete process.env.AUTOROUTER_KEY;
  process.env.KRONOS_E2E = "1";
  const script: ChatReply[] = [{ content: "", toolCalls: [{ id: "x", name: "free_slots", arguments: {} }] }, { content: "done", toolCalls: [] }];
  process.env.KRONOS_E2E_AI_SCRIPT_LOCAL = JSON.stringify(script);
  // E2E is read when the module loads, so load a fresh copy
  const fresh = (await import(new URL("./ai-local.ts?e2e", import.meta.url).href)) as typeof import("./ai-local.ts");
  try {
    assert.equal(fresh.localReady(), true);
    assert.deepEqual(await fresh.localChat(msgs, [], { baseUrl: "http://127.0.0.1:1/v1", model: "m" }), script[0]);
    const after: Message[] = [...msgs, { role: "assistant", content: "", toolCalls: script[0].toolCalls }];
    assert.deepEqual(await fresh.localChat(after, [], { baseUrl: "http://127.0.0.1:1/v1", model: "m" }), script[1]);
  } finally {
    delete process.env.KRONOS_E2E;
    delete process.env.KRONOS_E2E_AI_SCRIPT_LOCAL;
  }
});

const GOLDEN = "1054eb798b39e8ba0374b6d4601aa984d0141ddfc8845edcee53a2b5e98d3668";

test("the router key is only sent to local hosts", async () => {
  for (const h of ["127.0.0.1", "localhost", "192.168.1.20", "100.101.102.103", "10.0.0.5", "172.16.1.1", "box.example.ts.net"]) assert.equal(isLocalHost(h), true, h);
  for (const h of ["example.com", "8.8.8.8", "100.200.1.1", "172.32.0.1", "127.evil.com", "192.168.evil.com"]) assert.equal(isLocalHost(h), false, h);
  process.env.AUTOROUTER_KEY = "k";
  await assert.rejects(localChat(msgs, [], { baseUrl: "https://example.com/v1", model: "spark/auto:code:low:proxy" }), /only sent to this PC/);
});
