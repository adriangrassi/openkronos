// Maps the agent's Message/ToolDef/ChatReply types to and from OpenAI chat completions, for local routers. Pure: no Node or DOM imports.
import { toOpenAiTools, type ChatReply, type Message, type ToolCall, type ToolDef } from "./agent.ts";
import type { Usage } from "./usage.ts";

export type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};
export type OpenAiRequest = { messages: OpenAiMessage[]; tools?: ReturnType<typeof toOpenAiTools> };

// The reserved argument key that carries a decode failure to the agent loop, which answers the model with it.
export const ARGS_ERROR = "_argsError";

export function toOpenAI(messages: Message[], tools: ToolDef[]): OpenAiRequest {
  const out = messages.map((m): OpenAiMessage => {
    if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content === "" ? null : m.content,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
      };
    }
    return { role: m.role, content: m.content };
  });
  return tools.length > 0 ? { messages: out, tools: toOpenAiTools(tools) } : { messages: out };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

// One repair pass for what small models emit: code fences, text around the object, a trailing comma, a cut-off tail.
// shortcut: the trailing-comma regex does not skip string contents; upgrade if a model sends ",}" inside a value.
function repairJson(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < raw.length && end < 0; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) end = i + 1;
    }
  }
  let text = end > 0 ? raw.slice(start, end) : raw.slice(start) + (inStr ? '"' : "") + stack.reverse().join("");
  text = text.replace(/,\s*([}\]])/g, "$1");
  return text;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (isObj(raw)) return raw;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return {};
  const text = String(raw);
  let failure = "";
  try {
    const v: unknown = JSON.parse(text);
    if (isObj(v)) return v;
    failure = "the arguments were not a JSON object";
  } catch (e) {
    failure = e instanceof Error ? e.message : "invalid JSON";
    const fixed = repairJson(text);
    if (fixed !== null) {
      try {
        const v: unknown = JSON.parse(fixed);
        if (isObj(v)) return v;
      } catch {
        // falls through to the error the model sees
      }
    }
  }
  return { [ARGS_ERROR]: `The tool arguments could not be read (${failure.slice(0, 120)}). Call the tool again with the arguments as one valid JSON object.` };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

function usageOf(u: unknown): Usage | undefined {
  if (!isObj(u)) return undefined;
  const input = num(u.prompt_tokens);
  const output = num(u.completion_tokens);
  const total = num(u.total_tokens) || input + output;
  if (total === 0) return undefined;
  return { input, cached: num(isObj(u.prompt_tokens_details) ? u.prompt_tokens_details.cached_tokens : 0), output, total };
}

function textOf(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (isObj(p) && typeof p.text === "string" ? p.text : "")).join("");
  return "";
}

// turn numbers the ids a router left out.
export function fromOpenAI(body: unknown, turn = 0): ChatReply {
  if (!isObj(body)) throw new Error("the router reply was not JSON");
  if (body.error !== undefined && body.error !== null) throw new Error(`the router returned an error: ${String(isObj(body.error) ? body.error.message : body.error).slice(0, 200)}`);
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  if (!isObj(choice) || !isObj(choice.message)) throw new Error("the router reply had no message");
  const m = choice.message;
  const calls: ToolCall[] = (Array.isArray(m.tool_calls) ? m.tool_calls : []).flatMap((c: unknown, i: number): ToolCall[] => {
    if (!isObj(c) || !isObj(c.function) || typeof c.function.name !== "string") return [];
    return [{ id: typeof c.id === "string" && c.id !== "" ? c.id : `call_${turn}_${i}`, name: c.function.name, arguments: parseArgs(c.function.arguments) }];
  });
  const usage = usageOf(body.usage);
  return usage ? { content: textOf(m.content), toolCalls: calls, usage } : { content: textOf(m.content), toolCalls: calls };
}
