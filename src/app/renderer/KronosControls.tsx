// Graphical controls for the Kronos view: dial, lit toggle, segmented row, drop-down, fader, panel frame. Every edit goes out as onCommit(text), the path ParamRow uses.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref, type RefObject, type WheelEvent } from "react";
import type { Row } from "../../core/params/params.ts";
import { keyOf } from "../../core/pages/view.ts";
import { bipolarOf, controlKind, type ControlKind } from "../../core/pages/controls.ts";
import { angleOf, arcPath, dragPos, fracOf, resetValue, stepValue, wheelNotch, wheelValue } from "../../core/pages/dial.ts";
import { DetentMark, DialCap, DialFace, FADER_CAP, FaderFace, MiniEncoder } from "./theme-a/Faces.tsx";
import { faderCapTop, radialAt } from "./theme-a/face.ts";
import { useThemeA } from "./theme-a/useTheme.ts";
import { paramAttrs, registerParam } from "./explain.ts";
import "./KronosControls.css";

export type CtlProps = {
  r: Row;
  value: number;
  // The saved value: a double click on a dial goes back to it.
  base: number;
  changed: boolean;
  pointed?: boolean;
  // Value text for any value of this row.
  fmt: (v: number) => string;
  onCommit: (text: string) => void;
  // Overrides: the label, and where a dial's arc starts (fraction of the sweep).
  label?: string;
  centre?: number | null;
};

const textsCache = new WeakMap<Row, string[]>();
// Value texts of every value, only for rows small enough to draw as a choice or a dial.
export function textsOf(r: Row, fmt: (v: number) => string): string[] {
  let t = textsCache.get(r);
  if (!t) {
    t = r.rawMax - r.rawMin <= 255 ? Array.from({ length: r.rawMax - r.rawMin + 1 }, (_, i) => fmt(r.rawMin + i)) : [];
    textsCache.set(r, t);
  }
  return t;
}
export const kindOf = (r: Row, fmt: (v: number) => string): ControlKind => controlKind(r, textsOf(r, fmt));

const rootProps = (p: CtlProps, cls: string) => {
  registerParam(p.r, () => p.fmt(p.value));
  return {
    className: `kc ${cls}${p.pointed ? " pointed" : ""}`,
    "data-testid": `param-${keyOf(p.r)}`,
    "data-changed": p.changed ? "true" : "false",
    "data-pointed": p.pointed ? "true" : undefined,
    ...paramAttrs(p.r, p.label),
  };
};

// The draft follows the stored value (an undo, a commit, a load); typing does not change it until Enter or blur.
function NumberBox({ r, value, onCommit, className, ref }: { r: Row; value: number; onCommit: (t: string) => void; className?: string; ref?: Ref<HTMLInputElement> }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      ref={ref}
      data-testid={`input-${keyOf(r)}`}
      className={`kc-num ${className ?? ""}`}
      type="number"
      aria-label={r.name}
      min={r.rawMin}
      max={r.rawMax}
      step={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onCommit(draft); }}
      onBlur={() => onCommit(draft)}
    />
  );
}

// The wheel listener has to be non-passive to stop the page scrolling under a control; the handler is read through a ref, so one listener serves every render.
function useWheel(ref: RefObject<Element | null>, on: (e: globalThis.WheelEvent) => void, block: boolean): void {
  const h = useRef(on);
  h.current = on;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = ((e: globalThis.WheelEvent) => { if (block) e.preventDefault(); h.current(e); }) as EventListener;
    el.addEventListener("wheel", f, { passive: !block });
    return () => el.removeEventListener("wheel", f);
  }, [ref, block]);
}

// Drags repaint at most once a frame: paint() keeps the latest value, flush() drops the pending frame.
function useFrame(apply: (n: number) => void): { paint: (n: number) => void; flush: () => void } {
  const raf = useRef(0), pend = useRef<number | null>(null), fn = useRef(apply);
  fn.current = apply;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return {
    paint: (n) => {
      pend.current = n;
      if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; if (pend.current !== null) fn.current(pend.current); });
    },
    flush: () => { cancelAnimationFrame(raf.current); raf.current = 0; pend.current = null; },
  };
}

