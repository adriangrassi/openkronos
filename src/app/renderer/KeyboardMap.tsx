// Combi keyboard map: each timbre's key window and velocity window on one keyboard. Edges drag or step by one; each change is one undo step.
import { Fragment, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampZoneEdge, timbreRows, timbreZones, type Edge, type Write, type Zone } from "../../core/params/graphs.ts";
import { formatValue, readParam, type ParamTables, type Row } from "../../core/params/params.ts";
import { getName, listBanks } from "../../core/pcg/library.ts";
import { columnOf, programKey } from "../../core/pcg/refs.ts";
import type { PcgFile } from "../../core/pcg/pcg.ts";
import { ProgramPicker } from "./ProgramPicker.tsx";

const NOTES = 128;
const BLACK = [1, 3, 6, 8, 10];

type Preview = { timbre: number; edge: Edge; value: number };

const pct = (v: number) => `${(v / NOTES) * 100}%`;

// The program name when the bank is one the library tracks; otherwise the raw bank and program.
function sound(file: PcgFile, tables: ParamTables, t: number, entry: Uint8Array): string {
  const r = timbreRows(tables, t);
  const bank = readParam(entry, r.bank);
  const program = readParam(entry, r.program);
  const key = programKey(bank);
  if (key !== null && listBanks(file).some((b) => b.key === key)) return getName(file, key, program);
  return `Bank ${formatValue(r.bank, bank)}, program ${formatValue(r.program, program, tables)}`;
}

export function KeyboardMap({ tables, file, entry, onWrite }: { tables: ParamTables; file: PcgFile; entry: Uint8Array; onWrite: (writes: Write[]) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  // The timbre whose Program picker is open, if any.
  const [picking, setPicking] = useState<number | null>(null);
  const zones: Zone[] = timbreZones(tables, entry);
  const drag = (t: number) => (preview?.timbre === t ? preview : null);

  // Pointer drags move an edge by the distance travelled, so it does not jump to the pointer.
  const startDrag = (zone: Zone, edge: Edge, e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    // The native listeners below run after React has cleared e.currentTarget, so the element is kept here.
    const handleEl = e.currentTarget;
    handleEl.setPointerCapture(e.pointerId);
    const width = handleEl.parentElement!.getBoundingClientRect().width;
    const startX = e.clientX;
    const startValue = zone[edge];
    const move = (ev: globalThis.PointerEvent) => {
      const delta = ((ev.clientX - startX) / width) * NOTES;
      setPreview({ timbre: zone.timbre, edge, value: clampZoneEdge(zone, edge, startValue + delta) });
    };
    const up = (ev: globalThis.PointerEvent) => {
      handleEl.removeEventListener("pointermove", move);
      handleEl.removeEventListener("pointerup", up);
      setPreview(null);
      const value = clampZoneEdge(zone, edge, startValue + ((ev.clientX - startX) / width) * NOTES);
      if (value !== startValue) onWrite([{ row: timbreRows(tables, zone.timbre)[edge], value }]);
    };
    handleEl.addEventListener("pointermove", move);
    handleEl.addEventListener("pointerup", up);
  };

  // Arrow keys move an edge by one: Right and Up raise it, Left and Down lower it.
  const stepEdge = (zone: Zone, edge: Edge, e: KeyboardEvent<HTMLSpanElement>) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const value = clampZoneEdge(zone, edge, zone[edge] + d);
    if (value !== zone[edge]) onWrite([{ row: timbreRows(tables, zone.timbre)[edge], value }]);
  };

  // A handle sits on the edge of its note: the low edge at the note's left side, the high edge at its right side.
  const handle = (zone: Zone, edge: Edge, label: string, low: boolean, row: Row, velocity: boolean) => {
    const v = drag(zone.timbre)?.edge === edge ? drag(zone.timbre)!.value : zone[edge];
    const at = low ? v : v + 1;
    const max = velocity ? 127 : NOTES - 1;
    return (
      <span
        data-testid={`zone-${velocity ? "vel-" : ""}${edge === "keyBottom" || edge === "velLow" ? "low" : "high"}-${zone.timbre}`}
        className={velocity ? "km-handle km-handle-vel" : "km-handle"}
        role="slider"
        tabIndex={0}
        aria-label={`Timbre ${zone.timbre} ${label}`}
        aria-valuemin={velocity ? 1 : 0}
        aria-valuemax={max}
        aria-valuenow={v}
        aria-valuetext={formatValue(row, v)}
        style={{ left: pct(at) }}
        onPointerDown={(e) => startDrag(zone, edge, e)}
        onKeyDown={(e) => stepEdge(zone, edge, e)}
      />
    );
  };

  return (
    <div className="km" data-testid="keymap">
      <div className="km-row km-head-row">
        <span className="km-name muted">Timbre</span>
        <div className="km-keys" aria-hidden="true">
          {Array.from({ length: NOTES }, (_, n) => (
            <span key={n} className={BLACK.includes(n % 12) ? "km-k b" : "km-k w"} />
          ))}
        </div>
      </div>
      {zones.map((z) => {
        const t = z.timbre;
        const rows = timbreRows(tables, t);
        const cur = drag(t) ? { ...z, [drag(t)!.edge]: drag(t)!.value } : z;
        const off = formatValue(rows.status, cur.status) === "Off";
        const lo = Math.min(cur.keyBottom, cur.keyTop);
        const hi = Math.max(cur.keyBottom, cur.keyTop);
        const vlo = cur.velLow;
        const vhi = cur.velHigh;
        // One undo step writes the Bank Number and the Program Number together.
        const pick = (key: string, index: number) => {
          setPicking(null);
          onWrite([{ row: rows.bank, value: columnOf(key) }, { row: rows.program, value: index }]);
        };
        return (
          <Fragment key={t}>
          <div className="km-row" data-off={off ? "true" : undefined}>
            <div className="km-name">
              <span className="km-num">{t}</span>
              <span data-testid={`zone-label-${t}`} className="km-label">{sound(file, tables, t, entry)}</span>
              <button data-testid={`zone-pick-${t}`} onClick={() => setPicking(picking === t ? null : t)}>Program</button>
              <button data-testid={`zone-status-${t}`} onClick={() => onWrite([{ row: rows.status, value: cur.status === 0 ? 1 : 0 }])}>{off ? "Off" : "On"}</button>
              <span data-testid={`zone-range-${t}`} className="km-range muted">
                {`${formatValue(rows.keyBottom, cur.keyBottom)} to ${formatValue(rows.keyTop, cur.keyTop)}`}
              </span>
            </div>
            <div className="km-lane">
              <div data-testid={`zone-${t}`} data-off={off ? "true" : undefined} className="km-strip">
                <div className="km-bar" style={{ left: pct(lo), width: pct(hi - lo + 1) }} />
                {handle(z, "keyBottom", "low key", true, rows.keyBottom, false)}
                {handle(z, "keyTop", "high key", false, rows.keyTop, false)}
              </div>
              <div className="km-strip km-vel" role="group" aria-label={`Timbre ${t} velocity`}>
                <div className="km-bar" style={{ left: pct(vlo), width: pct(vhi - vlo + 1) }} />
                {handle(z, "velLow", "low velocity", true, rows.velLow, true)}
                {handle(z, "velHigh", "high velocity", false, rows.velHigh, true)}
              </div>
            </div>
          </div>
          {picking === t && <ProgramPicker file={file} onPick={pick} onClose={() => setPicking(null)} />}
          </Fragment>
        );
      })}
    </div>
  );
}
