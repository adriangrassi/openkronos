// Shift-click on a control asks the AI about it. One capture-phase listener on the document finds the control under the pointer and sends a 'kronos-explain' event; AiPanel does the asking.
import { useEffect } from "react";
import type { Row } from "../../core/params/params.ts";
import { humanizeId, type ControlKind, type ExplainCtx } from "../../core/ai/explain.ts";
import { keyOf } from "../../core/pages/view.ts";

// What the parameter controls on screen show right now, filled in as they render, so a click can read the value and range without guessing from text.
type ParamInfo = { r: Row; label?: string; text: () => string };
const registry = new Map<string, ParamInfo>();
export const registerParam = (r: Row, text: () => string, label?: string): void => void registry.set(keyOf(r), { r, label, text });
export const paramAttrs = (r: Row, label?: string) => ({ "data-param-id": keyOf(r), "data-param-label": label || r.name, "data-param-group": r.group });

const TOLERANCE = 4;
const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="slider"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="radio"], [role="combobox"], [role="spinbutton"], [tabindex]:not([tabindex="-1"]), [data-param-id], [data-explain]';
// The piano keys type their note name into the AI prompt on Shift-click, so they stay out of this.
const EXCLUDED = '[data-testid^="dock-key-"]';
const ROOT_KIND: [string, ControlKind][] = [["kc-dial", "dial"], ["kc-fader", "fader"], ["kc-box", "number"], ["kc-field", "number"], ["kc-check", "checkbox"], ["kc-toggle", "toggle"], ["kc-pick", "select"], ["kc-radios", "select"], ["kc-choice", "select"], ["kc-seg", "select"], ["param-row", "slider"]];
const SYMBOLS = /^[\s\p{P}\p{S}\d]*$/u;

const textOf = (el: Element | null | undefined, max = 60): string => {
  const t = (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  return t.length > max || SYMBOLS.test(t) ? "" : t;
};

const isTextEntry = (el: Element): boolean => el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable) || (el instanceof HTMLInputElement && ["text", "search", "number", "email", "url", "password", "tel"].includes(el.type));

// A box the owner is already typing in keeps its text selection; an unfocused one is a control like any other.
const typing = (el: Element): boolean => isTextEntry(el) && document.activeElement === el;

