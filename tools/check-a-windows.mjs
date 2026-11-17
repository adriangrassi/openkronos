// Style A window check. Static part (always): every dialog, menu and tooltip class in the renderer is styled by theme-a*.css, and theme-a*.css names no system font and no pure black.
// Runtime part (--runtime): opens each window of the app under Style A at 1400x900 and asserts computed styles on the visible tree: fonts, flat default chrome, textured dialogs, raised keys, inset wells.
//   node tools/check-a-windows.mjs [--runtime] [--shots <dir>]      prints an offender list and exits 1 when it is not empty.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { gate, core, launch, root } from "./gate-kit.mjs";

const rd = path.join(root, "src/app/renderer");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(rd), read = (f) => readFileSync(f, "utf8");
const offenders = [];
const bad = (what) => offenders.push(what);

// ---- Static ----
const themeA = files.filter((f) => /theme-a(\.css|[\\/].*\.css)$/.test(f));
const css = themeA.map(read).join("\n");
for (const [re, what] of [[/\b(Segoe|Arial|Times|Helvetica|Georgia|serif|sans-serif|system-ui)\b/i, "a system font"], [/#000\b|#000000\b|\brgb\(0,\s*0,\s*0\)|:\s*black\b/i, "pure black"]]) {
  const m = css.replace(/\/\*[\s\S]*?\*\//g, "").match(re);
  if (m) bad(`static: theme-a*.css names ${what}: ${m[0]}`);
}
const overlays = [];
for (const f of files.filter((x) => x.endsWith(".tsx"))) {
  for (const m of read(f).matchAll(/className="([^"]+)"[^>]*role="(?:dialog|alertdialog|menu|tooltip)"|role="(?:dialog|alertdialog|menu|tooltip)"[^>]*className="([^"]+)"/g)) overlays.push((m[1] ?? m[2]).split(/\s+/));
}
// An overlay is styled when any one of its classes has a rule (shell-palette rides on shell-dialog).
for (const cl of overlays) if (!cl.some((c) => css.includes(`.${c}`))) bad(`static: the overlay .${cl.join(".")} has no rule in theme-a*.css`);
console.log(`static: ${themeA.length} theme-a stylesheets, ${overlays.length} overlays (${overlays.map((c) => c.join(".")).join(", ")})`);

// ---- Runtime ----
const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? null : (process.argv[i + 1] ?? true); };
if (process.argv.includes("--runtime")) {
  process.env.KRONOS_GATE_THEME = "a";
  const shots = arg("--shots");
  if (shots) mkdirSync(shots, { recursive: true });
  const g = gate("A-WINDOWS"), C = await core(g);
  // The AI run is scripted: it changes one setting of a Program, so the review offers Compare A/B.
  const jump = C.L.getEntry(C.parsed(), "program:U-AA", 78), amp = C.Q.paramsFor(C.T, "exi", jump).find((r) => r.group === "EXi1 AL-1: Amplifier EG" && r.name === "Attack Time");
  const AIP = [{ content: "", toolCalls: [{ id: "a1", name: "set_params", arguments: { key: "program:U-AA", index: 78, changes: [{ id: `${amp.ofs}.${amp.bitLo ?? 0}`, value: C.Q.readParam(jump, amp) === 40 ? 41 : 40 }] } }] }, { content: "Attack changed.", toolCalls: [] }];
  const ui = await launch(g, C, { KRONOS_E2E_AI_SCRIPT: JSON.stringify(AIP), KRONOS_E2E_AI_DELAY_MS: "2500" });
  const { win, X, seen } = ui;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = /^"?(IBM Plex Sans Condensed|IBM Plex Sans|IBM Plex Mono|Doto)"?$/;
  const FLAT = new Set(["rgb(0, 0, 0)", "rgb(255, 255, 255)", "rgb(239, 239, 239)", "rgb(240, 240, 240)", "rgb(233, 233, 237)", "rgb(245, 245, 245)"]);
  // Flat on purpose: rows, tabs and icons inside lists draw no key of their own.
  const ROW = ".group, .bank, .sec-toggle, .hit, .change, .shell-list button, .ov-list button, .sb-row, .sb-star, .sb-chip button, .dock-tabs button, .dock-key, .info-btn, .kv button, .ms-opt, .wt-handle, .program-hits button, .kb-sim, .sl-pad, .ov-bar, .fxt-list button, .kc-segs button, .kc-steps button, .pv-chip, [role='tab'], .pv-chips button";
  const audit = (label, rootSel, rowSel) => win.evaluate(({ label, rootSel, rowSel, ok, FLAT }) => {
    const re = new RegExp(ok), out = [];
    const sel = (el) => el.tagName.toLowerCase() + (el.dataset?.testid ? `[data-testid=${el.dataset.testid.replace(/[0-9]+/g, "N")}]` : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
    const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return false; const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; };
    const first = (ff) => ff.split(",")[0].trim().replace(/^"|"$/g, "");
    for (const el of document.body.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el), own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()), ctl = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName);
      if ((own || ctl) && !re.test(first(cs.fontFamily))) out.push(["font " + first(cs.fontFamily), sel(el)]);
      if (cs.backgroundColor === "rgb(0, 0, 0)" || (el.tagName !== "BODY" && (FLAT.includes(cs.backgroundColor) && (ctl || own)))) out.push(["flat colour " + cs.backgroundColor, sel(el)]);
      if (el.tagName === "BUTTON" && !el.matches(rowSel) && !el.closest(rowSel) && el.getBoundingClientRect().width > 20) {
        const raised = cs.boxShadow !== "none" || cs.backgroundImage !== "none" || (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent");
        if (!raised) out.push(["button is not a raised key", sel(el)]);
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|range|file|button|color)$/.test(el.type ?? "") && !el.closest(".kc-readout, .kc-num-over, .pv") && cs.boxShadow === "none" && cs.opacity !== "0") out.push(["input is not an inset well", sel(el)]);
    }
    const r = rootSel && document.querySelector(rootSel);
    if (rootSel && !r) out.push(["window root " + rootSel + " not found", label]);
    else if (r) { const cs = getComputedStyle(r); if (cs.backgroundImage === "none") out.push(["dialog has no textured material", sel(r)]); }
    return out;
  }, { label, rootSel, rowSel, ok: ok.source, FLAT: [...FLAT] }).then((list) => {
    const seen = new Set();
    for (const [what, s] of list) { const k = `${what} @ ${s}`; if (!seen.has(k)) { seen.add(k); bad(`${label}: ${k}`); } }
    return list.length;
  });
  const done = [], missed = [];
  const win_ = async (name, root, open, close) => {
    try {
      await open(); await wait(600);
      if (shots) await win.screenshot({ path: path.join(shots, `a-win-${name}.png`) });
      await audit(name, root, ROW); done.push(name);
    } catch (e) { missed.push(name); bad(`${name}: could not be opened: ${String(e.message).split("\n")[0]}`); }
    try { await close?.(); } catch {}
    await wait(200);
  };
  const esc = () => win.keyboard.press("Escape");
  const click = (id) => async () => X(id).click();

  await win_("welcome", null, async () => {});
  await ui.openFile();
  await ui.openBank("program:INT-B");
  await win_("home", null, async () => {});
  await win_("settings", ".settings-dialog", click("settings-open"), click("settings-close"));
  await win_("help", ".shell-dialog", click("shell-help-button"), esc);
  await win_("packs", null, click("exchange-open"), click("exchange-open"));
  await win_("recent", ".shell-pop", click("shell-recent-button"), esc);
  await win_("history", null, click("shell-history-button"), esc);
  await win_("palette", ".shell-palette", () => win.keyboard.press("Control+k"), esc);
  await win_("overview", null, click("overview-open"), click("overview-close"));
  await win_("backup-manager", null, click("backupmgr-open-panel"), async () => {});
  await win_("sound-browser", null, click("sounds-open"), click("sounds-open"));
  await win_("bank-tools", null, click("banktools-open"), esc);
  await win_("set-lists-edit", null, async () => { await X("bank-setlist:SET").click(); await wait(500); await X("setlists-open").click(); await seen("setlists-panel"); await X("setlists-view-edit").click(); }, async () => {});
  await win_("set-lists-play", null, async () => { await X("setlists-view-play").click(); }, async () => { await X("setlists-exit").click(); await X("setlists-open").click(); });
  await ui.editSlot("program:INT-A", 0);
  await win_("info-pop", ".info-pop", async () => { await X("view-panel").click(); await win.locator("button.info-btn:visible").first().click(); }, esc);
  await win_("effects", null, click("effects-open"), () => win.getByText("Close effects", { exact: true }).click());
  await win_("effect-type-picker", ".fxt-dlg", async () => { await ui.closeEditor(); await ui.editSlot("program:INT-B", 0); await X("view-kronos").click(); await seen("kronos-view"); await X("kv-page-0-P8").click(); await X("kv-tab-8-7").click(); await X("kv-ifx-1").click(); await X("fxt-button").click(); }, esc);
  await ui.connectSim();
  await win_("confirm", ".modal", async () => { await X("store-bank").click(); await seen("confirm-ok"); }, click("confirm-cancel"));
  await win_("ai-window", ".ai-panel", async () => { await X("ai-open").click(); await seen("ai-prompt"); });
  await win_("ai-working", ".ai-panel", async () => { await X("ai-prompt").fill("bass left, brass right"); await X("ai-go").click(); await wait(800); });
  await win_("ai-review", ".ai-panel", async () => { await seen("ai-approve", 30000); });
  await win_("ai-ab-bar", null, async () => { await X("ab-open-ai").click(); await seen("ab-bar"); }, async () => { if (shots) await win.screenshot({ path: path.join(shots, "a-win-ai-ab-bar-state.png") }); });
  console.log(`windows checked: ${done.length} (${done.join(", ")})${missed.length ? `; not reached: ${missed.join(", ")}` : ""}`);
  console.log(offenders.length ? `\nOFFENDERS (${offenders.length})\n- ${offenders.join("\n- ")}` : "\ncheck-a-windows: ok");
  if (offenders.length) g.fails.push(`${offenders.length} offenders`);
  await g.finish();
}

console.log(offenders.length ? `\nOFFENDERS (${offenders.length})\n- ${offenders.join("\n- ")}` : "\ncheck-a-windows: ok");
process.exit(offenders.length ? 1 : 0);
