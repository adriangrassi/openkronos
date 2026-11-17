import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRenames, findEmpties, planRename, toCsv, toHtml } from "./banktools.ts";
import { getName, setName } from "./library.ts";
import { parsePcg, verifyChecksums } from "./pcg.ts";

const factory = () => parsePcg(new Uint8Array(readFileSync(new URL("../../../research/korg-factory/pcg/PRELOAD_KRONOSX.PCG", import.meta.url))));

test("planRename applies steps in order and flags refused names", () => {
  assert.deepEqual(planRename(["a.b"], { find: ".", replace: "_", letterCase: "upper" }).map((r) => r.to), ["A_B"]);
  assert.deepEqual(planRename(["x"], { numbering: { start: 1, pad: 2, at: "suffix", sep: " " } })[0].to, "x 01");
  assert.notEqual(planRename(["abc"], { suffix: "\t" })[0].error, null);
  assert.equal(planRename(["abc"], {})[0].error, null);
});

test("applyRenames refuses a bad batch without writing", () => {
  const f = factory();
  const before = getName(f, "program:INT-A", 0);
  assert.throws(() => applyRenames(f, "program:INT-A", [{ index: 0, name: "ok" }, { index: 1, name: "bad " }]));
  assert.equal(getName(f, "program:INT-A", 0), before);
  assert.equal(applyRenames(f, "program:INT-A", [{ index: 0, name: "Test" }]), 1);
  assert.deepEqual(verifyChecksums(f), []);
});

test("findEmpties reports Init names and sounds equal to an Init slot", () => {
  const f = factory();
  setName(f, "program:INT-A", 5, "Init copy");
  const hit = findEmpties(f).find((e) => e.key === "program:INT-A" && e.index === 5);
  assert.equal(hit?.reason, "name");
});

test("toCsv quotes commas and quotes; toHtml escapes markup", () => {
  const f = factory();
  setName(f, "program:INT-A", 0, `a,"b"`);
  assert.ok(toCsv(f, "program:INT-A").includes('program:INT-A,0,"a,""b"""\r\n'));
  setName(f, "program:INT-A", 0, "<i>&");
  assert.ok(toHtml(f, "program:INT-A", "T").includes("&lt;i&gt;&amp;"));
  assert.throws(() => toCsv(f, "program:NOPE"));
});
