// Gate for Shift-click explain: Shift+click on any control asks the AI about it and changes nothing. Simulator only; the AI model answers nothing on purpose, so the offline help text is what shows.
// KRONOS_GATE_THEME=normal|studio|a picks the theme. EXPLAIN_SWEEP=0 skips the coverage sweep.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gate, core, launch, load, testsAndTypes } from "./gate-kit.mjs";

const g = gate("EXPLAIN"), { check, finish } = g, C = await core(g), { L, parsed } = C;
const X_ = await load("src/core/ai/explain.ts");
await testsAndTypes(g, ["core/ai/explain.test.ts"]);
if (g.fails.length) await finish();

const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: "[]" });
const { win, X, seen, text, until, openBank, saved, listView, connectSim, openFile } = ui;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHIFT = { modifiers: ["Shift"] };
const hash = (a) => createHash("sha256").update(JSON.stringify(a)).digest("hex").slice(0, 12);

// Everything a stray click could change: the saved bytes, the undo state, the simulator's edit buffers, MIDI traffic and the link.
const snap = async () => {
  return {
    undo: await X("undo").isDisabled(),
    changes: await win.locator('[data-testid="changes-count"]').first().textContent().catch(() => ""),
    counts: await win.evaluate(() => window.__kronosE2E.liveCounts()),
    midi: await win.evaluate(() => window.__kronosE2E.midiLog().length),
    buffers: hash(await win.evaluate(() => [0, 1, 2, 3, 4, 5].map((o) => window.__kronosE2E.editBuffer(o)))),
    link: (await text("device-status")).slice(0, 40),
  };
};
// Opening a sound or a view makes the app sync it to the simulator a moment later; wait until the MIDI log has been quiet, so only what a Shift-click does is measured.
const settle = async () => { let last = -1, quiet = 0; for (let n = 0; n < 60 && quiet < 4; n++) { const m = await win.evaluate(() => window.__kronosE2E.midiLog().length); quiet = m === last ? quiet + 1 : 0; last = m; await sleep(200); } };
const note = async () => (await win.locator('[data-testid="ai-note"]').first().textContent().catch(() => "")) ?? "";
const closeAi = async () => { if (await win.locator('[data-testid="ai-close"]').count()) await X("ai-close").click(); await X("ai-prompt").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {}); };

await openFile();
await connectSim();
const file0 = hash([...(await saved())]);
await openBank("program:INT-A");
await X("row-5").click();
await X("edit-params").click();
await seen("editor-title");

