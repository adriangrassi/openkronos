// The envelope drawn above its parameter list. Points follow the pointer while dragging and commit once on release.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { KGrid, KLabel } from "./KronosGraphBits.tsx";
import { dragEnvelope, envelopeAxes, envelopePoints, readEnvelope, type Envelope, type EnvelopeValues, type Point, type Write } from "../../core/params/graphs.ts";

const W = 560;
const H = 180;
const PAD = 16;
const POINT_NAMES = ["Start level", "Attack", "Break", "Sustain start", "Sustain end", "Release end"];

type Drag = { point: number; x: number; y: number };

// The field that a write changes, named as in EnvelopeValues (the field keys match).
function applyWrites(env: Envelope, values: EnvelopeValues, writes: Write[]): EnvelopeValues {
  const out = { ...values };
  for (const w of writes) {
    const k = (Object.keys(env.fields) as (keyof Envelope["fields"])[]).find((f) => env.fields[f] === w.row);
    if (k) out[k] = w.value;
  }
  return out;
}

export function EnvelopeGraph({ env, entry, onWrite, kv }: { env: Envelope; entry: Uint8Array; onWrite: (writes: Write[]) => void; kv?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Keeps the grab point where it was, so the point does not jump to the pointer on the first move.
  const grab = useRef({ dx: 0, dy: 0 });
  const axes = envelopeAxes(env);
  const values = readEnvelope(env, entry);
  const levelSpan = Math.max(1, axes.levelMax - axes.levelMin);
  const plotW = W - 2 * PAD;
  const plotH = H - 2 * PAD;
  const X = (t: number) => PAD + (t / axes.axisMax) * plotW;
  const Y = (v: number) => PAD + ((axes.levelMax - v) / levelSpan) * plotH;

  // While a point is dragged, the shape shows what the release would write.
  const preview = drag ? applyWrites(env, values, dragEnvelope(env, values, drag.point, drag.x, drag.y)) : values;
  const pts: Point[] = envelopePoints(preview);

  // Converts a pointer position to envelope units, the same space envelopePoints uses.
  const units = (e: PointerEvent<Element>): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    return { x: ((px - PAD) / plotW) * axes.axisMax, y: axes.levelMax - ((py - PAD) / plotH) * levelSpan };
  };

  const onDown = (k: number, e: PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = units(e);
    grab.current = { dx: pts[k].x - p.x, dy: pts[k].y - p.y };
    setDrag({ point: k, x: pts[k].x, y: pts[k].y });
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = units(e);
    setDrag({ point: drag.point, x: p.x + grab.current.dx, y: p.y + grab.current.dy });
  };
  const onUp = () => {
    if (!drag) return;
    const writes = dragEnvelope(env, values, drag.point, drag.x, drag.y);
    setDrag(null);
    onWrite(writes);
  };

  // Arrow keys move a point by one unit and commit at once: Left and Right the time, Up and Down the level.
  const onKey = (k: number, e: KeyboardEvent<SVGCircleElement>) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const s = step[e.key];
    if (!s) return;
    e.preventDefault();
    onWrite(dragEnvelope(env, values, k, pts[k].x + s[0], pts[k].y + s[1]));
  };

  const zeroY = Y(0);
  return (
    <div className="eg" data-testid="eg-graph">
      <svg
        ref={svgRef}
        className="eg-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`${env.group} envelope`}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        {kv && <KGrid w={W} h={H} pad={PAD} />}
        {kv && <KLabel x={W - PAD - 4} y={PAD + 12} anchor="end">LEVEL</KLabel>}
        {kv && <KLabel x={W - PAD - 4} y={H - PAD - 4} anchor="end">TIME</KLabel>}
        {axes.levelMin < 0 && <line className="eg-zero" x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} />}
        <polyline className="eg-line" points={pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")} />
        {pts.map((p, k) => (
          <circle
            key={k}
            data-testid={`eg-point-${k}`}
            className="eg-point"
            cx={X(p.x)}
            cy={Y(p.y)}
            r={6}
            tabIndex={0}
            role="slider"
            aria-label={POINT_NAMES[k]}
            aria-valuetext={`time ${Math.round(p.x)}, level ${Math.round(p.y)}`}
            onPointerDown={(e) => onDown(k, e)}
            onKeyDown={(e) => onKey(k, e)}
          />
        ))}
      </svg>
      <p className="eg-note muted">shape, not seconds{axes.levelMin < 0 ? "; centre line is level 0" : ""}</p>
    </div>
  );
}
