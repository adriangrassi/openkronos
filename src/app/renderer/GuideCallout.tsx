// The Ask & show walkthrough's floating tip: sits beside the control of the current step, with Next, Back, Cancel and Do it for me.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { placeCallout, type Rect } from "../../core/ai/calloutPlace.ts";
import { stepWrites } from "../../core/ai/layer.ts";
import { pointRow, type PointAt } from "../../core/ai/point.ts";
import { changeEffectType } from "../../core/params/effects.ts";
import { formatValue, paramsFor, readParam, writeParam, type ParamTables, type ParamType } from "../../core/params/params.ts";
import { getEntry, setEntry } from "../../core/pcg/library.ts";
import type { Workspace } from "./document.ts";
import "./GuideCallout.css";

type Props = {
  ws: Workspace; tables: ParamTables; target: { key: string; index: number }; type: ParamType; rev: number;
  point: PointAt; index: number; total: number; settled: boolean; onChanged: () => void;
  onNext: () => void; onBack: () => void; onCancel: () => void; onOpen: () => void;
  ab?: { why: string | null; open: () => void }; // set only while a before state exists
};

const W = 300, DOCK_W = 420;
const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom);
const plain = (r: DOMRect | undefined): Rect | null => (r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null);

export function GuideCallout({ ws, tables, target, type, rev, point, index, total, settled, onChanged, onNext, onBack, onCancel, onOpen, ab }: Props) {
  const step = point.steps![0];
  const [rect, setRect] = useState<Rect | null>(null);
  const [dock, setDock] = useState<Rect | null>(null);
  const [size, setSize] = useState({ w: W, h: 150 });
  const [missing, setMissing] = useState(false);
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const scrolled = useRef<PointAt | null>(null);

  const cur = getEntry(ws.file, target.key, target.index);
  const isNote = step.kind === "note"; // an instruction with no control to anchor to: always docked
  const { row, writes } = useMemo(() => {
    const all = paramsFor(tables, type, cur), r = pointRow(all, cur, step.id);
    return { row: r, writes: stepWrites(all, step, r) };
  }, [tables, type, step.id, rev]);
  const now = row ? formatValue(row, readParam(cur, row), tables) : "";
  const suggested = row && step.suggest !== undefined ? formatValue(row, step.suggest, tables) : null;
  const atSuggest = writes.length > 0 && writes.every(([r, v]) => readParam(cur, r) === v);
  const why = !row ? "This setting cannot be written from here" : ws.running ? "The AI is still working: wait for it to finish or cancel it" : ws.isHeld(target.key, target.index) ? "Keep or Discard the AI changes first" : atSuggest ? "Already at the suggested value" : null;

  // Finds the highlighted control and measures it; one rAF per burst of layout changes, and it only re-renders when a rectangle moved.
  const measure = useCallback(() => {
    const el = Array.from(document.querySelectorAll('[data-pointed="true"]')).find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const r = el?.getBoundingClientRect();
    if (el && r && scrolled.current !== point) {
      scrolled.current = point;
      if (r.top < 8 || r.bottom > window.innerHeight - 8 || r.left < 0 || r.right > window.innerWidth) el.scrollIntoView({ block: "center", inline: "nearest" });
    }
    const next = plain(el?.getBoundingClientRect());
    setRect((p) => (sameRect(p, next) ? p : next));
    const d = plain(document.querySelector(".editor")?.getBoundingClientRect());
    setDock((p) => (sameRect(p, d) ? p : d));
  }, [point]);
  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; measure(); });
  }, [measure]);

  useEffect(() => {
    schedule();
    const root = document.querySelector("main.slots") ?? document.body;
    const mo = new MutationObserver(schedule);
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-pointed", "style", "class", "hidden", "open"] });
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => { mo.disconnect(); ro.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [schedule]);
  useEffect(() => { setErr(""); setDone(null); }, [step.id]);
  // The target may not be on screen yet while the editors open it; only after a short wait does the tip dock and offer Open it.
  useEffect(() => {
    if (rect || !settled) { setMissing(false); return; }
    const t = setTimeout(() => setMissing(true), 500);
    return () => clearTimeout(t);
  }, [!!rect, settled, point]);
  useLayoutEffect(() => {
    const b = boxRef.current;
    if (b && (b.offsetHeight !== size.h || b.offsetWidth !== size.w)) setSize({ w: b.offsetWidth, h: b.offsetHeight });
  });

  useEffect(() => {
    // Capture phase: the first Escape ends the tour instead of also closing the AI window the question came from; a modal dialog keeps its own Escape.
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".scrim, .settings-back")) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
      if (e.key === "Enter" && !(e.target as HTMLElement | null)?.closest?.("input, textarea, select, button, [contenteditable]")) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onNext, onCancel]);

  async function apply() {
    if (!row || writes.length === 0 || step.suggest === undefined || why) return;
    const v = step.suggest;
    try {
      await ws.apply([{ key: target.key, index: target.index }], () => {
        const e = getEntry(ws.file, target.key, target.index);
        for (const [r, x] of writes) {
          if (r.name === "Effect Type") changeEffectType(e, r.ofs, x);
          else writeParam(e, r, x);
        }
        setEntry(ws.file, target.key, target.index, e);
      });
      setErr("");
      setDone({ id: step.id, text: formatValue(row, v, tables) });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const docked = isNote || (settled && missing && !rect);
  if (!rect && !docked) return null;
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const avoid = Array.from(document.querySelectorAll(".ai-panel, .ab-bar")).map((e) => e.getBoundingClientRect());
  const placed = rect ? placeCallout(rect, size, vp, 12, 8, avoid) : null;
  const dl = Math.max(8, (dock?.left ?? 0) + 8), dt = Math.max(8, (dock?.top ?? 48) + 8);
  let dw = Math.min(DOCK_W, (dock ? dock.right - dock.left : vp.w) - 16);
  // The docked tip narrows to stop short of the AI window or A/B bar it would otherwise cover, when that leaves it wide enough to read.
  for (const a of avoid) if (a.right > dl && a.left < dl + dw && a.bottom > dt && a.top < dt + size.h && a.left - 8 - dl >= 240) dw = a.left - 8 - dl;
  const style: CSSProperties & Record<string, string | number> = placed
    ? { left: placed.left, top: placed.top, width: W, "--arrow": `${placed.arrow}px` }
    : { left: dl, top: dt, width: dw };
  const last = index === total - 1;
  return (
    <div ref={boxRef} className="guide" data-testid="guide-callout" data-side={placed?.side ?? "dock"} data-docked={docked ? "true" : undefined} role="dialog" aria-label={`Step ${index + 1} of ${total}: ${point.names[0]}`} style={style}>
      <div className="guide-step" data-testid="guide-step">Step {index + 1} of {total}</div>
      <div className="guide-name" data-testid="guide-name">{point.names[0]}</div>
      <div className="guide-note" data-testid="guide-note">{step.note}</div>
      {!isNote && (
        <dl className="guide-vals">
          <dt>Now</dt>
          <dd data-testid="guide-now">{now}</dd>
          {suggested !== null && (
            <>
              <dt>Suggested</dt>
              <dd data-testid="guide-suggest">{suggested}</dd>
            </>
          )}
        </dl>
      )}
      {docked && !isNote && <p className="guide-lost" data-testid="guide-lost">The control for this setting is not on screen.</p>}
      {done?.id === step.id && <p className="guide-ok" data-testid="guide-done" role="status">Set to {done.text}. Undo puts it back.</p>}
      {err && <p className="guide-err" role="alert">{err}</p>}
      {((docked && !isNote) || step.suggest !== undefined) && (
        <div className="guide-buttons">
          {docked && !isNote && <button type="button" data-testid="guide-open" onClick={onOpen}>Open it</button>}
          {step.suggest !== undefined && <button type="button" data-testid="guide-apply" disabled={why !== null} title={why ?? "Set this to the suggested value"} onClick={() => void apply()}>Do it for me</button>}
        </div>
      )}
      <div className="guide-buttons">
        <button type="button" data-testid="guide-cancel" onClick={onCancel}>Cancel</button>
        {ab && <button type="button" data-testid="ab-open-guide" disabled={ab.why !== null} title={ab.why ?? "Hear this sound before and after the changes, on the keyboard"} onClick={ab.open}>A/B</button>}
        <span className="guide-gap" />
        <button type="button" data-testid="guide-back" disabled={index === 0} onClick={onBack}>Back</button>
        <button type="button" className="primary" data-testid="guide-next" onClick={onNext}>{last ? "Done" : "Next"}</button>
      </div>
    </div>
  );
}
