// Effects page for a Program or Combination: the 16 effect slots, the Kronos's own type names and named controls for the chosen type.
import { useEffect, useRef, useState } from "react";
import { changeEffectType, effectParamRows, effectSlots, effectTypeName, type EffectKind } from "../../core/params/effects.ts";
import { formatValue, readParam, writeParam, type ParamTables, type Row } from "../../core/params/params.ts";
import { getEntry, setEntry } from "../../core/pcg/library.ts";
import type { PointAt } from "../../core/ai/point.ts";
import type { Workspace } from "./document.ts";
import "./EffectsPanel.css";

type Props = { tables: ParamTables; ws: Workspace; target: { key: string; index: number }; kind: EffectKind; onChanged: () => void; point?: PointAt | null; onPointClear?: () => void };

// Turns typed text into a raw value: the shown format (5.5), or a plain raw number where the display is the raw number. null = refused.
// shortcut: the text is matched against every value of the range, so a range wider than a few thousand values would be slow; none of the effect tables is
export function parseShown(tables: ParamTables, r: Row, text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  for (let v = r.rawMin; v <= r.rawMax; v++) {
    const shown = formatValue(r, v, tables);
    if (shown.toLowerCase() === t.toLowerCase() || (Number.isFinite(n) && shown !== "" && Number(shown) === n)) return v;
  }
  return null;
}

export function EffectsPanel({ tables, ws, target, kind, onChanged, point = null, onPointClear }: Props) {
  const [open, setOpen] = useState(false);
  const [slotId, setSlotId] = useState("ifx1");
  const [err, setErr] = useState("");
  const slots = effectSlots(tables, kind);
  const slot = slots.find((s) => s.id === slotId) ?? slots[0];
  const entry = getEntry(ws.file, target.key, target.index);
  const typeId = entry[slot.typeOfs];
  const unknown = new Set(window.kronos.e2eEffectsUnknown.split(",").filter(Boolean).map(Number));
  const rows = unknown.has(typeId) ? null : effectParamRows(tables, kind, slot.id, typeId);

  // Ask & show: open on the slot that holds the pointed parameter (ids are offset.bit, the same as the List rows), then bring it into view.
  const pageRef = useRef<HTMLDivElement>(null);
  const idOf = (r: Row) => `${r.ofs}.${r.bitLo ?? 0}`;
  useEffect(() => {
    const s = point && slots.find((x) => effectParamRows(tables, kind, x.id, entry[x.typeOfs])?.some((r) => idOf(r) === point.ids[0]));
    if (s) { setOpen(true); setSlotId(s.id); }
  }, [point]);
  useEffect(() => { if (point) pageRef.current?.querySelector("[data-pointed=true]")?.scrollIntoView({ block: "center" }); }, [point, open, slotId]);

  async function write(mutate: (e: Uint8Array) => void) {
    try {
      await ws.apply([target], () => {
        const e = getEntry(ws.file, target.key, target.index);
        mutate(e);
        setEntry(ws.file, target.key, target.index, e);
      });
      setErr("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const chooseType = (id: number) => {
    if (!Number.isInteger(id) || id < 0 || id > 197 || id === typeId) return;
    void write((e) => changeEffectType(e, slot.typeOfs, id));
  };
  const commit = (r: Row, text: string) => {
    const v = parseShown(tables, r, text);
    if (v === null) return setErr(`${r.name}: "${text}" is not a value from ${formatValue(r, r.rawMin, tables)} to ${formatValue(r, r.rawMax, tables)}`);
    if (readParam(getEntry(ws.file, target.key, target.index), r) === v) return setErr("");
    void write((e) => writeParam(e, r, v));
  };

  if (!open) return <button data-testid="effects-open" onClick={() => setOpen(true)}>Effects</button>;
  return (
    <div className="fx-page" data-testid="effects-page" ref={pageRef}>
      <div className="fx-slots">
        <button onClick={() => setOpen(false)}>Close effects</button>
        {slots.map((s) => (
          <button key={s.id} data-testid={`effects-slot-${s.id}`} aria-pressed={s.id === slot.id} onClick={() => { setSlotId(s.id); setErr(""); onPointClear?.(); }}>{s.label}</button>
        ))}
      </div>
      <div className="fx-type">
        <select data-testid="effects-type" aria-label={`${slot.label} type`} value={typeId} onChange={(e) => chooseType(Number(e.target.value))}>
          {tables.effectTypes.map((n, i) => <option key={i} value={String(i)}>{n}</option>)}
        </select>
        <span data-testid="effects-type-name">{effectTypeName(tables, typeId)}</span>
      </div>
      {err && <p className="fx-error" role="alert">{err}</p>}
      {rows === null && <p className="fx-note" data-testid="effects-generic">The parameters of this effect type are not known, so the controls are generic: use the Parameters list for this slot's bytes.</p>}
      <div className="fx-params">
        {rows?.map((r) => (
          <FxRow key={r.pid} tables={tables} r={r} pointed={!!point?.ids.includes(idOf(r))} value={readParam(entry, r)} onCommit={(t) => r.fixed || commit(r, t)} />
        ))}
      </div>
    </div>
  );
}

function FxRow({ tables, r, value, pointed, onCommit }: { tables: ParamTables; r: Row; value: number; pointed: boolean; onCommit: (t: string) => void }) {
  const shown = formatValue(r, value, tables);
  const [draft, setDraft] = useState(shown);
  const [last, setLast] = useState(shown);
  if (last !== shown) { setLast(shown); setDraft(shown); }
  const p = r.pid;
  return (
    <div className={pointed ? "fx-row pointed" : "fx-row"} data-pointed={pointed ? "true" : undefined} data-testid={`effects-param-${p}`}>
      <span data-testid={`effects-label-${p}`}>{r.name}</span>
      <span data-testid={`effects-value-${p}`}>{shown}</span>
      <input data-testid={`effects-input-${p}`} aria-label={r.name} value={draft} readOnly={r.fixed} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onCommit(draft); }} />
    </div>
  );
}
