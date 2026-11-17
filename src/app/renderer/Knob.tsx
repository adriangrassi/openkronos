import { useRef } from "react";
import { DialCap, DialFace } from "./theme-a/Faces.tsx";
import { useThemeA } from "./theme-a/useTheme.ts";
import "./Knob.css";

type Props = {
  value: number;
  min: number;
  max: number;
  label: string;
  testId: string;
  disabled: boolean;
  onChange: (v: number) => void;
  // Called once when a drag or a key press ends, with the final value.
  onCommit: (v: number) => void;
};

const R = 28;
const SWEEP = 135;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const xy = (deg: number, r: number): [string, string] => [(40 + r * Math.sin((deg * Math.PI) / 180)).toFixed(2), (40 - r * Math.cos((deg * Math.PI) / 180)).toFixed(2)];
const pt = (deg: number): string => xy(deg, R).join(" ");
const arc = (from: number, to: number): string => `M ${pt(from)} A ${R} ${R} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${pt(to)}`;

// A rotary dial over a real range input. The input takes the keyboard and assistive tech; dragging the dial up or down moves it too.
export function Knob({ value, min, max, label, testId, disabled, onChange, onCommit }: Props) {
  const themeA = useThemeA();
  const drag = useRef<{ y: number; v: number; last: number } | null>(null);
  const mid = (min + max) / 2;
  const deg = ((value - mid) / ((max - min) / 2)) * SWEEP;

  return (
    <div
      className="knob"
      data-explain={label}
      data-explain-value={String(value)}
      data-disabled={disabled ? "true" : "false"}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: value, last: value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // 2 px per step, 8 px with Shift for fine moves.
        d.last = clamp(Math.round(d.v + (d.y - e.clientY) / (e.shiftKey ? 8 : 2)), min, max);
        onChange(d.last);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d) onCommit(d.last);
      }}
      onDoubleClick={() => !disabled && onCommit(0)}
    >
      <svg viewBox="0 0 80 80" shapeRendering={themeA ? "geometricPrecision" : undefined} aria-hidden="true">
        <path className="knob-track" d={arc(-SWEEP, SWEEP)} />
        {deg !== 0 && <path className="knob-value" d={arc(0, deg)} />}
        {themeA ? (
          <>
            <DialFace cx={40} cy={40} rb={20} tr={31.6} />
            <DialCap cx={40} cy={40} rc={15.8} />
            <line className="knob-tick" x1={xy(deg, 5)[0]} y1={xy(deg, 5)[1]} x2={xy(deg, 14)[0]} y2={xy(deg, 14)[1]} />
          </>
        ) : (
          <>
            <circle className="knob-cap" cx="40" cy="40" r="20" />
            <line className="knob-tick" x1={xy(deg, 6)[0]} y1={xy(deg, 6)[1]} x2={xy(deg, 19)[0]} y2={xy(deg, 19)[1]} />
          </>
        )}
      </svg>
      <input
        data-testid={testId}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyUp={(e) => onCommit(Number(e.currentTarget.value))}
      />
    </div>
  );
}
