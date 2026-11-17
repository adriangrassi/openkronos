// Combination zone map: one bar per timbre across the keys (kind key) or up the velocities (kind vel). Read only: the timbre rows under it edit the edges.
import { readParam, type Row } from "../../core/params/params.ts";

const NAMES = { key: ["Key Window Bottom", "Key Window Top", 127, 0], vel: ["Vel.Window Low", "Vel.Window High", 127, 1] } as const;

// A window whose top lies below its bottom wraps round the ends of the range.
const spans = (lo: number, hi: number, min: number, max: number): [number, number][] => (hi >= lo ? [[lo, hi]] : [[min, hi], [lo, max]]);

export function KronosZones({ kind, rowOf, cur, selected }: { kind: "key" | "vel"; rowOf: (group: string, name: string) => Row | undefined; cur: Uint8Array; selected?: number }) {
  const [loName, hiName, max, min] = NAMES[kind];
  const bars = Array.from({ length: 16 }, (_, i) => {
    const lo = rowOf(`Timbre${i + 1}`, loName), hi = rowOf(`Timbre${i + 1}`, hiName);
    return { t: i + 1, spans: lo && hi ? spans(readParam(cur, lo), readParam(cur, hi), min, max) : [] };
  });
  const pct = (v: number) => `${((v - min) / (max - min + 1)) * 100}%`;
  const wide = (a: number, b: number) => `${((b - a + 1) / (max - min + 1)) * 100}%`;
  return (
    <div className={`kz kz-${kind}`} data-testid={`kronos-zones-${kind}`} role="img" aria-label={kind === "key" ? "Key windows of the 16 timbres" : "Velocity windows of the 16 timbres"}>
      {bars.map((b) => (
        <div key={b.t} className="kz-lane" data-sel={String(b.t === selected)}>
          <span className="kz-n">{b.t}</span>
          <span className="kz-track">
            {b.spans.map(([a, z], i) => <i key={i} className="kz-bar" style={kind === "key" ? { left: pct(a), width: wide(a, z) } : { bottom: pct(a), height: wide(a, z) }} />)}
          </span>
        </div>
      ))}
      {kind === "key" && <div className="kz-ruler" aria-hidden="true">{Array.from({ length: 11 }, (_, o) => <span key={o} style={{ left: pct(o * 12) }}>C{o - 1}</span>)}</div>}
    </div>
  );
}