export function Dial(p: CtlProps & { size?: number; help?: React.ReactNode }) {
  const { r, value, fmt, onCommit } = p;
  const themeA = useThemeA();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ y: number; pos: number; v: number; last: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [live, setLive] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const frame = useFrame(setLive);
  useEffect(() => setLive(null), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const v = live ?? value;
  const f = fracOf(v, r.rawMin, r.rawMax);
  const c = p.centre === undefined ? (bipolarOf(r) === null ? null : fracOf(0, r.rawMin, r.rawMax)) : p.centre;
  const a = angleOf(v, r.rawMin, r.rawMax);
  const tip = (rad: number): [number, number] => [32 + rad * Math.sin((a * Math.PI) / 180), 32 - rad * Math.cos((a * Math.PI) / 180)];
  const set = (n: number, now: boolean) => {
    setLive(n);
    window.clearTimeout(timer.current);
    if (now) onCommit(String(n));
    else timer.current = window.setTimeout(() => onCommit(String(n)), 250);
  };
  useWheel(svg, (e) => set(themeA ? wheelNotch(v, e.deltaX, e.deltaY, r.rawMin, r.rawMax, e.shiftKey) : wheelValue(v, e.deltaY, r.rawMin, r.rawMax), false), themeA);
  const onKey = (e: KeyboardEvent) => {
    if (themeA && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      set(e.key === "Home" ? r.rawMin : r.rawMax, true);
      return;
    }
    const step = e.shiftKey || e.key === "PageUp" || e.key === "PageDown" ? 10 : 1;
    const dir = e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "PageUp" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "PageDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    set(Math.min(r.rawMax, Math.max(r.rawMin, v + dir * step)), true);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    frame.flush();
    setActive(false);
    if (!d) return;
    setLive(d.last);
    if (d.last !== d.v) onCommit(String(d.last));
  };
  const [x1, y1] = tip(8), [x2, y2] = tip(15);
  return (
    <div {...rootProps(p, "kc-dial")} style={{ width: p.size }}>
      {p.label !== "" && <span className="kc-name">{p.label ?? r.name}{p.help}</span>}
      {themeA && active && <span className="ta-tip" aria-hidden="true">{fmt(v)}</span>}
      <svg
        ref={svg}
        className="kc-dial-svg"
        viewBox={themeA ? "-4 -4 72 72" : "0 0 64 64"}
        shapeRendering={themeA ? "geometricPrecision" : undefined}
        role="slider"
        tabIndex={0}
        aria-label={r.name}
        aria-valuemin={r.rawMin}
        aria-valuemax={r.rawMax}
        aria-valuenow={v}
        aria-valuetext={fmt(v)}
        onKeyDown={onKey}
        onPointerDown={(e: PointerEvent<SVGSVGElement>) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, pos: v, v, last: v };
          if (themeA) setActive(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.pos = dragPos(d.pos, d.y - e.clientY, r.rawMin, r.rawMax, e.shiftKey);
          d.y = e.clientY;
          const n = Math.round(d.pos);
          if (n !== d.last) { d.last = n; frame.paint(n); }
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => onCommit(String(themeA ? resetValue(p.base, r.rawMin, r.rawMax) : p.base))}
      >
        <path className="kc-track" d={arcPath(32, 32, 26, 0, 1)} />
        <path className="kc-arc" d={arcPath(32, 32, 26, c ?? 0, f)} />
        {themeA ? (
          <>
            <DetentMark cx={32} cy={32} r0={23.2} r1={28.6} centre={c} />
            <DialFace cx={32} cy={32} rb={19.5} tr={29.4} />
            <DialCap cx={32} cy={32} rc={15.4} />
            <line className="kc-tick" {...radialAt(32, 32, 4.5, 13.2, f)} />
          </>
        ) : (
          <>
            {c !== null && <line className="kc-centre" x1="32" y1="2" x2="32" y2="8" />}
            <circle className="kc-cap" cx="32" cy="32" r="17" />
            <line className="kc-tick" x1={x1} y1={y1} x2={x2} y2={y2} />
          </>
        )}
      </svg>
      <label className="kc-readout">
        <span className="kc-value" data-testid={`value-${keyOf(r)}`}>{fmt(v)}</span>
        <NumberBox r={r} value={value} onCommit={onCommit} className="kc-num-over" />
      </label>
    </div>
  );
}

const clampTo = (v: number, r: Row): number => Math.min(r.rawMax, Math.max(r.rawMin, v));

// The numeric box of the real screens: value text in a frame; drag up or down, wheel, the arrows, or click and type.
export function BoxField(p: CtlProps & { encoder?: boolean }) {
  const { r, value, fmt, onCommit } = p;
  const themeA = useThemeA();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ y: number; pos: number; v: number; last: number; moved: boolean; yTotal: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const frame = useFrame(setLive);
  useEffect(() => setLive(null), [value]);
  const v = live ?? value;
  // Shows the new value at once, so a second press before the file write lands builds on it.
  const step = (dir: 1 | -1, big = false) => { const n = stepValue(v, dir, big, r.rawMin, r.rawMax); setLive(n); onCommit(String(n)); };
  useWheel(root, (e) => {
    if (!themeA) return;
    const n = wheelNotch(v, e.deltaX, e.deltaY, r.rawMin, r.rawMax, e.shiftKey);
    if (n !== v) { setLive(n); onCommit(String(n)); }
  }, themeA);
  // The value and the encoder beside it drag the same way.
  const grab = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, pos: v, v, last: v, moved: false, yTotal: 0 };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      d.yTotal += d.y - e.clientY;
      if (Math.abs(d.yTotal) > 3) d.moved = true;
      if (d.moved) {
        d.pos = dragPos(d.pos, d.y - e.clientY, r.rawMin, r.rawMax, e.shiftKey);
        const n = Math.round(d.pos);
        if (n !== d.last) { d.last = n; frame.paint(n); }
      }
      d.y = e.clientY;
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      frame.flush();
      if (!d) return;
      if (!d.moved) input.current?.focus();
      else { setLive(d.last); if (d.last !== d.v) onCommit(String(d.last)); }
    },
  };
  return (
    <div ref={root} {...rootProps(p, "kc-box")} onWheel={themeA ? undefined : (e: WheelEvent) => step(e.deltaY < 0 ? 1 : -1, e.shiftKey)}>
      {themeA && p.encoder && <MiniEncoder v={v} min={r.rawMin} max={r.rawMax} centre={bipolarOf(r) === null ? null : fracOf(0, r.rawMin, r.rawMax)} handlers={grab} />}
      <div className="kc-boxframe">
        <span className="kc-value kc-boxval" data-testid={`value-${keyOf(r)}`} {...grab}>{fmt(v)}</span>
        <NumberBox ref={input} r={r} value={value} onCommit={onCommit} className="kc-num-over kc-box-input" />
        <span className="kc-steps" aria-hidden="true">
          <button type="button" tabIndex={-1} onClick={(e) => step(1, e.shiftKey)} />
          <button type="button" tabIndex={-1} onClick={(e) => step(-1, e.shiftKey)} />
        </span>
      </div>
    </div>
  );
}

