import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlocks, parseInline } from "./miniMarkdown.ts";

test("inline: bold and code are separated, everything else stays text", () => {
  assert.deepEqual(parseInline("Set **Cutoff** to `64` now"), [
    { kind: "text", text: "Set " }, { kind: "bold", text: "Cutoff" }, { kind: "text", text: " to " }, { kind: "code", text: "64" }, { kind: "text", text: " now" },
  ]);
  assert.deepEqual(parseInline("the *Filter* page"), [{ kind: "text", text: "the " }, { kind: "italic", text: "Filter" }, { kind: "text", text: " page" }]);
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ kind: "text", text: "2 * 3 * 4" }]);
  assert.deepEqual(parseInline("2 * 3 and `open"), [{ kind: "text", text: "2 * 3 and `open" }]);
});

test("blocks: paragraphs, lists, headings and continuation lines", () => {
  const b = parseBlocks("# Filter\nIt cuts highs.\nSecond line.\n\n- one\n- two\n  more of two\n1. first\n2) second\n\nDone");
  assert.deepEqual(b.map((x) => x.kind), ["h", "p", "ul", "ol", "p"]);
  assert.deepEqual((b[1] as { inline: unknown }).inline, [{ kind: "text", text: "It cuts highs.\nSecond line." }]);
  assert.equal((b[2] as { items: unknown[] }).items.length, 2);
  assert.deepEqual((b[2] as { items: { text: string }[][] }).items[1], [{ kind: "text", text: "two more of two" }]);
  assert.equal((b[3] as { items: unknown[] }).items.length, 2);
});

test("HTML is data: it comes back as text for the caller to escape", () => {
  const b = parseBlocks("<img src=x onerror=alert(1)> **<b>hi</b>**");
  assert.deepEqual(b, [{ kind: "p", inline: [{ kind: "text", text: "<img src=x onerror=alert(1)> " }, { kind: "bold", text: "<b>hi</b>" }] }]);
  assert.deepEqual(parseBlocks("   \n\n"), []);
});

test("blocks: a table needs its separator row, and ends at the first line without a pipe", () => {
  const b = parseBlocks(["Intro", "", "| A | B |", "| --- | --- |", "| 1 | `x` |", "| 2 | y |", "After"].join("\n"));
  assert.equal(b.length, 3);
  const t = b[1];
  assert.ok(t.kind === "table");
  assert.deepEqual(t.head.map((c) => c[0].text), ["A", "B"]);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0][1], [{ kind: "code", text: "x" }]);
  assert.equal(b[2].kind, "p");
  assert.equal(parseBlocks("| not | a table |\n| x | y |")[0].kind, "p");
});
