// The model provider for the AI panel: one chat turn through the Codex CLI, on the owner's ChatGPT login, so this app never holds a key.
// Runs in the main process only. No electron import, so the Jump baseline script can use it from plain node.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compactForModel, type ChatReply, type Message, type ToolDef } from "../../core/ai/agent.ts";
import { parseUsage } from "../../core/ai/usage.ts";
import { resolveCli, type Cli } from "./ai-cli.ts";

const TIMEOUT_MS = 120_000;
const ROLES = new Set(["system", "user", "assistant", "tool"]);
const E2E = process.env.KRONOS_E2E === "1";

export function checkMessages(v: unknown): Message[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 400) throw new Error("expected 1 to 400 chat messages");
  return v.map((m: Message) => {
    if (!m || typeof m !== "object" || !ROLES.has(m.role) || typeof m.content !== "string" || m.content.length > 200_000) {
      throw new Error("bad chat message");
    }
    return m;
  });
}

export function checkTools(v: unknown): ToolDef[] {
  if (!Array.isArray(v) || v.length > 20) throw new Error("expected up to 20 tools");
  return v as ToolDef[];
}

// Each turn of the scripted run is picked by how many assistant turns the conversation already has.
export function scriptedTurn(messages: Message[], script: string): ChatReply {
  const turns = JSON.parse(script) as ChatReply[];
  const n = messages.filter((m) => m.role === "assistant").length;
  return turns[n] ?? { content: "", toolCalls: [] };
}

export const TURN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "tool_calls"],
  properties: {
    text: { type: "string" },
    tool_calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "arguments_json"],
        properties: { name: { type: "string" }, arguments_json: { type: "string" } },
      },
    },
  },
};

export function promptFor(messages: Message[], tools: ToolDef[]): string {
  return [
    "You are the model in a tool loop run by an application. Do not run commands or read files: the application runs the tools.",
    'Read the conversation and return the next assistant turn. "text" is what to say. "tool_calls" are the tools to call next, each with its arguments as a JSON string in "arguments_json". When the work is finished, return an empty tool_calls list.',
    `TOOLS:\n${JSON.stringify(tools)}`,
    `CONVERSATION:\n${JSON.stringify(messages)}`,
  ].join("\n\n");
}

// Arguments that are not a JSON object become {}, so the tool reports the missing fields.
export function parseTurn(text: string, turn: number): ChatReply {
  const reply = JSON.parse(text) as { text?: unknown; tool_calls?: { name?: unknown; arguments_json?: unknown }[] };
  if (typeof reply.text !== "string" || !Array.isArray(reply.tool_calls)) throw new Error("the model's reply had the wrong shape");
  return {
    content: reply.text,
    toolCalls: reply.tool_calls.map((c, i) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(String(c.arguments_json));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
      return { id: `call_${turn}_${i}`, name: String(c.name), arguments: args };
    }),
  };
}

// Read-only in an empty folder: Codex only answers, and the panel validates and runs every tool itself.
// --json puts the usage on stdout (turn.completed); the reply itself still goes to the -o file.
function runCodex(prompt: string, dir: string, schema: string, out: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cli: Cli | null = resolveCli("codex");
    if (!cli) return reject(new Error("the Codex command-line tool is not installed"));
    const args = [...cli.pre, "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--json", "-C", dir, "--output-schema", schema, "-o", out, "-"];
    const child = spawn(cli.file, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...(cli.script ? { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } } : {}) });
    let events = "";
    child.stdout.on("data", (c: Buffer) => {
      events += c.toString("utf8");
    });
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stderr.on("data", (c: Buffer) => {
      err = (err + c.toString("utf8")).slice(-2000);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error("the Codex command-line tool is not installed") : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`the model did not answer within ${timeoutMs / 1000} seconds`));
      else if (code !== 0) reject(new Error(`Codex failed: ${err.trim().split("\n").pop()?.slice(0, 200) || `exit code ${code}`}`));
      else resolve(events);
    });
    child.stdin.on("error", () => {}); // Codex exiting early is reported by close
    child.stdin.end(prompt);
  });
}

// One model turn for the agent loop. Throws with a readable message.
export async function aiChat(messages: unknown, tools: unknown, timeoutMs = TIMEOUT_MS): Promise<ChatReply> {
  const msgs = checkMessages(messages);
  const defs = checkTools(tools);
  if (E2E && process.env.KRONOS_E2E_AI_SCRIPT) {
    await new Promise((r) => setTimeout(r, Number(process.env.KRONOS_E2E_AI_DELAY_MS) || 0)); // stands in for model latency so a scripted run lasts
    return scriptedTurn(msgs, process.env.KRONOS_E2E_AI_SCRIPT);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "kronos-ai-"));
  try {
    const schema = path.join(dir, "schema.json");
    const out = path.join(dir, "reply.json");
    writeFileSync(schema, JSON.stringify(TURN_SCHEMA));
    const events = await runCodex(promptFor(compactForModel(msgs), defs), dir, schema, out, timeoutMs);
    const reply = parseTurn(readFileSync(out, "utf8"), msgs.filter((m) => m.role === "assistant").length);
    const usage = parseUsage(events);
    return usage ? { ...reply, usage } : reply;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