export function Check(p: CtlProps) {
  const { r, value, onCommit } = p;
  return (
    <div {...rootProps(p, "kc-check")}>
      <label>
        <input data-testid={`input-${keyOf(r)}`} type="checkbox" aria-label={r.name} checked={value === r.rawMax} onChange={(e) => onCommit(String(e.target.checked ? r.rawMax : r.rawMin))} />
        <i className="kc-checkbox" aria-hidden="true" />
        <span className="kc-name">{p.label ?? r.name}</span>
      </label>
      <span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{p.fmt(value)}</span>
    </div>
  );
}

// A pop-up list with the round arrow icon of the real screens; radio: the choices side by side as radio buttons.
export function Pick(p: CtlProps & { radio?: boolean }) {
  const { r, value, fmt, onCommit } = p;
  const items = Array.from({ length: r.rawMax - r.rawMin + 1 }, (_, i) => r.rawMin + i);
  return (
    <div {...rootProps(p, p.radio ? "kc-radios" : "kc-pick")}>
      {p.radio ? (
        <div role="radiogroup" aria-label={r.name} data-testid={`input-${keyOf(r)}`}>
          {items.map((n) => (
            <label key={n}>
              <input type="radio" name={`r-${keyOf(r)}`} checked={n === value} onChange={() => onCommit(String(n))} />
              <i className="kc-radio" aria-hidden="true" />
              {fmt(n)}
            </label>
          ))}
        </div>
      ) : (
        <label className="kc-pickbox">
          <i className="kc-pick-ico" aria-hidden="true" />
          <select data-testid={`input-${keyOf(r)}`} aria-label={r.name} value={value} onChange={(e) => onCommit(e.target.value)}>
            {items.map((n) => <option key={n} value={n}>{fmt(n)}</option>)}
          </select>
        </label>
      )}
      <span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span>
    </div>
  );
}

