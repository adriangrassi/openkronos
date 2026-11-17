// Token usage from `codex exec --json`: only the turn.completed event carries it (stderr has no usage line).
// No Node or DOM imports, so it runs in the main process and the renderer alike.
export type Usage = { input: number; cached: number; output: number; total: number };

export const ZERO_USAGE: Usage = { input: 0, cached: 0, output: 0, total: 0 };

// Numbers may arrive as strings with commas ("14,431"); anything else is not a count.
function count(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[\d,]+$/.test(v.trim()) ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function accumulate(totals: Usage, step: Usage): Usage {
  return { input: totals.input + step.input, cached: totals.cached + step.cached, output: totals.output + step.output, total: totals.total + step.total };
}

// Sums the usage of every turn.completed event in the JSONL text. Null when none reports usage.
export function parseUsage(text: string): Usage | null {
  let found: Usage | null = null;
  for (const line of text.split("\n")) {
    let ev: { type?: unknown; usage?: Record<string, unknown> } | null;
    try {
      ev = JSON.parse(line) as typeof ev;
    } catch {
      continue;
    }
    if (ev?.type !== "turn.completed" || !ev.usage) continue;
    const u = ev.usage;
    const input = count(u.input_tokens);
    const output = count(u.output_tokens);
    if (input === null || output === null) continue;
    const step = { input, cached: count(u.cached_input_tokens) ?? 0, output, total: count(u.total_tokens) ?? input + output };
    found = accumulate(found ?? ZERO_USAGE, step);
  }
  return found;
}

// The `usage` object of `claude -p --output-format json`. Cache reads and writes are prompt tokens too, so they count in input; cached is the cache-read part, as for Codex.
export function parseClaudeUsage(u: unknown): Usage | null {
  if (typeof u !== "object" || u === null) return null;
  const r = u as Record<string, unknown>;
  const fresh = count(r.input_tokens);
  const output = count(r.output_tokens);
  if (fresh === null || output === null) return null;
  const cached = count(r.cache_read_input_tokens) ?? 0;
  const input = fresh + cached + (count(r.cache_creation_input_tokens) ?? 0);
  return { input, cached, output, total: input + output };
}

export function formatUsage(totals: Usage, steps: number): string {
  const n = (x: number): string => x.toLocaleString("en-US");
  return `${steps} step${steps === 1 ? "" : "s"}, ${n(totals.total)} tokens (${n(totals.cached)} cached)`;
}
