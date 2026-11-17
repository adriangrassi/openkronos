// Style A hardware faces drawn over the existing controls. They only paint: the dial's svg and the fader's range input keep all the input logic.
// Size tokens: dial 58 px (viewBox 72, ring r26, cap r19.5), mini encoder 28 px (hit area; ring r11), fader 44 px wide with a FADER_CAP tall cap on a 4 px slot.
// Hairlines (ticks, edges, knurl) carry vector-effect: non-scaling-stroke in theme-a.css, so they stay 1 CSS px at any size and device scale.
import { memo, type HTMLAttributes } from "react";
import { arcDeg, detentOf, dialTicks, encoderTip, faderCapTop, faderTicks, knurlPath, radialAt } from "./face.ts";
import { arcPath, fracOf } from "../../../core/pages/dial.ts";

// Under the cap: tick marks, the focus ring, the shadow, the body, its knurled rim and the light and shade on its edge. Constant, so it renders once per size.
// cx, cy: centre; rb: body radius; tr: where the tick marks start.
export const DialFace = memo(function DialFace({ cx, cy, rb, tr }: { cx: number; cy: number; rb: number; tr: number }) {
  const k = rb / 19.5;
  const ticks = dialTicks(cx, cy, tr, 10, 5, 2.5 * k, 4.5 * k);
  return (
    <g className="ta-face" aria-hidden="true">
      <path className="ta-tick" d={ticks.short} />
      <path className="ta-tick ta-long" d={ticks.long} />
      <circle className="ta-focus" cx={cx} cy={cy} r={rb + 3.2 * k} />
      <circle className="ta-shadow" cx={cx} cy={cy + 2 * k} r={rb} />
      <circle className="ta-body" cx={cx} cy={cy} r={rb} />
      <path className="ta-knurl" d={knurlPath(cx, cy, rb * 0.8, rb * 0.95, 48)} />
      <path className="ta-lit-edge" d={arcDeg(cx, cy, rb - 0.5, -85, 5)} />
      <path className="ta-shade-edge" d={arcDeg(cx, cy, rb - 0.5, 95, 185)} />
    </g>
  );
});

// Over the body: the cap with a lit upper-left edge and a shaded lower-right one.
export const DialCap = memo(function DialCap({ cx, cy, rc }: { cx: number; cy: number; rc: number }) {
  return (
    <g className="ta-capface" aria-hidden="true">
      <circle className="kc-cap knob-cap" cx={cx} cy={cy} r={rc} />
      <path className="ta-lit-edge ta-cap-lit" d={arcDeg(cx, cy, rc - 1.1, -80, 10)} />
      <path className="ta-shade-edge ta-cap-shade" d={arcDeg(cx, cy, rc - 1.1, 100, 190)} />
    </g>
  );
});

// The detent marker of a bipolar dial: a notch across the track at the zero, where the arc starts.
export function DetentMark({ cx, cy, r0, r1, centre }: { cx: number; cy: number; r0: number; r1: number; centre: number | null }) {
  const f = detentOf(centre);
  if (f === null) return null;
  const m = radialAt(cx, cy, r0, r1, f);
  return <line className="ta-detent" x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} />;
}

export const FADER_W = 44;
export const FADER_CAP = 28;
const CAP_X = 14;
const CAP_W = 24;

// Scale and slot: constant for a given height.
const FaderStatic = memo(function FaderStatic({ h }: { h: number }) {
  const ticks = faderTicks(9, FADER_CAP / 2, h - FADER_CAP / 2, 10, 5, 4, 6);
  return (
    <>
      <path className="ta-tick" d={ticks.short} />
      <path className="ta-tick ta-long" d={ticks.long} />
      <rect className="ta-slot" x="24" y={FADER_CAP / 2} width="4" height={Math.max(0, h - FADER_CAP)} rx="2" />
    </>
  );
});

// The fader's cap, slot and scale, behind a transparent range input whose thumb is FADER_CAP tall (--ta-cap), so the two stay in step. The cap sits on whole pixels so its edges stay sharp.
export function FaderFace({ h, f }: { h: number; f: number }) {
  const top = Math.round(faderCapTop(f, h, FADER_CAP));
  const mid = FADER_CAP / 2;
  const lit = Math.max(0, h - FADER_CAP / 2 - (top + mid));
  const g = (dy: number): string => `M${CAP_X + 3} ${mid + dy}h${CAP_W - 6}`;
  return (
    <svg className="ta-fader-svg" width={FADER_W} height={h} viewBox={`0 0 ${FADER_W} ${h}`} aria-hidden="true">
      <FaderStatic h={h} />
      <rect className="ta-lit" x="25" y={top + mid} width="2" height={lit} />
      <g transform={`translate(0 ${top})`}>
        <rect className="ta-cap-shadow" x={CAP_X} y="2" width={CAP_W} height={FADER_CAP} rx="3" />
        <rect className="ta-cap" x={CAP_X} y="0" width={CAP_W} height={FADER_CAP} rx="3" />
        <path className="ta-cap-hi" d={`M${CAP_X + 2} 1.5h${CAP_W - 4}`} />
        <path className="ta-groove" d={`${g(-7)}${g(-3.5)}${g(3.5)}${g(7)}`} />
        <path className="ta-groove-hi" d={`${g(-6)}${g(-2.5)}${g(4.5)}${g(8)}`} />
        <path className="ta-ind" d={`M${CAP_X} ${mid}h${CAP_W}`} />
      </g>
    </svg>
  );
}

// A 28 px hit area holding a rotary beside a numeric box: track, amber arc from the zero point (or the minimum), detent notch, indicator. centre: fraction where the arc starts, null for the minimum.
export function MiniEncoder({ v, min, max, centre, handlers }: { v: number; min: number; max: number; centre: number | null; handlers?: HTMLAttributes<HTMLSpanElement> }) {
  const f = fracOf(v, min, max);
  const [x, y] = encoderTip(14, 14, 5.5, f);
  const [x0, y0] = encoderTip(14, 14, 2, f);
  return (
    <span className="ta-enc-hit" {...handlers}>
      <svg className="ta-enc" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path className="ta-enc-track" d={arcPath(14, 14, 10.5, 0, 1)} />
        <path className="ta-enc-arc" d={arcPath(14, 14, 10.5, centre ?? 0, f)} />
        <DetentMark cx={14} cy={14} r0={8.6} r1={12.6} centre={centre} />
        <circle className="ta-enc-body" cx="14" cy="14" r="7.5" />
        <path className="ta-lit-edge ta-enc-lit" d={arcDeg(14, 14, 6.4, -80, 10)} />
        <path className="ta-ind" d={`M${x0} ${y0}L${x} ${y}`} />
      </svg>
    </span>
  );
}
