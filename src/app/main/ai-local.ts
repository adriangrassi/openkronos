// The local-router provider for the AI panel: OpenAI chat completions over node:http, which ignores HTTP(S)_PROXY.
// Main process only. AUTOROUTER_KEY is read here, goes into one request header, and is never stored, logged or sent to the renderer.
import http from "node:http";
import https from "node:https";
import { compactForModel, type ChatReply, type ToolDef } from "../../core/ai/agent.ts";
import { fromOpenAI, toOpenAI } from "../../core/ai/openai.ts";
import { isModelId } from "../../core/settings.ts";
import { checkMessages, checkTools, scriptedTurn } from "./ai.ts";

const TIMEOUT_MS = 120_000;
const MAX_REPLY = 8_000_000;
const E2E = process.env.KRONOS_E2E === "1";
const inflight = new Set<AbortController>();

// The renderer only learns whether the key exists. E2E runs use a scripted local model instead of the router.
// The router key goes into a header, so only loopback, LAN and tailnet hosts are allowed.
export const isLocalHost = (h: string): boolean => h === "localhost" || h === "[::1]" || h.endsWith(".ts.net") || (/^\d+(\.\d+){3}$/.test(h) && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h));
export const localReady = (): boolean => !!process.env.AUTOROUTER_KEY || (E2E && !!process.env.KRONOS_E2E_AI_SCRIPT_LOCAL);

export function cancelLocal(): void {
  for (const c of inflight) c.abort();
}

function post(url: URL, headers: Record<string, string>, body: string, signal: AbortSignal, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method: "POST", signal, headers: { ...headers, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_REPLY) req.destroy(new Error("the router reply is too large"));
        else chunks.push(c);
      });
      res.on("end", () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
      });
      res.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    const timer = setTimeout(() => req.destroy(new Error(`the model did not answer within ${timeoutMs / 1000} seconds`)), timeoutMs);
    req.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.name === "AbortError") reject(new Error("cancelled"));
      else reject(e.code === "ECONNREFUSED" ? new Error(`the local router is not reachable at ${url.host}`) : e);
    });
    req.end(body);
  });
}

// One model turn through the router. Throws with a readable message that never contains the key.
export async function localChat(messages: unknown, tools: unknown, route: { baseUrl: string; model: string }, timeoutMs = TIMEOUT_MS): Promise<ChatReply> {
  const msgs = checkMessages(messages);
  const defs: ToolDef[] = checkTools(tools);
  if (E2E && process.env.KRONOS_E2E_AI_SCRIPT_LOCAL) return scriptedTurn(msgs, process.env.KRONOS_E2E_AI_SCRIPT_LOCAL);
  const key = process.env.AUTOROUTER_KEY;
  if (!key) throw new Error("AUTOROUTER_KEY is not set");
  if (!isModelId(route.model)) throw new Error("bad model id");
  const url = new URL(`${route.baseUrl.replace(/\/+$/, "")}/chat/completions`);
  if (!isLocalHost(url.hostname)) throw new Error("the router key is only sent to this PC or the local network");
  const body = JSON.stringify({ model: route.model, ...toOpenAI(compactForModel(msgs), defs), max_tokens: 4096, temperature: 0.2 });
  const ac = new AbortController();
  inflight.add(ac);
  try {
    const { status, text } = await post(url, { "X-Q2-Proxy-Key": key, "x-autorouter-forward-key": "1" }, body, ac.signal, timeoutMs);
    if (status < 200 || status >= 300) throw new Error(`the router answered HTTP ${status}: ${text.split(key).join("***").slice(0, 200)}`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("the router reply was not JSON");
    }
    return fromOpenAI(json, msgs.filter((m) => m.role === "assistant").length);
  } finally {
    inflight.delete(ac);
  }
}

// The one place the provider is chosen: anything but an explicit local route goes to the cloud function with the same arguments as before.
export function routeChat(
  route: unknown,
  messages: unknown,
  tools: unknown,
  o: { baseUrl: string; defaultModel: string; cloud: (m: unknown, t: unknown) => Promise<ChatReply> },
): Promise<ChatReply> {
  const r = typeof route === "object" && route !== null ? (route as { provider?: unknown; model?: unknown }) : {};
  if (r.provider !== "local") return o.cloud(messages, tools);
  return localChat(messages, tools, { baseUrl: o.baseUrl, model: typeof r.model === "string" && r.model !== "" ? r.model : o.defaultModel });
}