// Shift+click on `loc`, then expect the AI window in Ask with the control's label (and value) and nothing changed.
const explains = async (what, loc, { label, value, at } = {}) => check(`Shift+click on ${what} explains it and changes nothing`, async () => {
  await closeAi();
  await settle();
  const before = await snap();
  await loc.click({ ...SHIFT, position: at });
  await seen("ai-prompt");
  await until(async () => /Explain "/.test(await text("ai-log")) && (await note()).length > 20, "the explanation", 20000);
  const n = await note(), asked = await X("ask-text").inputValue();
  assert.match(asked, /^Explain "/, `Ask box: ${asked}`);
  assert.doesNotMatch(n + asked, /undefined|\[object|null/);
  if (label) assert.ok(n.toLowerCase().includes(label.toLowerCase()), `label ${label} not in: ${n.slice(0, 200)}`);
  if (value) assert.ok(n.includes(value), `value ${value} not in: ${n.slice(0, 300)}`);
  assert.match(n, /help text built into the app/);
  await settle();
  assert.deepEqual(await snap(), before);
  return asked;
});

// Which view shows a dial depends on the theme: take the first one that has a Kronos dial or a panel knob.
const DIAL = ".kc-dial:visible, .knob:visible";
let PANEL = "view-panel";
await win.locator('[data-testid="view-list"]').waitFor({ timeout: 15000 });
for (const v of ["view-panel", "view-kronos", "view-keyboard", "view-simple"]) {
  if (!(await win.locator(`[data-testid="${v}"]`).count())) continue;
  await X(v).click();
  if (await win.locator(DIAL).first().waitFor({ timeout: 4000 }).then(() => true, () => false)) { PANEL = v; break; }
}
try { await win.locator(DIAL).first().waitFor({ timeout: 15000 }); } catch (e) {
  const info = await win.evaluate(() => ({ views: [...document.querySelectorAll('[data-testid^="view-"]')].map((b) => b.dataset.testid + ":" + b.getAttribute("aria-pressed")), kc: document.querySelectorAll(".kc-dial").length, knob: document.querySelectorAll(".knob").length, range: document.querySelectorAll("input[type=range]").length, rows: document.querySelectorAll(".param-row").length }));
  console.log("DEBUG " + JSON.stringify(info));
  throw e;
}

const dial = win.locator(DIAL).first();
const dialLabel = (await dial.getAttribute("data-param-label")) ?? (await dial.getAttribute("data-explain")) ?? "";
const dialValue = (await dial.locator(".kc-value").count()) ? ((await dial.locator(".kc-value").first().textContent()) ?? "").trim() : (await dial.getAttribute("data-explain-value")) ?? "";
await explains("a dial in the panel view", dial.locator("svg").first(), { label: dialLabel, value: dialValue });

const toggle = win.locator(".kc-toggle, .kc-check").first();
if (await toggle.count()) await explains("a toggle", toggle.locator("button, input, label").first(), { label: (await toggle.getAttribute("data-param-label")) ?? "" });
else await check("a toggle exists in the panel view", async () => { throw new Error("no .kc-toggle or .kc-check on this page"); });

const fader = win.locator(".kc-fader").first();
if (await fader.count()) await explains("a fader (off the thumb)", fader.locator("input[type=range]"), { label: (await fader.getAttribute("data-param-label")) ?? "", at: { x: 6, y: 6 } });

await explains("the Send button", (await X("send-sound").count()) ? X("send-sound") : X("push-bank"), { label: "Send" });
await explains("the Check keyboard button", X("check-keyboard"), { label: "Check keyboard" });

await X("view-list").click(); // Simple mode only ends when another view is chosen
await listView();
const slider = win.locator('.param-row [data-testid^="slider-"]').first();
await slider.waitFor();
const sliderRow = win.locator(".param-row").filter({ has: slider }).first();
await explains("a list-view slider (off the thumb)", slider, { label: (await sliderRow.getAttribute("data-param-label", { timeout: 3000 }).catch(() => null)) ?? "", at: { x: 8, y: 4 } });

await check("Shift+click on a disabled button still explains it and says it is disabled", async () => {
  await closeAi();
  await X("ai-open").click();
  await seen("ai-prompt");
  await X("ask-text").fill("");
  assert.equal(await X("ask-go").isDisabled(), true);
  const before = await snap();
  await X("ask-go").click({ ...SHIFT, force: true });
  await until(async () => /Explain "Ask"/.test(await text("ai-log")) || /Ask/.test(await note()), "the disabled-control explanation", 15000);
  assert.match(await note(), /disabled/i);
  assert.deepEqual(await snap(), before);
});

await check("a Shift drag still adjusts a control and does not open the AI", async () => {
  await closeAi();
  await X(PANEL).click();
  const root = win.locator('.kc-dial:visible, .knob[data-disabled="false"]:visible').first(), d = root.locator("svg").first(); // an empty macro knob is disabled and cannot move
  await d.waitFor();
  const read = async () => (await root.getAttribute("data-explain-value")) ?? (await root.locator(".kc-value").first().textContent()) ?? "";
  const before = await read();
  await d.evaluate((e) => e.scrollIntoView({ block: "center" })); // the piano dock can sit over a dial near the bottom
  const b = await d.boundingBox();
  await win.keyboard.down("Shift");
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await win.mouse.down();
  await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 40, { steps: 6 });
  await win.mouse.up();
  await win.keyboard.up("Shift");
  await until(async () => (await read()) !== before, "the dial moved", 8000).catch(async (e) => {
    const info = await win.evaluate(([x, y]) => { const t = document.elementFromPoint(x, y); return { top: t && (t.tagName + "." + String(t.className?.baseVal ?? t.className) + " in " + (t.closest("[data-param-label]")?.dataset.paramLabel ?? "?")), changed: document.querySelector(".kc-dial:not([style*=none])")?.dataset.changed }; }, [b.x + b.width / 2, b.y + b.height / 2]);
    throw new Error(`${e.message} before=${before} after=${await read()} ${JSON.stringify(info)} box=${JSON.stringify(b)}`);
  });
  assert.equal(await win.locator('[data-testid="ai-prompt"]').count(), 0, "the AI window opened on a drag");
  await X("undo").click();
});

await check("a plain click still works (a toggle changes value)", async () => {
  const t = win.locator(".kc-toggle button, .kc-check input, .kc-toggle input").first();
  if (!(await t.count())) return "no toggle on this page";
  const root = win.locator(".kc-toggle, .kc-check").first(), before = await root.getAttribute("data-changed");
  await t.click();
  await until(async () => (await root.getAttribute("data-changed")) !== before, "the toggle changed", 8000);
  await X("undo").click();
});

await check("a piano Shift-click still types the note name into the prompt and does not explain", async () => {
  await closeAi();
  await X("ai-open").click();
  await seen("ai-prompt");
  const noteBefore = await note();
  await X("ai-prompt").click();
  await win.keyboard.press("Tab"); // the prompt remembers where the caret was when it loses focus
  await seen("dock-key-60");
  const b = await X("dock-key-60").boundingBox();
  await win.keyboard.down("Shift");
  await win.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.8);
  await win.mouse.down();
  await win.mouse.up();
  await win.keyboard.up("Shift");
  await until(async () => (await X("ai-prompt").inputValue()).length > 0, "the note name in the prompt", 8000);
  assert.match(await X("ai-prompt").inputValue(), /[A-G]/);
  assert.equal(await note(), noteBefore, "a piano key opened an explanation");
});

await check("Shift+click inside a focused text box keeps selecting text and explains nothing", async () => {
  const noteBefore = await note();
  await X("ai-prompt").fill("hello world");
  await X("ai-prompt").click();
  await X("ai-prompt").click({ ...SHIFT, position: { x: 4, y: 8 } });
  assert.equal(await note(), noteBefore);
  assert.equal(await X("ai-prompt").inputValue(), "hello world");
});

await check("the hint is shown in the Help panel and as the AI tooltip", async () => {
  assert.equal(await X("ai-open").getAttribute("title") ?? "", X_.EXPLAIN_HINT);
  await closeAi();
  assert.equal(await X("ai-open").getAttribute("title"), X_.EXPLAIN_HINT);
  await X("shell-help-button").click();
  await seen("shell-explain-hint");
  assert.equal((await text("shell-explain-hint")), X_.EXPLAIN_HINT);
  await win.keyboard.press("Escape");
  await X("shell-shortcuts").waitFor({ state: "hidden", timeout: 3000 }).catch(async () => { await win.mouse.click(5, 5); });
});

// ---- Coverage sweep: Shift+click every interactive element on every screen we can reach, in dry mode (the real listener, but the explanation is recorded instead of asked). ----
const SEL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="slider"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="radio"], [role="combobox"], [role="spinbutton"], [tabindex]:not([tabindex="-1"]), [data-param-id], [data-testid]';
const stats = { screens: 0, found: 0, param: 0, grounded: 0, generic: 0, idOnly: 0, missing: 0, covered: 0, noExplain: 0 };
const lists = { generic: [], idOnly: [], missing: [], covered: [], noExplain: [], unreachable: [], sentMidi: [] };
let midiNow = 0;
const done = new Set();
if (process.env.EXPLAIN_SWEEP !== "0") {
  await closeAi();
  await win.evaluate(() => { window.__kronosExplainProbe = true; window.__probe = []; window.addEventListener("kronos-explain-probe", (e) => window.__probe.push(e.detail)); });
  const sweep = async (screen) => {
    const tagged = await win.evaluate((sel) => {
      const out = [];
      document.querySelectorAll("[data-sweep]").forEach((e) => e.removeAttribute("data-sweep"));
      document.querySelectorAll(sel).forEach((el) => {
        const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (b.width < 2 || b.height < 2 || cs.visibility === "hidden" || cs.display === "none") return;
        const tid = el.getAttribute("data-testid") ?? "";
        if (el === document.activeElement && el.matches('input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea')) return; // typing there is left alone on purpose
        if (/^dock-key-/.test(tid) || el.closest('[data-testid^="dock-key-"]')) return;
        const interactive = el.matches('button, a[href], input, select, textarea, summary, [role="button"], [role="slider"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="radio"], [role="combobox"], [role="spinbutton"], [tabindex]:not([tabindex="-1"]), [data-param-id], [data-explain]') || (cs.cursor === "pointer" && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer"));
        if (!interactive) return;
        const sig = tid + "|" + el.tagName + "|" + (el.getAttribute("aria-label") ?? "") + "|" + (tid ? "" : (el.textContent ?? "").slice(0, 30));
        el.setAttribute("data-sweep", String(out.length));
        out.push({ i: out.length, sig, tid, tag: el.tagName.toLowerCase(), text: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40) });
      });
      return out;
    }, SEL);
    stats.screens++;
    await settle();
    const before = await snap();
    for (const t of tagged) {
      if (done.has(t.sig)) continue;
      done.add(t.sig);
      const pt = await win.evaluate((i) => {
        const el = document.querySelector(`[data-sweep="${i}"]`);
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center" });
        const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, hit = document.elementFromPoint(x, y);
        return { x, y, ok: !!hit && (el.contains(hit) || hit.contains(el)) };
      }, t.i);
      stats.found++;
      const where = `${screen}: <${t.tag}> ${t.tid || t.text}`;
      if (!pt) continue;
      if (!pt.ok) stats.covered++; // another element sits over its centre: the Shift-click goes to whatever the owner would hit
      midiNow = await win.evaluate(() => { window.__probe.length = 0; return window.__kronosE2E.midiLog().length; });
      await win.keyboard.down("Shift");
      await win.mouse.click(pt.x, pt.y);
      await win.keyboard.up("Shift");
      const [got, midiAfter] = await win.evaluate(() => [window.__probe.slice(), window.__kronosE2E.midiLog().length]);
      if (midiAfter !== midiNow) lists.sentMidi.push(`${where} (+${midiAfter - midiNow} messages)`);
      if (got.length !== 1) { if (pt.ok) { stats.noExplain++; lists.noExplain.push(`${where} (${got.length} explanations)`); } else lists.covered.push(`${where} (covered, no control under the pointer)`); continue; }
      const { ctx, source } = got[0], req = X_.describeControl(ctx);
      const bad = !ctx.label.trim() || /undefined|\[object|null/.test(req.question + req.offline);
      if (source === "none" || bad) { stats.missing++; lists.missing.push(where); }
      else if (source === "testid") { stats.idOnly++; lists.idOnly.push(`${where} -> ${ctx.label}`); }
      else if (req.grounded) { stats.grounded++; if (source === "param") stats.param++; }
      else { stats.generic++; lists.generic.push(`${where} -> ${ctx.label}`); }
    }
    await settle();
    const after = await snap();
    assert.deepEqual(after, before, `${screen}: something changed while Shift-clicking`);
  };
  const dismiss = async () => {
    await win.keyboard.press("Escape");
    for (const id of ["settings-close", "overview-close", "banktools-close", "exchange-close", "ai-close", "setlists-exit", "ab-close", "verify-strip-close", "confirm-cancel"]) {
      const l = win.locator(`[data-testid="${id}"]`);
      if ((await l.count()) && (await l.first().isVisible())) await l.first().click().catch(() => {});
    }
    await sleep(150);
  };
  const click = async (id) => { await seen(id, 6000); await X(id).click({ timeout: 6000 }); };
  const visit = (name, open, close) => check(`coverage: ${name}`, async () => {
    try { await open(); } catch (e) { lists.unreachable.push(`${name}: ${String(e.message).split("\n")[0]}`); await dismiss(); return "unreachable"; }
    await sleep(250);
    await sweep(name);
    if (close) await close().catch(() => {});
    await dismiss();
  });
  const views = ["view-panel", "view-list", "view-keyboard", "view-kronos", "view-simple"];
  const pages = async (name, prefix) => {
    const n = await win.locator(`[data-testid^="${prefix}"]`).count();
    for (let k = 0; k < n; k++) { const b = win.locator(`[data-testid^="${prefix}"]`).nth(k); if (!(await b.isVisible()) || (await b.isDisabled())) continue; await b.click(); await sleep(200); await sweep(`${name} page ${k}`); }
  };

  await visit("program editor", async () => {});
  for (const v of views) {
    if (!(await win.locator(`[data-testid="${v}"]`).count())) continue;
    await visit(`program ${v}`, async () => { await X(v).click(); await sleep(300); });
    if (v === "view-kronos") await check("coverage: kronos view pages", async () => { await pages("program kronos", "kv-page-"); await pages("program kronos tabs", "kv-tab-"); });
    if (v === "view-keyboard") await check("coverage: keyboard view pages", async () => { await pages("program keyboard", "kb-page-"); await pages("program keyboard tabs", "kb-tab-"); });
    if (v === "view-list") await check("coverage: list groups", async () => { await pages("program list", "group-"); });
  }
  await visit("effects", async () => { await click("effects-open"); });
  await ui.closeEditor().catch(() => {});

  const banks = L.listBanks(parsed());
  for (const [kind, key, row] of [["combi", "combi:INT-A", 3], ["drum kit", "drumkit:INT", 2], ["wave sequence", "waveseq:INT", 4]]) {
    if (!banks.some((b) => b.key === key)) continue;
    await visit(`${kind} editor`, async () => { await openBank(key); await X(`row-${row}`).click(); await click("edit-params"); await seen("editor-title"); });
    for (const v of views) {
      if (!(await win.locator(`[data-testid="${v}"]`).count()) || (await X(v).isDisabled())) continue;
      await visit(`${kind} ${v}`, async () => { await X(v).click(); await sleep(300); });
    }
    await ui.closeEditor().catch(() => {});
  }
  await visit("library and top bar", async () => { await openBank("program:INT-A"); });
  const toggle = (id) => async () => { if ((await X(id).getAttribute("aria-pressed")) === "true") await X(id).click(); };
  for (const [name, open, close] of [
    ["AI panel", async () => click("ai-open"), async () => click("ai-close")], ["settings dialog", async () => click("settings-open"), async () => click("settings-close")],
    ["help panel", async () => click("shell-help-button")], ["undo history", async () => click("shell-history-button")], ["recent files", async () => click("shell-recent-button")],
    ["overview", async () => click("overview-open"), toggle("overview-open")], ["set lists", async () => click("setlists-open"), toggle("setlists-open")],
    ["sound browser", async () => click("sounds-open"), toggle("sounds-open")], ["backup manager", async () => click("backupmgr-open-panel")],
    ["packs (exchange)", async () => click("exchange-open"), async () => click("exchange-close")], ["bank tools", async () => click("banktools-open"), async () => click("banktools-close")],
    ["dock monitor", async () => click("dock-tab-monitor")], ["dock player", async () => click("dock-tab-player"), async () => click("dock-tab-keys")],
    ["command palette", async () => { await win.keyboard.press("Control+k"); await seen("shell-palette-input", 6000); }],
  ]) await visit(name, open, close);
  await openBank("program:INT-A"); await X("row-5").click(); await X("edit-params").click(); await seen("editor-title");
  for (const [name, id] of [["snapshots", "snapshots-toggle"], ["variations", "variations-open"]]) await visit(name, async () => { await click(id); });
  await dismiss();
  console.log(`SWEEP: ${stats.screens} screens, ${stats.found} elements; grounded ${stats.grounded} (of which parameter controls ${stats.param}), generic label-only ${stats.generic}, label from test id only ${stats.idOnly}, missing ${stats.missing}, covered by another element ${stats.covered}, no explanation ${stats.noExplain}`);
  for (const [k, v] of Object.entries(lists)) if (v.length) console.log(`  ${k} (${v.length}):\n    ${v.slice(0, 80).join("\n    ")}${v.length > 80 ? `\n    ... ${v.length - 80} more` : ""}`);
  await check("coverage: no control is missing a label, and every Shift-click explained", async () => { assert.equal(lists.sentMidi.length, 0, lists.sentMidi.slice(0, 6).join("; ")); assert.equal(stats.missing, 0, lists.missing.slice(0, 6).join("; ")); assert.equal(stats.noExplain, 0, lists.noExplain.slice(0, 6).join("; ")); assert.equal(stats.idOnly, 0, lists.idOnly.slice(0, 6).join("; ")); });
  await win.evaluate(() => { window.__kronosExplainProbe = false; });
}

await check("the saved file is byte-identical to the one saved before the Shift-clicks", async () => assert.equal(hash([...(await saved())]), file0));
await ui.noErrors();
await finish();
