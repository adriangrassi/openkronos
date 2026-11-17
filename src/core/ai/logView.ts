// Groups the AI window's plain log lines for display: the owner's request, the model's words, tool trace lines (collapsed), everything else.
export type LogEntry =
  | { kind: "echo" | "model" | "line"; text: string }
  | { kind: "tools"; lines: string[] };

export function groupLog(lines: string[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const l of lines) {
    if (/^ {2}\S/.test(l)) {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.lines.push(l.trim());
      else out.push({ kind: "tools", lines: [l.trim()] });
    } else if (l.startsWith("You: ")) out.push({ kind: "echo", text: l.slice(5) });
    else if (l.startsWith("Model: ")) out.push({ kind: "model", text: l.slice(7) });
    else out.push({ kind: "line", text: l });
  }
  return out;
}
