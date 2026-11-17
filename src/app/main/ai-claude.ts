// The Claude provider for the AI panel: one chat turn through the user's own Claude Code command line (`claude -p`), on their own Claude login.
// Main process only. The app never reads, stores or logs the login: it starts the tool, writes the prompt to its stdin and reads its JSON answer.
// The panel's tool loop is the same as for Codex: the model returns the next turn as {text, tool_calls} (the --json-schema below), the app runs the tools.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactForModel, type ChatReply } from "../../core/ai/agent.ts";
import { classifyFailure, friendlyError, type AiErrorKind } from "../../core/ai/connect.ts";
import { parseClaudeUsage } from "../../core/ai/usage.ts";
import { CLAUDE_MODELS } from "../../core/settings.ts";
import { checkMessages, checkTools, parseTurn, promptFor, TURN_SCHEMA } from "./ai.ts";
import { capture, cliEnv, resolveCli } from "./ai-cli.ts";

const TIMEOUT_MS = 120_000;
const MAX_PROMPT = 4_000_000;
const SYSTEM = "You are the model in a tool loop run by an application. The application runs the tools; you only return the next turn in the required structure.";

export class AiError extends Error {
  kind: AiErrorKind;
  constructor(kind: AiErrorKind, detail = "") {
    super(friendlyError("claude", kind, detail));
    this.kind = kind;
  }
}

// Verified against claude 2.1.326: --tools "" turns every built-in tool off, --setting-sources "" and --strict-mcp-config keep the user's hooks, settings and MCP servers out,
// --no-session-persistence writes nothing to disk. --max-turns is 4, not 1: --json-schema returns its answer through a hidden structured-output step that needs a second turn.
export const claudeArgs = (model: string): string[] => [
  "-p", "--output-format", "json", "--model", model, "--tools", "", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "", "--max-turns", "4",
  "--system-prompt", SYSTEM, "--json-schema", JSON.stringify(TURN_SCHEMA),
];

// The shape of a real run: { type:"result", is_error, result, structured_output, usage:{input_tokens, cache_*_input_tokens, output_tokens}, total_cost_usd, terminal_reason }.
// A signed-out tool exits 1 with is_error true and result "Not logged in · Please run /login".
export function parseClaudeRun(code: number | null, stdout: string, stderr: string, turn: number): ChatReply {
  let j: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(stdout);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) j = v as Record<string, unknown>;
  } catch {
    j = null;
  }
  const text = typeof j?.result === "string" ? j.result : "";
  if (j?.is_error === true || (code !== 0 && code !== null)) {
    const why = classifyFailure(`${text}\n${stderr}`);
    if (why) throw new AiError(why);
    if (/unknown option|unrecognized|invalid option/i.test(stderr)) throw new AiError("failed", "this version of Claude Code is too old for OpenKronos; run claude update");
    throw new AiError("failed", (text || stderr).trim().split("\n").pop()?.slice(0, 200) || `exit code ${code}`);
  }
  if (!j) throw new AiError("bad-output");
  const so = j.structured_output;
  const raw = typeof so === "object" && so !== null ? JSON.stringify(so) : text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  let reply: ChatReply;
  try {
    reply = parseTurn(raw, turn);
  } catch {
    throw new AiError("bad-output");
  }
  const usage = parseClaudeUsage(j.usage);
  return usage ? { ...reply, usage } : reply;
}

// One model turn. Throws AiError (a typed failure with friendly words) or Error("cancelled").
export async function claudeChat(messages: unknown, tools: unknown, o: { model: string; timeoutMs?: number }): Promise<ChatReply> {
  const msgs = checkMessages(messages);
  const defs = checkTools(tools);
  const model = CLAUDE_MODELS.find((m) => m === o.model);
  if (!model) throw new Error("bad Claude model");
  const cli = resolveCli("claude");
  if (!cli) throw new AiError("not-installed");
  const prompt = promptFor(compactForModel(msgs), defs);
  if (prompt.length > MAX_PROMPT) throw new AiError("failed", "the conversation is too long to send");
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  const dir = mkdtempSync(path.join(os.tmpdir(), "kronos-claude-")); // an empty folder, so no project files or CLAUDE.md are picked up
  try {
    const c = await capture(cli, claudeArgs(model), { input: prompt, timeoutMs, cwd: dir, env: cliEnv("claude", cli) });
    if (c.cancelled) throw new Error("cancelled");
    if (c.missing) throw new AiError("not-installed");
    if (c.timedOut) throw new AiError("timeout");
    if (c.tooBig) throw new AiError("bad-output");
    let stdout: string;
    try {
      stdout = new TextDecoder("utf-8", { fatal: true }).decode(c.out);
    } catch {
      throw new AiError("bad-output");
    }
    return parseClaudeRun(c.code, stdout, c.err, msgs.filter((m) => m.role === "assistant").length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
