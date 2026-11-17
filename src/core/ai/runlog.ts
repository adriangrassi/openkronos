// ai-runs.jsonl in userData, local only, one JSON object per line: the seed for fine-tuning a small model later.
//   {"type":"run","id","time","kind":"build|refine|ask","provider":"cloud|claude|local","model","prompt","seconds","steps","tokens":{input,cached,output,total},
//    "status":"done|turn-limit|error|cancelled","slots":[{key,index}],"candidate":"A|B|null","transcript":[{role,content,toolCalls?,toolCallId?}]}
//   {"type":"decision","id":<run id>,"time","decision":"keep|discard|audition","candidate":"A|B|null"}   (appended when the owner chooses; a keep of a changed existing sound adds "destination":"current|new-program|new-combi" and "destinationNote")
// The system prompt is not stored (it is the same for every run of a kind); tool results are cut to keep a line small.
import type { Message } from "./agent.ts";

const ROLES = new Set(["user", "assistant", "tool"]);
const KINDS = new Set(["build", "refine", "ask"]);
const STATUS = new Set(["done", "turn-limit", "error", "cancelled"]);
const DECISIONS = new Set(["keep", "discard", "audition"]);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const cand = (v: unknown): "A" | "B" | null => (v === "A" || v === "B" ? v : null);

export function transcriptOf(messages: Message[]): Message[] {
  return messages.filter((m) => m.role !== "system");
}

// Validates a row from the renderer and returns the line to append (no newline). Throws on a row it does not understand.
export function runLine(raw: unknown): string {
  if (!isObj(raw) || typeof raw.id !== "string" || raw.id === "" || typeof raw.time !== "string") throw new Error("bad run row");
  const id = raw.id.slice(0, 64);
  const time = raw.time.slice(0, 40);
  if (raw.type === "decision") {
    if (typeof raw.decision !== "string" || !DECISIONS.has(raw.decision)) throw new Error("bad decision");
    const dest = typeof raw.destination === "string" ? { destination: str(raw.destination, 20), destinationNote: str(raw.destinationNote, 400) } : {};
    return JSON.stringify({ type: "decision", id, time, decision: raw.decision, candidate: cand(raw.candidate), ...dest });
  }
  if (raw.type !== "run" || !KINDS.has(String(raw.kind)) || !STATUS.has(String(raw.status)) || (raw.provider !== "cloud" && raw.provider !== "claude" && raw.provider !== "local")) throw new Error("bad run row");
  const t = isObj(raw.tokens) ? raw.tokens : {};
  const transcript = (Array.isArray(raw.transcript) ? raw.transcript : []).slice(0, 400).flatMap((m: unknown) => {
    if (!isObj(m) || !ROLES.has(String(m.role))) return [];
    const calls = Array.isArray(m.toolCalls) ? m.toolCalls.slice(0, 20).flatMap((c: unknown) => (isObj(c) ? [{ id: str(c.id, 80), name: str(c.name, 80), arguments: isObj(c.arguments) ? c.arguments : {} }] : [])) : undefined;
    return [{ role: m.role, content: str(m.content, 4000), ...(calls ? { toolCalls: calls } : {}), ...(typeof m.toolCallId === "string" ? { toolCallId: m.toolCallId.slice(0, 80) } : {}) }];
  });
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).slice(0, 60).flatMap((s: unknown) => (isObj(s) && typeof s.key === "string" ? [{ key: s.key.slice(0, 40), index: num(s.index) }] : []));
  return JSON.stringify({
    type: "run", id, time, kind: raw.kind, provider: raw.provider, model: str(raw.model, 120), prompt: str(raw.prompt, 4000),
    seconds: num(raw.seconds), steps: num(raw.steps), tokens: { input: num(t.input), cached: num(t.cached), output: num(t.output), total: num(t.total) },
    status: raw.status, slots, candidate: cand(raw.candidate), transcript,
  });
}