export function Toggle(p: CtlProps) {
  const { r, value, onCommit } = p;
  const on = value === r.rawMax;
  return (
    <div {...rootProps(p, "kc-toggle")}>
      <button type="button" role="switch" data-testid={`input-${keyOf(r)}`} className="kc-btn" aria-label={r.name} aria-checked={on} onClick={() => onCommit(String(on ? r.rawMin : r.rawMax))}>
        <i className="kc-led" />
        <span className="kc-name">{p.label ?? r.name}</span>
      </button>
      <span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{p.fmt(value)}</span>
    </div>
  );
}

export function Segmented(p: CtlProps) {
  const { r, value, fmt, onCommit } = p;
  const items = Array.from({ length: r.rawMax - r.rawMin + 1 }, (_, i) => r.rawMin + i);
  return (
    <div {...rootProps(p, "kc-seg")}>
      <span className="kc-name">{p.label ?? r.name}</span>
      <div className="kc-segs" role="radiogroup" aria-label={r.name} data-testid={`input-${keyOf(r)}`}>
        {items.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === value} data-active={String(n === value)} onClick={() => n !== value && onCommit(String(n))}>
            {fmt(n)}
          </button>
        ))}
      </div>
      <span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span>
    </div>
  );
}

export function Choice(p: CtlProps) {
  const { r, value, fmt, onCommit } = p;
  const items = Array.from({ length: r.rawMax - r.rawMin + 1 }, (_, i) => r.rawMin + i);
  return (
    <div {...rootProps(p, "kc-choice")}>
      <span className="kc-name">{p.label ?? r.name}</span>
      <select data-testid={`input-${keyOf(r)}`} className="kc-select" aria-label={r.name} value={value} onChange={(e) => onCommit(e.target.value)}>
        {items.map((n) => <option key={n} value={n}>{fmt(n)}</option>)}
      </select>
      <span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span>
    </div>
  );
}

// Wide numeric rows (more than 128 steps): value text, a number box and a fill bar; the wheel nudges.
export function Field(p: CtlProps) {
  const { r, value, fmt, onCommit } = p;
  const [slide, setSlide] = useState(value);
  useEffect(() => setSlide(value), [value]);
  return (
    <div {...rootProps(p, "kc-field")} onWheel={(e) => onCommit(String(wheelValue(value, e.deltaY, r.rawMin, r.rawMax)))}>
      <span className="kc-name">{p.label ?? r.name}</span>
      <span className="kc-value" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span>
      <NumberBox r={r} value={value} onCommit={onCommit} />
      <input data-testid={`slider-${keyOf(r)}`} className="kc-bar" type="range" aria-label={`${r.name} slider`} min={r.rawMin} max={r.rawMax} step={1} value={slide} style={{ ["--p" as string]: `${fracOf(slide, r.rawMin, r.rawMax) * 100}%` }} onChange={(e) => setSlide(Number(e.target.value))} onPointerUp={(e) => onCommit(e.currentTarget.value)} onKeyUp={(e) => onCommit(e.currentTarget.value)} />
    </div>
  );
}

export function ReadOnly(p: CtlProps) {
  return (
    <div {...rootProps(p, "kc-field kc-ro")}>
      <span className="kc-name">{p.label ?? p.r.name}</span>
      <span className="kc-value" data-testid={`value-${keyOf(p.r)}`}>{p.fmt(p.value)}</span>
    </div>
  );
}

