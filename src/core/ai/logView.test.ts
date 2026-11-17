import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLog } from "./logView.ts";

test("trace lines collapse into one group, the rest keep their kind", () => {
  const g = groupLog(["You: Ask: why?", "  Read \"X\" INT-A 000", "  list_effect_types: ok", "Model: Because.", "  Searched: 3 found", "Cloud: 3 s"]);
  assert.deepEqual(g, [
    { kind: "echo", text: "Ask: why?" },
    { kind: "tools", lines: ["Read \"X\" INT-A 000", "list_effect_types: ok"] },
    { kind: "model", text: "Because." },
    { kind: "tools", lines: ["Searched: 3 found"] },
    { kind: "line", text: "Cloud: 3 s" },
  ]);
});
