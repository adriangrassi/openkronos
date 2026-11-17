// The filter response drawn above its parameter list. Dragging the handle sets cutoff and resonance and commits once on release.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Write } from "../../core/params/graphs.ts";
import { readParam } from "../../core/params/params.ts";
import { filterCurve, filterFromPointer, type Filter } from "../../core/params/shapes.ts";
import { KGrid, KLabel } from "./KronosGraphBits.tsx";
import "./Graphs3.css";

const W = 560;
const H = 180;
const PAD = 16;
const N = 120;

type Drag = { fx: number; fy: number };

export function FilterGraph({ f, entry, onWrite, kv }: { f: Filter; entry: Uint8Array; onWrite: (writes: Write[]) => void; kv?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Keeps the grab point where it was, so the handle does not jump to the pointer on the first move.
  const grab = useRef({ dx: 0, dy: 0 });
  const cur = { cutoff: readParam(entry, f.cutoff), resonance: readParam(entry, f.resonance) };
  const plotW = W - 2 * PAD;
  const plotH = H - 2 * PAD;
  const fx0 = cur.cutoff / f.cutoff.rawMax;
  const fy0 = 1 - cur.resonance / f.resonance.rawMax;

  // While dragging, the curve and handle show what a release would write.
  const preview = drag ? filterFromPointer(f, cur, drag.fx, drag.fy) : [];
  const cutoff = preview.find((w) => w.row === f.cutoff)?.value ?? cur.cutoff;
  const resonance = preview.find((w) => w.row === f.resonance)?.value ?? cur.resonance;
  const pts = filterCurve(readParam(entry, f.type), cutoff, resonance, N);
  const hx = PAD + (cutoff / f.cutoff.rawMax) * plotW;
  const hy = PAD + (1 - resonance / f.resonance.rawMax) * plotH;

  // Pointer position across the plot, 0..1 with 0 at the left and the top.
  const units = (e: PointerEvent<Element>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      fx: (((e.clientX - rect.left) / rect.width) * W - PAD) / plotW,
      fy: (((e.clientY - rect.top) / rect.height) * H - PAD) / plotH,
    };
  };

  const onDown = (e: PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = units(e);
    grab.current = { dx: fx0 - p.fx, dy: fy0 - p.fy };
    setDrag({ fx: fx0, fy: fy0 });
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = units(e);
    setDrag({ fx: p.fx + grab.current.dx, fy: p.fy + grab.current.dy });
  };
  const onUp = () => {
    if (!drag) return;
    const writes = filterFromPointer(f, cur, drag.fx, drag.fy);
    setDrag(null);
    if (writes.length) onWrite(writes);
  };

  // Arrow keys move the handle one step and commit at once: Right is higher cutoff, Up is more resonance.
  const onKey = (e: KeyboardEvent<SVGCircleElement>) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const s = step[e.key];
    if (!s) return;
    e.preventDefault();
    const writes = filterFromPointer(f, cur, (cur.cutoff + s[0]) / f.cutoff.rawMax, 1 - (cur.resonance + s[1]) / f.resonance.rawMax);
    if (writes.length) onWrite(writes);
  };

  return (
    <div className="g3" data-testid="graphs3-filter">
      <svg
        ref={svgRef}
        className="g3-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`${f.group} filter response`}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        <polyline
          data-testid="graphs3-filter-curve"
          className="g3-line"
          points={pts.map((y, i) => `${PAD + (i / (N - 1)) * plotW},${PAD + (1 - y) * plotH}`).join(" ")}
        />
        <circle
          data-testid="graphs3-filter-handle"
          className="g3-handle"
          cx={hx}
          cy={hy}
          r={6}
          tabIndex={0}
          role="slider"
          aria-label="Cutoff and resonance"
          aria-valuetext={`cutoff ${cutoff}, resonance ${resonance}`}
          onPointerDown={onDown}
          onKeyDown={onKey}
        />
      </svg>
      <p className="g3-caption muted" data-testid="graphs3-filter-caption">
        Filter response, a shape, not a measurement. Drag right for cutoff, up for resonance.
      </p>
    </div>
  );
}
