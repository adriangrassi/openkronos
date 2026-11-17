// The AI connection screen's side of the main process: which providers are usable (status), one tiny real call (test), and the one place a provider is chosen for a chat turn.
// No key or token passes through here: the status commands print the sign-in state, and of that only a yes or no is read.
import http from "node:http";
import https from "node:https";
import type { ChatReply } from "../../core/ai/agent.ts";
import { classifyFailure, encodeAiError, friendlyError, parseAiError, parseClaudeAuth, parseCodexLogin, parseVersion, type AiErrorKind, type ProviderId, type ProviderStatus, type TestResult } from "../../core/ai/connect.ts";
import type { Settings } from "../../core/settings.ts";
import { aiChat } from "./ai.ts";
import { AiError, claudeChat } from "./ai-claude.ts";
import { capture, cliEnv, resolveCli, type CliName } from "./ai-cli.ts";
import { isLocalHost, localReady, routeChat } from "./ai-local.ts";

const STATUS_MS = 15_000;
const TEST_MS = 20_000;

// A provider failure becomes an Error whose message carries its kind, so the AI window can tell "not set up" from "the model said something odd".
function wire(provider: ProviderId, e: unknown): Error {
  if (e instanceof AiError) return new Error(encodeAiError(e.kind, e.message));
  const m = e instanceof Error ? e.message : String(e);
  if (provider === "cloud") {
    if (/not installed/i.test(m)) return new Error(encodeAiError("not-installed", friendlyError("cloud", "not-installed")));
    if (/did not answer within/i.test(m)) return new Error(encodeAiError("timeout", friendlyError("cloud", "timeout")));
    const why: AiErrorKind | null = classifyFailure(m);
    if (why) return new Error(encodeAiError(why, friendlyError("cloud", why)));
  }
  return e instanceof Error ? e : new Error(m);
}

const providerOf = (route: unknown): ProviderId => {
  const p = typeof route === "object" && route !== null ? (route as { provider?: unknown }).provider : undefined;
  return p === "claude" || p === "local" ? p : "cloud";
};

// The one place the provider is chosen: Claude here, the local router or Codex through routeChat exactly as before.
export async function chatVia(route: unknown, messages: unknown, tools: unknown, s: Settings, timeoutMs?: number): Promise<ChatReply> {
  const provider = providerOf(route);
  try {
    if (provider === "claude") return await claudeChat(messages, tools, { model: s.aiClaudeModel, timeoutMs });
    return await routeChat(route, messages, tools, { baseUrl: s.aiBaseUrl, defaultModel: s.aiModel, cloud: (m, t) => aiChat(m, t, timeoutMs) });
  } catch (e) {
    throw wire(provider, e);
  }
}

// Two quick commands per tool: the version (is it there and does it start) and the sign-in state (can it be known without a real call).
async function cliStatus(name: CliName, id: ProviderId, loginArgs: string[], read: (out: string, err: string) => { signedIn: boolean | "unknown"; detail: string }): Promise<ProviderStatus> {
  const label = id === "claude" ? "Claude Code" : "Codex";
  const cli = resolveCli(name);
  if (!cli) return { installed: false, signedIn: false, detail: `${label} was not found on this computer.` };
  const env = cliEnv(name, cli);
  const v = await capture(cli, ["--version"], { timeoutMs: STATUS_MS, env });
  if (v.missing) return { installed: false, signedIn: false, detail: `${label} was not found on this computer.` };
  const version = parseVersion(v.out.toString("utf8"));
  if (!version) return { installed: true, signedIn: "unknown", detail: `${label} was found but did not report a version. Try updating it.` };
  const a = await capture(cli, loginArgs, { timeoutMs: STATUS_MS, env });
  const r = read(a.out.toString("utf8"), a.err);
  return { installed: true, signedIn: r.signedIn, version, detail: r.detail };
}

// GET the models list with the router key: a reachable router that accepts the key is ready, a refusal is a key problem, silence is "not known". The key goes to a local or tailnet host only.
function routerStatus(s: Settings): Promise<ProviderStatus> {
  if (!localReady()) return Promise.resolve({ installed: false, signedIn: false, detail: "AUTOROUTER_KEY is not set in the environment OpenKronos was started from." });
  if (process.env.KRONOS_E2E === "1" && process.env.KRONOS_E2E_AI_SCRIPT_LOCAL) return Promise.resolve({ installed: true, signedIn: true, detail: "A scripted test model is answering." });
  const key = process.env.AUTOROUTER_KEY ?? "";
  const url = new URL(`${s.aiBaseUrl.replace(/\/+$/, "")}/models`);
  if (!isLocalHost(url.hostname)) return Promise.resolve({ installed: true, signedIn: false, detail: "The router address must be this computer or a machine on your network." });
  return new Promise((resolve) => {
    const req = (url.protocol === "https:" ? https : http).get(url, { headers: { "X-Q2-Proxy-Key": key, "x-autorouter-forward-key": "1" }, timeout: 5000 }, (res) => {
      res.resume();
      const c = res.statusCode ?? 0;
      resolve(c >= 200 && c < 300 ? { installed: true, signedIn: true, detail: `Reachable at ${url.host}.` } : c === 401 || c === 403 ? { installed: true, signedIn: false, detail: "The router refused the key in AUTOROUTER_KEY." } : { installed: true, signedIn: "unknown", detail: `The router answered HTTP ${c}.` });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ installed: true, signedIn: "unknown", detail: `Nothing answered at ${url.host}.` }));
  });
}

export function providerStatus(id: ProviderId, s: Settings): Promise<ProviderStatus> {
  if (id === "local") return routerStatus(s);
  if (id === "claude") {
    return cliStatus("claude", "claude", ["auth", "status"], (out) => {
      const r = parseClaudeAuth(out.trim());
      return r.signedIn === true ? { signedIn: true, detail: r.method === "claude.ai" || r.method === undefined ? "Signed in with a Claude account." : `Signed in (${r.method}); billing follows that method.` }
        : r.signedIn === false ? { signedIn: false, detail: "Not signed in. Sign in once in a terminal." }
        : { signedIn: "unknown", detail: "This version cannot report its sign-in. Use Test connection, or run claude update." };
    });
  }
  return cliStatus("codex", "cloud", ["login", "status"], (out, err) => {
    const r = parseCodexLogin(`${out}\n${err}`);
    return r === true ? { signedIn: true, detail: "Signed in." } : r === false ? { signedIn: false, detail: "Not signed in. Sign in once in a terminal." } : { signedIn: "unknown", detail: "This version cannot report its sign-in. Use Test connection." };
  });
}

// One tiny real call: a few tokens of your plan, at most 20 seconds.
export async function testProvider(id: ProviderId, s: Settings): Promise<TestResult> {
  const t0 = Date.now();
  try {
    await chatVia({ provider: id }, [{ role: "user", content: "Reply with OK" }], [], s, TEST_MS);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const typed = parseAiError(m);
    return { ok: false, kind: typed?.kind ?? "failed", message: typed?.message ?? m.slice(0, 300) };
  }
}