// Vertical fader over a real range input (keyboard and assistive tech), with a number box. Commits once on release.
// Style A adds the wheel (Shift is 1 step), a double click back to the saved value and a floating readout while the cap is held.
export function Fader(p: CtlProps & { height?: number; hideName?: boolean; help?: React.ReactNode }) {
  const { r, value, onCommit } = p;
  const themeA = useThemeA();
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [slide, setSlide] = useState(value);
  const [active, setActive] = useState(false);
  useEffect(() => setSlide(value), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const h = p.height ?? 90;
  const f = fracOf(slide, r.rawMin, r.rawMax);
  useWheel(wrap, (e) => {
    const n = wheelNotch(slide, e.deltaX, e.deltaY, r.rawMin, r.rawMax, e.shiftKey);
    if (n === slide) return;
    setSlide(n);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCommit(String(n)), 250);
  }, themeA);
  const release = (commit: boolean, el: HTMLInputElement) => { setActive(false); if (commit) onCommit(el.value); };
  const input = (
    <input
      data-testid={`slider-${keyOf(r)}`}
      className="kc-fader-input"
      type="range"
      aria-label={`${r.name} fader`}
      aria-valuetext={themeA ? p.fmt(slide) : undefined}
      min={r.rawMin}
      max={r.rawMax}
      step={1}
      value={slide}
      style={{ height: h }}
      onChange={(e) => setSlide(Number(e.target.value))}
      onPointerDown={themeA ? () => setActive(true) : undefined}
      onPointerUp={(e) => (themeA ? release(true, e.currentTarget) : onCommit(e.currentTarget.value))}
      onPointerCancel={themeA ? (e) => release(false, e.currentTarget) : undefined}
      onKeyUp={(e) => onCommit(e.currentTarget.value)}
      onDoubleClick={themeA ? () => { const n = resetValue(p.base, r.rawMin, r.rawMax); setSlide(n); onCommit(String(n)); } : undefined}
    />
  );
  return (
    <div {...rootProps(p, "kc-fader")}>
      {!p.hideName && <span className="kc-name">{p.label ?? r.name}{p.help}</span>}
      {themeA ? (
        <div ref={wrap} className="ta-fader" style={{ height: h, ["--ta-cap" as string]: `${FADER_CAP}px` }}>
          <FaderFace h={h} f={f} />
          {active && <span className="ta-tip ta-tip-fader" aria-hidden="true" style={{ top: Math.round(faderCapTop(f, h, FADER_CAP)) - 4 }}>{p.fmt(slide)}</span>}
          {input}
        </div>
      ) : input}
      <NumberBox r={r} value={value} onCommit={onCommit} className="kc-fader-box" />
      <span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{p.fmt(value)}</span>
    </div>
  );
}

// Value text with the number box over it (see .kc-num-over): the compact form for headers and table cells.
export function ValueBox({ r, value, fmt, onCommit, className }: { r: Row; value: number; fmt: (v: number) => string; onCommit: (t: string) => void; className?: string }) {
  return (
    <label className={`kc-readout ${className ?? ""}`}>
      <span className="kc-value" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span>
      <NumberBox r={r} value={value} onCommit={onCommit} className="kc-num-over" />
    </label>
  );
}

// One table cell: a lit button for two values, a drop-down for names, else the value box.
export function Cell(p: CtlProps) {
  const { r, value, fmt, onCommit } = p;
  const kind = kindOf(r, fmt);
  let body;
  if (kind === "toggle") {
    const on = value === r.rawMax;
    body = <button type="button" role="switch" data-testid={`input-${keyOf(r)}`} className="kc-btn kc-cell-btn" aria-label={r.name} aria-checked={on} onClick={() => onCommit(String(on ? r.rawMin : r.rawMax))}><i className="kc-led" /><span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span></button>;
  } else if (kind === "select" || kind === "segmented") {
    body = <><select data-testid={`input-${keyOf(r)}`} className="kc-select" aria-label={r.name} value={value} onChange={(e) => onCommit(e.target.value)}>{Array.from({ length: r.rawMax - r.rawMin + 1 }, (_, i) => r.rawMin + i).map((n) => <option key={n} value={n}>{fmt(n)}</option>)}</select><span className="kc-sr" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span></>;
  } else if (kind === "readonly") body = <span className="kc-value" data-testid={`value-${keyOf(r)}`}>{fmt(value)}</span>;
  else body = <ValueBox r={r} value={value} fmt={fmt} onCommit={onCommit} />;
  return <div {...rootProps(p, "kc-cell")}>{body}</div>;
}

// Picks the control for a row from its range and value texts.
export function KControl(p: CtlProps) {
  switch (kindOf(p.r, p.fmt)) {
    case "toggle": return <Toggle {...p} />;
    case "segmented": return <Segmented {...p} />;
    case "select": return <Choice {...p} />;
    case "dial": return <Dial {...p} />;
    case "field": return <Field {...p} />;
    default: return <ReadOnly {...p} />;
  }
}

// A framed box with a title bar, as the Kronos draws its panels.
export function Panel({ title, badge, className, children }: { title: string; badge?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`kp ${className ?? ""}`}>
      <header className="kp-title"><span>{title}</span>{badge}</header>
      <div className="kp-body">{children}</div>
    </section>
  );
}

export const Badge = ({ children, tone }: { children: ReactNode; tone?: "blue" | "red" | "green" }) => <span className={`kb-badge${tone ? ` kb-${tone}` : ""}`}>{children}</span>;
