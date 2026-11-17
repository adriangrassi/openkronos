// Test helper: a copy of tools/fakes/fake-<name>.mjs in its own temp folder with a mode.json, so each test controls what the "CLI" prints. Not imported by the app.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Fake = { dir: string; file: string; capture: () => { argv: string[]; stdin: string; env: Record<string, string>; cwd: string } };

export function makeFake(name: "claude" | "codex", mode: Record<string, unknown>): Fake {
  const dir = mkdtempSync(path.join(os.tmpdir(), `kronos-fake-${name}-`));
  const file = path.join(dir, `fake-${name}.mjs`);
  copyFileSync(path.join(import.meta.dirname, "..", "..", "..", "tools", "fakes", `fake-${name}.mjs`), file);
  writeFileSync(path.join(dir, "mode.json"), JSON.stringify(mode));
  return { dir, file, capture: () => JSON.parse(readFileSync(path.join(dir, "capture.json"), "utf8")) };
}

// The JSON a real `claude -p --output-format json --json-schema ...` run prints (2.1.326), trimmed to the fields the app reads, plus the sign-out answer.
export const claudeOk = (turn: { text: string; tool_calls: { name: string; arguments_json: string }[] }, usage = { input_tokens: 2, cache_creation_input_tokens: 4482, cache_read_input_tokens: 0, output_tokens: 50 }): string =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 2, terminal_reason: "completed", result: JSON.stringify(turn), structured_output: turn, usage, total_cost_usd: 0.0009 });
export const claudeNotLoggedIn = JSON.stringify({ type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", result: "Not logged in · Please run /login", usage: { input_tokens: 0, output_tokens: 0 } });
