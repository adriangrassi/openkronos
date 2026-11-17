// Wave Sequence timeline: the shown steps as blocks whose width follows Duration, the loop range marked, and an end handle per step.
// A drag or an arrow key changes one step's Duration; a drag commits once on release.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { waveShown, type WaveTimeline as Timeline } from "../../core/params/graphs2.ts";
import type { Write } from "../../core/params/graphs.ts";

type Drag = { step: number; value: number };

export function WaveTimeline({ tl, onWrite }: { tl: Timeline; onWrite: (writes: Write[]) => void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const shown = waveShown(tl);
  const value = (i: number) => (drag?.step === i ? drag.value : tl.steps[i].duration);
  // The scale is the total of the saved durations, so the handles keep their place while one is dragged.
  const total = Math.max(1, shown.reduce((a, i) => a + tl.steps[i].duration, 0));
  const edges = [0];
  for (const i of shown) edges.push(edges[edges.length - 1] + value(i));
  const pct = (v: number) => `${(v / total) * 100}%`;

  const startDrag = (i: number, e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const handleEl = e.currentTarget;
    handleEl.setPointerCapture(e.pointerId);
    const width = trackRef.current!.getBoundingClientRect().width;
    const unitsPerPx = total / Math.max(1, width);
    const { duration: start, durationRow: row } = tl.steps[i];
    const startX = e.clientX;
    const clamp = (v: number) => Math.min(row.rawMax, Math.max(row.rawMin, Math.round(v)));
    const move = (ev: globalThis.PointerEvent) => setDrag({ step: i, value: clamp(start + (ev.clientX - startX) * unitsPerPx) });
    const up = (ev: globalThis.PointerEvent) => {
      handleEl.removeEventListener("pointermove", move);
      handleEl.removeEventListener("pointerup", up);
      setDrag(null);
      const v = clamp(start + (ev.clientX - startX) * unitsPerPx);
      if (v !== start) onWrite([{ row, value: v }]);
    };
    handleEl.addEventListener("pointermove", move);
    handleEl.addEventListener("pointerup", up);
  };

  // Arrow keys move the duration by one: Right and Up lengthen, Left and Down shorten.
  const stepKey = (i: number, e: KeyboardEvent<HTMLSpanElement>) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const { duration, durationRow: row } = tl.steps[i];
    const v = Math.min(row.rawMax, Math.max(row.rawMin, duration + d));
    if (v !== duration) onWrite([{ row, value: v }]);
  };

  // The loop range is drawn only when both of its ends are among the shown steps.
  const p1 = shown.indexOf(tl.loopStart);
  const p2 = shown.indexOf(tl.loopEnd);
  const loop = p1 >= 0 && p2 >= p1 ? { left: pct(edges[p1]), width: pct(edges[p2 + 1] - edges[p1]) } : null;

  return (
    <div className="wt" data-testid="wave-timeline">
      <div className="wt-track" ref={trackRef}>
        {loop && <div data-testid="wave-loop" className="wt-loop" style={loop} />}
        {shown.map((i, k) => {
          const n = i + 1;
          return (
            <div
              key={n}
              data-testid={`wave-step-${n}`}
              className={`wt-block${tl.steps[i].type === 1 ? " rest" : ""}`}
              style={{ left: pct(edges[k]), width: pct(value(i)) }}
              title={`Step ${n}, duration ${value(i)}`}
            >
              <span className="wt-num">{n}</span>
            </div>
          );
        })}
        {shown.map((i, k) => {
          const n = i + 1;
          const v = value(i);
          return (
            <span
              key={`h${n}`}
              data-testid={`wave-step-end-${n}`}
              className="wt-handle"
              role="slider"
              tabIndex={0}
              aria-label={`Step ${n} duration`}
              aria-valuemin={tl.steps[i].durationRow.rawMin}
              aria-valuemax={tl.steps[i].durationRow.rawMax}
              aria-valuenow={v}
              style={{ left: pct(edges[k + 1]) }}
              onPointerDown={(e) => startDrag(i, e)}
              onKeyDown={(e) => stepKey(i, e)}
            />
          );
        })}
      </div>
      <p className="wt-note muted">
        Steps {tl.startStep + 1} to {tl.endStep + 1}, loop {tl.loopStart + 1} to {tl.loopEnd + 1}; the widths are Duration
      </p>
    </div>
  );
}
