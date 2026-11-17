import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { runTool, toolDefinitions } from "./session.ts";
import { ASK_SYSTEM } from "./agent.ts";
import { engineSummary, lookupParamDoc, MAX_EXCERPT, setParamDocs, type DocData } from "./paramDocs.ts";

const FILE = new URL("../../generated/param-docs.json", import.meta.url);
const have = existsSync(FILE) && readFileSync(FILE, "utf8").length > 10;
const load = (): void => setParamDocs(have ? (JSON.parse(readFileSync(FILE, "utf8")) as DocData) : null);
const guide = { skip: have ? false : "param-docs.json is built from the owner's private guide" };

test("the engine notes answer with no guide data: Poly Legato on an SGX-2 is unsupported", () => {
  setParamDocs(null);
  const r = lookupParamDoc({ label: "Poly Legato", engine: "SGX-2", kind: "Program" });
  assert.ok(r);
  assert.match(r.excerpt, /SGX-2/);
  assert.match(r.excerpt, /do not apply|not support/);
  assert.match(r.source, /p\.397/);
  assert.equal(lookupParamDoc({ label: "Cutoff", engine: "SGX-2", kind: "Program" }), null);
  assert.equal(lookupParamDoc({ label: "Poly Legato", engine: "HD-1", kind: "Program" }), null);
});

test("Poly Legato on a program returns the guide's own text", guide, () => {
  load();
  const r = lookupParamDoc({ label: "Poly Legato", page: "Program Basic", group: "Voice Assign Mode", engine: "HD-1", kind: "Program" });
  assert.ok(r);
  assert.match(r.excerpt, /legato start point/i);
  assert.match(r.excerpt, /Voice Assign Mode is set to Poly/);
  assert.doesNotMatch(r.excerpt, /^On the /);
  assert.match(r.source, /Parameter Guide p\.42/);
});

test("Poly Legato on SGX-2, EP-1 and the other EXi: the engine note comes first, then the EXi guide text", guide, () => {
  load();
  for (const e of ["SGX-2", "EP-1"]) {
    const r = lookupParamDoc({ label: "Poly Legato", engine: e, kind: "Program" });
    assert.ok(r, e);
    assert.ok(r.excerpt.startsWith(`On the ${e}`), r.excerpt.slice(0, 80));
    assert.match(r.excerpt, /applies only to EXi which include sample playback/);
  }
  assert.match(lookupParamDoc({ label: "Poly Legato", engine: "AL-1", kind: "Program" })!.excerpt, /designed for sample playback/);
  assert.match(lookupParamDoc({ label: "Poly Legato", engine: "CX-3", kind: "Program" })!.excerpt, /always acts as if it were On/);
});

test("matching ignores case, spaces, hyphens and a bracketed note, and is repeatable", guide, () => {
  load();
  const a = lookupParamDoc({ label: "Poly Legato", engine: "SGX-2", kind: "Program" });
  for (const l of ["poly-legato", "POLY LEGATO", "PolyLegato", "Poly Legato (Poly mode)", "polyphonic legato"]) assert.deepEqual(lookupParamDoc({ label: l, engine: "SGX-2", kind: "Program" }), a, l);
  assert.deepEqual(lookupParamDoc({ label: "Poly Legato", engine: "SGX-2", kind: "Program" }), a);
});

test("a nonsense label finds nothing; the excerpt never passes the cap", guide, () => {
  load();
  assert.equal(lookupParamDoc({ label: "Zzyzx Frobnicate", kind: "Program" }), null);
  assert.equal(lookupParamDoc({ label: "", kind: "Program" }), null);
  for (const l of ["Cutoff", "Poly Legato", "Voice Assign Mode", "Detune", "Attack Time"]) {
    const r = lookupParamDoc({ label: l, engine: "SGX-2", kind: "Program" });
    if (r) assert.ok(r.excerpt.length <= MAX_EXCERPT, l);
  }
});

test("a generic Detune is not an Unison Detune unless its group says so", () => {
  setParamDocs(null);
  assert.equal(lookupParamDoc({ label: "Detune", group: "OSC1 Pitch", engine: "SGX-2", kind: "Program" }), null);
  assert.match(lookupParamDoc({ label: "Detune", group: "Unison", engine: "SGX-2", kind: "Program" })!.excerpt, /Unison/);
});

test("an engine alone gets its summary", () => {
  assert.match(engineSummary("what about sgx-2")!.excerpt, /SGX-2 Premium Piano/);
  assert.equal(engineSummary("nothing"), null);
});

test("lookup_param_help is an Ask-only read tool, answers from the guide, and ASK_SYSTEM tells the model to use it", () => {
  setParamDocs(null);
  assert.ok(toolDefinitions("ask").some((d) => d.name === "lookup_param_help"));
  assert.ok(!toolDefinitions("build").some((d) => d.name === "lookup_param_help"));
  assert.ok(!toolDefinitions("refine").some((d) => d.name === "lookup_param_help"));
  assert.match(ASK_SYSTEM, /Before saying you are unsure about a parameter or engine behaviour, call lookup_param_help/);
  const ask = { ask: true } as never;
  const hit = runTool(ask, "lookup_param_help", { query: "Poly Legato on the SGX-2" });
  assert.equal(hit.ok, true);
  assert.equal(hit.found, true);
  assert.match(String(hit.excerpt), /SGX-2/);
  assert.equal(runTool(ask, "lookup_param_help", { query: "SGX-2" }).found, true, "an engine alone gets its summary");
  assert.equal(runTool(ask, "lookup_param_help", { query: "Zzyzx" }).found, false);
  assert.equal(runTool(ask, "lookup_param_help", {}).found, false);
  assert.equal(runTool({ onlySlot: { key: "program:INT-A", index: 0 } } as never, "lookup_param_help", { query: "x" }).ok, false, "Refine may not use it");
});
