// The Vector position as an XY square drawn above its parameter list. Dragging a point sets its X and Y and commits once on release.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Write } from "../../core/params/graphs.ts";
import { readParam } from "../../core/params/params.ts";
import { vectorFromPointer, vectorUnit, type Vector } from "../../core/params/shapes.ts";
import { KGrid } from "./KronosGraphBits.tsx";
import "./Graphs3.css";

const S = 240;
const PAD = 16;
const PLOT = S - 2 * PAD;

type Drag = { i: number; ux: number; uy: number };
type Unit = { ux: number; uy: number };

export function VectorGraph({ vec, entry, onWrite, kv }: { vec: Vector; entry: Uint8Array; onWrite: (writes: Write[]) => void; kv?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Keeps the grab point where it was, so the point does not jump to the pointer on the first move.
  const grab = useRef({ dx: 0, dy: 0 });
  const stored: Unit[] = vec.points.map((p) => ({ ux: vectorUnit(readParam(entry, p.x)), uy: vectorUnit(readParam(entry, p.y)) }));
  const shown: Unit[] = stored.map((u, i) => (drag && drag.i === i ? { ux: drag.ux, uy: drag.uy } : u));
  const X = (u: number) => PAD + u * PLOT;
  const Y = (u: number) => PAD + (1 - u) * PLOT;

  // Pointer position as 0..1 with 0 at the left and the bottom, so up is +Y.
  const units = (e: PointerEvent<Element>): Unit => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      ux: (((e.clientX - rect.left) / rect.width) * S - PAD) / PLOT,
      uy: 1 - (((e.clientY - rect.top) / rect.height) * S - PAD) / PLOT,
    };
  };

  const onDown = (i: number, e: PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = units(e);
    grab.current = { dx: stored[i].ux - p.ux, dy: stored[i].uy - p.uy };
    setDrag({ i, ux: stored[i].ux, uy: stored[i].uy });
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = units(e);
    setDrag({ i: drag.i, ux: p.ux + grab.current.dx, uy: p.uy + grab.current.dy });
  };
  const onUp = () => {
    if (!drag) return;
    const writes = vectorFromPointer(vec, drag.i, drag.ux, drag.uy);
    setDrag(null);
    onWrite(writes);
  };

  // Arrow keys move the point one raw step and commit at once: Right is +X, Up is +Y.
  const onKey = (i: number, e: KeyboardEvent<SVGCircleElement>) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const s = step[e.key];
    if (!s) return;
    e.preventDefault();
    onWrite(vectorFromPointer(vec, i, stored[i].ux + s[0] / 254, stored[i].uy + s[1] / 254));
  };

  return (
    <div className="g3" data-testid="graphs3-vector">
      <svg
        ref={svgRef}
        className="g3-svg g3-square"
        viewBox={`0 0 ${S} ${S}`}
        role="group"
        aria-label="Vector position"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        {kv && <KGrid w={S} h={S} pad={PAD} cols={4} rows={4} />}
        <rect className="g3-frame" x={PAD} y={PAD} width={PLOT} height={PLOT} />
        <polyline className="g3-line" points={shown.map((u) => `${X(u.ux)},${Y(u.uy)}`).join(" ")} />
        {shown.map((u, i) => (
          <circle
            key={i}
            data-testid={`graphs3-vector-point-${i}`}
            className="g3-handle"
            cx={X(u.ux)}
            cy={Y(u.uy)}
            r={6}
            tabIndex={0}
            role="slider"
            aria-label={`Vector point ${i}`}
            aria-valuetext={`X ${Math.round(u.ux * 254 - 127)}, Y ${Math.round(u.uy * 254 - 127)}`}
            onPointerDown={(e) => onDown(i, e)}
            onKeyDown={(e) => onKey(i, e)}
          />
        ))}
      </svg>
      <p className="g3-caption muted" data-testid="graphs3-vector-caption">
        Vector position, a shape, not a measurement. Right is +X, up is +Y.
      </p>
    </div>
  );
}