export function controlAt(target: EventTarget | null, x: number, y: number): HTMLElement | null {
  const t = target instanceof Element ? target : null;
  if (t?.closest(EXCLUDED)) return null;
  let el = t?.closest<HTMLElement>(INTERACTIVE) ?? null;
  if (!el && t) {
    // A disabled control may not report the pointer: hit-test the disabled ones under the nearest wrapper by position.
    const scope = t.closest("[data-testid]") ?? document.body;
    const hit = [...scope.querySelectorAll<HTMLElement>("button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled='true']")].filter((d) => { const b = d.getBoundingClientRect(); return b.width > 0 && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
    el = hit.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0] ?? null;
  }
  if (!el) {
    // cursor is inherited, so a pointer under a pointer parent is the parent's, not a control of its own.
    const c = t?.closest<HTMLElement>("[data-testid]");
    if (c && getComputedStyle(c).cursor === "pointer" && (!c.parentElement || getComputedStyle(c.parentElement).cursor !== "pointer")) el = c;
  }
  if (!el || typing(el)) return null;
  return el;
}

const isDisabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || !!el.closest("fieldset:disabled");

const labelledBy = (el: HTMLElement): string => (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(" ");
const labelFor = (el: HTMLElement): string => {
  const own = ((el as HTMLInputElement).labels ? [...(el as HTMLInputElement).labels!] : []).map((l) => textOf(l)).find(Boolean) ?? "";
  return own || textOf(el.closest("label"));
};

export type Resolved = { ctx: ExplainCtx; source: "param" | "aria" | "label" | "title" | "text" | "testid" | "none" };

export function resolveControl(el: HTMLElement): Resolved {
  const testid = el.closest<HTMLElement>("[data-testid]")?.dataset.testid ?? el.dataset.testid;
  const isInfo = el.classList.contains("info-btn");
  const root = isInfo ? null : el.closest<HTMLElement>("[data-param-id]");
  const hint = el.getAttribute("title") ?? undefined;
  const disabled = isDisabled(el);
  const dialog = el.closest<HTMLElement>('[role="dialog"][aria-label]')?.getAttribute("aria-label") ?? undefined;
  const pageBtn = document.querySelector<HTMLElement>('[data-testid^="kv-page-"][aria-pressed="true"], [data-testid^="kb-page-"][aria-pressed="true"], [data-testid^="kb-tab-"][aria-pressed="true"]');
  const base: ExplainCtx = { label: "", testid, hint, disabled, page: dialog ?? (textOf(pageBtn) || undefined) };
  if (root) {
    const info = registry.get(root.dataset.paramId!);
    const r = info?.r;
    const kind = ROOT_KIND.find(([c]) => root.classList.contains(c))?.[1] ?? "other";
    const label = (root.dataset.paramLabel ?? r?.name ?? "").replace(/\s*:\s*$/, "");
    const ctx: ExplainCtx = { ...base, label, kind, group: root.dataset.paramGroup || r?.group, testid: root.dataset.testid ?? testid };
    if (r) { ctx.min = r.rawMin; ctx.max = r.rawMax; ctx.value = info!.text(); }
    return { ctx, source: label ? "param" : "none" };
  }
  const kind: ControlKind = el instanceof HTMLSelectElement || el.getAttribute("role") === "combobox" ? "select"
    : el instanceof HTMLInputElement ? (el.type === "range" ? (el.classList.contains("kc-fader-input") ? "fader" : "slider") : el.type === "checkbox" || el.type === "radio" ? (el.type === "radio" ? "toggle" : "checkbox") : el.type === "number" ? "number" : "text")
    : el instanceof HTMLTextAreaElement ? "text"
    : el.getAttribute("role") === "slider" ? "slider" : el.getAttribute("role") === "tab" || /(^|-)(tab|page)-/.test(testid ?? "") ? "tab"
    : el.getAttribute("role") === "switch" ? "toggle" : el.getAttribute("role") === "checkbox" ? "checkbox" : /^fxc?-|node/.test(testid ?? "") ? "node" : "button";
  const own = el.closest<HTMLElement>("[data-explain-value]");
  if (own) base.value = own.dataset.explainValue;
  else if (el instanceof HTMLInputElement && el.type !== "button") base.value = el.type === "checkbox" || el.type === "radio" ? (el.checked ? "on" : "off") : el.value;
  else if (el instanceof HTMLSelectElement) base.value = el.selectedOptions[0]?.textContent ?? el.value;
  else if (el.getAttribute("aria-pressed") !== null) base.value = el.getAttribute("aria-pressed") === "true" ? "on" : "off";
  else if (el.getAttribute("aria-checked") !== null) base.value = el.getAttribute("aria-checked") === "true" ? "on" : "off";
  if (el instanceof HTMLInputElement && el.type === "range") { base.min = Number(el.min); base.max = Number(el.max); }
  const tries: [Resolved["source"], string][] = [
    ["aria", el.closest<HTMLElement>("[data-explain]")?.dataset.explain ?? ""], ["aria", el.getAttribute("aria-label") ?? ""], ["aria", labelledBy(el)], ["label", labelFor(el)], ["text", textOf(el)], ["title", hint ?? ""],
  ];
  const hit = tries.find(([, s]) => s.trim());
  if (hit) return { ctx: { ...base, kind, label: hit[1].trim() }, source: hit[0] };
  const id = humanizeId(testid ?? "");
  return { ctx: { ...base, kind, label: id }, source: id ? "testid" : "none" };
}

export function useExplain(): void {
  useEffect(() => {
    let down: { x: number; y: number; el: HTMLElement; range: string | null; moved: boolean } | null = null;
    let swallowUntil = 0;
    const onDown = (e: PointerEvent) => {
      down = null;
      if (!e.shiftKey || e.button !== 0 || !e.isPrimary) return;
      const el = controlAt(e.target, e.clientX, e.clientY);
      if (el) down = { x: e.clientX, y: e.clientY, el, range: el instanceof HTMLInputElement && el.type === "range" ? el.value : null, moved: false };
    };
    const onMove = (e: PointerEvent) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TOLERANCE) down.moved = true; };
    // A range input jumps to the click point on pointerdown and some of them send at once: hold back its input events until the pointer has moved (a real drag).
    const hold = (e: Event) => { if (down && down.range !== null && !down.moved && e.target === down.el) e.stopImmediatePropagation(); };
    // A pointer that already moved is a drag (fine adjust), not a click; a disabled control gets no click at all, so ask on pointerup.
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TOLERANCE) return;
      // The browser jumped the slider to the click point without telling the page: put it back, silently.
      if (d.range !== null) (d.el as HTMLInputElement).value = d.range;
      swallowUntil = Date.now() + 700;
      const found = resolveControl(d.el);
      // The coverage gate sets this flag to read what each control resolves to without opening the AI window.
      if ((window as { __kronosExplainProbe?: boolean }).__kronosExplainProbe) window.dispatchEvent(new CustomEvent("kronos-explain-probe", { detail: found }));
      else window.dispatchEvent(new CustomEvent("kronos-explain", { detail: found.ctx }));
    };
    const stop = (e: Event) => { if (Date.now() < swallowUntil && (e as MouseEvent).shiftKey) { e.preventDefault(); e.stopPropagation(); } };
    // A select would open its list and a text box would take focus on mousedown.
    const onMouse = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0) return;
      const el = controlAt(e.target, e.clientX, e.clientY);
      if (el && (el instanceof HTMLSelectElement || isTextEntry(el))) e.preventDefault();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("input", hold, true);
    document.addEventListener("change", hold, true);
    document.addEventListener("mousedown", onMouse, true);
    document.addEventListener("click", stop, true);
    document.addEventListener("dblclick", stop, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("input", hold, true);
      document.removeEventListener("change", hold, true);
      document.removeEventListener("mousedown", onMouse, true);
      document.removeEventListener("click", stop, true);
      document.removeEventListener("dblclick", stop, true);
    };
  }, []);
}

