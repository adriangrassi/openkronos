import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_HELP, describeControl, humanizeId, MAX_HELP, SETTING_HELP } from "./explain.ts";

test("a dial question carries label, page, range, kind and the help text, but not the sound name or the value", () => {
  const q = describeControl({ label: "Cutoff", kind: "dial", page: "Filter", group: "Filter 1", soundKind: "Program", soundName: "Jump", value: "64", min: 0, max: 127, help: "Sets the filter's cutoff frequency." });
  for (const s of ["Cutoff", "dial", "Filter", "Filter 1", "Program", "0 to 127", "cutoff frequency"]) assert.ok(q.question.includes(s), s);
  for (const s of ["Jump", "64"]) assert.ok(!q.question.includes(s), `${s} stays out of the model question so its answer can be reused`);
  assert.equal(q.valueLine, "Current value: 64");
  assert.match(q.offline, /64/);
  assert.match(q.question, /Shift/);
  assert.equal(q.grounded, true);
  assert.match(q.offline, /Sets the filter's cutoff frequency/);
  assert.ok(!q.question.includes("Jump") && !q.offline.includes("Jump"), "the sound name is never in the text");
  assert.ok(!describeControl({ label: "Cutoff", kind: "dial", soundKind: "Program", soundName: "Jump" }, "normal", "pt").offline.includes("Jump"));
});

test("fader, select, checkbox and button each get their own usage line", () => {
  assert.match(describeControl({ label: "Level", kind: "fader" }).question, /Drag the cap/);
  assert.match(describeControl({ label: "Mode", kind: "select" }).question, /pick an entry/);
  assert.match(describeControl({ label: "Hold", kind: "checkbox" }).question, /switch it on or off/);
  assert.match(describeControl({ label: "Store", kind: "button" }).offline, /Click it to run it/);
});

test("a control with only a label still yields a usable question and offline text", () => {
  const r = describeControl({ label: "Mystery" });
  assert.equal(r.grounded, false);
  assert.match(r.question, /Mystery/);
  assert.match(r.question, /No factory help text/);
  assert.match(r.offline, /^Mystery/);
});

test("an unknown control with no label falls back to its test id, never undefined", () => {
  const r = describeControl({ label: "", testid: "check-keyboard-3" });
  assert.equal(r.label, "Check keyboard");
  assert.ok(!/undefined|null/.test(r.question + r.offline));
  assert.equal(describeControl({ label: "" }).label, "Unnamed control");
});

test("help text is cut to the limit", () => {
  const r = describeControl({ label: "X", help: "a".repeat(5000) });
  assert.ok(r.question.length < MAX_HELP + 900);
  assert.ok(!r.question.includes("a".repeat(MAX_HELP + 1)));
});

test("the question asks for an explanation only: no write verbs or tool names", () => {
  const r = describeControl({ label: "Attack", kind: "dial", value: "10", help: "Attack time." });
  assert.ok(!/\b(set_params|build_combi|propose_layer|write|apply|modify|overwrite)\b/i.test(r.question));
  assert.match(r.question, /read-only/);
});

test("settings and app buttons are explained from the built-in tables, and a disabled control says why", () => {
  assert.match(describeControl({ label: "Live", kind: "checkbox", testid: "settings-liveparams" }).offline, /sent to the keyboard/);
  assert.match(describeControl({ label: "Theme", kind: "toggle", testid: "settings-theme-studio" }).question, /three themes/);
  assert.match(describeControl({ label: "Send", kind: "button", testid: "send-sound" }).question, /MIDI transfer/);
  const d = describeControl({ label: "Ask", kind: "button", disabled: true, hint: "No sound is open: select one row or open it" });
  assert.match(d.question, /disabled: No sound is open/);
  assert.match(d.offline, /disabled/);
});

test("every settings field has a description", () => {
  for (const id of ["theme", "accent", "scale", "density", "channel", "global-channel", "liveparams", "verifylive", "ai-url", "ai-model", "reset", "close", "open"]) assert.ok(SETTING_HELP[`settings-${id}`], id);
  for (const id of ["use", "check", "test", "model", "guide", "copy"]) assert.ok(APP_HELP[`ai-conn-${id}`], id);
  for (const v of Object.values({ ...SETTING_HELP, ...APP_HELP })) assert.ok(v.length > 15);
});

test("humanizeId drops indexes and template holes", () => {
  assert.equal(humanizeId("row-name-12"), "Row name");
  assert.equal(humanizeId("kv-tab-${s.id}"), "Kv tab");
});

test("Very brief: the offline answer is the label, one line of purpose and the current value", () => {
  const brief = describeControl({ label: "Cutoff", kind: "dial", value: "64", help: "Sets how bright the sound is. More text follows here." }, "brief");
  assert.equal(brief.offline, "Cutoff: Sets how bright the sound is. Now: 64.");
  assert.match(brief.question, /Keep it very short/);
  assert.equal(describeControl({ label: "Cutoff", kind: "dial", value: "64" }).offline, describeControl({ label: "Cutoff", kind: "dial", value: "64" }, "detailed").offline);
});

test("Portuguese offline text for dial, select and button; help stays English with a note", () => {
  const dial = describeControl({ label: "Cutoff", kind: "dial", page: "Filter", value: "64", help: "Sets the filter's cutoff frequency." }, "normal", "pt").offline;
  assert.match(dial, /Valor atual: 64/);
  assert.match(dial, /Como usar: Arraste para cima ou para baixo/);
  assert.match(dial, /Sets the filter's cutoff frequency/);
  assert.match(dial, /texto de ajuda original em inglês/);
  assert.match(describeControl({ label: "Mode", kind: "select" }, "normal", "pt").offline, /Clique e escolha uma entrada da lista/);
  assert.match(describeControl({ label: "Send", kind: "button" }, "normal", "pt").offline, /Clique para executar/);
  assert.equal(describeControl({ label: "Cutoff", kind: "dial", value: "64", help: "Sets it." }, "brief", "pt").offline.startsWith("Cutoff: Arraste para cima"), true);
  assert.match(describeControl({ label: "Cutoff", kind: "dial", value: "64" }, "brief", "pt").offline, /Agora: 64\.$/);
});
